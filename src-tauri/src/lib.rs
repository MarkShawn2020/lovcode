//! Lovcode Tauri shell — thin layer over `lovcode-core`.

mod commands;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_search_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Global hotkey: ⌘⇧K (Ctrl+Shift+K on win/linux).
            let modifiers = if cfg!(target_os = "macos") {
                Modifiers::SUPER | Modifiers::SHIFT
            } else {
                Modifiers::CONTROL | Modifiers::SHIFT
            };
            let shortcut = Shortcut::new(Some(modifiers), Code::KeyK);
            app.global_shortcut().register(shortcut).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::list_sources,
            commands::list_connectors,
            commands::search,
            commands::get_conversation,
            commands::rebuild_index,
            toggle_search_overlay,
            focus_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_search_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("search") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

#[tauri::command]
fn toggle_search_overlay(app: tauri::AppHandle) {
    toggle_search_window(&app);
}

/// Focus the main window and emit a navigation event with the target conversation id.
#[tauri::command]
fn focus_main_window(app: tauri::AppHandle, conversation_id: Option<String>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        if let Some(id) = conversation_id {
            let _ = win.emit("lovcode:navigate-conversation", id);
        }
    }
    if let Some(win) = app.get_webview_window("search") {
        let _ = win.hide();
    }
}
