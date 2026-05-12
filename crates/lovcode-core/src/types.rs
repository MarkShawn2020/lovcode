//! Canonical types shared by every adapter and surface.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Stable identifier for a data-source adapter (e.g. `"claude-code"`, `"codex"`).
pub type SourceId = &'static str;

/// One AI conversation, normalized across adapters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub source: String,
    pub project: Option<String>,
    pub title: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub messages: Vec<Message>,
    pub raw_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
    pub timestamp: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    System,
    Tool,
    Other,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub source: Option<String>,
    pub project: Option<String>,
    pub since: Option<DateTime<Utc>>,
    pub until: Option<DateTime<Utc>>,
    pub role: Option<Role>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub conversation_id: String,
    pub source: String,
    pub project: Option<String>,
    pub title: Option<String>,
    pub snippet: String,
    pub score: f32,
    pub timestamp: Option<DateTime<Utc>>,
}
