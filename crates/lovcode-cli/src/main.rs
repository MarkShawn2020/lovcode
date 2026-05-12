//! `lovcode` — single binary, several subcommands.

mod cmd_import;
mod cmd_index;
mod cmd_mcp;
mod cmd_search;
mod cmd_serve;
mod cmd_show;
mod cmd_sources;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "lovcode", version, about = "Search every conversation you've ever had with an AI.")]
struct Cli {
    /// Override index directory. Default: $LOVCODE_INDEX_DIR or ~/.lovcode/index.
    #[arg(long, global = true)]
    index_dir: Option<PathBuf>,

    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Build or update the local conversation index.
    Index(cmd_index::Args),

    /// Search the index.
    Search(cmd_search::Args),

    /// Show one conversation by id.
    Show(cmd_show::Args),

    /// Import a third-party export (currently: ChatGPT `.zip`).
    Import(cmd_import::Args),

    /// List configured source adapters.
    Sources,

    /// Start HTTP server for the web UI / external clients.
    Serve(cmd_serve::Args),

    /// Run MCP server on stdio (for Claude Desktop, Cursor, etc.).
    Mcp,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("lovcode=info,warn")),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    let index_dir = cli
        .index_dir
        .unwrap_or_else(lovcode_core::index::default_index_dir);

    match cli.command {
        Cmd::Index(a) => cmd_index::run(&index_dir, a),
        Cmd::Search(a) => cmd_search::run(&index_dir, a),
        Cmd::Show(a) => cmd_show::run(&index_dir, a),
        Cmd::Import(a) => cmd_import::run(a),
        Cmd::Sources => cmd_sources::run(&index_dir),
        Cmd::Serve(a) => cmd_serve::run(&index_dir, a),
        Cmd::Mcp => cmd_mcp::run(&index_dir),
    }
}
