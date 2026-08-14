use super::*;

fn toggle_search_overlay(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("search") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    #[cfg(target_os = "macos")]
    install_overlay_panel(&window);
    let _ = window.center();
    let _ = window.show();
    #[cfg(target_os = "macos")]
    show_overlay_keyed(&window);
    #[cfg(not(target_os = "macos"))]
    let _ = window.set_focus();
    let _ = app.emit("search-overlay:show", ());
}

fn watch_conversation_directory(app: tauri::AppHandle, directory: PathBuf) {
    if !directory.exists() {
        return;
    }

    std::thread::spawn(move || {
        let (sender, receiver) = channel();
        let mut watcher: RecommendedWatcher =
            match notify::recommended_watcher(move |event: Result<Event, notify::Error>| {
                if let Ok(event) = event {
                    if event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove() {
                        let _ = sender.send(event.paths);
                    }
                }
            }) {
                Ok(watcher) => watcher,
                Err(error) => {
                    eprintln!("[Ataru] session watcher unavailable: {error}");
                    return;
                }
            };

        if let Err(error) = watcher.watch(&directory, RecursiveMode::Recursive) {
            eprintln!("[Ataru] failed to watch {}: {error}", directory.display());
            return;
        }

        while let Ok(mut changed_paths) = receiver.recv() {
            while let Ok(paths) = receiver.recv_timeout(Duration::from_millis(400)) {
                changed_paths.extend(paths);
            }
            changed_paths.sort();
            changed_paths.dedup();
            emit_sessions_changed_with_fresh_cache(app.clone());
            notify_incremental_search_index_source_changes(app.clone(), &changed_paths);
        }
    });
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        #[cfg(target_os = "macos")]
        activate_and_focus_window(&window);
        #[cfg(not(target_os = "macos"))]
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    migrate_legacy_lovcode_storage();

    if let Some(exit_code) = run_cli_if_requested() {
        std::process::exit(exit_code);
    }

    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
    let shortcut = {
        #[cfg(target_os = "macos")]
        {
            Shortcut::new(Some(Modifiers::SUPER), Code::KeyK)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Shortcut::new(Some(Modifiers::CONTROL), Code::KeyK)
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, candidate, event| {
                    if event.state() == ShortcutState::Pressed && candidate == &shortcut {
                        toggle_search_overlay(app);
                    }
                })
                .with_shortcut(shortcut)
                .expect("failed to register search shortcut")
                .build(),
        )
        .setup(|app| {
            #[cfg(all(debug_assertions, target_os = "macos"))]
            unsafe {
                use cocoa::appkit::NSApp;
                use cocoa::base::nil;
                use objc::*;
                let application = NSApp();
                let _: () = msg_send![application, hide: nil];
            }

            watch_conversation_directory(app.handle().clone(), get_claude_dir().join("projects"));
            watch_conversation_directory(app.handle().clone(), get_codex_dir());
            Ok(())
        })
        .invoke_handler(command_handler())
        .build(tauri::generate_context!())
        .expect("error while building Ataru")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
