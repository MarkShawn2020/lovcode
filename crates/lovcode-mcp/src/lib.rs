//! MCP server exposing Lovcode conversation search.
//!
//! Tools:
//! - `search_conversations` — full-text search with optional filters.
//! - `list_sources` — enumerate configured adapters + counts.
//!
//! Run with [`serve_stdio`] from a binary that wants to BE a stdio MCP
//! server (e.g. `lovcode mcp`).

use lovcode_core::adapter::builtin_adapters;
use lovcode_core::index::LovcodeIndex;
use lovcode_core::query;
use lovcode_core::types::SearchQuery;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content, ServerCapabilities, ServerInfo};
use rmcp::transport::stdio;
use rmcp::{
    schemars, tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt,
};
use std::path::PathBuf;
use std::sync::Arc;

/// MCP service handle. One instance owns one open index reader.
#[derive(Clone)]
pub struct LovcodeMcp {
    index: Arc<LovcodeIndex>,
    tool_router: ToolRouter<LovcodeMcp>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SearchArgs {
    /// Search query string. Supports phrases.
    pub query: String,
    /// Optional source filter: e.g. "claude-code", "codex".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Optional project substring (matches conversation cwd).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// Relative time like "7d" or "12h", or RFC3339.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    /// Max results (default 20).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[tool_router]
impl LovcodeMcp {
    pub fn new(index: Arc<LovcodeIndex>) -> Self {
        Self {
            index,
            tool_router: Self::tool_router(),
        }
    }

    #[tool(description = "Full-text search across every indexed AI conversation. Supports CJK.")]
    async fn search_conversations(
        &self,
        Parameters(args): Parameters<SearchArgs>,
    ) -> Result<CallToolResult, McpError> {
        let q = SearchQuery {
            q: args.query,
            source: args.source,
            project: args.project,
            since: args.since.as_deref().and_then(query::parse_since),
            until: None,
            role: None,
            limit: args.limit,
        };
        let results = query::search(&self.index, &q)
            .map_err(|e| McpError::internal_error(format!("search failed: {e}"), None))?;
        let json = serde_json::to_string_pretty(&results)
            .map_err(|e| McpError::internal_error(format!("serialize failed: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }

    #[tool(description = "List configured conversation source adapters and their discovered counts.")]
    async fn list_sources(&self) -> Result<CallToolResult, McpError> {
        let out: Vec<_> = builtin_adapters()
            .iter()
            .map(|a| {
                let count = a.discover().map(|v| v.len()).unwrap_or(0);
                serde_json::json!({ "id": a.id(), "name": a.name(), "count": count })
            })
            .collect();
        let json = serde_json::to_string_pretty(&out)
            .map_err(|e| McpError::internal_error(format!("serialize failed: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
    }
}

#[tool_handler]
impl ServerHandler for LovcodeMcp {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.instructions = Some(
            "Lovcode MCP server. Use `search_conversations` to find past AI conversations \
             across Claude Code, Codex, and other indexed sources."
                .into(),
        );
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }
}

/// Open the index at `index_dir` and serve MCP on stdio. Blocks.
pub async fn serve_stdio(index_dir: PathBuf) -> anyhow::Result<()> {
    let index = Arc::new(LovcodeIndex::open_or_create(&index_dir)?);
    let service = LovcodeMcp::new(index).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
