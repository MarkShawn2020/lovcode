use crate::adapter::claude_code::ClaudeCodeAdapter;
use crate::adapter::SourceAdapter;
use crate::connector::{ConnectorEndpoint, ConnectorState, SourceConnector};
use std::path::PathBuf;

pub struct ClaudeCodeConnector {
    adapter: ClaudeCodeAdapter,
}

impl ClaudeCodeConnector {
    pub fn new() -> Self { Self { adapter: ClaudeCodeAdapter } }
    fn root() -> PathBuf {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".claude").join("projects")
    }
}

impl SourceConnector for ClaudeCodeConnector {
    fn id(&self) -> &'static str { "claude-code" }
    fn name(&self) -> &'static str { "Claude Code" }
    fn family(&self) -> &'static str { "CLI" }
    fn adapter(&self) -> Option<&dyn SourceAdapter> { Some(&self.adapter) }

    fn state(&self) -> ConnectorState {
        if Self::root().exists() { ConnectorState::Ready } else { ConnectorState::NeedsConfig }
    }
    fn endpoint(&self) -> ConnectorEndpoint {
        ConnectorEndpoint::LocalPath { path: Self::root() }
    }
    fn message(&self) -> Option<String> {
        if Self::root().exists() { None } else { Some("Install Claude Code or run it once.".into()) }
    }
}
