use anyhow::Result;
use clap::Args as ClapArgs;
use lovcode_core::import;
use std::path::PathBuf;

#[derive(ClapArgs)]
pub struct Args {
    /// Path to a ChatGPT export `.zip` (or its unzipped directory containing
    /// `conversations.json`).
    pub path: PathBuf,

    /// Optional override for output directory.
    #[arg(long)]
    pub out: Option<PathBuf>,
}

pub fn run(args: Args) -> Result<()> {
    let p = &args.path;
    let out = if p.is_dir() {
        import::chatgpt::import_dir(p, args.out.as_deref())?
    } else {
        import::chatgpt::import_zip(p, args.out.as_deref())?
    };
    eprintln!("Imported → {}", out.display());
    eprintln!("Run `lovcode index` to make it searchable.");
    Ok(())
}
