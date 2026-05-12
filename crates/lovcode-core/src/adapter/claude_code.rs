//! Claude Code adapter — reads `~/.claude/projects/<encoded-path>/<uuid>.jsonl`.
//!
//! KISS shape extraction only. Each line is one event; we keep user/assistant
//! messages with extractable text, dropping queue/tool noise. UI-level
//! deduping, command-tag parsing, etc. are out of scope for the indexer.

use super::SourceAdapter;
use crate::types::{Conversation, Message, Role};
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct ClaudeCodeAdapter;

impl SourceAdapter for ClaudeCodeAdapter {
    fn id(&self) -> &'static str { "claude-code" }
    fn name(&self) -> &'static str { "Claude Code" }

    fn discover(&self) -> Result<Vec<PathBuf>> {
        let root = claude_projects_root();
        if !root.exists() {
            return Ok(Vec::new());
        }
        Ok(WalkDir::new(&root)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
            .map(|e| e.into_path())
            .collect())
    }

    fn parse(&self, path: &Path) -> Result<Conversation> {
        parse_jsonl(path)
    }

    fn watch_roots(&self) -> Vec<PathBuf> {
        vec![claude_projects_root()]
    }
}

fn claude_projects_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("projects")
}

#[derive(Debug, Deserialize)]
struct Line {
    #[serde(rename = "type")]
    line_type: Option<String>,
    #[serde(default)]
    message: Option<RawMessage>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    content: Option<serde_json::Value>,
}

fn parse_jsonl(path: &Path) -> Result<Conversation> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    let mut id: Option<String> = None;
    let mut project: Option<String> = None;
    let mut messages: Vec<Message> = Vec::new();
    let mut first_ts: Option<DateTime<Utc>> = None;
    let mut last_ts: Option<DateTime<Utc>> = None;

    for raw in reader.lines().map_while(Result::ok) {
        let Ok(line) = serde_json::from_str::<Line>(&raw) else { continue };

        if id.is_none() {
            id = line.session_id.clone();
        }
        if project.is_none() {
            project = line.cwd.clone();
        }

        let ts = line.timestamp.as_deref().and_then(parse_ts);
        if let Some(t) = ts {
            if first_ts.is_none() { first_ts = Some(t); }
            last_ts = Some(t);
        }

        let ty = line.line_type.as_deref().unwrap_or("");
        if ty != "user" && ty != "assistant" {
            continue;
        }

        let Some(msg) = line.message else { continue };
        let content = msg.content.as_ref().map(extract_text).unwrap_or_default();
        if content.is_empty() {
            continue;
        }

        let role = match msg.role.as_deref().unwrap_or(ty) {
            "user" => Role::User,
            "assistant" => Role::Assistant,
            "system" => Role::System,
            "tool" => Role::Tool,
            _ => Role::Other,
        };

        messages.push(Message { role, content, timestamp: ts });
    }

    let id = id.unwrap_or_else(|| {
        path.file_stem().unwrap_or_default().to_string_lossy().into_owned()
    });

    Ok(Conversation {
        id,
        source: "claude-code".into(),
        project,
        title: None,
        created_at: first_ts,
        updated_at: last_ts,
        messages,
        raw_path: Some(path.to_string_lossy().into_owned()),
    })
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

/// Flatten Claude's content (string OR array of {type, text, ...} blocks)
/// into a single text string.
fn extract_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}
