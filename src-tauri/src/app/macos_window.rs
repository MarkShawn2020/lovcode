use super::*;

// ============================================================================
// macOS Window Configuration
// ============================================================================

/// 激活应用并聚焦指定窗口 (macOS)
/// 使用 dispatch_after 确保在 window.show() 异步操作完成后再激活
#[cfg(target_os = "macos")]
pub(crate) fn activate_and_focus_window(window: &tauri::WebviewWindow) {
    use cocoa::appkit::NSApplicationActivationPolicy;
    use cocoa::base::id;
    use objc::runtime::YES;
    use objc::*;

    // 获取 NSWindow 句柄
    let ns_window = match window.ns_window() {
        Ok(w) => w as usize, // 转为 usize 以便跨闭包传递
        Err(_) => return,
    };

    unsafe {
        let app = cocoa::appkit::NSApp();

        // 1. 确保应用是 Regular 类型（可以接收焦点）
        let _: () = msg_send![app, setActivationPolicy: NSApplicationActivationPolicy::NSApplicationActivationPolicyRegular];

        // 2. 激活应用（立即执行）
        let _: () = msg_send![app, activateIgnoringOtherApps: YES];

        // 3. 延迟执行窗口聚焦，等待 window.show() 完成
        // 使用 performSelector:withObject:afterDelay: 在主线程的 run loop 中延迟执行
        // 50ms 足够让 macOS 完成窗口显示动画
        let ns_win: id = ns_window as id;
        let nil_ptr: id = std::ptr::null_mut();

        let sel_make_key = sel!(makeKeyAndOrderFront:);
        let sel_order_front = sel!(orderFrontRegardless);
        let sel_make_main = sel!(makeMainWindow);

        // 延迟 50ms 后执行
        let delay: f64 = 0.05;
        let _: () =
            msg_send![ns_win, performSelector:sel_make_key withObject:nil_ptr afterDelay:delay];
        let _: () =
            msg_send![ns_win, performSelector:sel_order_front withObject:nil_ptr afterDelay:delay];
        let _: () =
            msg_send![ns_win, performSelector:sel_make_main withObject:nil_ptr afterDelay:delay];

        println!("[Lovcode] Window activation scheduled (50ms delay)");
    }
}

/// Convert a Tauri window into a nonactivating NSPanel on macOS.
/// Lets the window receive keyboard focus without bringing the owning app
/// to the foreground — required for Spotlight/Raycast-style overlays.
/// On non-macOS this is a no-op.
#[tauri::command]
pub(crate) fn make_window_nonactivating_panel(window: tauri::WebviewWindow) -> Result<(), String> {
    // Previously this swapped the NSWindow's isa to NSPanel via object_setClass
    // to enable NSWindowStyleMaskNonactivatingPanel. That broke Cocoa KVO
    // metadata on TaoWindow and crashed the app when system components
    // (ScreenTime / ViewBridge) tried to unregister observers from the webview
    // during hide/close. Now we keep TaoWindow as-is and only float it above
    // other windows — losing the "doesn't steal focus" property but staying
    // crash-free.
    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::base::id;
        use objc::*;

        let ns_window = window.ns_window().map_err(|e| e.to_string())? as id;
        if ns_window.is_null() {
            return Err("ns_window is null".into());
        }

        let floating_level: i64 = 3; // NSFloatingWindowLevel
        let _: () = msg_send![ns_window, setLevel: floating_level];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: objc::runtime::NO];
    }
    let _ = window;
    Ok(())
}
