//! `SourceAdapter` trait + per-source impls.

use crate::types::Conversation;
use std::path::{Path, PathBuf};

pub mod claude_code;
pub mod codex;
pub mod imported;

pub trait SourceAdapter: Send + Sync {
    /// Stable id, e.g. `"claude-code"`.
    fn id(&self) -> &'static str;

    /// Human-facing label.
    fn name(&self) -> &'static str;

    /// Enumerate conversation files on disk for this adapter.
    fn discover(&self) -> anyhow::Result<Vec<PathBuf>>;

    /// Parse one conversation file. One-per-file adapters return one
    /// Conversation; multi-per-file adapters should override `parse_many`
    /// and may leave `parse` as `unreachable!()`.
    fn parse(&self, path: &Path) -> anyhow::Result<Conversation>;

    /// Optional batch parser: one file → N conversations. Default delegates
    /// to `parse`.
    fn parse_many(&self, path: &Path) -> anyhow::Result<Vec<Conversation>> {
        Ok(vec![self.parse(path)?])
    }

    /// Roots the watcher should observe for live updates.
    fn watch_roots(&self) -> Vec<PathBuf>;
}

/// All built-in adapters, ready to register.
pub fn builtin_adapters() -> Vec<Box<dyn SourceAdapter>> {
    vec![
        Box::new(claude_code::ClaudeCodeAdapter),
        Box::new(codex::CodexAdapter),
        Box::new(imported::ImportedAdapter::chatgpt()),
        Box::new(imported::ImportedAdapter::gemini()),
        Box::new(imported::ImportedAdapter::claude_desktop()),
    ]
}
