use crate::adapter::codex::CodexAdapter;
use crate::adapter::SourceAdapter;
use crate::connector::{ConnectorEndpoint, ConnectorState, SourceConnector};
use std::path::PathBuf;

pub struct CodexConnector {
    adapter: CodexAdapter,
}

impl CodexConnector {
    pub fn new() -> Self { Self { adapter: CodexAdapter } }
    fn root() -> PathBuf {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".codex").join("sessions")
    }
}

impl SourceConnector for CodexConnector {
    fn id(&self) -> &'static str { "codex" }
    fn name(&self) -> &'static str { "Codex" }
    fn family(&self) -> &'static str { "CLI" }
    fn adapter(&self) -> Option<&dyn SourceAdapter> { Some(&self.adapter) }

    fn state(&self) -> ConnectorState {
        if Self::root().exists() { ConnectorState::Ready } else { ConnectorState::NeedsConfig }
    }
    fn endpoint(&self) -> ConnectorEndpoint {
        ConnectorEndpoint::LocalPath { path: Self::root() }
    }
    fn message(&self) -> Option<String> {
        if Self::root().exists() { None } else { Some("Install Codex or run it once.".into()) }
    }
}
