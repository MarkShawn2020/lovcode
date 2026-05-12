use anyhow::Result;
use lovcode_core::adapter::builtin_adapters;
use std::path::Path;

pub fn run(_index_dir: &Path) -> Result<()> {
    for a in builtin_adapters() {
        let count = a.discover().map(|v| v.len()).unwrap_or(0);
        let roots = a
            .watch_roots()
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        println!("{:<14} {:<20} {count:>5} files   {roots}", a.id(), a.name());
    }
    Ok(())
}
