use anyhow::Result;
use clap::Args as ClapArgs;
use lovcode_core::index::LovcodeIndex;
use lovcode_core::query;
use lovcode_core::types::{Role, SearchQuery};
use std::path::Path;

#[derive(ClapArgs)]
pub struct Args {
    /// Query string. Phrases supported.
    pub query: Vec<String>,

    #[arg(long)]
    pub source: Option<String>,

    #[arg(long)]
    pub project: Option<String>,

    /// e.g. `7d`, `12h`, or RFC3339.
    #[arg(long)]
    pub since: Option<String>,

    #[arg(long)]
    pub role: Option<String>,

    #[arg(long, default_value_t = 20)]
    pub limit: usize,

    /// Emit machine-readable JSON.
    #[arg(long)]
    pub json: bool,
}

pub fn run(index_dir: &Path, args: Args) -> Result<()> {
    let q_text = args.query.join(" ");
    if q_text.trim().is_empty() {
        anyhow::bail!("query is empty");
    }

    let idx = LovcodeIndex::open_or_create(index_dir)?;
    let role = args.role.and_then(|r| match r.to_lowercase().as_str() {
        "user" => Some(Role::User),
        "assistant" => Some(Role::Assistant),
        "system" => Some(Role::System),
        "tool" => Some(Role::Tool),
        _ => None,
    });
    let q = SearchQuery {
        q: q_text,
        source: args.source,
        project: args.project,
        since: args.since.as_deref().and_then(query::parse_since),
        until: None,
        role,
        limit: Some(args.limit),
    };

    let results = query::search(&idx, &q)?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&results)?);
        return Ok(());
    }

    if results.is_empty() {
        eprintln!("No results.");
        return Ok(());
    }

    for r in results {
        let when = r
            .timestamp
            .map(|t| t.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "—".into());
        let proj = r.project.as_deref().unwrap_or("");
        println!(
            "{:>4.2}  {:<11}  {when}  {proj}",
            r.score, r.source
        );
        if let Some(t) = &r.title {
            println!("       {}", trim(t, 90));
        }
        println!("       {}", trim(&r.snippet.replace('\n', " "), 90));
        println!("       id={}\n", r.conversation_id);
    }
    Ok(())
}

fn trim(s: &str, n: usize) -> String {
    let mut out: String = s.chars().take(n).collect();
    if s.chars().count() > n { out.push('…'); }
    out
}
