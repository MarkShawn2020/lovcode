//! `SourceConnector` — the lifecycle wrapper around `SourceAdapter`.
//!
//! Adapters answer "how do I parse files from this source". Connectors
//! answer "is this source reachable right now, do I have credentials,
//! how do I (dis)connect or reconfigure it".
//!
//! Adapters that already have everything on disk (claude-code, codex,
//! imported jsonl) report `Ready` unconditionally. Connectors that need
//! credentials (claude.ai web, Claude Desktop integrations) report
//! `NeedsConfig` until configured.

use crate::adapter::SourceAdapter;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Coarse-grained lifecycle state surfaced to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectorState {
    /// Discovered and ready to index.
    Ready,
    /// Installed but disabled by the user.
    Disabled,
    /// Reachable in principle but requires credentials or paths.
    NeedsConfig,
    /// Tried to reach the source and it failed.
    Error,
    /// Not implemented on the current build (placeholder for future surfaces).
    Unimplemented,
}

/// Where the connector data lives (filesystem path, URL, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ConnectorEndpoint {
    LocalPath { path: PathBuf },
    Url { url: String },
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorInfo {
    pub id: String,
    pub name: String,
    /// Friendly short subtitle e.g. "CLI" / "Web" / "Desktop".
    pub family: String,
    pub icon: Option<String>,
    pub state: ConnectorState,
    pub endpoint: ConnectorEndpoint,
    pub discovered: usize,
    /// Stable hint for the UI when state is NeedsConfig/Error.
    pub message: Option<String>,
}

/// Lifecycle contract. Defaults are write-once: most connectors only
/// override the inspection methods and inherit the stubs.
pub trait SourceConnector: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn family(&self) -> &'static str;
    fn icon(&self) -> Option<&'static str> { None }

    /// Adapter that does the actual parsing. None when this connector is
    /// a pure placeholder (Unimplemented state).
    fn adapter(&self) -> Option<&dyn SourceAdapter>;

    fn state(&self) -> ConnectorState;
    fn endpoint(&self) -> ConnectorEndpoint;
    fn message(&self) -> Option<String> { None }

    fn info(&self) -> ConnectorInfo {
        let discovered = self
            .adapter()
            .and_then(|a| a.discover().ok())
            .map(|v| v.len())
            .unwrap_or(0);
        ConnectorInfo {
            id: self.id().into(),
            name: self.name().into(),
            family: self.family().into(),
            icon: self.icon().map(|s| s.into()),
            state: self.state(),
            endpoint: self.endpoint(),
            discovered,
            message: self.message(),
        }
    }

    // ── Lifecycle hooks ───────────────────────────────────────────────
    //
    // Default: refuse politely. Concrete connectors with credentials
    // (claude-app-web etc.) override these in later phases.

    fn connect(&self) -> anyhow::Result<()> {
        anyhow::bail!("connector {} does not support connect()", self.id())
    }
    fn disconnect(&self) -> anyhow::Result<()> {
        anyhow::bail!("connector {} does not support disconnect()", self.id())
    }
    fn configure(&self, _payload: serde_json::Value) -> anyhow::Result<()> {
        anyhow::bail!("connector {} does not support configure()", self.id())
    }
}

// ── Concrete connectors ─────────────────────────────────────────────────────

mod claude_code_connector;
mod claude_desktop_connectors;
mod codex_connector;
mod imported_connectors;

pub use claude_code_connector::ClaudeCodeConnector;
pub use claude_desktop_connectors::{ClaudeAppCodeConnector, ClaudeAppCoworkConnector, ClaudeAppWebConnector};
pub use codex_connector::CodexConnector;
pub use imported_connectors::{ChatgptConnector, ClaudeDesktopImportConnector, GeminiConnector};

pub fn builtin_connectors() -> Vec<Box<dyn SourceConnector>> {
    vec![
        Box::new(ClaudeCodeConnector::new()),
        Box::new(CodexConnector::new()),
        Box::new(ClaudeAppWebConnector::new()),
        Box::new(ClaudeAppCodeConnector::new()),
        Box::new(ClaudeAppCoworkConnector::new()),
        Box::new(ChatgptConnector::new()),
        Box::new(GeminiConnector::new()),
        Box::new(ClaudeDesktopImportConnector::new()),
    ]
}
