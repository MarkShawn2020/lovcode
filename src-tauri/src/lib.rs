//! Lovcode Tauri shell.
//!
//! This is a thin layer over `lovcode-core`. All search logic lives in the
//! core crate. Tauri commands here are 1:1 wrappers that adapt core types
//! to JSON-serializable shapes for the React frontend.
//!
//! Phase 1: skeleton. Concrete commands land alongside the lovcode-core
//! implementation in phase 1.2 / 1.3.

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
