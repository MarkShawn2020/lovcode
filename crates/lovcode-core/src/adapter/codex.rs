//! Codex adapter — reads `~/.codex/sessions/**/*.jsonl` rollouts.

use super::SourceAdapter;
use crate::types::{Conversation, Message, Role};
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct CodexAdapter;

impl SourceAdapter for CodexAdapter {
    fn id(&self) -> &'static str { "codex" }
    fn name(&self) -> &'static str { "Codex" }

    fn discover(&self) -> Result<Vec<PathBuf>> {
        let root = codex_sessions_root();
        if !root.exists() {
            return Ok(Vec::new());
        }
        Ok(WalkDir::new(&root)
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
        vec![codex_sessions_root()]
    }
}

fn codex_sessions_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
        .join("sessions")
}

#[derive(Debug, Deserialize)]
struct Line {
    #[serde(rename = "type")]
    line_type: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
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
        let ts = line.timestamp.as_deref().and_then(parse_ts);
        if let Some(t) = ts {
            if first_ts.is_none() { first_ts = Some(t); }
            last_ts = Some(t);
        }
        let Some(payload) = line.payload else { continue };

        match line.line_type.as_deref().unwrap_or("") {
            "session_meta" => {
                if id.is_none() {
                    id = payload.get("id").and_then(|v| v.as_str()).map(String::from);
                }
                if project.is_none() {
                    project = payload.get("cwd").and_then(|v| v.as_str()).map(String::from);
                }
            }
            "event_msg" => {
                if payload.get("type").and_then(|v| v.as_str()) == Some("user_message") {
                    if let Some(text) = payload.get("message").and_then(|v| v.as_str()) {
                        let text = text.trim();
                        if !text.is_empty() {
                            messages.push(Message {
                                role: Role::User,
                                content: text.to_string(),
                                timestamp: ts,
                            });
                        }
                    }
                }
            }
            "response_item" => {
                if payload.get("type").and_then(|v| v.as_str()) == Some("message") {
                    let role_str = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
                    let role = match role_str {
                        "user" => Role::User,
                        "assistant" => Role::Assistant,
                        "system" => Role::System,
                        _ => Role::Other,
                    };
                    let text = extract_payload_text(&payload);
                    if !text.is_empty() {
                        messages.push(Message {
                            role,
                            content: text,
                            timestamp: ts,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    let id = id.unwrap_or_else(|| {
        path.file_stem().unwrap_or_default().to_string_lossy().into_owned()
    });

    Ok(Conversation {
        id,
        source: "codex".into(),
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

/// Codex response_item.content is an array of {type, text} blocks.
fn extract_payload_text(payload: &serde_json::Value) -> String {
    let Some(content) = payload.get("content") else { return String::new() };
    match content {
        serde_json::Value::String(s) => s.trim().to_string(),
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| item.get("text").and_then(|t| t.as_str()).map(String::from))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string(),
        _ => String::new(),
    }
}
