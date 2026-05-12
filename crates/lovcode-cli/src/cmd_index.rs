use anyhow::Result;
use clap::Args as ClapArgs;
use lovcode_core::adapter::builtin_adapters;
use lovcode_core::index::LovcodeIndex;
use lovcode_core::watcher;
use std::path::Path;
use std::time::Instant;

#[derive(ClapArgs)]
pub struct Args {
    /// After indexing, keep running and watch source roots for changes.
    #[arg(long)]
    pub watch: bool,
}

pub fn run(index_dir: &Path, args: Args) -> Result<()> {
    let idx = LovcodeIndex::open_or_create(index_dir)?;
    let adapters = builtin_adapters();

    let started = Instant::now();
    let count = watcher::index_all(&idx, &adapters)?;
    eprintln!(
        "Indexed {count} conversations in {:.2}s → {}",
        started.elapsed().as_secs_f32(),
        index_dir.display()
    );

    if args.watch {
        eprintln!("Watching for changes (Ctrl-C to exit)…");
        watcher::watch(&idx, adapters)?;
    }
    Ok(())
}
