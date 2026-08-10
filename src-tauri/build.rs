fn main() {
    // macOS development builds embed the application icon into the executable.
    // Track both assets explicitly so an icon-only update rebuilds the native
    // process instead of leaving Dock with a stale cached icon.
    println!("cargo:rerun-if-changed=icons/ataru/icon.icns");
    println!("cargo:rerun-if-changed=icons/ataru/icon.png");
    tauri_build::build()
}
