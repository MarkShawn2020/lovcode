//! Tauri command wrappers — thin adapters over `lovcode-core`.

use lovcode_core::adapter::builtin_adapters;
use lovcode_core::detail;
use lovcode_core::index::{default_index_dir, LovcodeIndex};
use lovcode_core::query;
use lovcode_core::types::{Conversation, SearchQuery, SearchResult};
use lovcode_core::watcher;
use serde::Serialize;
use std::sync::OnceLock;

fn index() -> &'static LovcodeIndex {
    static OWNED: OnceLock<LovcodeIndex> = OnceLock::new();
    OWNED.get_or_init(|| {
        let dir = default_index_dir();
        LovcodeIndex::open_or_create(&dir).expect("open lovcode index")
    })
}

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[derive(Serialize)]
pub struct SourceSummary {
    pub id: String,
    pub name: String,
    pub count: usize,
}

#[tauri::command]
pub fn list_sources() -> Vec<SourceSummary> {
    builtin_adapters()
        .iter()
        .map(|a| SourceSummary {
            id: a.id().into(),
            name: a.name().into(),
            count: a.discover().map(|v| v.len()).unwrap_or(0),
        })
        .collect()
}

#[tauri::command]
pub fn search(
    q: String,
    source: Option<String>,
    project: Option<String>,
    since: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let query = SearchQuery {
        q,
        source,
        project,
        since: since.as_deref().and_then(query::parse_since),
        until: None,
        role: None,
        limit,
    };
    query::search(index(), &query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_conversation(id: String) -> Result<Conversation, String> {
    detail::get_conversation(index(), &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rebuild_index() -> Result<usize, String> {
    tokio::task::spawn_blocking(|| {
        let adapters = builtin_adapters();
        watcher::index_all(index(), &adapters)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
