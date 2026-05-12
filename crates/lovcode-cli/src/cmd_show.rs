use anyhow::Result;
use clap::Args as ClapArgs;
use lovcode_core::detail;
use lovcode_core::index::LovcodeIndex;
use std::path::Path;

#[derive(ClapArgs)]
pub struct Args {
    pub id: String,
    #[arg(long)]
    pub json: bool,
}

pub fn run(index_dir: &Path, args: Args) -> Result<()> {
    let idx = LovcodeIndex::open_or_create(index_dir)?;
    let conv = detail::get_conversation(&idx, &args.id)?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&conv)?);
        return Ok(());
    }
    println!("# {}", conv.title.as_deref().unwrap_or(&conv.id));
    println!("source: {}   id: {}", conv.source, conv.id);
    if let Some(p) = &conv.project { println!("project: {p}"); }
    println!();
    for (i, m) in conv.messages.iter().enumerate() {
        let role = format!("{:?}", m.role).to_lowercase();
        let ts = m.timestamp.map(|t| t.format("%H:%M:%S").to_string()).unwrap_or_default();
        println!("─── [{i}] {role}  {ts} ───");
        println!("{}", m.content);
        println!();
    }
    Ok(())
}
