use jieba_rs::Jieba;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::Duration;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{self, Value as TantivyValue, *};
use tantivy::tokenizer::{LowerCaser, TextAnalyzer, Token, TokenStream, Tokenizer};
use tantivy::{doc, Index, IndexWriter, ReloadPolicy};
use tauri::{menu::Menu, tray::TrayIconBuilder, Emitter, Manager};
use warp::Filter;

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use objc::runtime::{BOOL, YES};
#[cfg(target_os = "macos")]
use objc::*;

// Global jieba instance for Chinese tokenization
static JIEBA: LazyLock<Jieba> = LazyLock::new(|| Jieba::new());

// Cache for command stats with incremental update support
// (stats, scanned_files with their mtime)
static COMMAND_STATS_CACHE: LazyLock<Mutex<CommandStatsCache>> =
    LazyLock::new(|| Mutex::new(CommandStatsCache::default()));

#[derive(Default)]
struct CommandStatsCache {
    stats: HashMap<String, usize>,
    scanned: HashMap<String, u64>, // path -> file_size (for incremental read)
}

// Custom tokenizer for Chinese + English mixed content
#[derive(Clone)]
struct JiebaTokenizer;

impl Tokenizer for JiebaTokenizer {
    type TokenStream<'a> = JiebaTokenStream;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        let words = JIEBA.cut(text, true);
        let mut tokens = Vec::new();
        let mut offset = 0;

        for word in words {
            let word_str = word.trim();
            if !word_str.is_empty() {
                let start = text[offset..]
                    .find(word)
                    .map(|i| offset + i)
                    .unwrap_or(offset);
                let end = start + word.len();
                tokens.push(Token {
                    offset_from: start,
                    offset_to: end,
                    position: tokens.len(),
                    text: word_str.to_string(),
                    position_length: 1,
                });
                offset = end;
            }
        }

        JiebaTokenStream { tokens, index: 0 }
    }
}

struct JiebaTokenStream {
    tokens: Vec<Token>,
    index: usize,
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
static SEARCH_INDEX: Mutex<Option<SearchIndex>> = Mutex::new(None);

// Global review queue for notification server
static REVIEW_QUEUE: LazyLock<Mutex<Vec<ReviewItem>>> = LazyLock::new(|| Mutex::new(Vec::new()));

// Global completed queue for dismissed items
static COMPLETED_QUEUE: LazyLock<Mutex<Vec<ReviewItem>>> = LazyLock::new(|| Mutex::new(Vec::new()));

// Review queue persistence path
fn get_review_queue_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovcode")
        .join("review_queue.json")
}

// Load review queue from disk
fn load_review_queue() {
    let path = get_review_queue_path();
    println!("[Lovcode] Loading review queue from {:?}", path);
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<Vec<ReviewItem>>(&content) {
                Ok(items) => {
                    println!("[Lovcode] Loaded {} items from review queue", items.len());
                    let mut queue = REVIEW_QUEUE.lock().unwrap();
                    *queue = items;
                }
                Err(e) => {
                    println!("[Lovcode] Failed to parse review queue: {}", e);
                }
            }
        }
    } else {
        println!("[Lovcode] Review queue file not found");
    }
}

// Save review queue to disk
fn save_review_queue() {
    let path = get_review_queue_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let queue = REVIEW_QUEUE.lock().unwrap();
    if let Ok(json) = serde_json::to_string_pretty(&*queue) {
        let _ = std::fs::write(&path, json);
    }
}

// Completed queue persistence path
fn get_completed_queue_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovcode")
        .join("completed_queue.jsonl")
}

// Load completed queue from disk
fn load_completed_queue() {
    let path = get_completed_queue_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let mut queue = COMPLETED_QUEUE.lock().unwrap();
            for line in content.lines() {
                if let Ok(item) = serde_json::from_str::<ReviewItem>(line) {
                    queue.push(item);
                }
            }
        }
    }
}

// Append a completed item to disk
fn persist_completed_item(item: &ReviewItem) {
    let path = get_completed_queue_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(item) {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(file, "{}", json);
        }
    }
}

// Global auto-increment sequence number for review items
static REVIEW_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn get_review_seq_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovcode")
        .join("review_seq")
}

fn load_review_seq() {
    if let Ok(content) = std::fs::read_to_string(get_review_seq_path()) {
        if let Ok(seq) = content.trim().parse::<u64>() {
            REVIEW_SEQ.store(seq, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

fn next_review_seq() -> u64 {
    let seq = REVIEW_SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    // Persist to file
    let path = get_review_seq_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, (seq + 1).to_string());
    seq
}

// Notification server port
const NOTIFY_SERVER_PORT: u16 = 23567;

// Distill watch state
static DISTILL_WATCH_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

struct SearchIndex {
    index: Index,
    schema: Schema,
}

fn get_index_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lovcode")
        .join("search-index")
}

const JIEBA_TOKENIZER_NAME: &str = "jieba";

fn create_schema() -> Schema {
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
    schema_builder.add_text_field("role", STRING | STORED);
    schema_builder.add_text_field("project_id", STRING | STORED);
    schema_builder.add_text_field("project_path", STRING | STORED);
    schema_builder.add_text_field("session_id", STRING | STORED);
    schema_builder.add_text_field("session_summary", text_options);
    schema_builder.add_text_field("timestamp", STRING | STORED);
    schema_builder.build()
}

fn register_jieba_tokenizer(index: &Index) {
    let tokenizer = TextAnalyzer::builder(JiebaTokenizer)
        .filter(LowerCaser)
        .build();
    index.tokenizers().register(JIEBA_TOKENIZER_NAME, tokenizer);
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub path: String,
    pub session_count: usize,
    pub last_active: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub project_path: Option<String>,
    pub summary: Option<String>,
    pub message_count: usize,
    pub last_modified: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub uuid: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub is_meta: bool, // slash command 展开的内容
    pub is_tool: bool, // tool_use 或 tool_result
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
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
pub struct ChatsResponse {
    pub items: Vec<ChatMessage>,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
struct RawLine {
    #[serde(rename = "type")]
    line_type: Option<String>,
    summary: Option<String>,
    uuid: Option<String>,
    message: Option<RawMessage>,
    timestamp: Option<String>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
    role: Option<String>,
    content: Option<serde_json::Value>,
}

// ============================================================================
// Commands & Settings Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalCommand {
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
pub struct McpServer {
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

// ============================================================================
// Review Queue Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewItem {
    pub id: String,
    pub seq: u64, // Global auto-increment sequence number
    pub title: String,
    pub project: Option<String>,
    pub timestamp: u64,
    // tmux navigation context
    pub tmux_session: Option<String>,
    pub tmux_window: Option<String>,
    pub tmux_pane: Option<String>,
    // Claude session reference
    pub session_id: Option<String>,
    pub project_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeSettings {
    pub raw: Value,
    pub permissions: Option<Value>,
    pub hooks: Option<Value>,
    pub mcp_servers: Vec<McpServer>,
}

fn get_claude_dir() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude")
}

fn get_lovstudio_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio")
        .join("lovcode")
}

fn get_disabled_env_path() -> PathBuf {
    get_lovstudio_dir().join("disabled_env.json")
}

fn load_disabled_env() -> Result<serde_json::Map<String, Value>, String> {
    let path = get_disabled_env_path();
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(value.as_object().cloned().unwrap_or_default())
}

fn save_disabled_env(disabled: &serde_json::Map<String, Value>) -> Result<(), String> {
    let path = get_disabled_env_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let output = serde_json::to_string_pretty(&Value::Object(disabled.clone()))
        .map_err(|e| e.to_string())?;
    fs::write(&path, output).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get path to ~/.claude.json (MCP servers config)
fn get_claude_json_path() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude.json")
}

/// Decode project ID to actual filesystem path.
/// Claude Code encodes: `/` -> `-`, and `.` -> `-`
/// So `/.` becomes `--`, but `-` in directory names is NOT escaped
fn decode_project_path(id: &str) -> String {
    // First, handle `--` which means `/.` (hidden directories like .claude)
    // Replace `--` with a placeholder, then `-` with `/`, then restore `/.`
    let base = id
        .replace("--", "\x00")
        .replace("-", "/")
        .replace("\x00", "/.");

    // If the base path exists, we're done
    if PathBuf::from(&base).exists() {
        return base;
    }

    // Otherwise, the project name likely contains hyphens
    // Try progressively merging path segments after common base directories
    for base_dir in &["/projects/", "/repos/", "/Documents/", "/Desktop/"] {
        if let Some(idx) = base.find(base_dir) {
            let prefix = &base[..idx + base_dir.len()];
            let rest = &base[idx + base_dir.len()..];

            // Try merging segments: /a/b/c -> a-b-c, a-b/c, a/b-c, etc.
            if let Some(merged) = try_merge_segments(prefix, rest) {
                return merged;
            }
        }
    }

    // Fallback to base interpretation
    base
}

/// Try different combinations of merging path segments with hyphens
fn try_merge_segments(prefix: &str, rest: &str) -> Option<String> {
    let segments: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return None;
    }

    // Try merging all segments into one (most common: project-name-here)
    let all_merged = format!("{}{}", prefix, segments.join("-"));
    if PathBuf::from(&all_merged).exists() {
        return Some(all_merged);
    }

    // Try merging first N segments, leaving rest as subdirs
    for merge_count in (1..segments.len()).rev() {
        let merged_part = segments[..=merge_count].join("-");
        let rest_part = segments[merge_count + 1..].join("/");
        let candidate = if rest_part.is_empty() {
            format!("{}{}", prefix, merged_part)
        } else {
            format!("{}{}/{}", prefix, merged_part, rest_part)
        };
        if PathBuf::from(&candidate).exists() {
            return Some(candidate);
        }
    }

    None
}

#[tauri::command]
async fn list_projects() -> Result<Vec<Project>, String> {
    // Run blocking IO on a separate thread to avoid blocking the main thread
    tauri::async_runtime::spawn_blocking(|| {
        let projects_dir = get_claude_dir().join("projects");

        if !projects_dir.exists() {
            return Ok(vec![]);
        }

        let mut projects = Vec::new();

        for entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                let id = path.file_name().unwrap().to_string_lossy().to_string();
                let display_path = decode_project_path(&id);

                let mut session_count = 0;
                let mut last_active: u64 = 0;

                if let Ok(entries) = fs::read_dir(&path) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                            session_count += 1;
                            if let Ok(meta) = entry.metadata() {
                                if let Ok(modified) = meta.modified() {
                                    if let Ok(duration) =
                                        modified.duration_since(std::time::UNIX_EPOCH)
                                    {
                                        last_active = last_active.max(duration.as_secs());
                                    }
                                }
                            }
                        }
                    }
                }

                projects.push(Project {
                    id: id.clone(),
                    path: display_path,
                    session_count,
                    last_active,
                });
            }
        }

        projects.sort_by(|a, b| b.last_active.cmp(&a.last_active));
        Ok(projects)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_sessions(project_id: String) -> Result<Vec<Session>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project_dir = get_claude_dir().join("projects").join(&project_id);

        if !project_dir.exists() {
            return Err("Project not found".to_string());
        }

        let mut sessions = Vec::new();

        for entry in fs::read_dir(&project_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();

            if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                let session_id = name.trim_end_matches(".jsonl").to_string();
                let content = fs::read_to_string(&path).unwrap_or_default();

                let mut summary = None;
                let mut message_count = 0;

                for line in content.lines() {
                    if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                        if parsed.line_type.as_deref() == Some("summary") {
                            summary = parsed.summary;
                        }
                        if parsed.line_type.as_deref() == Some("user")
                            || parsed.line_type.as_deref() == Some("assistant")
                        {
                            message_count += 1;
                        }
                    }
                }

                let metadata = fs::metadata(&path).ok();
                let last_modified = metadata
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                sessions.push(Session {
                    id: session_id,
                    project_id: project_id.clone(),
                    project_path: None,
                    summary,
                    message_count,
                    last_modified,
                });
            }
        }

        sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        Ok(sessions)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_all_sessions() -> Result<Vec<Session>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let projects_dir = get_claude_dir().join("projects");

        if !projects_dir.exists() {
            return Ok(vec![]);
        }

        let mut all_sessions = Vec::new();

        for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let project_entry = project_entry.map_err(|e| e.to_string())?;
            let project_path = project_entry.path();

            if !project_path.is_dir() {
                continue;
            }

            let project_id = project_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let display_path = decode_project_path(&project_id);

            for entry in fs::read_dir(&project_path).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy().to_string();

                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let session_id = name.trim_end_matches(".jsonl").to_string();
                    let content = fs::read_to_string(&path).unwrap_or_default();

                    let mut summary = None;
                    let mut message_count = 0;

                    for line in content.lines() {
                        if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                            if parsed.line_type.as_deref() == Some("summary") {
                                summary = parsed.summary;
                            }
                            if parsed.line_type.as_deref() == Some("user")
                                || parsed.line_type.as_deref() == Some("assistant")
                            {
                                message_count += 1;
                            }
                        }
                    }

                    let metadata = fs::metadata(&path).ok();
                    let last_modified = metadata
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    all_sessions.push(Session {
                        id: session_id,
                        project_id: project_id.clone(),
                        project_path: Some(display_path.clone()),
                        summary,
                        message_count,
                        last_modified,
                    });
                }
            }
        }

        all_sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        Ok(all_sessions)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_all_chats(
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<ChatsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let projects_dir = get_claude_dir().join("projects");
        let max_messages = limit.unwrap_or(50);
        let skip = offset.unwrap_or(0);

        if !projects_dir.exists() {
            return Ok(ChatsResponse {
                items: vec![],
                total: 0,
            });
        }

        // Collect all session files with metadata
        let mut session_files: Vec<(PathBuf, String, String, u64)> = Vec::new();

        for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let project_entry = project_entry.map_err(|e| e.to_string())?;
            let project_path = project_entry.path();

            if !project_path.is_dir() {
                continue;
            }

            let project_id = project_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let display_path = decode_project_path(&project_id);

            for entry in fs::read_dir(&project_path).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy().to_string();

                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let last_modified = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    session_files.push((
                        path,
                        project_id.clone(),
                        display_path.clone(),
                        last_modified,
                    ));
                }
            }
        }

        // Sort by last modified (newest first)
        session_files.sort_by(|a, b| b.3.cmp(&a.3));

        let mut all_chats: Vec<ChatMessage> = Vec::new();

        // Process all sessions to get total count
        for (path, project_id, project_path, _) in session_files {
            let session_id = path.file_stem().unwrap().to_string_lossy().to_string();
            let content = fs::read_to_string(&path).unwrap_or_default();

            let mut session_summary: Option<String> = None;
            let mut session_messages: Vec<ChatMessage> = Vec::new();

            for line in content.lines() {
                if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                    let line_type = parsed.line_type.as_deref();

                    if line_type == Some("summary") {
                        session_summary = parsed.summary;
                    }

                    if line_type == Some("user") || line_type == Some("assistant") {
                        if let Some(msg) = &parsed.message {
                            let role = msg.role.clone().unwrap_or_default();
                            let (text_content, _is_tool) = extract_content_with_meta(&msg.content);
                            let is_meta = parsed.is_meta.unwrap_or(false);

                            // Skip meta messages and empty content
                            if !is_meta && !text_content.is_empty() {
                                session_messages.push(ChatMessage {
                                    uuid: parsed.uuid.unwrap_or_default(),
                                    role,
                                    content: text_content,
                                    timestamp: parsed.timestamp.unwrap_or_default(),
                                    project_id: project_id.clone(),
                                    project_path: project_path.clone(),
                                    session_id: session_id.clone(),
                                    session_summary: None, // Will be filled later
                                });
                            }
                        }
                    }
                }
            }

            // Update session_summary for all messages
            for msg in &mut session_messages {
                msg.session_summary = session_summary.clone();
            }

            all_chats.extend(session_messages);
        }

        // Sort all by timestamp (newest first)
        all_chats.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        let total = all_chats.len();
        let items: Vec<ChatMessage> = all_chats
            .into_iter()
            .skip(skip)
            .take(max_messages)
            .collect();

        Ok(ChatsResponse { items, total })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_session_messages(
    project_id: String,
    session_id: String,
) -> Result<Vec<Message>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session_path = get_claude_dir()
            .join("projects")
            .join(&project_id)
            .join(format!("{}.jsonl", session_id));

        if !session_path.exists() {
            return Err("Session not found".to_string());
        }

        let content = fs::read_to_string(&session_path).map_err(|e| e.to_string())?;
        let mut messages = Vec::new();

        for line in content.lines() {
            if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                let line_type = parsed.line_type.as_deref();
                if line_type == Some("user") || line_type == Some("assistant") {
                    if let Some(msg) = &parsed.message {
                        let role = msg.role.clone().unwrap_or_default();
                        let (content, is_tool) = extract_content_with_meta(&msg.content);
                        let is_meta = parsed.is_meta.unwrap_or(false);

                        if !content.is_empty() {
                            messages.push(Message {
                                uuid: parsed.uuid.unwrap_or_default(),
                                role,
                                content,
                                timestamp: parsed.timestamp.unwrap_or_default(),
                                is_meta,
                                is_tool,
                            });
                        }
                    }
                }
            }
        }

        Ok(messages)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================================================
// Search Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub uuid: String,
    pub content: String,
    pub role: String,
    pub project_id: String,
    pub project_path: String,
    pub session_id: String,
    pub session_summary: Option<String>,
    pub timestamp: String,
    pub score: f32,
}

#[tauri::command]
async fn build_search_index() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let index_dir = get_index_dir();

        // Remove old index if exists
        if index_dir.exists() {
            fs::remove_dir_all(&index_dir).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&index_dir).map_err(|e| e.to_string())?;

        let schema = create_schema();
        let index = Index::create_in_dir(&index_dir, schema.clone()).map_err(|e| e.to_string())?;

        // Register jieba tokenizer for Chinese support
        register_jieba_tokenizer(&index);

        let mut index_writer: IndexWriter = index
            .writer(50_000_000) // 50MB heap
            .map_err(|e| e.to_string())?;

        let uuid_field = schema.get_field("uuid").unwrap();
        let content_field = schema.get_field("content").unwrap();
        let role_field = schema.get_field("role").unwrap();
        let project_id_field = schema.get_field("project_id").unwrap();
        let project_path_field = schema.get_field("project_path").unwrap();
        let session_id_field = schema.get_field("session_id").unwrap();
        let session_summary_field = schema.get_field("session_summary").unwrap();
        let timestamp_field = schema.get_field("timestamp").unwrap();

        let projects_dir = get_claude_dir().join("projects");
        let mut indexed_count = 0;

        if !projects_dir.exists() {
            return Ok(0);
        }

        for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let project_entry = project_entry.map_err(|e| e.to_string())?;
            let project_path_buf = project_entry.path();

            if !project_path_buf.is_dir() {
                continue;
            }

            let project_id = project_path_buf.file_name().unwrap().to_string_lossy().to_string();
            let display_path = decode_project_path(&project_id);

            for entry in fs::read_dir(&project_path_buf).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy().to_string();

                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let session_id = name.trim_end_matches(".jsonl").to_string();
                    let file_content = fs::read_to_string(&path).unwrap_or_default();

                    let mut session_summary: Option<String> = None;

                    // First pass: get summary
                    for line in file_content.lines() {
                        if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                            if parsed.line_type.as_deref() == Some("summary") {
                                session_summary = parsed.summary;
                                break;
                            }
                        }
                    }

                    // Second pass: index messages
                    for line in file_content.lines() {
                        if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                            let line_type = parsed.line_type.as_deref();

                            if line_type == Some("user") || line_type == Some("assistant") {
                                if let Some(msg) = &parsed.message {
                                    let role = msg.role.clone().unwrap_or_default();
                                    let (text_content, _) = extract_content_with_meta(&msg.content);
                                    let is_meta = parsed.is_meta.unwrap_or(false);

                                    if !is_meta && !text_content.is_empty() {
                                        index_writer.add_document(doc!(
                                            uuid_field => parsed.uuid.clone().unwrap_or_default(),
                                            content_field => text_content,
                                            role_field => role,
                                            project_id_field => project_id.clone(),
                                            project_path_field => display_path.clone(),
                                            session_id_field => session_id.clone(),
                                            session_summary_field => session_summary.clone().unwrap_or_default(),
                                            timestamp_field => parsed.timestamp.clone().unwrap_or_default(),
                                        )).map_err(|e| e.to_string())?;

                                        indexed_count += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        index_writer.commit().map_err(|e| e.to_string())?;

        // Store index in global state
        let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;
        *guard = Some(SearchIndex { index, schema });

        Ok(indexed_count)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn search_chats(
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let max_results = limit.unwrap_or(50);

    // Try to get index from global state or load from disk
    let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;

    if guard.is_none() {
        let index_dir = get_index_dir();
        if !index_dir.exists() {
            return Err("Search index not built. Please build index first.".to_string());
        }

        let schema = create_schema();
        let index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
        // Register jieba tokenizer for Chinese support
        register_jieba_tokenizer(&index);
        *guard = Some(SearchIndex { index, schema });
    }

    let search_index = guard.as_ref().unwrap();
    let reader = search_index
        .index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
        .map_err(|e: tantivy::TantivyError| e.to_string())?;

    let searcher = reader.searcher();

    let content_field = search_index.schema.get_field("content").unwrap();
    let session_summary_field = search_index.schema.get_field("session_summary").unwrap();

    let query_parser = QueryParser::for_index(
        &search_index.index,
        vec![content_field, session_summary_field],
    );
    let parsed_query = query_parser
        .parse_query(&query)
        .map_err(|e| e.to_string())?;

    let top_docs = searcher
        .search(&parsed_query, &TopDocs::with_limit(max_results))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    for (score, doc_address) in top_docs {
        let retrieved_doc: tantivy::TantivyDocument =
            searcher.doc(doc_address).map_err(|e| e.to_string())?;

        let get_text = |field_name: &str| -> String {
            let field = search_index.schema.get_field(field_name).unwrap();
            retrieved_doc
                .get_first(field)
                .and_then(|v| TantivyValue::as_str(&v))
                .unwrap_or("")
                .to_string()
        };

        let doc_project_id = get_text("project_id");

        // Filter by project_id if specified
        if let Some(ref filter_id) = project_id {
            if &doc_project_id != filter_id {
                continue;
            }
        }

        let summary = get_text("session_summary");

        results.push(SearchResult {
            uuid: get_text("uuid"),
            content: get_text("content"),
            role: get_text("role"),
            project_id: doc_project_id,
            project_path: get_text("project_path"),
            session_id: get_text("session_id"),
            session_summary: if summary.is_empty() {
                None
            } else {
                Some(summary)
            },
            timestamp: get_text("timestamp"),
            score,
        });
    }

    Ok(results)
}

fn extract_content_with_meta(value: &Option<serde_json::Value>) -> (String, bool) {
    match value {
        Some(serde_json::Value::String(s)) => (s.clone(), false),
        Some(serde_json::Value::Array(arr)) => {
            // Check if array contains tool_use or tool_result
            let has_tool = arr.iter().any(|item| {
                if let Some(obj) = item.as_object() {
                    let t = obj.get("type").and_then(|v| v.as_str());
                    return t == Some("tool_use") || t == Some("tool_result");
                }
                false
            });

            let text = arr
                .iter()
                .filter_map(|item| {
                    if let Some(obj) = item.as_object() {
                        if obj.get("type").and_then(|v| v.as_str()) == Some("text") {
                            return obj.get("text").and_then(|v| v.as_str()).map(String::from);
                        }
                    }
                    None
                })
                .collect::<Vec<_>>()
                .join("\n");

            (text, has_tool)
        }
        _ => (String::new(), false),
    }
}

// ============================================================================
// Commands Feature
// ============================================================================

#[tauri::command]
fn list_local_commands() -> Result<Vec<LocalCommand>, String> {
    let claude_dir = get_claude_dir();
    let commands_dir = claude_dir.join("commands");
    let dot_commands_dir = claude_dir.join(".commands");
    let archived_dir = dot_commands_dir.join("archived");

    // One-time migration: check version marker
    let migration_marker = dot_commands_dir.join("migrated");
    let current_version = fs::read_to_string(&migration_marker).unwrap_or_default();

    // Run migrations if needed
    if !current_version.contains("v4") {
        run_command_migrations(&claude_dir, &commands_dir, &archived_dir);
        let _ = fs::create_dir_all(&dot_commands_dir);
        let _ = fs::write(&migration_marker, "v4");
    }

    let mut commands = Vec::new();

    // Collect active commands from commands/
    if commands_dir.exists() {
        collect_commands_from_dir(&commands_dir, &commands_dir, &mut commands, "active")?;
    }

    // Collect deprecated commands from .commands/archived/
    if archived_dir.exists() {
        collect_commands_from_dir(&archived_dir, &archived_dir, &mut commands, "deprecated")?;
    }

    commands.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(commands)
}

/// Run all pending migrations
fn run_command_migrations(claude_dir: &PathBuf, commands_dir: &PathBuf, archived_dir: &PathBuf) {
    // Migrate legacy .md.deprecated files
    migrate_deprecated_files_recursive(commands_dir, commands_dir, archived_dir);

    // Migrate files from old .archive/ subdirectories
    migrate_archive_subdirs_recursive(commands_dir, commands_dir, archived_dir);

    // Migrate from old .archived-commands/ directory (v3 format)
    let old_archived_dir = claude_dir.join(".archived-commands");
    if old_archived_dir.exists() {
        migrate_old_archived_commands(&old_archived_dir, archived_dir);
    }

    // Migrate orphan .changelog files
    migrate_orphan_changelogs(commands_dir, archived_dir);
}

/// Migrate from old .archived-commands/ to new .commands/archived/
fn migrate_old_archived_commands(old_dir: &PathBuf, new_dir: &PathBuf) {
    if let Ok(entries) = fs::read_dir(old_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(relative) = path.strip_prefix(old_dir) {
                let dest = new_dir.join(relative);
                if let Some(parent) = dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::rename(&path, &dest);
            }
        }
    }
    // Try to remove old directory
    let _ = fs::remove_dir_all(old_dir);
}

/// Recursively migrate .md.deprecated files to archived directory
fn migrate_deprecated_files_recursive(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    archived_dir: &PathBuf,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir()
                && !path
                    .file_name()
                    .map_or(false, |n| n.to_string_lossy().starts_with('.'))
            {
                migrate_deprecated_files_recursive(base_dir, &path, archived_dir);
            } else if path.extension().map_or(false, |e| e == "deprecated") {
                // Migrate .md.deprecated file
                if let Ok(relative) = path.strip_prefix(base_dir) {
                    let new_name = relative
                        .to_string_lossy()
                        .trim_end_matches(".deprecated")
                        .to_string();
                    let dest = archived_dir.join(&new_name);
                    if let Some(parent) = dest.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let _ = fs::rename(&path, &dest);

                    // Also migrate changelog if exists
                    let changelog_src = PathBuf::from(
                        path.to_string_lossy()
                            .replace(".md.deprecated", ".changelog"),
                    );
                    if changelog_src.exists() {
                        let changelog_dest =
                            archived_dir.join(new_name.replace(".md", ".changelog"));
                        let _ = fs::rename(&changelog_src, &changelog_dest);
                    }
                }
            }
        }
    }
}

/// Recursively migrate files from .archive/ subdirectories
fn migrate_archive_subdirs_recursive(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    archived_dir: &PathBuf,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name == ".archive" {
                    // Found .archive/ directory - migrate its contents
                    if let Ok(archive_entries) = fs::read_dir(&path) {
                        for archive_entry in archive_entries.flatten() {
                            let file_path = archive_entry.path();
                            if file_path.is_file() {
                                // Calculate relative path from base commands dir
                                let parent_relative =
                                    current_dir.strip_prefix(base_dir).unwrap_or(Path::new(""));
                                let filename = file_path.file_name().unwrap_or_default();
                                let dest = archived_dir.join(parent_relative).join(filename);
                                if let Some(parent) = dest.parent() {
                                    let _ = fs::create_dir_all(parent);
                                }
                                let _ = fs::rename(&file_path, &dest);
                            }
                        }
                    }
                    // Try to remove empty .archive/ directory
                    let _ = fs::remove_dir(&path);
                } else if !name.starts_with('.') {
                    migrate_archive_subdirs_recursive(base_dir, &path, archived_dir);
                }
            }
        }
    }
}

/// Migrate orphan .changelog files whose .md is in archived directory
fn migrate_orphan_changelogs(commands_dir: &PathBuf, archived_dir: &PathBuf) {
    if !archived_dir.exists() {
        return;
    }
    migrate_orphan_changelogs_recursive(commands_dir, commands_dir, archived_dir);
}

fn migrate_orphan_changelogs_recursive(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    archived_dir: &PathBuf,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir()
                && !path
                    .file_name()
                    .map_or(false, |n| n.to_string_lossy().starts_with('.'))
            {
                migrate_orphan_changelogs_recursive(base_dir, &path, archived_dir);
            } else if path.extension().map_or(false, |e| e == "changelog") {
                // Check if corresponding .md exists in archived_dir
                if let Ok(relative) = path.strip_prefix(base_dir) {
                    let md_name = relative.to_string_lossy().replace(".changelog", ".md");
                    let archived_md = archived_dir.join(&md_name);
                    if archived_md.exists() {
                        let dest = archived_dir.join(relative);
                        if let Some(parent) = dest.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        let _ = fs::rename(&path, &dest);
                    }
                }
            }
        }
    }
}

/// Collect commands from a directory with a given status
fn collect_commands_from_dir(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    commands: &mut Vec<LocalCommand>,
    status: &str,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            // Skip hidden directories
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if !name.starts_with('.') {
                collect_commands_from_dir(base_dir, &path, commands, status)?;
            }
        } else {
            let filename = path.file_name().unwrap_or_default().to_string_lossy();

            // Determine file type
            let (is_command, name_suffix) = if filename.ends_with(".md.archived") {
                (true, ".md.archived")
            } else if filename.ends_with(".md") {
                (true, ".md")
            } else {
                (false, "")
            };

            if is_command {
                let relative = path.strip_prefix(base_dir).unwrap_or(&path);
                let name = relative
                    .to_string_lossy()
                    .trim_end_matches(name_suffix)
                    .replace("\\", "/")
                    .to_string();

                let content = fs::read_to_string(&path).unwrap_or_default();
                let (frontmatter, raw_frontmatter, body) = parse_frontmatter(&content);

                // Use "archived" status for .md.archived files, otherwise use provided status
                let actual_status = if filename.ends_with(".md.archived") {
                    "archived"
                } else {
                    status
                };

                // Read changelog if exists (same directory, .changelog extension)
                let changelog = path
                    .parent()
                    .map(|dir| {
                        let base = path.file_stem().unwrap_or_default().to_string_lossy();
                        dir.join(format!("{}.changelog", base))
                    })
                    .filter(|p| p.exists())
                    .and_then(|p| fs::read_to_string(p).ok());

                // Parse aliases: comma-separated list of previous command names
                let aliases = frontmatter
                    .get("aliases")
                    .map(|s| {
                        s.split(',')
                            .map(|a| {
                                a.trim()
                                    .trim_matches(|c| c == '[' || c == ']' || c == '"' || c == '\'')
                                    .to_string()
                            })
                            .filter(|a| !a.is_empty())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                commands.push(LocalCommand {
                    name: format!("/{}", name),
                    path: path.to_string_lossy().to_string(),
                    description: frontmatter.get("description").cloned(),
                    allowed_tools: frontmatter.get("allowed-tools").cloned(),
                    argument_hint: frontmatter.get("argument-hint").cloned(),
                    content: body,
                    version: frontmatter.get("version").cloned(),
                    status: actual_status.to_string(),
                    deprecated_by: frontmatter.get("replaced-by").cloned(),
                    changelog,
                    aliases,
                    frontmatter: raw_frontmatter,
                });
            }
        }
    }
    Ok(())
}

fn parse_frontmatter(content: &str) -> (HashMap<String, String>, Option<String>, String) {
    let mut frontmatter = HashMap::new();
    let mut raw_frontmatter: Option<String> = None;
    let mut body = content.to_string();

    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let fm_content = &content[3..end_idx + 3];
            raw_frontmatter = Some(fm_content.trim().to_string());
            body = content[end_idx + 6..].trim_start().to_string();

            for line in fm_content.lines() {
                if let Some(colon_idx) = line.find(':') {
                    let key = line[..colon_idx].trim().to_string();
                    let value = line[colon_idx + 1..].trim();
                    // Strip surrounding quotes from YAML values
                    let value = value.trim_matches('"').trim_matches('\'').to_string();
                    frontmatter.insert(key, value);
                }
            }
        }
    }

    (frontmatter, raw_frontmatter, body)
}

/// Rename a command file (supports path changes like /foo/bar -> /foo/baz/bar)
#[tauri::command]
fn rename_command(
    path: String,
    new_name: String,
    create_dir: Option<bool>,
) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    if !path.ends_with(".md") {
        return Err("Can only rename .md commands".to_string());
    }

    // Parse new_name as a command path (e.g., /lovstudio/repo/takeover)
    let name = new_name.trim().trim_start_matches('/');
    if name.is_empty() {
        return Err("New name cannot be empty".to_string());
    }

    // Build destination path from command name
    let commands_dir = get_claude_dir().join("commands");
    let new_filename = if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{}.md", name)
    };
    let dest = commands_dir.join(&new_filename);

    // Check if destination directory exists
    if let Some(dest_parent) = dest.parent() {
        if !dest_parent.exists() {
            if create_dir.unwrap_or(false) {
                fs::create_dir_all(dest_parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            } else {
                // Return special error for frontend to show confirmation
                return Err(format!("DIR_NOT_EXIST:{}", dest_parent.to_string_lossy()));
            }
        }
    }

    if dest.exists() && dest != src {
        return Err(format!(
            "A command with name '{}' already exists",
            new_filename
        ));
    }

    if dest != src {
        // Calculate old command name (derive from filename without .md)
        let old_basename = src
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Cannot get old filename")?;
        let old_name =
            if let Ok(relative) = src.parent().unwrap_or(&src).strip_prefix(&commands_dir) {
                if relative.as_os_str().is_empty() {
                    format!("/{}", old_basename)
                } else {
                    format!("/{}/{}", relative.to_string_lossy(), old_basename)
                }
            } else {
                format!("/{}", old_basename)
            };

        // Calculate new command name
        let new_basename = dest
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Cannot get new filename")?;
        let new_name =
            if let Ok(relative) = dest.parent().unwrap_or(&dest).strip_prefix(&commands_dir) {
                if relative.as_os_str().is_empty() {
                    format!("/{}", new_basename)
                } else {
                    format!("/{}/{}", relative.to_string_lossy(), new_basename)
                }
            } else {
                format!("/{}", new_basename)
            };

        // Update aliases: add old name, remove new name if it was an alias
        let content = fs::read_to_string(&src).map_err(|e| e.to_string())?;
        let updated = update_aliases_on_rename(&content, &old_name, &new_name);
        if updated != content {
            fs::write(&src, &updated).map_err(|e| e.to_string())?;
        }

        fs::rename(&src, &dest).map_err(|e| e.to_string())?;

        // Also rename associated .changelog file if exists
        let changelog_src = src.with_extension("changelog");
        if changelog_src.exists() {
            let changelog_dest = dest.with_extension("changelog");
            let _ = fs::rename(&changelog_src, &changelog_dest);
        }
    }

    Ok(dest.to_string_lossy().to_string())
}

fn update_aliases_on_rename(content: &str, old_name: &str, new_name: &str) -> String {
    // Parse existing aliases from frontmatter
    let (existing_aliases, has_frontmatter) = if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() >= 3 {
            let frontmatter = parts[1];
            if let Some(line) = frontmatter
                .lines()
                .find(|l| l.trim_start().starts_with("aliases:"))
            {
                let value_part = line.split(':').nth(1).unwrap_or("").trim();
                let aliases: Vec<String> = value_part
                    .trim_matches('"')
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                (aliases, true)
            } else {
                (Vec::new(), true)
            }
        } else {
            (Vec::new(), false)
        }
    } else {
        (Vec::new(), false)
    };

    // Build new aliases: add old_name, remove new_name
    let mut new_aliases: Vec<String> = existing_aliases
        .into_iter()
        .filter(|a| a != new_name)
        .collect();

    if !new_aliases.contains(&old_name.to_string()) {
        new_aliases.push(old_name.to_string());
    }

    // Update frontmatter
    if !has_frontmatter {
        if new_aliases.is_empty() {
            return content.to_string();
        }
        return format!(
            "---\naliases: \"{}\"\n---\n\n{}",
            new_aliases.join(", "),
            content
        );
    }

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    let frontmatter = parts[1];
    let body = parts[2];

    if let Some(aliases_line_idx) = frontmatter
        .lines()
        .position(|l| l.trim_start().starts_with("aliases:"))
    {
        let lines: Vec<&str> = frontmatter.lines().collect();

        let new_frontmatter: Vec<String> = lines
            .iter()
            .enumerate()
            .filter_map(|(i, &l)| {
                if i == aliases_line_idx {
                    if new_aliases.is_empty() {
                        None // Remove the line if no aliases
                    } else {
                        Some(format!("aliases: \"{}\"", new_aliases.join(", ")))
                    }
                } else {
                    Some(l.to_string())
                }
            })
            .collect();

        format!("---{}---{}", new_frontmatter.join("\n"), body)
    } else if !new_aliases.is_empty() {
        // No aliases field, add it
        let new_frontmatter = format!(
            "{}\naliases: \"{}\"",
            frontmatter.trim_end(),
            new_aliases.join(", ")
        );
        format!("---{}---{}", new_frontmatter, body)
    } else {
        content.to_string()
    }
}

/// Deprecate a command by moving it to ~/.claude/.commands/archived/
/// This moves it outside the commands directory so Claude Code won't load it
#[tauri::command]
fn deprecate_command(
    path: String,
    replaced_by: Option<String>,
    note: Option<String>,
) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    let commands_dir = get_claude_dir().join("commands");
    let archived_dir = get_claude_dir().join(".commands").join("archived");

    // Only allow deprecating active .md files from commands directory
    if !path.ends_with(".md") {
        return Err("Can only deprecate .md commands".to_string());
    }

    // Check if already archived
    if src.starts_with(&archived_dir) {
        return Err("Command is already archived".to_string());
    }

    // Update frontmatter with replaced_by and/or note
    let content = fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let mut updated = content.clone();
    if let Some(replacement) = &replaced_by {
        updated = add_frontmatter_field(&updated, "replaced-by", replacement);
    }
    if let Some(n) = &note {
        updated = add_frontmatter_field(&updated, "deprecation-note", n);
    }
    if updated != content {
        fs::write(&src, updated).map_err(|e| e.to_string())?;
    }

    // Calculate relative path from commands directory
    let relative = src
        .strip_prefix(&commands_dir)
        .map_err(|_| "Command is not in commands directory")?;

    // Create destination path in archived directory (preserving subdirectory structure)
    let dest = archived_dir.join(relative);
    if let Some(dest_parent) = dest.parent() {
        fs::create_dir_all(dest_parent).map_err(|e| e.to_string())?;
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    // Also move associated .changelog file if exists
    let base_name = src.with_extension("");
    let changelog_src = base_name.with_extension("changelog");
    if changelog_src.exists() {
        let changelog_relative = changelog_src
            .strip_prefix(&commands_dir)
            .map_err(|_| "Changelog is not in commands directory")?;
        let changelog_dest = archived_dir.join(changelog_relative);
        let _ = fs::rename(&changelog_src, &changelog_dest);
    }

    Ok(dest.to_string_lossy().to_string())
}

/// Archive a command by moving it to versions/ directory with version suffix
#[tauri::command]
fn archive_command(path: String, version: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    // Get the commands directory and create versions/ if needed
    let commands_dir = src.parent().unwrap_or(&src);
    let versions_dir = commands_dir.join("versions");
    fs::create_dir_all(&versions_dir).map_err(|e| e.to_string())?;

    // Get base name and create versioned filename
    let filename = src.file_name().unwrap_or_default().to_string_lossy();
    let base_name = filename.trim_end_matches(".md");
    let versioned_name = format!("{}.v{}.md.archived", base_name, version);
    let dest = versions_dir.join(versioned_name);

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

/// Restore a deprecated or archived command to active status
#[tauri::command]
fn restore_command(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    let commands_dir = get_claude_dir().join("commands");
    let archived_dir = get_claude_dir().join(".commands").join("archived");
    let path_str = src.to_string_lossy();

    // Determine source type and calculate destination
    let dest = if src.starts_with(&archived_dir) {
        // From .commands/archived/ - restore to commands/
        let relative = src
            .strip_prefix(&archived_dir)
            .map_err(|_| "Cannot get relative path")?;
        commands_dir.join(relative)
    } else if path_str.contains("/.archive/") || path_str.contains("\\.archive\\") {
        // Legacy: from .archive/ subdirectory - move to parent
        let archive_dir = src.parent().ok_or("Cannot get parent directory")?;
        let parent = archive_dir
            .parent()
            .ok_or("Cannot get grandparent directory")?;
        let filename = src.file_name().ok_or("Cannot get filename")?;
        parent.join(filename)
    } else if path_str.ends_with(".md.deprecated") {
        // Legacy: remove .deprecated suffix
        PathBuf::from(path_str.trim_end_matches(".deprecated"))
    } else if path_str.ends_with(".md.archived") {
        // From versions/ - restore to parent with base name
        let parent = src.parent().and_then(|p| p.parent()).unwrap_or(&src);
        let file_name = src.file_name().unwrap_or_default().to_string_lossy();
        let base = file_name.split(".v").next().unwrap_or(&file_name);
        parent.join(format!("{}.md", base))
    } else {
        return Err("File is not deprecated or archived".to_string());
    };

    // Check if destination already exists
    if dest.exists() {
        return Err(format!("Cannot restore: {} already exists", dest.display()));
    }

    // Create destination directory if needed
    if let Some(dest_parent) = dest.parent() {
        fs::create_dir_all(dest_parent).map_err(|e| e.to_string())?;
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    // Also restore associated .changelog file if exists
    if src.starts_with(&archived_dir) {
        let base_name = src.with_extension("");
        let changelog_src = base_name.with_extension("changelog");
        if changelog_src.exists() {
            let changelog_relative = changelog_src
                .strip_prefix(&archived_dir)
                .map_err(|_| "Cannot get changelog relative path")?;
            let changelog_dest = commands_dir.join(changelog_relative);
            let _ = fs::rename(&changelog_src, &changelog_dest);
        }
    }

    Ok(dest.to_string_lossy().to_string())
}

/// Helper to add a field to frontmatter
fn add_frontmatter_field(content: &str, key: &str, value: &str) -> String {
    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let fm_content = &content[3..end_idx + 3];
            let body = &content[end_idx + 6..];
            return format!("---\n{}{}: {}\n---{}", fm_content, key, value, body);
        }
    }
    // No frontmatter, add one
    format!("---\n{}: {}\n---\n\n{}", key, value, content)
}

/// Helper to update or add a field in frontmatter
fn update_frontmatter_field(content: &str, key: &str, value: &str) -> String {
    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let fm_content = &content[3..end_idx + 3];
            let body = &content[end_idx + 6..];

            // Check if key exists and update it
            let mut found = false;
            let mapped: Vec<String> = fm_content
                .lines()
                .map(|line| {
                    if let Some(colon_idx) = line.find(':') {
                        let k = line[..colon_idx].trim();
                        if k == key {
                            found = true;
                            if value.is_empty() {
                                return String::new(); // Remove the field
                            }
                            return format!("{}: {}", key, value);
                        }
                    }
                    line.to_string()
                })
                .collect();
            let updated_fm: Vec<String> = mapped
                .into_iter()
                .filter(|l| !l.is_empty() || !found)
                .collect();

            let fm_str = updated_fm.join("\n");
            if found {
                return format!("---\n{}\n---{}", fm_str, body);
            } else if !value.is_empty() {
                // Key not found, add it
                return format!("---\n{}\n{}: {}\n---{}", fm_str, key, value, body);
            }
            return format!("---\n{}\n---{}", fm_str, body);
        }
    }
    // No frontmatter, add one if value is not empty
    if value.is_empty() {
        content.to_string()
    } else {
        format!("---\n{}: {}\n---\n\n{}", key, value, content)
    }
}

/// Update aliases for a command
#[tauri::command]
fn update_command_aliases(path: String, aliases: Vec<String>) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;

    // Format aliases as comma-separated string
    let aliases_value = aliases.join(", ");
    let updated_content = update_frontmatter_field(&content, "aliases", &aliases_value);

    fs::write(&file_path, updated_content).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Agents Feature (commands with 'model' field = agents)
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalAgent {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub model: Option<String>,
    pub tools: Option<String>,
    pub content: String,
}

#[tauri::command]
fn list_local_agents() -> Result<Vec<LocalAgent>, String> {
    let commands_dir = get_claude_dir().join("commands");

    if !commands_dir.exists() {
        return Ok(vec![]);
    }

    let mut agents = Vec::new();
    collect_agents(&commands_dir, &commands_dir, &mut agents)?;

    agents.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(agents)
}

fn collect_agents(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    agents: &mut Vec<LocalAgent>,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            collect_agents(base_dir, &path, agents)?;
        } else if path.extension().map_or(false, |e| e == "md") {
            let content = fs::read_to_string(&path).unwrap_or_default();
            let (frontmatter, _, body) = parse_frontmatter(&content);

            // Only include if it has a 'model' field (agents have model, commands don't)
            if frontmatter.contains_key("model") {
                let relative = path.strip_prefix(base_dir).unwrap_or(&path);
                let name = relative
                    .to_string_lossy()
                    .trim_end_matches(".md")
                    .replace("\\", "/")
                    .to_string();

                agents.push(LocalAgent {
                    name,
                    path: path.to_string_lossy().to_string(),
                    description: frontmatter.get("description").cloned(),
                    model: frontmatter.get("model").cloned(),
                    tools: frontmatter.get("tools").cloned(),
                    content: body,
                });
            }
        }
    }
    Ok(())
}

// ============================================================================
// Skills Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalSkill {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub content: String,
}

#[tauri::command]
fn list_local_skills() -> Result<Vec<LocalSkill>, String> {
    let skills_dir = get_claude_dir().join("skills");

    if !skills_dir.exists() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();

    for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            let skill_name = path.file_name().unwrap().to_string_lossy().to_string();
            let skill_md = path.join("SKILL.md");

            if skill_md.exists() {
                let content = fs::read_to_string(&skill_md).unwrap_or_default();
                let (frontmatter, _, body) = parse_frontmatter(&content);

                skills.push(LocalSkill {
                    name: skill_name,
                    path: skill_md.to_string_lossy().to_string(),
                    description: frontmatter.get("description").cloned(),
                    content: body,
                });
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

// ============================================================================
// Knowledge Base (Distill Documents)
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DistillDocument {
    pub date: String,
    pub file: String,
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub session: Option<String>,
}

fn get_distill_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio/docs/distill")
}

fn get_reference_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio/docs/reference")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReferenceSource {
    pub name: String,
    pub path: String,
    pub doc_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReferenceDoc {
    pub name: String,
    pub path: String,
    pub group: Option<String>,
}

#[tauri::command]
fn list_reference_sources() -> Result<Vec<ReferenceSource>, String> {
    let ref_dir = get_reference_dir();
    if !ref_dir.exists() {
        return Ok(vec![]);
    }

    let mut sources = Vec::new();
    for entry in fs::read_dir(&ref_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        // Follow symlinks and check if it's a directory
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            let doc_count = fs::read_dir(&path)
                .map(|entries| {
                    entries
                        .filter(|e| {
                            e.as_ref()
                                .ok()
                                .map(|e| {
                                    e.path().extension().map(|ext| ext == "md").unwrap_or(false)
                                })
                                .unwrap_or(false)
                        })
                        .count()
                })
                .unwrap_or(0);

            sources.push(ReferenceSource {
                name,
                path: path.to_string_lossy().to_string(),
                doc_count,
            });
        }
    }

    sources.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sources)
}

#[tauri::command]
fn list_reference_docs(source: String) -> Result<Vec<ReferenceDoc>, String> {
    let ref_dir = get_reference_dir();
    let source_dir = ref_dir.join(&source);

    if !source_dir.exists() {
        return Ok(vec![]);
    }

    // Read _order.txt if exists, parse groups from comments
    let order_file = source_dir.join("_order.txt");
    let mut order_map: HashMap<String, (usize, Option<String>)> = HashMap::new(); // name -> (order, group)

    if order_file.exists() {
        if let Ok(content) = fs::read_to_string(&order_file) {
            let mut current_group: Option<String> = None;
            let mut order_idx = 0;

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed.starts_with('#') {
                    // Comment line = group name (strip # and trim)
                    let group_name = trimmed.trim_start_matches('#').trim();
                    if !group_name.is_empty() {
                        current_group = Some(group_name.to_string());
                    }
                } else {
                    // Doc name
                    order_map.insert(trimmed.to_string(), (order_idx, current_group.clone()));
                    order_idx += 1;
                }
            }
        }
    }

    let mut docs = Vec::new();
    for entry in fs::read_dir(&source_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().map(|e| e == "md").unwrap_or(false) {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let group = order_map.get(&name).and_then(|(_, g)| g.clone());

            docs.push(ReferenceDoc {
                name,
                path: path.to_string_lossy().to_string(),
                group,
            });
        }
    }

    // Sort by _order.txt if available, otherwise alphabetically
    if !order_map.is_empty() {
        docs.sort_by(|a, b| {
            let a_idx = order_map
                .get(&a.name)
                .map(|(i, _)| *i)
                .unwrap_or(usize::MAX);
            let b_idx = order_map
                .get(&b.name)
                .map(|(i, _)| *i)
                .unwrap_or(usize::MAX);
            a_idx.cmp(&b_idx)
        });
    } else {
        docs.sort_by(|a, b| a.name.cmp(&b.name));
    }

    Ok(docs)
}

#[tauri::command]
fn get_reference_doc(path: String) -> Result<String, String> {
    let doc_path = PathBuf::from(&path);
    if !doc_path.exists() {
        return Err(format!("Document not found: {}", path));
    }
    fs::read_to_string(&doc_path).map_err(|e| e.to_string())
}

// ============================================================================
// Review Queue Commands
// ============================================================================

#[tauri::command]
fn emit_review_queue(window: tauri::Window, items: Vec<ReviewItem>) -> Result<(), String> {
    window
        .emit("review-queue-update", items)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_review_queue() -> Vec<ReviewItem> {
    REVIEW_QUEUE.lock().unwrap().clone()
}

#[tauri::command]
fn get_completed_queue(limit: Option<usize>, offset: Option<usize>) -> Vec<ReviewItem> {
    let queue = COMPLETED_QUEUE.lock().unwrap();
    let skip = offset.unwrap_or(0);
    let take = limit.unwrap_or(50);
    // Return newest first (reverse order since we append)
    queue.iter().rev().skip(skip).take(take).cloned().collect()
}

#[tauri::command]
fn dismiss_review_item(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let dismissed_item = {
        let mut queue = REVIEW_QUEUE.lock().unwrap();
        let pos = queue.iter().position(|item| item.id == id);
        pos.map(|i| queue.remove(i))
    };

    if let Some(mut item) = dismissed_item {
        // Update timestamp to completion time
        item.timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Add to completed queue
        {
            let mut completed = COMPLETED_QUEUE.lock().unwrap();
            completed.push(item.clone());
        }

        // Persist to disk
        persist_completed_item(&item);

        // Emit updated queues to frontend
        let pending = REVIEW_QUEUE.lock().unwrap().clone();
        let _ = app_handle.emit("review-queue-update", pending);

        // Update tray menu
        update_tray_menu(&app_handle);

        // Persist queue
        save_review_queue();
    }

    Ok(())
}

#[tauri::command]
fn clear_completed_queue() -> Result<(), String> {
    {
        let mut queue = COMPLETED_QUEUE.lock().unwrap();
        queue.clear();
    }
    // Remove persistence file
    let path = get_completed_queue_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn list_distill_documents() -> Result<Vec<DistillDocument>, String> {
    let distill_dir = get_distill_dir();
    let index_path = distill_dir.join("index.jsonl");

    if !index_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let mut docs: Vec<DistillDocument> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut doc: DistillDocument = serde_json::from_str(line).ok()?;
            // Use actual file modification time instead of index.jsonl date
            let file_path = distill_dir.join(&doc.file);
            if let Ok(metadata) = fs::metadata(&file_path) {
                if let Ok(modified) = metadata.modified() {
                    let datetime: chrono::DateTime<chrono::Local> = modified.into();
                    doc.date = datetime.format("%Y-%m-%dT%H:%M:%S").to_string();
                }
            }
            Some(doc)
        })
        .collect();

    // Sort by date descending (newest first)
    docs.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(docs)
}

#[tauri::command]
fn get_distill_document(file: String) -> Result<String, String> {
    let distill_dir = get_distill_dir();
    let doc_path = distill_dir.join(&file);

    if !doc_path.exists() {
        return Err(format!("Document not found: {}", file));
    }

    fs::read_to_string(&doc_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_session_project(session_id: String) -> Result<Option<Session>, String> {
    let projects_dir = get_claude_dir().join("projects");
    if !projects_dir.exists() {
        return Ok(None);
    }

    for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
        let project_entry = project_entry.map_err(|e| e.to_string())?;
        let project_path = project_entry.path();

        if !project_path.is_dir() {
            continue;
        }

        let session_file = project_path.join(format!("{}.jsonl", session_id));
        if session_file.exists() {
            let project_id = project_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let display_path = decode_project_path(&project_id);
            let content = fs::read_to_string(&session_file).unwrap_or_default();

            let mut summary = None;
            for line in content.lines() {
                if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                    if parsed.line_type.as_deref() == Some("summary") {
                        summary = parsed.summary;
                        break;
                    }
                }
            }

            return Ok(Some(Session {
                id: session_id,
                project_id,
                project_path: Some(display_path),
                summary,
                message_count: 0,
                last_modified: 0,
            }));
        }
    }
    Ok(None)
}

#[tauri::command]
fn get_distill_command_file() -> Result<String, String> {
    let cmd_path = get_claude_dir().join("commands/distill.md");

    if !cmd_path.exists() {
        return Err("distill.md command file not found".to_string());
    }

    fs::read_to_string(&cmd_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_distill_watch_enabled() -> bool {
    DISTILL_WATCH_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
fn set_distill_watch_enabled(enabled: bool) {
    DISTILL_WATCH_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

// ============================================================================
// Marketplace Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateComponent {
    pub name: String,
    pub path: String,
    pub category: String,
    #[serde(rename = "type")]
    pub component_type: String,
    pub description: Option<String>,
    pub downloads: Option<u32>,
    pub content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TemplatesCatalog {
    pub agents: Vec<TemplateComponent>,
    pub commands: Vec<TemplateComponent>,
    pub mcps: Vec<TemplateComponent>,
    pub hooks: Vec<TemplateComponent>,
    pub settings: Vec<TemplateComponent>,
    pub skills: Vec<TemplateComponent>,
}

fn get_templates_path(app_handle: Option<&tauri::AppHandle>) -> PathBuf {
    // In production: read from bundled resources
    // Tauri maps "../" to "_up_/" in the resource bundle
    if let Some(handle) = app_handle {
        if let Ok(resource_path) = handle.path().resource_dir() {
            let bundled =
                resource_path.join("_up_/third-parties/claude-code-templates/docs/components.json");
            if bundled.exists() {
                return bundled;
            }
        }
    }

    // In development: read from project source
    let relative_path = "third-parties/claude-code-templates/docs/components.json";
    let candidates = [
        std::env::current_dir().ok(),
        std::env::current_dir()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf())),
    ];

    for candidate in candidates.into_iter().flatten() {
        let path = candidate.join(relative_path);
        if path.exists() {
            return path;
        }
    }

    std::env::current_dir()
        .unwrap_or_default()
        .join(relative_path)
}

#[tauri::command]
fn get_templates_catalog(app_handle: tauri::AppHandle) -> Result<TemplatesCatalog, String> {
    let path = get_templates_path(Some(&app_handle));

    if !path.exists() {
        return Err(format!("Templates catalog not found at {:?}", path));
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let raw: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Parse each component type, defaulting to empty arrays
    let agents: Vec<TemplateComponent> = raw
        .get("agents")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let commands: Vec<TemplateComponent> = raw
        .get("commands")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let mcps: Vec<TemplateComponent> = raw
        .get("mcps")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let hooks: Vec<TemplateComponent> = raw
        .get("hooks")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let settings: Vec<TemplateComponent> = raw
        .get("settings")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let skills: Vec<TemplateComponent> = raw
        .get("skills")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    Ok(TemplatesCatalog {
        agents,
        commands,
        mcps,
        hooks,
        settings,
        skills,
    })
}

#[tauri::command]
fn install_command_template(name: String, content: String) -> Result<String, String> {
    let commands_dir = get_claude_dir().join("commands");
    fs::create_dir_all(&commands_dir).map_err(|e| e.to_string())?;

    let file_path = commands_dir.join(format!("{}.md", name));
    fs::write(&file_path, content).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn install_mcp_template(name: String, config: String) -> Result<String, String> {
    // MCP servers are stored in ~/.claude.json (not ~/.claude/settings.json)
    let claude_json_path = get_claude_json_path();

    // Parse the MCP config
    let mcp_config: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;

    // Extract the actual server config from the template
    // Templates may come as {"mcpServers": {"name": {...}}} or just {...}
    let server_config =
        if let Some(mcp_servers) = mcp_config.get("mcpServers").and_then(|v| v.as_object()) {
            // Template has mcpServers wrapper - extract the first server's config
            mcp_servers
                .values()
                .next()
                .cloned()
                .unwrap_or(mcp_config.clone())
        } else {
            // Template is already the bare config
            mcp_config
        };

    // Read existing ~/.claude.json or create new
    let mut claude_json: serde_json::Value = if claude_json_path.exists() {
        let content = fs::read_to_string(&claude_json_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure mcpServers exists
    if !claude_json.get("mcpServers").is_some() {
        claude_json["mcpServers"] = serde_json::json!({});
    }

    // Add the MCP server with the extracted config
    claude_json["mcpServers"][&name] = server_config;

    // Write back
    let output = serde_json::to_string_pretty(&claude_json).map_err(|e| e.to_string())?;
    fs::write(&claude_json_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Installed MCP: {}", name))
}

#[tauri::command]
fn uninstall_mcp_template(name: String) -> Result<String, String> {
    let claude_json_path = get_claude_json_path();

    if !claude_json_path.exists() {
        return Err("No MCP configuration found".to_string());
    }

    let content = fs::read_to_string(&claude_json_path).map_err(|e| e.to_string())?;
    let mut claude_json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(mcp_servers) = claude_json
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
    {
        if mcp_servers.remove(&name).is_none() {
            return Err(format!("MCP '{}' not found", name));
        }
    } else {
        return Err("No mcpServers found".to_string());
    }

    let output = serde_json::to_string_pretty(&claude_json).map_err(|e| e.to_string())?;
    fs::write(&claude_json_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Uninstalled MCP: {}", name))
}

#[tauri::command]
fn check_mcp_installed(name: String) -> bool {
    let claude_json_path = get_claude_json_path();

    if !claude_json_path.exists() {
        return false;
    }

    let Ok(content) = fs::read_to_string(&claude_json_path) else {
        return false;
    };

    let Ok(claude_json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };

    claude_json
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .map(|servers| servers.contains_key(&name))
        .unwrap_or(false)
}

#[tauri::command]
fn install_hook_template(name: String, config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    // Parse the hook config (should be an object with event type as key)
    let hook_config: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| e.to_string())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure hooks exists
    if !settings.get("hooks").is_some() {
        settings["hooks"] = serde_json::json!({});
    }

    // Merge hook config - hooks are typically structured as {"PreToolUse": [...], "PostToolUse": [...]}
    if let Some(hook_obj) = hook_config.as_object() {
        for (event_type, handlers) in hook_obj {
            if let Some(handlers_arr) = handlers.as_array() {
                // Get existing handlers for this event type
                let existing = settings["hooks"]
                    .get(event_type)
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                // Merge (append new handlers)
                let mut merged: Vec<serde_json::Value> = existing;
                merged.extend(handlers_arr.clone());
                settings["hooks"][event_type] = serde_json::Value::Array(merged);
            }
        }
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Installed hook: {}", name))
}

#[tauri::command]
fn install_setting_template(config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    // Parse the setting config
    let new_settings: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| e.to_string())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Deep merge the new settings
    if let (Some(existing_obj), Some(new_obj)) =
        (settings.as_object_mut(), new_settings.as_object())
    {
        for (key, value) in new_obj {
            existing_obj.insert(key.clone(), value.clone());
        }
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok("Settings updated".to_string())
}

// ============================================================================
// Context Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct ContextFile {
    pub name: String,
    pub path: String,
    pub scope: String, // "global" or "project"
    pub content: String,
    pub last_modified: u64,
}

#[tauri::command]
fn get_context_files() -> Result<Vec<ContextFile>, String> {
    let mut files = Vec::new();

    // Global CLAUDE.md
    let global_path = get_claude_dir().join("CLAUDE.md");
    if global_path.exists() {
        if let Ok(content) = fs::read_to_string(&global_path) {
            let last_modified = fs::metadata(&global_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: "CLAUDE.md".to_string(),
                path: global_path.to_string_lossy().to_string(),
                scope: "global".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check each project directory for CLAUDE.md
    let projects_dir = get_claude_dir().join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let project_path = entry.path();
                if project_path.is_dir() {
                    let project_id = project_path
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .to_string();
                    let display_path = decode_project_path(&project_id);

                    // Convert project_id back to real path and check for CLAUDE.md
                    let real_project_path = PathBuf::from(&display_path);
                    let claude_md_path = real_project_path.join("CLAUDE.md");

                    if claude_md_path.exists() {
                        if let Ok(content) = fs::read_to_string(&claude_md_path) {
                            let last_modified = fs::metadata(&claude_md_path)
                                .ok()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);

                            files.push(ContextFile {
                                name: format!("{}/CLAUDE.md", display_path),
                                path: claude_md_path.to_string_lossy().to_string(),
                                scope: "project".to_string(),
                                content,
                                last_modified,
                            });
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(files)
}

#[tauri::command]
fn get_project_context(project_path: String) -> Result<Vec<ContextFile>, String> {
    let mut files = Vec::new();
    let project_dir = PathBuf::from(&project_path);

    // Check for CLAUDE.md in project root
    let claude_md = project_dir.join("CLAUDE.md");
    if claude_md.exists() {
        if let Ok(content) = fs::read_to_string(&claude_md) {
            let last_modified = fs::metadata(&claude_md)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: "CLAUDE.md".to_string(),
                path: claude_md.to_string_lossy().to_string(),
                scope: "project".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check for .claude/CLAUDE.md in project
    let dot_claude_md = project_dir.join(".claude").join("CLAUDE.md");
    if dot_claude_md.exists() {
        if let Ok(content) = fs::read_to_string(&dot_claude_md) {
            let last_modified = fs::metadata(&dot_claude_md)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: ".claude/CLAUDE.md".to_string(),
                path: dot_claude_md.to_string_lossy().to_string(),
                scope: "project".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check for project-local commands in .claude/commands/
    let commands_dir = project_dir.join(".claude").join("commands");
    if commands_dir.exists() && commands_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&commands_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        let name = path.file_name().unwrap().to_string_lossy().to_string();
                        let last_modified = fs::metadata(&path)
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);

                        files.push(ContextFile {
                            name: format!(".claude/commands/{}", name),
                            path: path.to_string_lossy().to_string(),
                            scope: "command".to_string(),
                            content,
                            last_modified,
                        });
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(files)
}

// ============================================================================
// Command Usage Stats Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandStats {
    pub name: String,
    pub count: usize,
}

#[tauri::command]
async fn get_command_stats() -> Result<HashMap<String, usize>, String> {
    // Get current cache state
    let (cached_stats, cached_scanned) = {
        let cache = COMMAND_STATS_CACHE.lock().unwrap();
        (cache.stats.clone(), cache.scanned.clone())
    };

    // Incremental update in background
    let (new_stats, new_scanned) = tauri::async_runtime::spawn_blocking(move || {
        let projects_dir = get_claude_dir().join("projects");
        let mut stats = cached_stats;
        let mut scanned = cached_scanned;

        if !projects_dir.exists() {
            return Ok::<_, String>((stats, scanned));
        }

        let command_pattern = regex::Regex::new(r"<command-name>(/[^<]+)</command-name>")
            .map_err(|e| e.to_string())?;

        for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let project_entry = project_entry.map_err(|e| e.to_string())?;
            let project_path = project_entry.path();

            if !project_path.is_dir() {
                continue;
            }

            for session_entry in fs::read_dir(&project_path).map_err(|e| e.to_string())? {
                let session_entry = session_entry.map_err(|e| e.to_string())?;
                let session_path = session_entry.path();
                let name = session_path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                if !name.ends_with(".jsonl") || name.starts_with("agent-") {
                    continue;
                }

                let path_str = session_path.to_string_lossy().to_string();
                let file_size = session_path.metadata().map(|m| m.len()).unwrap_or(0);
                let prev_size = scanned.get(&path_str).copied().unwrap_or(0);

                // Skip if no new content
                if file_size <= prev_size {
                    continue;
                }

                // Read only new content (from prev_size offset)
                if let Ok(mut file) = std::fs::File::open(&session_path) {
                    use std::io::{Read, Seek, SeekFrom};
                    if file.seek(SeekFrom::Start(prev_size)).is_ok() {
                        let mut new_content = String::new();
                        if file.read_to_string(&mut new_content).is_ok() {
                            for cap in command_pattern.captures_iter(&new_content) {
                                if let Some(cmd_name) = cap.get(1) {
                                    // Remove leading "/" to match cmd.name format
                                    let name =
                                        cmd_name.as_str().trim_start_matches('/').to_string();
                                    *stats.entry(name).or_insert(0) += 1;
                                }
                            }
                        }
                    }
                }
                scanned.insert(path_str, file_size);
            }
        }

        Ok((stats, scanned))
    })
    .await
    .map_err(|e| e.to_string())??;

    // Update cache
    {
        let mut cache = COMMAND_STATS_CACHE.lock().unwrap();
        cache.stats = new_stats.clone();
        cache.scanned = new_scanned;
    }

    Ok(new_stats)
}

// ============================================================================
// Settings Feature
// ============================================================================

#[tauri::command]
fn get_settings() -> Result<ClaudeSettings, String> {
    let settings_path = get_claude_dir().join("settings.json");
    let claude_json_path = get_claude_json_path();

    // Read ~/.claude/settings.json for permissions, hooks, etc.
    let (mut raw, permissions, hooks) = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        let raw: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let permissions = raw.get("permissions").cloned();
        let hooks = raw.get("hooks").cloned();
        (raw, permissions, hooks)
    } else {
        (Value::Null, None, None)
    };

    // Overlay disabled env from ~/.lovstudio/lovcode (do not persist in settings.json)
    if let Ok(disabled_env) = load_disabled_env() {
        if !disabled_env.is_empty() {
            if let Some(obj) = raw.as_object_mut() {
                obj.insert(
                    "_lovcode_disabled_env".to_string(),
                    Value::Object(disabled_env),
                );
            } else {
                raw = serde_json::json!({
                    "_lovcode_disabled_env": disabled_env
                });
            }
        } else if let Some(obj) = raw.as_object_mut() {
            obj.remove("_lovcode_disabled_env");
        }
    }

    // Read ~/.claude.json for MCP servers
    let mut mcp_servers = Vec::new();
    if claude_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&claude_json_path) {
            if let Ok(claude_json) = serde_json::from_str::<Value>(&content) {
                if let Some(mcp_obj) = claude_json.get("mcpServers").and_then(|v| v.as_object()) {
                    for (name, config) in mcp_obj {
                        if let Some(obj) = config.as_object() {
                            // Handle nested mcpServers format (from some installers)
                            let actual_config = if let Some(nested) =
                                obj.get("mcpServers").and_then(|v| v.as_object())
                            {
                                nested.values().next().and_then(|v| v.as_object())
                            } else {
                                Some(obj)
                            };

                            if let Some(cfg) = actual_config {
                                let description = cfg
                                    .get("description")
                                    .and_then(|v| v.as_str())
                                    .map(String::from);
                                let command = cfg
                                    .get("command")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let args: Vec<String> = cfg
                                    .get("args")
                                    .and_then(|v| v.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|v| v.as_str().map(String::from))
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                let env: HashMap<String, String> = cfg
                                    .get("env")
                                    .and_then(|v| v.as_object())
                                    .map(|m| {
                                        m.iter()
                                            .filter_map(|(k, v)| {
                                                v.as_str().map(|s| (k.clone(), s.to_string()))
                                            })
                                            .collect()
                                    })
                                    .unwrap_or_default();

                                mcp_servers.push(McpServer {
                                    name: name.clone(),
                                    description,
                                    command,
                                    args,
                                    env,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ClaudeSettings {
        raw,
        permissions,
        hooks,
        mcp_servers,
    })
}

fn get_session_path(project_id: &str, session_id: &str) -> PathBuf {
    get_claude_dir()
        .join("projects")
        .join(project_id)
        .join(format!("{}.jsonl", session_id))
}

#[tauri::command]
fn open_session_in_editor(project_id: String, session_id: String) -> Result<(), String> {
    let path = get_session_path(&project_id, &session_id);
    if !path.exists() {
        return Err("Session file not found".to_string());
    }
    open_in_editor(path.to_string_lossy().to_string())
}

#[tauri::command]
fn reveal_session_file(project_id: String, session_id: String) -> Result<(), String> {
    let session_path = get_session_path(&project_id, &session_id);

    if !session_path.exists() {
        return Err("Session file not found".to_string());
    }

    let path = session_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(session_path.parent().unwrap_or(&session_path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_in_editor(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_settings_path() -> String {
    get_claude_dir()
        .join("settings.json")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn get_mcp_config_path() -> String {
    get_claude_json_path().to_string_lossy().to_string()
}

#[tauri::command]
fn get_home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_mcp_env(server_name: String, env_key: String, env_value: String) -> Result<(), String> {
    let claude_json_path = get_claude_json_path();

    let mut claude_json: serde_json::Value = if claude_json_path.exists() {
        let content = fs::read_to_string(&claude_json_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("~/.claude.json not found".to_string());
    };

    let server = claude_json
        .get_mut("mcpServers")
        .and_then(|s| s.get_mut(&server_name))
        .ok_or_else(|| format!("MCP server '{}' not found", server_name))?;

    if !server.get("env").is_some() {
        server["env"] = serde_json::json!({});
    }
    server["env"][&env_key] = serde_json::Value::String(env_value);

    let output = serde_json::to_string_pretty(&claude_json).map_err(|e| e.to_string())?;
    fs::write(&claude_json_path, output).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn update_settings_env(
    env_key: String,
    env_value: String,
    is_new: Option<bool>,
) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };

    if !settings.get("env").and_then(|v| v.as_object()).is_some() {
        settings["env"] = serde_json::json!({});
    }
    settings["env"][&env_key] = serde_json::Value::String(env_value);

    // Track custom env keys when is_new=true
    if is_new == Some(true) {
        let custom_keys = settings
            .get("_lovcode_custom_env_keys")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let key_val = serde_json::Value::String(env_key.clone());
        if !custom_keys.contains(&key_val) {
            let mut new_keys = custom_keys;
            new_keys.push(key_val);
            settings["_lovcode_custom_env_keys"] = serde_json::Value::Array(new_keys);
        }
    }

    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_settings_env(env_key: String) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };

    if let Some(env) = settings.get_mut("env").and_then(|v| v.as_object_mut()) {
        env.remove(&env_key);
    }

    // Also remove from custom keys list
    if let Some(custom_keys) = settings
        .get_mut("_lovcode_custom_env_keys")
        .and_then(|v| v.as_array_mut())
    {
        custom_keys.retain(|v| v.as_str() != Some(&env_key));
    }

    // Also remove from disabled env if present
    if let Some(disabled) = settings
        .get_mut("_lovcode_disabled_env")
        .and_then(|v| v.as_object_mut())
    {
        disabled.remove(&env_key);
    }

    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    let mut disabled_env = load_disabled_env()?;
    disabled_env.remove(&env_key);
    save_disabled_env(&disabled_env)?;

    Ok(())
}

#[tauri::command]
fn disable_settings_env(env_key: String) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Get current value before removing
    let current_value = settings
        .get("env")
        .and_then(|v| v.get(&env_key))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Remove from active env
    if let Some(env) = settings.get_mut("env").and_then(|v| v.as_object_mut()) {
        env.remove(&env_key);
    }

    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    let mut disabled_env = load_disabled_env()?;
    disabled_env.insert(env_key, serde_json::Value::String(current_value));
    save_disabled_env(&disabled_env)?;

    Ok(())
}

#[tauri::command]
fn enable_settings_env(env_key: String) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };

    // Get value from disabled env
    let mut disabled_env = load_disabled_env()?;
    let disabled_value = disabled_env
        .get(&env_key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    disabled_env.remove(&env_key);
    save_disabled_env(&disabled_env)?;

    // Add back to active env
    if !settings.get("env").and_then(|v| v.as_object()).is_some() {
        settings["env"] = serde_json::json!({});
    }
    settings["env"][&env_key] = serde_json::Value::String(disabled_value);

    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn update_disabled_settings_env(env_key: String, env_value: String) -> Result<(), String> {
    let mut disabled_env = load_disabled_env()?;
    disabled_env.insert(env_key, serde_json::Value::String(env_value));
    save_disabled_env(&disabled_env)?;

    Ok(())
}

#[derive(Serialize)]
struct ZenmuxTestResult {
    ok: bool,
    status: u16,
    body: String,
}

#[tauri::command]
async fn test_zenmux_connection(
    base_url: String,
    auth_token: String,
    model: String,
) -> Result<ZenmuxTestResult, String> {
    if auth_token.trim().is_empty() {
        return Err("ZENMUX_API_KEY/ANTHROPIC_AUTH_TOKEN is empty".to_string());
    }

    let base = base_url.trim_end_matches('/');
    let url = format!("{}/v1/messages", base);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "model": model,
        "max_tokens": 1,
        "messages": [
            { "role": "user", "content": "ping" }
        ]
    });

    println!("zenmux test request url={}", url);
    println!("zenmux test request headers x-api-key={} anthropic-version=2023-06-01 content-type=application/json", auth_token);
    println!("zenmux test request body={}", payload);

    let response = client
        .post(&url)
        .header("x-api-key", auth_token)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    println!("zenmux test status={} body={}", status, body);

    Ok(ZenmuxTestResult {
        ok: status.is_success(),
        status: status.as_u16(),
        body,
    })
}

// ============================================================================
// macOS Window Configuration
// ============================================================================

#[cfg(target_os = "macos")]
fn setup_float_window_macos(app: &tauri::App) {
    use objc::*;
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("float") {
        // 获取原生 NSWindow 句柄
        if let Ok(ns_window) = window.ns_window() {
            unsafe {
                let ns_win: id = ns_window as id;

                // 设置窗口可以接收鼠标事件但不激活
                ns_win.setAcceptsMouseMovedEvents_(YES);

                // 设置窗口行为：可以出现在所有空间，且不激活
                let behavior =
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle;
                ns_win.setCollectionBehavior_(behavior);

                // 设置窗口级别为悬浮面板 (NSFloatingWindowLevel = 3)
                ns_win.setLevel_(3);

                // 关键：添加 NSWindowStyleMaskNonactivatingPanel 样式
                // 这让窗口可以成为 key window 但不成为 main window
                // 从而让 WebKit 正常更新光标
                // NSWindowStyleMaskNonactivatingPanel = 1 << 7 = 128
                let current_style: u64 = msg_send![ns_win, styleMask];
                let new_style = current_style | (1 << 7); // NSWindowStyleMaskNonactivatingPanel
                let _: () = msg_send![ns_win, setStyleMask: new_style];

                // 关键：忽略鼠标事件不会让窗口获得焦点
                ns_win.setIgnoresMouseEvents_(cocoa::base::NO);

                // 禁用 cursor rects，防止系统重置光标
                let _: () = msg_send![ns_win, disableCursorRects];

                println!("[DEBUG] Float window macOS properties configured with NonactivatingPanel style");
            }
        }
    }
}

// ============================================================================
// Cursor Control (macOS)
// ============================================================================

#[derive(Serialize)]
struct CursorInWindow {
    supported: bool,
    in_window: bool,
    x: f64,
    y: f64,
}

/// 获取鼠标在指定窗口内容区内的坐标（逻辑坐标，左上角为原点）
#[tauri::command]
fn get_cursor_position_in_window(app_handle: tauri::AppHandle, label: String) -> CursorInWindow {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;

        let mut result = CursorInWindow {
            supported: true,
            in_window: false,
            x: 0.0,
            y: 0.0,
        };

        if let Some(window) = app_handle.get_webview_window(&label) {
            if let Ok(ns_window) = window.ns_window() {
                unsafe {
                    let ns_win: id = ns_window as id;
                    let location: cocoa::foundation::NSPoint =
                        msg_send![class!(NSEvent), mouseLocation];
                    let window_point: cocoa::foundation::NSPoint =
                        msg_send![ns_win, convertPointFromScreen: location];
                    let content_view: id = msg_send![ns_win, contentView];

                    if content_view != nil {
                        let view_point: cocoa::foundation::NSPoint =
                            msg_send![content_view, convertPoint: window_point fromView: nil];
                        let view_bounds: cocoa::foundation::NSRect =
                            msg_send![content_view, bounds];
                        let width = view_bounds.size.width;
                        let height = view_bounds.size.height;
                        let local_x = view_point.x - view_bounds.origin.x;
                        let local_y = view_point.y - view_bounds.origin.y;
                        let flipped: BOOL = msg_send![content_view, isFlipped];

                        if local_x >= 0.0 && local_x <= width && local_y >= 0.0 && local_y <= height
                        {
                            result.in_window = true;
                            result.x = local_x;
                            result.y = if flipped == YES {
                                local_y
                            } else {
                                height - local_y
                            };
                        }
                    }
                }
            }
        }

        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        CursorInWindow {
            supported: false,
            in_window: false,
            x: 0.0,
            y: 0.0,
        }
    }
}

/// 获取当前鼠标位置（全局屏幕坐标）
#[tauri::command]
fn get_cursor_position() -> (f64, f64) {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let location: cocoa::foundation::NSPoint = msg_send![class!(NSEvent), mouseLocation];
            // macOS 的 y 坐标是从屏幕底部开始的，需要转换
            // 获取主屏幕高度
            let screen: id = msg_send![class!(NSScreen), mainScreen];
            let frame: cocoa::foundation::NSRect = msg_send![screen, frame];
            let screen_height = frame.size.height;
            // 转换 y 坐标：从底部起算 -> 从顶部起算
            (location.x, screen_height - location.y)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        (0.0, 0.0)
    }
}

/// 强制设置系统光标，绕过 WebKit 的 key window 限制
#[tauri::command]
fn set_cursor(cursor_type: String) {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let cursor_class: id = msg_send![class!(NSCursor), class];
            let cursor: id = match cursor_type.as_str() {
                "pointer" | "hand" => msg_send![cursor_class, pointingHandCursor],
                "text" => msg_send![cursor_class, IBeamCursor],
                "crosshair" => msg_send![cursor_class, crosshairCursor],
                "move" => msg_send![cursor_class, openHandCursor],
                "grab" => msg_send![cursor_class, openHandCursor],
                "grabbing" => msg_send![cursor_class, closedHandCursor],
                "not-allowed" => msg_send![cursor_class, operationNotAllowedCursor],
                "resize-ew" | "ew-resize" | "col-resize" => {
                    msg_send![cursor_class, resizeLeftRightCursor]
                }
                "resize-ns" | "ns-resize" | "row-resize" => {
                    msg_send![cursor_class, resizeUpDownCursor]
                }
                _ => msg_send![cursor_class, arrowCursor], // default
            };
            let _: () = msg_send![cursor, set];
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = cursor_type; // suppress unused warning
    }
}

// ============================================================================
// tmux Navigation
// ============================================================================

#[tauri::command]
fn navigate_to_tmux_pane(session: String, window: String, pane: String) -> Result<(), String> {
    println!(
        "[DEBUG][navigate_to_tmux_pane] 入口: session={}, window={}, pane={}",
        session, window, pane
    );

    let target = format!("{}:{}.{}", session, window, pane);

    // 获取 tmux pane 的 TTY
    let pane_tty_result = std::process::Command::new("tmux")
        .args(["display-message", "-t", &target, "-p", "#{pane_tty}"])
        .output();

    let pane_tty = match &pane_tty_result {
        Ok(output) => {
            let tty = String::from_utf8_lossy(&output.stdout).trim().to_string();
            println!("[DEBUG][navigate_to_tmux_pane] tmux pane TTY: '{}'", tty);
            tty
        }
        Err(e) => {
            println!("[DEBUG][navigate_to_tmux_pane] 获取 pane TTY 失败: {}", e);
            String::new()
        }
    };

    #[cfg(target_os = "macos")]
    {
        // 参考 Lovnotifier 的 activate.sh 实现
        // 遍历 windows -> tabs -> sessions，通过 session name 匹配 tmux session
        let script = format!(
            r#"
            tell application "iTerm2"
                activate
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with s in sessions of t
                            if name of s contains "{}" then
                                select w
                                select t
                                select s
                                return "FOUND"
                            end if
                        end repeat
                    end repeat
                end repeat
                return "NOT_FOUND"
            end tell
        "#,
            session
        );

        println!(
            "[DEBUG][navigate_to_tmux_pane] iTerm2 查找 session name 包含 '{}'",
            session
        );
        let result = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output();

        match &result {
            Ok(output) => {
                println!(
                    "[DEBUG][navigate_to_tmux_pane] iTerm2 结果: {}",
                    String::from_utf8_lossy(&output.stdout).trim()
                );
            }
            Err(e) => {
                println!("[DEBUG][navigate_to_tmux_pane] iTerm2 错误: {}", e);
            }
        }

        // 切换 tmux 窗口和 pane
        if !window.is_empty() {
            let _ = std::process::Command::new("tmux")
                .args(["select-window", "-t", &format!("{}:{}", session, window)])
                .output();
        }
        if !pane.is_empty() {
            let _ = std::process::Command::new("tmux")
                .args([
                    "select-pane",
                    "-t",
                    &format!("{}:{}.{}", session, window, pane),
                ])
                .output();
        }
    }

    println!("[DEBUG][navigate_to_tmux_pane] 完成");
    Ok(())
}

// ============================================================================
// Notification HTTP Server
// ============================================================================

/// Incoming notification payload from shell scripts
#[derive(Debug, Deserialize)]
struct NotifyPayload {
    title: String,
    project: Option<String>,
    project_path: Option<String>,
    session_id: Option<String>,
    tmux_session: Option<String>,
    tmux_window: Option<String>,
    tmux_pane: Option<String>,
}

/// Start the HTTP notification server
fn start_notify_server(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let app_handle = Arc::new(app_handle);

        // POST /notify - receive notifications from shell scripts
        let app_for_notify = app_handle.clone();
        let notify_route = warp::post()
            .and(warp::path("notify"))
            .and(warp::body::json())
            .map(move |payload: NotifyPayload| {
                let app = app_for_notify.clone();
                let item = ReviewItem {
                    id: format!(
                        "{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                    ),
                    seq: next_review_seq(),
                    title: payload.title,
                    project: payload.project,
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    tmux_session: payload.tmux_session,
                    tmux_window: payload.tmux_window,
                    tmux_pane: payload.tmux_pane,
                    session_id: payload.session_id,
                    project_path: payload.project_path,
                };

                // Add to queue (dedupe by terminal identity: same tmux session/window/pane)
                {
                    let mut queue = REVIEW_QUEUE.lock().unwrap();
                    // Remove existing items with same terminal identity
                    if item.tmux_session.is_some()
                        || item.tmux_window.is_some()
                        || item.tmux_pane.is_some()
                    {
                        queue.retain(|existing| {
                            // Keep if terminal identity differs
                            existing.tmux_session != item.tmux_session
                                || existing.tmux_window != item.tmux_window
                                || existing.tmux_pane != item.tmux_pane
                        });
                    }
                    queue.push(item.clone());
                }

                // Emit to frontend
                let queue = REVIEW_QUEUE.lock().unwrap().clone();
                let _ = app.emit("review-queue-update", queue);

                // Update tray menu
                update_tray_menu(&app);

                // Persist queue
                save_review_queue();

                warp::reply::json(&serde_json::json!({"ok": true, "id": item.id}))
            });

        // GET /queue - get current queue (for debugging)
        let queue_route = warp::get().and(warp::path("queue")).map(|| {
            let queue = REVIEW_QUEUE.lock().unwrap().clone();
            warp::reply::json(&queue)
        });

        // DELETE /queue/:id - dismiss an item
        let dismiss_route = warp::delete()
            .and(warp::path("queue"))
            .and(warp::path::param::<String>())
            .map(move |id: String| {
                let mut queue = REVIEW_QUEUE.lock().unwrap();
                queue.retain(|item| item.id != id);
                warp::reply::json(&serde_json::json!({"ok": true}))
            });

        let routes = notify_route.or(queue_route).or(dismiss_route);

        println!(
            "[Lovcode] Notification server starting on port {}",
            NOTIFY_SERVER_PORT
        );
        warp::serve(routes)
            .run(([127, 0, 0, 1], NOTIFY_SERVER_PORT))
            .await;
    });
}

// Build tray menu from review queue
fn build_tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};

    let queue = REVIEW_QUEUE.lock().unwrap();
    let mut menu_builder = MenuBuilder::new(app);

    if queue.is_empty() {
        let empty_item = MenuItemBuilder::with_id("empty", "No messages")
            .enabled(false)
            .build(app)?;
        menu_builder = menu_builder.item(&empty_item);
    } else {
        // Sort by timestamp ascending (oldest first) and take up to 10
        let mut sorted: Vec<_> = queue.iter().collect();
        sorted.sort_by_key(|item| item.timestamp);

        for item in sorted.iter().take(10) {
            let label = format!("#{} {}", item.seq, truncate_str(&item.title, 30));
            let menu_item =
                MenuItemBuilder::with_id(format!("msg:{}", item.id), label).build(app)?;
            menu_builder = menu_builder.item(&menu_item);
        }

        if queue.len() > 10 {
            let more_item =
                MenuItemBuilder::with_id("more", format!("... and {} more", queue.len() - 10))
                    .enabled(false)
                    .build(app)?;
            menu_builder = menu_builder.item(&more_item);
        }
    }

    menu_builder = menu_builder.separator();

    let show_main = MenuItemBuilder::with_id("show_main", "Show Main Window").build(app)?;
    let show_float = MenuItemBuilder::with_id("show_float", "Show Float Window").build(app)?;

    menu_builder.item(&show_main).item(&show_float).build()
}

// Truncate string for menu display
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_len - 1).collect();
        format!("{}…", truncated)
    }
}

// Consume a review item (dismiss and navigate)
fn consume_review_item<R: tauri::Runtime>(app: &tauri::AppHandle<R>, msg_id: &str) {
    // Find the item first
    let item = {
        let queue = REVIEW_QUEUE.lock().unwrap();
        queue.iter().find(|i| i.id == msg_id).cloned()
    };

    if let Some(item) = item {
        // Navigate to tmux pane if available
        if let (Some(session), Some(window), Some(pane)) =
            (&item.tmux_session, &item.tmux_window, &item.tmux_pane)
        {
            let _ = std::process::Command::new("tmux")
                .args(["select-window", "-t", &format!("{}:{}", session, window)])
                .status();
            let _ = std::process::Command::new("tmux")
                .args([
                    "select-pane",
                    "-t",
                    &format!("{}:{}.{}", session, window, pane),
                ])
                .status();
        }

        // Remove from queue
        {
            let mut queue = REVIEW_QUEUE.lock().unwrap();
            if let Some(pos) = queue.iter().position(|i| i.id == msg_id) {
                let removed = queue.remove(pos);

                // Persist to disk
                persist_completed_item(&removed);

                // Add to completed queue
                let mut completed = COMPLETED_QUEUE.lock().unwrap();
                completed.insert(0, removed);
                // Keep only last 100 completed items
                completed.truncate(100);
            }
        }

        // Emit update event
        let _ = app.emit("review-queue-update", ());

        // Update tray menu
        update_tray_menu(app);

        // Persist queue
        save_review_queue();
    }
}

// Update tray menu and badge (call after queue changes)
fn update_tray_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(menu) = build_tray_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
        // Update title to show message count (always show, including 0)
        let count = REVIEW_QUEUE.lock().unwrap().len();
        let _ = tray.set_title(Some(count.to_string()));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem};

            // Load persisted review sequence number
            load_review_seq();

            // Load persisted review queue
            load_review_queue();

            // Load persisted completed queue
            load_completed_queue();

            // Start notification HTTP server
            start_notify_server(app.handle().clone());

            // Configure float window for macOS (non-activating panel)
            #[cfg(target_os = "macos")]
            setup_float_window_macos(app);

            // Register global shortcut F4 to consume oldest message
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

                let f4_shortcut = Shortcut::new(None, Code::F4);
                let shortcut_app = app.handle().clone();

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |_app, shortcut, event| {
                            if shortcut == &f4_shortcut && event.state() == ShortcutState::Pressed {
                                // Consume oldest message
                                let oldest_id = {
                                    let queue = REVIEW_QUEUE.lock().unwrap();
                                    queue.iter()
                                        .min_by_key(|item| item.timestamp)
                                        .map(|item| item.id.clone())
                                };
                                if let Some(id) = oldest_id {
                                    consume_review_item(&shortcut_app, &id);
                                }
                            }
                        })
                        .build(),
                )?;

                app.global_shortcut().register(f4_shortcut)?;
            }

            // Start watching distill directory for changes
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let distill_dir = get_distill_dir();
                if !distill_dir.exists() {
                    // Create directory if it doesn't exist so we can watch it
                    let _ = fs::create_dir_all(&distill_dir);
                }

                let (tx, rx) = channel();
                let mut watcher: RecommendedWatcher = match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
                    if let Ok(event) = res {
                        // Only trigger on create/modify/remove events
                        if event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove() {
                            let _ = tx.send(());
                        }
                    }
                }) {
                    Ok(w) => w,
                    Err(_) => return,
                };

                if watcher.watch(&distill_dir, RecursiveMode::NonRecursive).is_err() {
                    return;
                }

                // Debounce: wait for events to settle before emitting
                loop {
                    if rx.recv().is_ok() {
                        // Drain any additional events that came in quickly
                        while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}
                        // Only emit if watch is enabled
                        if DISTILL_WATCH_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
                            let _ = app_handle.emit("distill-changed", ());
                        }
                    }
                }
            });

            let settings = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Lovcode")
                .item(&PredefinedMenuItem::about(app, Some("About Lovcode"), None)?)
                .separator()
                .item(&settings)
                .separator()
                .item(&PredefinedMenuItem::hide(app, Some("Hide Lovcode"))?)
                .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
                .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Quit Lovcode"))?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            let show_main = MenuItemBuilder::with_id("show_main", "Show Main Window")
                .accelerator("CmdOrCtrl+1")
                .build(app)?;
            let show_float = MenuItemBuilder::with_id("show_float", "Show Float Window")
                .accelerator("CmdOrCtrl+2")
                .build(app)?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .item(&show_main)
                .item(&show_float)
                .separator()
                .item(&PredefinedMenuItem::minimize(app, None)?)
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .item(&PredefinedMenuItem::close_window(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            // Create system tray
            let app_handle = app.handle();
            let initial_count = REVIEW_QUEUE.lock().unwrap().len();
            let tray_menu = build_tray_menu(app_handle)?;
            println!("[Lovcode] Tray init: queue has {} messages", initial_count);
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .tooltip("Lovcode Messages")
                .title(initial_count.to_string())
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id.starts_with("msg:") {
                        // Extract message ID and consume it
                        let msg_id = &id[4..];
                        consume_review_item(app, msg_id);
                    } else if id == "show_main" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if id == "show_float" {
                        if let Some(window) = app.get_webview_window("float") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::WebviewWindowBuilder;
            use tauri::WebviewUrl;

            match event.id().as_ref() {
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-settings", ());
                    }
                }
                "show_main" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    } else {
                        // Recreate main window
                        #[cfg(target_os = "macos")]
                        let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                            .title("Lovcode")
                            .inner_size(800.0, 600.0)
                            .title_bar_style(tauri::TitleBarStyle::Overlay)
                            .hidden_title(true);
                        #[cfg(not(target_os = "macos"))]
                        let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                            .title("Lovcode")
                            .inner_size(800.0, 600.0);
                        let _ = builder.build();
                    }
                }
                "show_float" => {
                    if let Some(window) = app.get_webview_window("float") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    } else {
                        // Recreate float window
                        if let Ok(window) = WebviewWindowBuilder::new(app, "float", WebviewUrl::App("/float.html".into()))
                            .title("")
                            .inner_size(121.0, 48.0)
                            .position(100.0, 100.0)
                            .decorations(false)
                            .transparent(true)
                            .always_on_top(true)
                            .skip_taskbar(true)
                            .resizable(false)
                            .visible(true)
                            .accept_first_mouse(true)
                            .focused(false)
                            .build()
                        {
                            // Apply macOS specific settings
                            #[cfg(target_os = "macos")]
                            {
                                use objc::*;
                                if let Ok(ns_window) = window.ns_window() {
                                    unsafe {
                                        let ns_win: id = ns_window as id;
                                        ns_win.setAcceptsMouseMovedEvents_(YES);
                                        let behavior = NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle;
                                        ns_win.setCollectionBehavior_(behavior);
                                        ns_win.setLevel_(3);
                                        // 添加 NonactivatingPanel 样式让光标正常更新
                                        let current_style: u64 = msg_send![ns_win, styleMask];
                                        let new_style = current_style | (1 << 7);
                                        let _: () = msg_send![ns_win, setStyleMask: new_style];
                                        ns_win.setIgnoresMouseEvents_(cocoa::base::NO);
                                    }
                                }
                            }
                            let _ = window;
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            list_sessions,
            list_all_sessions,
            list_all_chats,
            get_session_messages,
            build_search_index,
            search_chats,
            list_local_commands,
            list_local_agents,
            list_local_skills,
            get_context_files,
            get_project_context,
            get_settings,
            get_command_stats,
            get_templates_catalog,
            install_command_template,
            rename_command,
            deprecate_command,
            archive_command,
            restore_command,
            update_command_aliases,
            install_mcp_template,
            uninstall_mcp_template,
            check_mcp_installed,
            install_hook_template,
            install_setting_template,
            open_in_editor,
            open_session_in_editor,
            reveal_session_file,
            get_settings_path,
            get_mcp_config_path,
            get_home_dir,
            write_file,
            update_mcp_env,
            update_settings_env,
            delete_settings_env,
            disable_settings_env,
            enable_settings_env,
            update_disabled_settings_env,
            test_zenmux_connection,
            list_distill_documents,
            get_distill_document,
            find_session_project,
            get_distill_command_file,
            get_distill_watch_enabled,
            set_distill_watch_enabled,
            list_reference_sources,
            list_reference_docs,
            get_reference_doc,
            emit_review_queue,
            get_review_queue,
            get_completed_queue,
            dismiss_review_item,
            clear_completed_queue,
            navigate_to_tmux_pane,
            set_cursor,
            get_cursor_position_in_window,
            get_cursor_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
