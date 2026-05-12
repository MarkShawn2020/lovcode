//! `SourceAdapter` trait + per-source impls.

use crate::types::Conversation;
use std::path::{Path, PathBuf};

pub mod claude_code;
pub mod codex;

pub trait SourceAdapter: Send + Sync {
    /// Stable id, e.g. `"claude-code"`.
    fn id(&self) -> &'static str;

    /// Human-facing label.
    fn name(&self) -> &'static str;

    /// Enumerate conversation files on disk for this adapter.
    fn discover(&self) -> anyhow::Result<Vec<PathBuf>>;

    /// Parse one conversation file into the canonical `Conversation` shape.
    fn parse(&self, path: &Path) -> anyhow::Result<Conversation>;

    /// Roots the watcher should observe for live updates.
    fn watch_roots(&self) -> Vec<PathBuf>;
}

/// All built-in adapters, ready to register.
pub fn builtin_adapters() -> Vec<Box<dyn SourceAdapter>> {
    vec![
        Box::new(claude_code::ClaudeCodeAdapter),
        Box::new(codex::CodexAdapter),
    ]
}
