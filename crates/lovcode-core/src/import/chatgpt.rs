//! Convert a ChatGPT `.zip` export (Settings → Data controls → Export data)
//! into canonical Conversation JSON-lines under
//! `~/.lovcode/imports/chatgpt/<basename>.jsonl`.

use crate::types::{Conversation, Message, Role};
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct GptConv {
    id: Option<String>,
    title: Option<String>,
    create_time: Option<f64>,
    update_time: Option<f64>,
    #[serde(default)]
    mapping: HashMap<String, MapNode>,
    current_node: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MapNode {
    #[serde(default)]
    message: Option<GptMsg>,
    parent: Option<String>,
    #[serde(default)]
    children: Vec<String>,
    #[serde(default)]
    #[allow(dead_code)]
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GptMsg {
    author: Option<Author>,
    create_time: Option<f64>,
    content: Option<MsgContent>,
}

#[derive(Debug, Deserialize)]
struct Author {
    role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MsgContent {
    content_type: Option<String>,
    #[serde(default)]
    parts: Vec<serde_json::Value>,
}

/// Import a ChatGPT export. Returns the path of the written JSONL.
pub fn import_zip(zip_path: &Path, out_dir: Option<&Path>) -> Result<PathBuf> {
    let conversations = read_zip(zip_path)?;
    write_jsonl(&conversations, zip_path, out_dir)
}

/// Import a directory containing a `conversations.json` (already unzipped).
pub fn import_dir(dir: &Path, out_dir: Option<&Path>) -> Result<PathBuf> {
    let conv_json = dir.join("conversations.json");
    let raw = std::fs::read_to_string(&conv_json)
        .with_context(|| format!("read {}", conv_json.display()))?;
    let conversations = parse_conversations_json(&raw)?;
    write_jsonl(&conversations, dir, out_dir)
}

fn read_zip(zip_path: &Path) -> Result<Vec<Conversation>> {
    let file = File::open(zip_path).with_context(|| format!("open {}", zip_path.display()))?;
    let mut archive = zip::ZipArchive::new(BufReader::new(file))
        .with_context(|| format!("read zip {}", zip_path.display()))?;
    let mut entry = archive
        .by_name("conversations.json")
        .map_err(|_| anyhow!("zip does not contain conversations.json"))?;
    let mut raw = String::new();
    entry.read_to_string(&mut raw)?;
    parse_conversations_json(&raw)
}

fn parse_conversations_json(raw: &str) -> Result<Vec<Conversation>> {
    let gpts: Vec<GptConv> = serde_json::from_str(raw).context("parse conversations.json")?;
    Ok(gpts
        .into_iter()
        .filter_map(|c| convert(c).ok())
        .filter(|c| !c.messages.is_empty())
        .collect())
}

fn convert(c: GptConv) -> Result<Conversation> {
    let id = c.id.clone().ok_or_else(|| anyhow!("missing id"))?;
    let messages = linearize(&c);

    Ok(Conversation {
        id,
        source: "chatgpt".to_string(),
        project: None,
        title: c.title,
        created_at: c.create_time.and_then(epoch_to_dt),
        updated_at: c.update_time.and_then(epoch_to_dt),
        messages,
        raw_path: None,
    })
}

/// Walk parent→child from current_node back to root, collecting messages.
fn linearize(c: &GptConv) -> Vec<Message> {
    let Some(mut node_id) = c.current_node.clone().or_else(|| {
        // Fallback: pick any leaf (no children).
        c.mapping
            .iter()
            .find(|(_, n)| n.children.is_empty())
            .map(|(id, _)| id.clone())
    }) else {
        return Vec::new();
    };

    let mut path: Vec<&MapNode> = Vec::new();
    let mut visited = std::collections::HashSet::new();
    loop {
        if !visited.insert(node_id.clone()) { break; }
        let Some(node) = c.mapping.get(&node_id) else { break };
        path.push(node);
        let Some(parent) = node.parent.clone() else { break };
        node_id = parent;
    }
    path.reverse();

    path.iter()
        .filter_map(|n| n.message.as_ref().and_then(msg_to_message))
        .collect()
}

fn msg_to_message(m: &GptMsg) -> Option<Message> {
    let role_str = m.author.as_ref().and_then(|a| a.role.as_deref()).unwrap_or("");
    let role = match role_str {
        "user" => Role::User,
        "assistant" => Role::Assistant,
        "system" => Role::System,
        "tool" => Role::Tool,
        _ => return None, // skip "function", empty, etc.
    };
    let content = m
        .content
        .as_ref()
        .map(|c| {
            if c.content_type.as_deref() == Some("text") || c.content_type.is_none() {
                c.parts
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                String::new()
            }
        })
        .unwrap_or_default();
    let content = content.trim().to_string();
    if content.is_empty() { return None; }

    Some(Message {
        role,
        content,
        timestamp: m.create_time.and_then(epoch_to_dt),
    })
}

fn epoch_to_dt(secs: f64) -> Option<DateTime<Utc>> {
    Utc.timestamp_opt(secs as i64, 0).single()
}

fn write_jsonl(conversations: &[Conversation], source: &Path, out_dir: Option<&Path>) -> Result<PathBuf> {
    let dir = match out_dir {
        Some(d) => d.to_path_buf(),
        None => dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".lovcode")
            .join("imports")
            .join("chatgpt"),
    };
    std::fs::create_dir_all(&dir)?;
    let basename = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("chatgpt-export");
    let out = dir.join(format!("{basename}.jsonl"));

    let mut f = File::create(&out)?;
    for c in conversations {
        serde_json::to_writer(&mut f, c)?;
        writeln!(f)?;
    }
    tracing::info!(count = conversations.len(), path = %out.display(), "wrote chatgpt import");
    Ok(out)
}
