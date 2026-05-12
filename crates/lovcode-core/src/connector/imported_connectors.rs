//! Connectors that wrap the generic `ImportedAdapter` — they expose the
//! same canonical-JSONL drop directory but report distinct identities so
//! the UI shows them as separate sources.

use crate::adapter::imported::ImportedAdapter;
use crate::adapter::SourceAdapter;
use crate::connector::{ConnectorEndpoint, ConnectorState, SourceConnector};
use std::path::PathBuf;

fn imports_dir(sub: &str) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovcode")
        .join("imports")
        .join(sub)
}

macro_rules! imported_connector {
    ($name:ident, $id:expr, $label:expr, $family:expr, $subdir:expr, $adapter_ctor:expr, $msg:expr) => {
        pub struct $name { adapter: ImportedAdapter }
        impl $name {
            pub fn new() -> Self { Self { adapter: $adapter_ctor } }
        }
        impl SourceConnector for $name {
            fn id(&self) -> &'static str { $id }
            fn name(&self) -> &'static str { $label }
            fn family(&self) -> &'static str { $family }
            fn adapter(&self) -> Option<&dyn SourceAdapter> { Some(&self.adapter) }
            fn state(&self) -> ConnectorState {
                let root = imports_dir($subdir);
                if !root.exists() { return ConnectorState::NeedsConfig; }
                let any = std::fs::read_dir(&root)
                    .ok()
                    .and_then(|mut d| d.next())
                    .is_some();
                if any { ConnectorState::Ready } else { ConnectorState::NeedsConfig }
            }
            fn endpoint(&self) -> ConnectorEndpoint {
                ConnectorEndpoint::LocalPath { path: imports_dir($subdir) }
            }
            fn message(&self) -> Option<String> { Some($msg.into()) }
        }
    };
}

imported_connector!(
    ChatgptConnector,
    "chatgpt",
    "ChatGPT",
    "Import",
    "chatgpt",
    ImportedAdapter::chatgpt(),
    "Run `lovcode import <export.zip>` to add ChatGPT conversations."
);

imported_connector!(
    GeminiConnector,
    "gemini",
    "Gemini",
    "Import",
    "gemini",
    ImportedAdapter::gemini(),
    "Drop canonical JSONL files into ~/.lovcode/imports/gemini/."
);

imported_connector!(
    ClaudeDesktopImportConnector,
    "claude-desktop",
    "Claude Desktop (imported)",
    "Import",
    "claude-desktop",
    ImportedAdapter::claude_desktop(),
    "Drop canonical JSONL files into ~/.lovcode/imports/claude-desktop/."
);
