//! Stdio MCP server bridge. Delegates to `lovcode-mcp`.

use anyhow::Result;
use std::path::Path;

pub fn run(index_dir: &Path) -> Result<()> {
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(lovcode_mcp::serve_stdio(index_dir.to_path_buf()))
}
