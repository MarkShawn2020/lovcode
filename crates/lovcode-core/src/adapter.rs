//! `SourceAdapter` trait — one impl per supported AI tool.
//!
//! Per-source modules (claude_code, codex, ...) land here in phase 1.2.

use crate::types::Conversation;
use std::path::{Path, PathBuf};

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
