use super::*;

// Global jieba instance for Chinese tokenization
pub(crate) static JIEBA: LazyLock<Jieba> = LazyLock::new(|| Jieba::new());

// Custom tokenizer for Chinese + English mixed content
#[derive(Clone)]
pub(crate) struct JiebaTokenizer;

impl Tokenizer for JiebaTokenizer {
    type TokenStream<'a> = JiebaTokenStream;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        let words = JIEBA.cut_for_search(text, true);
        let mut tokens = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let base = text.as_ptr() as usize;

        for word in words {
            let word_str = word.trim();
            if !word_str.is_empty() {
                let start = word.as_ptr() as usize - base;
                let end = start + word.len();
                push_search_token(&mut tokens, &mut seen, start, end, word_str);
            }
        }
        add_dotted_ascii_tokens(text, &mut tokens, &mut seen);

        JiebaTokenStream { tokens, index: 0 }
    }
}

fn push_search_token(
    tokens: &mut Vec<Token>,
    seen: &mut std::collections::HashSet<(usize, usize, String)>,
    offset_from: usize,
    offset_to: usize,
    text: &str,
) {
    let token_text = text.trim();
    if token_text.is_empty() || offset_from >= offset_to {
        return;
    }

    let key = (offset_from, offset_to, token_text.to_string());
    if !seen.insert(key) {
        return;
    }

    tokens.push(Token {
        offset_from,
        offset_to,
        position: tokens.len(),
        text: token_text.to_string(),
        position_length: 1,
    });
}

fn is_dotted_ascii_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_')
}

fn is_dotted_ascii_candidate(value: &str) -> bool {
    let mut segments = value.split('.').filter(|segment| !segment.is_empty());
    let has_first = segments.next().is_some();
    let has_second = segments.next().is_some();
    has_first && has_second && value.bytes().any(|byte| byte.is_ascii_alphabetic())
}

fn add_dotted_ascii_tokens(
    text: &str,
    tokens: &mut Vec<Token>,
    seen: &mut std::collections::HashSet<(usize, usize, String)>,
) {
    let bytes = text.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        while index < bytes.len() && !is_dotted_ascii_byte(bytes[index]) {
            index += 1;
        }
        let run_start = index;
        while index < bytes.len() && is_dotted_ascii_byte(bytes[index]) {
            index += 1;
        }
        let run_end = index;
        if run_start >= run_end {
            continue;
        }

        let mut start = run_start;
        let mut end = run_end;
        while start < end && matches!(bytes[start], b'.' | b'-' | b'_') {
            start += 1;
        }
        while start < end && matches!(bytes[end - 1], b'.' | b'-' | b'_') {
            end -= 1;
        }
        if start >= end {
            continue;
        }

        let candidate = &text[start..end];
        if is_dotted_ascii_candidate(candidate) {
            push_search_token(tokens, seen, start, end, candidate);
        }
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

#[cfg(test)]
mod search_tokenizer_tests {
    use super::*;

    #[test]
    fn dotted_ascii_tokens_preserve_domains_and_asset_names() {
        let mut tokens = Vec::new();
        let mut seen = std::collections::HashSet::new();

        add_dotted_ascii_tokens(
            "访问 https://voca.lovstudio.ai/ 和 index-BStkyt_B.js.",
            &mut tokens,
            &mut seen,
        );

        let texts = tokens
            .into_iter()
            .map(|token| token.text)
            .collect::<Vec<_>>();
        assert!(texts.contains(&"voca.lovstudio.ai".to_string()));
        assert!(texts.contains(&"index-BStkyt_B.js".to_string()));
    }
}

// Global search index state
pub(crate) static SEARCH_INDEX: Mutex<Option<SearchIndex>> = Mutex::new(None);
pub(crate) static SEARCH_INDEX_BUILD_LOCK: Mutex<()> = Mutex::new(());

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
    schema_builder.add_text_field("source_path", STRING | STORED);
    schema_builder.add_text_field("session_summary", text_options.clone());
    schema_builder.add_text_field("timestamp", STRING | STORED);
    schema_builder.add_u64_field("line_number", STORED);
    schema_builder.add_u64_field("round_index", STORED);
    schema_builder.add_text_field("round_prompt", text_options.clone());
    schema_builder.add_text_field("round_timestamp", STRING | STORED);
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct SessionUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub cost_usd: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
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

pub(crate) fn get_lovstudio_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio")
        .join("lovcode")
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
