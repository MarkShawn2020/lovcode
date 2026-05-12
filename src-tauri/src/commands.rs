//! Tauri command wrappers — thin adapters over `lovcode-core`.
//!
//! Real commands (`search`, `list_sources`, `get_conversation`, `index_refresh`,
//! `register_global_hotkey`, ...) land in phase 1.3 once core is wired up.

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}
