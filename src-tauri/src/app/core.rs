use super::*;

// Global jieba instance for Chinese tokenization
pub(crate) static JIEBA: LazyLock<Jieba> = LazyLock::new(|| Jieba::new());

// Cache for command stats with incremental update support
// (stats, scanned_files with their mtime)
pub(crate) static COMMAND_STATS_CACHE: LazyLock<Mutex<CommandStatsCache>> =
    LazyLock::new(|| Mutex::new(CommandStatsCache::default()));

pub(crate) static LOVCODE_RELEASES_CACHE: LazyLock<
    Mutex<Option<(SystemTime, Vec<LovcodeRelease>)>>,
> = LazyLock::new(|| Mutex::new(None));
pub(crate) static SETTINGS_WRITE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
pub(crate) const LOVCODE_RELEASES_CACHE_TTL: Duration = Duration::from_secs(30 * 60);
pub(crate) const ZENMUX_MODELS_API_URL: &str = "https://zenmux.ai/api/v1/models";
pub(crate) const ZENMUX_DEFAULT_FETCH_COMMAND: &str = "GET https://zenmux.ai/api/v1/models";

#[derive(Default)]
pub(crate) struct CommandStatsCache {
    pub(crate) stats: HashMap<String, usize>,
    pub(crate) scanned: HashMap<String, u64>, // path -> file_size (for incremental read)
}

// Custom tokenizer for Chinese + English mixed content
#[derive(Clone)]
pub(crate) struct JiebaTokenizer;

impl Tokenizer for JiebaTokenizer {
    type TokenStream<'a> = JiebaTokenStream;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        let words = JIEBA.cut_for_search(text, true);
        let mut tokens = Vec::new();
        let base = text.as_ptr() as usize;

        for word in words {
            let word_str = word.trim();
            if !word_str.is_empty() {
                let start = word.as_ptr() as usize - base;
                let end = start + word.len();
                tokens.push(Token {
                    offset_from: start,
                    offset_to: end,
                    position: tokens.len(),
                    text: word_str.to_string(),
                    position_length: 1,
                });
            }
        }

        JiebaTokenStream { tokens, index: 0 }
    }
}

pub(crate) struct JiebaTokenStream {
    pub(crate) tokens: Vec<Token>,
    pub(crate) index: usize,
}

impl TokenStream for JiebaTokenStream {
    fn advance(&mut self) -> bool {
        if self.index < self.tokens.len() {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn token(&self) -> &Token {
        &self.tokens[self.index - 1]
    }

    fn token_mut(&mut self) -> &mut Token {
        &mut self.tokens[self.index - 1]
    }
}

// Global search index state
pub(crate) static SEARCH_INDEX: Mutex<Option<SearchIndex>> = Mutex::new(None);
pub(crate) static SEARCH_INDEX_BUILD_LOCK: Mutex<()> = Mutex::new(());

// Distill watch state
pub(crate) static DISTILL_WATCH_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

// Claude Code install process PID (for cancellation)
pub(crate) static CC_INSTALL_PID: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);
pub(crate) static CODEX_INSTALL_PID: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);

pub(crate) struct SearchIndex {
    pub(crate) index: Index,
    pub(crate) schema: Schema,
}

pub(crate) fn get_index_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovcode")
        .join("search-index")
}

pub(crate) fn get_command_stats_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovcode")
        .join("command-stats.json")
}

pub(crate) const JIEBA_TOKENIZER_NAME: &str = "jieba";

pub(crate) fn create_schema() -> Schema {
    let mut schema_builder = Schema::builder();

    // Use custom jieba tokenizer for content fields to support Chinese
    let text_options = TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer(JIEBA_TOKENIZER_NAME)
                .set_index_option(schema::IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored();

    schema_builder.add_text_field("uuid", STRING | STORED);
    schema_builder.add_text_field("content", text_options.clone());
    schema_builder.add_text_field("title", text_options.clone());
    schema_builder.add_text_field("summary", text_options.clone());
    schema_builder.add_text_field("last_prompt", text_options.clone());
    schema_builder.add_text_field("prompt", text_options.clone());
    schema_builder.add_text_field("user", text_options.clone());
    schema_builder.add_text_field("assistant", text_options.clone());
    schema_builder.add_text_field("project", text_options.clone());
    schema_builder.add_text_field("role", STRING | STORED);
    schema_builder.add_text_field("project_id", STRING | STORED);
    schema_builder.add_text_field("project_path", STRING | STORED);
    schema_builder.add_text_field("session_id", STRING | STORED);
    schema_builder.add_text_field("session_summary", text_options);
    schema_builder.add_text_field("timestamp", STRING | STORED);
    schema_builder.build()
}

pub(crate) fn register_jieba_tokenizer(index: &Index) {
    let tokenizer = TextAnalyzer::builder(JiebaTokenizer)
        .filter(LowerCaser)
        .build();
    index.tokenizers().register(JIEBA_TOKENIZER_NAME, tokenizer);
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Project {
    pub id: String,
    pub path: String,
    pub session_count: usize,
    pub last_active: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceSession {
    pub id: String,
    pub provider: String,
    pub runtime: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_prompt: Option<String>,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pty_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub harness_messages: Vec<AgentHarnessMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_exit_code: Option<i32>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_history_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_link_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_link_last_tried_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_link_last_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_parent_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_from_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_from_title: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<u64>,
    #[serde(default)]
    pub unread: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_viewed_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentHarnessMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
    #[serde(default)]
    pub transient: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceConversationMeta {
    pub id: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<u64>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub needs_review: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceState {
    #[serde(default = "default_agent_workspace_version")]
    pub version: u32,
    #[serde(default)]
    pub sessions: Vec<AgentWorkspaceSession>,
    #[serde(default)]
    pub conversation_meta: HashMap<String, AgentWorkspaceConversationMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_environment: Option<AgentWorkspaceEnvironmentConfig>,
    #[serde(default)]
    pub project_environments: HashMap<String, AgentWorkspaceEnvironmentConfig>,
    #[serde(default)]
    pub session_environments: HashMap<String, AgentWorkspaceEnvironmentConfig>,
    #[serde(default)]
    pub sidebar: AgentWorkspaceSidebarState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceSidebarState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_list_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_filter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merge_worktrees: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_project_new_conversation: Option<bool>,
    #[serde(default)]
    pub collapsed_project_paths: Vec<String>,
    #[serde(default)]
    pub expanded_project_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sessions_sidebar_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceHookConfig {
    pub events_dir: String,
    pub script_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceEnvironmentAction {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub scripts: HashMap<String, String>,
    #[serde(default)]
    pub platform_specific: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceEnvironmentConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub setup_scripts: HashMap<String, String>,
    #[serde(default)]
    pub cleanup_scripts: HashMap<String, String>,
    #[serde(default)]
    pub actions: Vec<AgentWorkspaceEnvironmentAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

pub(crate) fn default_agent_workspace_version() -> u32 {
    5
}

impl Default for AgentWorkspaceState {
    fn default() -> Self {
        Self {
            version: default_agent_workspace_version(),
            sessions: Vec::new(),
            conversation_meta: HashMap::new(),
            global_environment: None,
            project_environments: HashMap::new(),
            session_environments: HashMap::new(),
            sidebar: AgentWorkspaceSidebarState::default(),
            active_session_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct SessionUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub cost_usd: f64, // estimated cost in USD
    /// Last model identifier seen in the session (e.g. "claude-opus-4-7"). Populated from
    /// assistant message metadata; None for older sessions or non-Claude sources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Peak total input footprint across any single assistant turn — best proxy for "context
    /// window occupancy" since each turn ships the full live transcript. = input + cache_read +
    /// cache_creation tokens at that turn. 0 when unknown.
    #[serde(default)]
    pub context_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Session {
    pub id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Last user-typed prompt (Claude Code's `lastPrompt`). Used as a
    /// last-resort label when no title/summary exists. Never substituted
    /// into `title` or `summary` — kept as a separate field so the UI can
    /// display it with a distinct visual treatment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_prompt: Option<String>,
    /// Where `title`/fallback came from when the UI renders a label.
    /// Values: "custom" | "ai" | "slug" | "summary" | "prompt" | "none"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_source: Option<String>,
    /// User-initiated conversation rounds (one per user message).
    pub rounds: usize,
    /// Total transcript messages (user + assistant turns). An assistant may
    /// emit several messages per round (thinking, tool-use, reply), so this
    /// is strictly >= rounds.
    pub message_count: usize,
    pub created_at: u64,
    pub last_modified: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<SessionUsage>,
    /// One of:
    ///   "cli"        — local Claude Code CLI session (~/.claude/projects/<encoded>/<uuid>.jsonl)
    ///   "app-code"   — Claude desktop app's Code tab session (richer metadata, links to same CLI .jsonl)
    ///   "app-web"    — claude.ai web conversation synced via Claude desktop app cookie
    ///   "app-cowork" — Claude desktop app Cowork session (reserved, not yet implemented)
    ///   "codex"      — local Codex rollout session (~/.codex/sessions or ~/.codex/archived_sessions)
    #[serde(default = "default_source")]
    pub source: String,
}

pub(crate) fn default_source() -> String {
    "cli".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub(crate) enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        images: Option<Vec<ToolResultImage>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        raw: Option<String>,
    },
    #[serde(rename = "thinking")]
    Thinking { thinking: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ToolResultImage {
    pub media_type: String,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Message {
    pub uuid: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub is_meta: bool, // slash command 展开的内容
    pub is_tool: bool, // tool_use 或 tool_result
    pub line_number: usize,
    pub content_blocks: Option<Vec<ContentBlock>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionHandoff {
    pub source_provider: String,
    pub target_provider: String,
    pub source_session_id: String,
    pub source_project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_title: Option<String>,
    pub prompt: String,
    pub message_count: usize,
    pub included_message_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRuntimeFork {
    pub source_provider: String,
    pub target_provider: String,
    pub source_session_id: String,
    pub source_project_id: String,
    pub target_session_id: String,
    pub target_project_id: String,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_title: Option<String>,
    pub target_path: String,
    pub target_session: Session,
    pub message_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ChatMessage {
    pub uuid: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub project_id: String,
    pub project_path: String,
    pub session_id: String,
    pub session_summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ChatsResponse {
    pub items: Vec<ChatMessage>,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawLine {
    #[serde(rename = "type")]
    pub(crate) line_type: Option<String>,
    pub(crate) summary: Option<String>,
    pub(crate) slug: Option<String>,
    pub(crate) uuid: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) message: Option<RawMessage>,
    pub(crate) timestamp: Option<String>,
    #[serde(rename = "isMeta")]
    pub(crate) is_meta: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct RawUsage {
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) cache_creation_input_tokens: Option<u64>,
    pub(crate) cache_read_input_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawMessage {
    pub(crate) role: Option<String>,
    pub(crate) content: Option<serde_json::Value>,
    pub(crate) usage: Option<RawUsage>,
    pub(crate) model: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexRolloutLine {
    pub(crate) timestamp: Option<String>,
    #[serde(rename = "type")]
    pub(crate) line_type: Option<String>,
    pub(crate) payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexSessionHead {
    pub(crate) id: String,
    pub(crate) cwd: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) last_prompt: Option<String>,
    pub(crate) rounds: usize,
    pub(crate) message_count: usize,
    pub(crate) model: Option<String>,
    pub(crate) created_at: Option<u64>,
}

/// Entry from history.jsonl - used as fast session index
#[derive(Debug, Deserialize)]
pub(crate) struct HistoryEntry {
    pub(crate) display: Option<String>,
    pub(crate) timestamp: Option<u64>,
    pub(crate) project: Option<String>,
    #[serde(rename = "sessionId")]
    pub(crate) session_id: Option<String>,
}

// ============================================================================
// Commands & Settings Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct LocalCommand {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub allowed_tools: Option<String>,
    pub argument_hint: Option<String>,
    pub content: String,
    pub version: Option<String>,
    pub status: String,                // "active" | "deprecated" | "archived"
    pub deprecated_by: Option<String>, // replacement command name
    pub changelog: Option<String>,     // changelog content if .changelog file exists
    pub aliases: Vec<String>,          // previous names for stats aggregation
    pub frontmatter: Option<String>,   // raw frontmatter text (if any)
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct McpServer {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub server_type: Option<String>, // "http" | "sse" | "stdio"
    pub url: Option<String>,     // for http/sse servers
    pub command: Option<String>, // for stdio servers
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ClaudeSettings {
    pub raw: Value,
    pub permissions: Option<Value>,
    pub hooks: Option<Value>,
    pub mcp_servers: Vec<McpServer>,
}

pub(crate) fn get_claude_dir() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude")
}

pub(crate) fn get_codex_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

pub(crate) fn get_codex_sessions_dir() -> PathBuf {
    get_codex_dir().join("sessions")
}

pub(crate) fn get_codex_archived_sessions_dir() -> PathBuf {
    get_codex_dir().join("archived_sessions")
}

#[derive(Debug, Clone)]
pub(crate) struct SkillHome {
    pub(crate) id: &'static str,
    pub(crate) label: &'static str,
    pub(crate) path: PathBuf,
}

pub(crate) fn get_skill_home_candidates() -> Vec<SkillHome> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    vec![
        SkillHome {
            id: "agent",
            label: "~/.agent",
            path: home.join(".agent"),
        },
        SkillHome {
            id: "agents",
            label: "~/.agents",
            path: home.join(".agents"),
        },
        SkillHome {
            id: "claude",
            label: "~/.claude",
            path: get_claude_dir(),
        },
    ]
}

pub(crate) fn get_readable_skill_homes() -> Vec<SkillHome> {
    get_skill_home_candidates()
        .into_iter()
        .filter(|home| home.path.join("skills").is_dir())
        .collect()
}

pub(crate) fn get_preferred_skill_home() -> SkillHome {
    let candidates = get_skill_home_candidates();

    if let Some(home) = candidates
        .iter()
        .find(|home| home.path.is_dir() && home.path.join("skills").is_dir())
    {
        return (*home).clone();
    }

    if let Some(home) = candidates
        .iter()
        .take(2)
        .find(|home| home.path.is_dir() || !home.path.exists())
    {
        return (*home).clone();
    }

    if let Some(home) = candidates.iter().find(|home| home.path.is_dir()) {
        return (*home).clone();
    }

    candidates
        .into_iter()
        .find(|home| !home.path.exists())
        .unwrap_or_else(|| SkillHome {
            id: "agents",
            label: "~/.agents",
            path: dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".agents"),
        })
}

pub(crate) fn find_skill_home(name: &str) -> Option<SkillHome> {
    get_readable_skill_homes().into_iter().find(|home| {
        home.path
            .join("skills")
            .join(name)
            .join("SKILL.md")
            .exists()
    })
}

pub(crate) fn system_time_to_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

pub(crate) fn get_lovstudio_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio")
        .join("lovcode")
}

pub(crate) fn get_lovcode_updater_settings_path() -> PathBuf {
    get_lovstudio_dir().join("updater-settings.json")
}

pub(crate) fn get_lovcode_releases_cache_path() -> PathBuf {
    get_lovstudio_dir().join("releases-cache.json")
}

pub(crate) fn get_disabled_env_path() -> PathBuf {
    get_lovstudio_dir().join("disabled_env.json")
}

pub(crate) fn get_claude_settings_path() -> PathBuf {
    get_claude_dir().join("settings.json")
}

pub(crate) fn load_json_object_file(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub(crate) fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let output = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, output).map_err(|e| e.to_string())
}

pub(crate) fn load_disabled_env() -> Result<serde_json::Map<String, Value>, String> {
    let path = get_disabled_env_path();
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(value.as_object().cloned().unwrap_or_default())
}

pub(crate) fn get_provider_contexts_path() -> PathBuf {
    get_lovstudio_dir().join("provider_contexts.json")
}

pub(crate) fn get_agent_workspace_path() -> PathBuf {
    get_lovstudio_dir().join("agent-workspace.json")
}

pub(crate) fn get_agent_plain_chat_workspace_dir() -> PathBuf {
    get_lovstudio_dir().join("general-chat")
}

pub(crate) fn get_agent_hook_dir() -> PathBuf {
    get_lovstudio_dir().join("agent-hooks")
}

pub(crate) fn get_agent_hook_script_path() -> PathBuf {
    #[cfg(windows)]
    {
        get_agent_hook_dir().join("lovcode-agent-hook.ps1")
    }

    #[cfg(not(windows))]
    {
        get_agent_hook_dir().join("lovcode-agent-hook.sh")
    }
}

pub(crate) fn get_agent_codex_notify_script_path() -> PathBuf {
    get_agent_hook_dir().join("lovcode-codex-notify.py")
}

pub(crate) fn get_agent_hook_events_dir() -> PathBuf {
    get_agent_hook_dir().join("events")
}

#[cfg(not(windows))]
pub(crate) fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn safe_template_path(
    base_dir: &Path,
    name: &str,
    extension: &str,
    allow_nested: bool,
) -> Result<PathBuf, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Template name cannot be empty".to_string());
    }
    if trimmed.contains('\0') || trimmed.contains('\\') {
        return Err("Template name contains invalid characters".to_string());
    }

    let raw_path = Path::new(trimmed);
    let mut relative = PathBuf::new();
    let mut segment_count = 0usize;
    for component in raw_path.components() {
        match component {
            std::path::Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty() || segment.starts_with('.') {
                    return Err("Template name contains invalid path segment".to_string());
                }
                segment_count += 1;
                relative.push(segment.as_ref());
            }
            _ => return Err("Template name must be a relative path".to_string()),
        }
    }

    if segment_count == 0 {
        return Err("Template name cannot be empty".to_string());
    }
    if !allow_nested && segment_count > 1 {
        return Err("Template name cannot contain path separators".to_string());
    }

    relative.set_extension(extension.trim_start_matches('.'));
    Ok(base_dir.join(relative))
}

#[cfg(windows)]
pub(crate) fn powershell_double_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('`', "``")
            .replace('"', "`\"")
            .replace('$', "`$")
    )
}

pub(crate) fn load_agent_workspace_state() -> Result<AgentWorkspaceState, String> {
    let path = get_agent_workspace_path();
    if !path.exists() {
        return Ok(AgentWorkspaceState::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(AgentWorkspaceState::default());
    }
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub(crate) fn write_agent_workspace_state(
    mut state: AgentWorkspaceState,
) -> Result<AgentWorkspaceState, String> {
    if state.version < default_agent_workspace_version() {
        state.version = default_agent_workspace_version();
    }

    let path = get_agent_workspace_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let output = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&path, output).map_err(|e| e.to_string())?;
    Ok(state)
}

pub(crate) fn load_provider_contexts() -> Result<serde_json::Map<String, Value>, String> {
    let path = get_provider_contexts_path();
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(value.as_object().cloned().unwrap_or_default())
}

pub(crate) fn save_provider_contexts(
    contexts: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    let path = get_provider_contexts_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let output = serde_json::to_string_pretty(&Value::Object(contexts.clone()))
        .map_err(|e| e.to_string())?;
    fs::write(&path, output).map_err(|e| e.to_string())?;
    Ok(())
}
