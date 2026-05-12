//! Stdio MCP server. Phase 3 wires this up to `rmcp`; for now we stub it
//! so the subcommand exists and prints an actionable message.

use anyhow::Result;
use std::path::Path;

pub fn run(_index_dir: &Path) -> Result<()> {
    eprintln!(
        "lovcode mcp: not implemented yet (lands in phase 3). \
         The crate `lovcode-mcp` will host the rmcp server; \
         this subcommand will then spawn it on stdio."
    );
    std::process::exit(2);
}
