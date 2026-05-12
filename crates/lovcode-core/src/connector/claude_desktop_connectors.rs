//! Placeholders for the three Claude Desktop surfaces (Web, Code, Cowork).
//!
//! These are live in the v0.39 codebase via cookie + Keychain decryption,
//! but a clean re-port lands in a later phase. For now they advertise
//! themselves as `Unimplemented` so the UI can render them as "coming
//! soon" cards with a meaningful explanation.

use crate::adapter::SourceAdapter;
use crate::connector::{ConnectorEndpoint, ConnectorState, SourceConnector};

macro_rules! placeholder_connector {
    ($name:ident, $id:expr, $label:expr, $family:expr, $msg:expr) => {
        pub struct $name;
        impl $name {
            pub fn new() -> Self { Self }
        }
        impl SourceConnector for $name {
            fn id(&self) -> &'static str { $id }
            fn name(&self) -> &'static str { $label }
            fn family(&self) -> &'static str { $family }
            fn adapter(&self) -> Option<&dyn SourceAdapter> { None }
            fn state(&self) -> ConnectorState { ConnectorState::Unimplemented }
            fn endpoint(&self) -> ConnectorEndpoint { ConnectorEndpoint::Url { url: "https://claude.ai".into() } }
            fn message(&self) -> Option<String> { Some($msg.into()) }
        }
    };
}

placeholder_connector!(
    ClaudeAppWebConnector,
    "claude-app-web",
    "Claude (Web)",
    "App",
    "claude.ai web conversations — Keychain-decrypted cookie sync. Re-port in progress."
);

placeholder_connector!(
    ClaudeAppCodeConnector,
    "claude-app-code",
    "Claude Desktop — Code",
    "App",
    "Claude Desktop Code panel. Re-port in progress."
);

placeholder_connector!(
    ClaudeAppCoworkConnector,
    "claude-app-cowork",
    "Claude Desktop — Cowork",
    "App",
    "Claude Desktop Cowork panel. Re-port in progress."
);
