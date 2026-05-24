use super::*;

/// Toggle visibility of the floating search overlay window.
/// Lives at the app level (not per-window) so it survives main-window close.
fn toggle_search_overlay(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("search") else {
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    if visible {
        let _ = win.hide();
    } else {
        // Re-apply the nonactivating-panel SPI every time we show. Cheap and
        // idempotent. Crucially this runs BEFORE `win.show()` so the very
        // first Cmd-K invocation behaves like Spotlight (no app activation).
        // The frontend mount-time `invoke` is kept as a belt-and-braces hook
        // for the case where the window is shown some other way.
        #[cfg(target_os = "macos")]
        install_overlay_panel(&win);
        let _ = win.center();
        let _ = win.show();
        // On macOS, AVOID `win.set_focus()` — it calls
        // `[NSApp activateIgnoringOtherApps:YES]` which would bring lovcode
        // to the foreground. `show_overlay_keyed` only sends
        // `makeKeyAndOrderFront:` to the NSWindow; combined with
        // `_setPreventsActivation:YES` the WindowServer routes keyboard
        // input here without changing the frontmost app.
        #[cfg(target_os = "macos")]
        show_overlay_keyed(&win);
        #[cfg(not(target_os = "macos"))]
        let _ = win.set_focus();
        let _ = app.emit("search-overlay:show", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

    let toggle_search_shortcut = {
        #[cfg(target_os = "macos")]
        {
            Shortcut::new(Some(Modifiers::SUPER), Code::KeyK)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Shortcut::new(Some(Modifiers::CONTROL), Code::KeyK)
        }
    };
    println!(
        "[Lovcode] registering global shortcut id={:?}",
        toggle_search_shortcut.id()
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    println!(
                        "[Lovcode] global-shortcut fired: {:?} state={:?}",
                        shortcut,
                        event.state()
                    );
                    if event.state() == ShortcutState::Pressed
                        && shortcut == &toggle_search_shortcut
                    {
                        toggle_search_overlay(app);
                    }
                })
                .with_shortcut(toggle_search_shortcut)
                .expect("failed to declare CmdOrCtrl+K shortcut")
                .build(),
        )
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

            // dev 模式：cargo 重启二进制后默认抢焦点。`[NSApp hide:]` 让自己
            // 在 active 之前先隐藏一次 —— macOS 会立刻把焦点交还给上一个
            // frontmost app（通常是触发 cargo 的终端）。窗口随后正常显示，
            // Dock 图标和 cmd-tab 列表都保留。release 构建零影响。
            #[cfg(all(debug_assertions, target_os = "macos"))]
            unsafe {
                use cocoa::appkit::NSApp;
                use cocoa::base::nil;
                use objc::*;
                let ns_app = NSApp();
                let _: () = msg_send![ns_app, hide: nil];
            }

            // Initialize PTY manager with app handle for event emission
            pty_manager::init(app.handle().clone());
            // NOTE: we do NOT call `install_overlay_panel` here. Touching the
            // search NSWindow during `applicationDidFinishLaunching` (which
            // is what setup runs inside) panics through tao's non-unwindable
            // extern "C" boundary on macOS 26. Instead, the frontend invokes
            // `make_window_nonactivating_panel` from search-overlay.tsx on
            // mount — by that point the NSWindow is fully realized and we
            // can safely call `_setPreventsActivation:`.

            // Start watching distill directory for changes
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let distill_dir = get_distill_dir();
                if !distill_dir.exists() {
                    // Create directory if it doesn't exist so we can watch it
                    let _ = fs::create_dir_all(&distill_dir);
                }

                let (tx, rx) = channel();
                let mut watcher: RecommendedWatcher =
                    match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
                        if let Ok(event) = res {
                            // Only trigger on create/modify/remove events
                            if event.kind.is_create()
                                || event.kind.is_modify()
                                || event.kind.is_remove()
                            {
                                let _ = tx.send(());
                            }
                        }
                    }) {
                        Ok(w) => w,
                        Err(_) => return,
                    };

                if watcher
                    .watch(&distill_dir, RecursiveMode::NonRecursive)
                    .is_err()
                {
                    return;
                }

                // Debounce: wait for events to settle before emitting
                loop {
                    if rx.recv().is_ok() {
                        // Drain any additional events that came in quickly
                        while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}
                        // Only emit if watch is enabled
                        if DISTILL_WATCH_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
                            let _ = app_handle.emit("distill-changed", ());
                        }
                    }
                }
            });

            // Start watching ~/.claude/projects/ for session changes (new/updated jsonl files)
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let projects_dir = get_claude_dir().join("projects");
                if !projects_dir.exists() {
                    let _ = fs::create_dir_all(&projects_dir);
                }

                let (tx, rx) = channel();
                let mut watcher: RecommendedWatcher =
                    match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
                        if let Ok(event) = res {
                            if event.kind.is_create()
                                || event.kind.is_modify()
                                || event.kind.is_remove()
                            {
                                let _ = tx.send(());
                            }
                        }
                    }) {
                        Ok(w) => w,
                        Err(_) => return,
                    };

                if watcher
                    .watch(&projects_dir, RecursiveMode::Recursive)
                    .is_err()
                {
                    return;
                }

                loop {
                    if rx.recv().is_ok() {
                        // Debounce burst of writes from jsonl appends
                        while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}
                        emit_sessions_changed_with_fresh_cache(app_handle.clone());
                    }
                }
            });

            // Start watching Codex rollout files and session_index.jsonl title changes.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let codex_dir = get_codex_dir();
                let sessions_dir = get_codex_sessions_dir();
                let archived_sessions_dir = get_codex_archived_sessions_dir();
                let session_index_path = codex_dir.join("session_index.jsonl");
                let sessions_dir_for_events = sessions_dir.clone();
                let archived_sessions_dir_for_events = archived_sessions_dir.clone();
                let session_index_path_for_events = session_index_path.clone();
                if !codex_dir.exists() {
                    let _ = fs::create_dir_all(&codex_dir);
                }
                if !sessions_dir.exists() {
                    let _ = fs::create_dir_all(&sessions_dir);
                }
                if !archived_sessions_dir.exists() {
                    let _ = fs::create_dir_all(&archived_sessions_dir);
                }

                let (tx, rx) = channel();
                let mut watcher: RecommendedWatcher =
                    match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
                        if let Ok(event) = res {
                            let is_relevant_path = event.paths.iter().any(|path| {
                                path.starts_with(&sessions_dir_for_events)
                                    || path.starts_with(&archived_sessions_dir_for_events)
                                    || path == &session_index_path_for_events
                            });
                            if is_relevant_path
                                && (event.kind.is_create()
                                    || event.kind.is_modify()
                                    || event.kind.is_remove())
                            {
                                let _ = tx.send(());
                            }
                        }
                    }) {
                        Ok(w) => w,
                        Err(_) => return,
                    };

                if watcher
                    .watch(&sessions_dir, RecursiveMode::Recursive)
                    .is_err()
                {
                    return;
                }
                if watcher
                    .watch(&archived_sessions_dir, RecursiveMode::Recursive)
                    .is_err()
                {
                    return;
                }
                if watcher
                    .watch(&codex_dir, RecursiveMode::NonRecursive)
                    .is_err()
                {
                    return;
                }

                loop {
                    if rx.recv().is_ok() {
                        while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}
                        emit_sessions_changed_with_fresh_cache(app_handle.clone());
                    }
                }
            });

            let settings = MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Lovcode")
                .item(&PredefinedMenuItem::about(
                    app,
                    Some("About Lovcode"),
                    None,
                )?)
                .separator()
                .item(&settings)
                .separator()
                .item(&PredefinedMenuItem::hide(app, Some("Hide Lovcode"))?)
                .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
                .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Quit Lovcode"))?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            let toggle_main = MenuItemBuilder::with_id("toggle_main", "Toggle Main Window")
                .accelerator("CmdOrCtrl+1")
                .build(app)?;
            let duplicate_page =
                MenuItemBuilder::with_id("duplicate_page", "Duplicate Current Page")
                    .accelerator("CmdOrCtrl+Shift+N")
                    .build(app)?;

            #[cfg(debug_assertions)]
            let close_devtools = MenuItemBuilder::with_id("close_devtools", "Close DevTools")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;

            let window_menu_builder = SubmenuBuilder::new(app, "Window")
                .item(&toggle_main)
                .item(&duplicate_page)
                .separator();
            #[cfg(debug_assertions)]
            let window_menu_builder = window_menu_builder.item(&close_devtools).separator();
            let window_menu = window_menu_builder
                .item(&PredefinedMenuItem::minimize(app, None)?)
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .item(&PredefinedMenuItem::close_window(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::WebviewUrl;
            use tauri::WebviewWindowBuilder;

            match event.id().as_ref() {
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-settings", ());
                    }
                }
                "close_devtools" => {
                    #[cfg(debug_assertions)]
                    {
                        for (_, window) in app.webview_windows() {
                            window.close_devtools();
                        }
                    }
                }
                "toggle_main" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let visible = window.is_visible().unwrap_or(false);
                        let focused = window.is_focused().unwrap_or(false);
                        if visible && focused {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            #[cfg(target_os = "macos")]
                            activate_and_focus_window(&window);
                            #[cfg(not(target_os = "macos"))]
                            let _ = window.set_focus();
                        }
                    } else {
                        // Recreate main window
                        #[cfg(target_os = "macos")]
                        {
                            if let Ok(window) =
                                WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                                    .title("Lovcode")
                                    .inner_size(800.0, 600.0)
                                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                                    .hidden_title(true)
                                    .traffic_light_position(tauri::Position::Logical(
                                        tauri::LogicalPosition::new(16.0, 28.0),
                                    ))
                                    .build()
                            {
                                let _ = window.show();
                                activate_and_focus_window(&window);
                            }
                        }
                        #[cfg(not(target_os = "macos"))]
                        if let Ok(window) =
                            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                                .title("Lovcode")
                                .inner_size(800.0, 600.0)
                                .build()
                        {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                "duplicate_page" => {
                    let mut target_window = None;
                    for (_, window) in app.webview_windows() {
                        if window.is_focused().unwrap_or(false) {
                            target_window = Some(window);
                            break;
                        }
                    }

                    if target_window.is_none() {
                        target_window = app.get_webview_window("main");
                    }

                    if let Some(window) = target_window {
                        let _ = window.emit("menu-duplicate-page-window", ());
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(command_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            {
                use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

                if let RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } = _event
                {
                    println!(
                        "[Lovcode] Dock clicked! has_visible_windows: {}",
                        has_visible_windows
                    );

                    // 无论是否有"可见窗口"，都尝试打开主窗口
                    // 因为 float 窗口可能被计入 has_visible_windows
                    if let Some(window) = _app.get_webview_window("main") {
                        println!("[Lovcode] Main window exists, showing...");
                        let _ = window.show();
                        activate_and_focus_window(&window);
                    } else {
                        println!("[Lovcode] Main window gone, recreating...");
                        match WebviewWindowBuilder::new(_app, "main", WebviewUrl::default())
                            .title("Lovcode")
                            .inner_size(800.0, 600.0)
                            .title_bar_style(tauri::TitleBarStyle::Overlay)
                            .hidden_title(true)
                            .traffic_light_position(tauri::Position::Logical(
                                tauri::LogicalPosition::new(16.0, 28.0),
                            ))
                            .build()
                        {
                            Ok(window) => {
                                println!("[Lovcode] Window created successfully");
                                let _ = window.show();
                                activate_and_focus_window(&window);
                            }
                            Err(e) => {
                                println!("[Lovcode] Failed to create window: {:?}", e);
                            }
                        }
                    }
                }
            }
        });
}
