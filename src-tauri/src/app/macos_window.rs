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

// =====================================================================
// Spotlight-style overlay configuration for the search window
//
// Goal: keyboard input arrives at the overlay WITHOUT bringing lovcode
// to the foreground (Spotlight / Alfred / Raycast behavior).
//
// Why we don't `object_setClass` to NSPanel here
// -----------------------------------------------
// Tao registers its own `TaoWindow` class (subclass of NSWindow) with
// custom ivars (`focusable`) and method overrides (`sendEvent:`,
// `canBecomeMainWindow`, `canBecomeKeyWindow`). Swapping the isa pointer
// to a separate NSPanel-rooted class breaks those overrides AND triggers
// KVO bookkeeping mismatches when system frameworks (notably ScreenTime
// / WKWebView on macOS 26 — FB21537703) later try to remove observers
// they registered against the original class. That's the crash that
// killed the previous attempt at this feature.
//
// What we do instead
// ------------------
// 1. Call the private SPI `_setPreventsActivation:` on the existing
//    NSWindow. This is the same call AppKit makes internally when
//    `NSWindowStyleMaskNonactivatingPanel` is passed in `init`. It writes
//    `kCGSPreventsActivationTagBit` to the WindowServer-side window
//    record so this window can become key without activating the owning
//    app — even though the window's class is still TaoWindow / NSWindow.
//    Reference: https://philz.blog/nspanel-nonactivating-style-mask-flag/
// 2. Set NSFloatingWindowLevel + the standard Spotlight collection
//    behavior (canJoinAllSpaces | moveToActiveSpace | transient |
//    fullScreenAuxiliary) so the overlay floats over normal windows /
//    fullscreen apps and follows the user across Spaces.
// 3. setHidesOnDeactivate:NO so app deactivation doesn't auto-hide.
// =====================================================================

// One-shot injection of the nonactivating-panel hooks onto TaoWindow.
// We use `class_addMethod` rather than `object_setClass` (the path that
// crashed previously) so:
//   - TaoWindow's own ivars (`focusable`) stay in place
//   - TaoWindow's `sendEvent:` / `canBecomeKeyWindow` overrides stay in place
//   - No KVO bookkeeping mismatch (the registered class never changes)
//
// Why this works: AppKit's activation routing checks
// `_isNonactivatingPanel` on the receiver via objc_msgSend. As long as the
// class implements that selector and returns YES, AppKit treats the window
// as nonactivating — the actual class hierarchy doesn't have to be NSPanel.
// (Confirmed by FunWithPanels' "method_addMethod" technique.)
#[cfg(target_os = "macos")]
fn ensure_nonactivating_methods_injected(ns_window: cocoa::base::id) {
    use cocoa::base::{BOOL, YES};
    use objc::runtime::{class_addMethod, object_getClass, Class, Imp, Sel};
    use objc::*;
    use std::os::raw::c_char;
    use std::sync::Once;

    static ONCE: Once = Once::new();

    extern "C" fn yes_impl(_this: cocoa::base::id, _sel: Sel) -> BOOL {
        YES
    }

    ONCE.call_once(|| unsafe {
        // Get the dynamic (concrete) class of THIS NSWindow instance —
        // that's TaoWindow, not the abstract NSWindow.
        let cls = object_getClass(ns_window as *const _) as *mut Class;
        if cls.is_null() {
            eprintln!("[Lovcode] object_getClass returned null; skip injection");
            return;
        }

        // Method type encoding "c@:" — returns char (BOOL), takes id (self)
        // and SEL. Sizes are derived by the runtime on registration.
        let types = b"c@:\0".as_ptr() as *const c_char;

        let imp: Imp = std::mem::transmute(yes_impl as extern "C" fn(_, _) -> BOOL);

        for sel_name in &[sel!(_isNonactivatingPanel), sel!(canBecomeKeyWindow)] {
            let added = class_addMethod(cls, *sel_name, imp, types);
            eprintln!(
                "[Lovcode] class_addMethod({:?}) = {}",
                *sel_name,
                added == YES
            );
        }
    });
}

#[cfg(target_os = "macos")]
unsafe fn configure_overlay(ns_window: cocoa::base::id) {
    use cocoa::base::{NO, YES};
    use objc::*;

    if ns_window.is_null() {
        return;
    }

    // (1) Inject `_isNonactivatingPanel` -> YES into TaoWindow's class
    // (idempotent, runs once per process).
    ensure_nonactivating_methods_injected(ns_window);

    // (2) Also flip the WindowServer-side activation tag via the SPI.
    // On its own this didn't take effect on macOS 26 (logs showed
    // _isNonactivatingPanel still NO afterwards), but combined with the
    // method injection above the AppKit hook now returns YES, so the
    // SPI's WindowServer write should land.
    let _: () = msg_send![ns_window, _setPreventsActivation: YES];

    // (3) Float above normal windows, sit on top of fullscreen apps,
    // be present on every Space (Spotlight collection).
    let floating_level: i64 = 3; // NSFloatingWindowLevel
    let _: () = msg_send![ns_window, setLevel: floating_level];
    // CanJoinAllSpaces | Transient | FullScreenAuxiliary
    let behavior: u64 = (1 << 0) | (1 << 3) | (1 << 8);
    let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

    // (4) Don't auto-hide on app deactivation; we manage visibility.
    let _: () = msg_send![ns_window, setHidesOnDeactivate: NO];

    // Diagnostic: confirm the AppKit hook now returns YES.
    let is_non: cocoa::base::BOOL = msg_send![ns_window, _isNonactivatingPanel];
    eprintln!(
        "[Lovcode] after configure: _isNonactivatingPanel = {}",
        is_non == YES
    );
}

/// Idempotent — exposed to the frontend as a fallback / re-arm hook.
#[tauri::command]
pub(crate) fn make_window_nonactivating_panel(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as cocoa::base::id;
        configure_overlay(ns_window);
    }
    let _ = window;
    Ok(())
}

/// Apply the overlay configuration from Rust startup so it lands BEFORE
/// the webview's first runloop tick — minimizing the window where third
/// party frameworks could capture pre-config state.
#[cfg(target_os = "macos")]
pub(crate) fn install_overlay_panel(window: &tauri::WebviewWindow) {
    let ns_window = match window.ns_window() {
        Ok(w) => w as cocoa::base::id,
        Err(_) => return,
    };
    unsafe { configure_overlay(ns_window) };
}

/// Show the overlay window without activating the app — replacement for
/// `WebviewWindow::set_focus()` which calls `[NSApp activateIgnoringOtherApps:]`
/// and would defeat the nonactivating-panel behavior we just configured.
///
/// We bypass Tauri's focus path and call `makeKeyAndOrderFront:` directly on
/// the NSWindow. Combined with `_setPreventsActivation:` set to YES, the
/// WindowServer routes keyboard events here without making lovcode the
/// frontmost app.
#[cfg(target_os = "macos")]
pub(crate) fn show_overlay_keyed(window: &tauri::WebviewWindow) {
    use cocoa::base::id;
    use objc::*;

    let ns_window = match window.ns_window() {
        Ok(w) => w as id,
        Err(_) => return,
    };
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let nil_ptr: id = std::ptr::null_mut();
        let _: () = msg_send![ns_window, makeKeyAndOrderFront: nil_ptr];
    }
}
