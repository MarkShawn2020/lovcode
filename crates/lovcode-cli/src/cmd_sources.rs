use anyhow::Result;
use lovcode_core::connector::{builtin_connectors, ConnectorEndpoint};
use std::path::Path;

pub fn run(_index_dir: &Path) -> Result<()> {
    for c in builtin_connectors() {
        let info = c.info();
        let endpoint = match &info.endpoint {
            ConnectorEndpoint::LocalPath { path } => path.display().to_string(),
            ConnectorEndpoint::Url { url } => url.clone(),
            ConnectorEndpoint::None => String::new(),
        };
        let state = format!("{:?}", info.state).to_lowercase();
        println!(
            "{:<18} {:<26} {:<13} {:>5} files   {endpoint}",
            info.id, info.name, state, info.discovered
        );
    }
    Ok(())
}
