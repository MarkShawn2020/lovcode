//! Generic "imported" adapter.
//!
//! Reads canonical `Conversation` JSON lines from `~/.lovcode/imports/<source>/*.jsonl`,
//! one full conversation per line. This is the escape hatch for any data
//! source we don't have a first-class adapter for yet: ChatGPT exports,
//! Gemini exports, Claude.ai web dumps, etc.
//!
//! A small converter binary or skill writes the canonical JSON; the adapter
//! itself stays trivial.

use super::SourceAdapter;
use crate::types::Conversation;
use anyhow::{Context, Result};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct ImportedAdapter {
    pub id: &'static str,
    pub name: &'static str,
    pub subdir: &'static str,
}

impl ImportedAdapter {
    pub const fn chatgpt() -> Self {
        Self { id: "chatgpt", name: "ChatGPT (imported)", subdir: "chatgpt" }
    }
    pub const fn gemini() -> Self {
        Self { id: "gemini", name: "Gemini (imported)", subdir: "gemini" }
    }
    pub const fn claude_desktop() -> Self {
        Self { id: "claude-desktop", name: "Claude Desktop (imported)", subdir: "claude-desktop" }
    }

    fn root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".lovcode")
            .join("imports")
            .join(self.subdir)
    }
}

impl SourceAdapter for ImportedAdapter {
    fn id(&self) -> &'static str { self.id }
    fn name(&self) -> &'static str { self.name }

    fn discover(&self) -> Result<Vec<PathBuf>> {
        let root = self.root();
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

    fn parse(&self, _path: &Path) -> Result<Conversation> {
        anyhow::bail!("ImportedAdapter is multi-conversation; use parse_many")
    }

    fn parse_many(&self, path: &Path) -> Result<Vec<Conversation>> {
        let mut out = read_imported_file(path)?;
        // Stamp the source id onto each conversation so downstream filtering
        // and per-source counts stay accurate regardless of what the writer
        // put in the canonical JSON.
        for c in &mut out {
            c.source = self.id.to_string();
        }
        Ok(out)
    }

    fn watch_roots(&self) -> Vec<PathBuf> {
        vec![self.root()]
    }
}

/// Each line in the file is one canonical `Conversation`. The watcher path
/// is whole-file; we need the per-line stream too. Public so the indexer
/// can stream them out.
pub fn read_imported_file(path: &Path) -> Result<Vec<Conversation>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut out = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() { continue; }
        match serde_json::from_str::<Conversation>(&line) {
            Ok(c) => out.push(c),
            Err(e) => tracing::warn!(error = %e, path = %path.display(), "skipped malformed import line"),
        }
    }
    Ok(out)
}
