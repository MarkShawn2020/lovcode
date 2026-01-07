//! PTY session management for terminal panels
//!
//! Event-driven architecture: data pushed via Tauri events instead of polling.
//! Scrollback buffers are persisted to disk for recovery after app restart.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Maximum scrollback buffer size per session (256KB)
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;

/// Minimum interval between disk writes (debounce)
const SCROLLBACK_SAVE_INTERVAL_MS: u64 = 2000;

/// Global AppHandle for emitting events
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Get scrollback storage directory
fn get_scrollback_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio")
        .join("lovcode")
        .join("scrollback")
}

/// Get scrollback file path for a session
fn get_scrollback_path(id: &str) -> PathBuf {
    get_scrollback_dir().join(format!("{}.bin", id))
}

/// Load scrollback from disk
fn load_scrollback_from_disk(id: &str) -> Option<VecDeque<u8>> {
    let path = get_scrollback_path(id);
    if path.exists() {
        match fs::read(&path) {
            Ok(data) => Some(VecDeque::from(data)),
            Err(_) => None,
        }
    } else {
        None
    }
}

/// Save scrollback to disk
fn save_scrollback_to_disk(id: &str, data: &VecDeque<u8>) -> Result<(), String> {
    let dir = get_scrollback_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create scrollback dir: {}", e))?;

    let path = get_scrollback_path(id);
    let bytes: Vec<u8> = data.iter().copied().collect();
    fs::write(&path, &bytes).map_err(|e| format!("Failed to write scrollback: {}", e))?;
    Ok(())
}

/// Delete scrollback file
fn delete_scrollback_from_disk(id: &str) {
    let path = get_scrollback_path(id);
    let _ = fs::remove_file(path);
}

/// Initialize PTY manager with AppHandle
pub fn init(app_handle: AppHandle) {
    let _ = APP_HANDLE.set(app_handle);
}

/// PTY data event payload
#[derive(Clone, Serialize)]
pub struct PtyDataEvent {
    pub id: String,
    pub data: Vec<u8>,
}

/// PTY exit event payload
#[derive(Clone, Serialize)]
pub struct PtyExitEvent {
    pub id: String,
}

/// Session I/O handles
struct SessionIO {
    writer: Box<dyn Write + Send>,
}

/// Session control
struct SessionControl {
    running: Arc<AtomicBool>,
}

/// Global storages
static PTY_SESSIONS: LazyLock<Mutex<HashMap<String, Arc<Mutex<SessionIO>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static PTY_CONTROLS: LazyLock<Mutex<HashMap<String, SessionControl>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static PTY_MASTERS: LazyLock<Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Scrollback buffer per session (ring buffer, max SCROLLBACK_MAX_BYTES)
static PTY_SCROLLBACK: LazyLock<Mutex<HashMap<String, VecDeque<u8>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Last disk save timestamp per session (for debouncing)
static PTY_SCROLLBACK_LAST_SAVE: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Sessions with pending unsaved changes
static PTY_SCROLLBACK_DIRTY: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Create a new PTY session with background reader thread
pub fn create_session(
    id: String,
    cwd: String,
    shell: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    let app_handle = APP_HANDLE
        .get()
        .ok_or_else(|| "PTY manager not initialized".to_string())?
        .clone();

    let pty_system = native_pty_system();

    // Create PTY pair
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Determine shell and build command based on platform
    #[cfg(windows)]
    let mut cmd = {
        // On Windows, use PowerShell as default (better than cmd.exe for modern terminals)
        let shell_cmd = shell.unwrap_or_else(|| {
            std::env::var("SHELL")
                .or_else(|_| std::env::var("COMSPEC"))
                .unwrap_or_else(|_| "powershell.exe".to_string())
        });

        let is_powershell = shell_cmd.to_lowercase().contains("powershell");
        let is_cmd = shell_cmd.to_lowercase().contains("cmd");

        if let Some(ref command_str) = command {
            let mut c = CommandBuilder::new(&shell_cmd);
            if is_powershell {
                c.arg("-NoExit");
                c.arg("-Command");
                c.arg(command_str);
            } else if is_cmd {
                c.arg("/K");
                c.arg(command_str);
            } else {
                // Generic: try Unix-style args
                c.arg("-c");
                c.arg(command_str);
            }
            c
        } else {
            // Interactive shell
            let mut c = CommandBuilder::new(&shell_cmd);
            if is_powershell {
                c.arg("-NoExit");
            } else if is_cmd {
                c.arg("/K");
            }
            c
        }
    };

    #[cfg(not(windows))]
    let mut cmd = {
        // On Unix, use user's default shell, fallback to zsh (macOS default since Catalina)
        let shell_cmd = shell.unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        });

        // Build command: either run custom command via login shell, or just start shell
        // Use -ilc (interactive + login) to load user's shell config (~/.zshrc, ~/.bashrc)
        // This ensures PATH includes nvm, homebrew, npm global, etc.
        if let Some(ref command_str) = command {
            let mut c = CommandBuilder::new(&shell_cmd);
            c.arg("-ilc");
            c.arg(command_str);
            c
        } else {
            // Interactive shell: use -il for login mode (loads profile/rc files)
            let mut c = CommandBuilder::new(&shell_cmd);
            c.arg("-il");
            c
        }
    };

    cmd.cwd(&cwd);

    // Set proper TERM for xterm.js
    cmd.env("TERM", "xterm-256color");
    // Mark as lovcode terminal (similar to ITERM_SESSION_ID for iTerm)
    cmd.env("LOVCODE_TERMINAL", "1");

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Get reader and writer
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store writer
    let io = Arc::new(Mutex::new(SessionIO { writer }));
    {
        let mut sessions = PTY_SESSIONS.lock().map_err(|e| e.to_string())?;
        sessions.insert(id.clone(), io);
    }

    // Store master for resize
    {
        let mut masters = PTY_MASTERS.lock().map_err(|e| e.to_string())?;
        masters.insert(id.clone(), pair.master);
    }

    // Create control flag
    let running = Arc::new(AtomicBool::new(true));
    {
        let mut controls = PTY_CONTROLS.lock().map_err(|e| e.to_string())?;
        controls.insert(id.clone(), SessionControl { running: running.clone() });
    }

    // Initialize scrollback buffer - load from disk if exists (for app restart recovery)
    {
        let mut scrollback = PTY_SCROLLBACK.lock().map_err(|e| e.to_string())?;
        let buffer = load_scrollback_from_disk(&id)
            .unwrap_or_else(|| VecDeque::with_capacity(SCROLLBACK_MAX_BYTES));
        scrollback.insert(id.clone(), buffer);
    }
    // Initialize last save timestamp
    {
        let mut last_save = PTY_SCROLLBACK_LAST_SAVE.lock().map_err(|e| e.to_string())?;
        last_save.insert(id.clone(), Instant::now());
    }

    // Spawn background reader thread
    let session_id = id.clone();
    let running_flag = running;

    thread::spawn(move || {
        read_loop(session_id, reader, running_flag, app_handle);
    });

    Ok(())
}

/// Background reader loop - runs in dedicated thread per session
fn read_loop(
    id: String,
    mut reader: Box<dyn Read + Send>,
    running: Arc<AtomicBool>,
    app_handle: AppHandle,
) {
    let mut buffer = vec![0u8; 16384]; // 16KB buffer

    while running.load(Ordering::Relaxed) {
        match reader.read(&mut buffer) {
            Ok(0) => {
                // EOF - session ended
                let _ = app_handle.emit("pty-exit", PtyExitEvent { id: id.clone() });
                break;
            }
            Ok(n) => {
                let data = buffer[..n].to_vec();

                // Save to scrollback buffer and persist to disk (debounced)
                let should_save = if let Ok(mut scrollback) = PTY_SCROLLBACK.lock() {
                    if let Some(buf) = scrollback.get_mut(&id) {
                        // Remove old data if buffer would exceed max
                        let overflow = (buf.len() + n).saturating_sub(SCROLLBACK_MAX_BYTES);
                        if overflow > 0 {
                            buf.drain(..overflow);
                        }
                        buf.extend(&data);

                        // Check if we should persist to disk (debounced)
                        let now = Instant::now();
                        let should_save = if let Ok(mut last_save) = PTY_SCROLLBACK_LAST_SAVE.lock() {
                            if let Some(last) = last_save.get(&id) {
                                if now.duration_since(*last) >= Duration::from_millis(SCROLLBACK_SAVE_INTERVAL_MS) {
                                    last_save.insert(id.clone(), now);
                                    true
                                } else {
                                    // Mark as dirty for later save
                                    if let Ok(mut dirty) = PTY_SCROLLBACK_DIRTY.lock() {
                                        dirty.insert(id.clone());
                                    }
                                    false
                                }
                            } else {
                                last_save.insert(id.clone(), now);
                                true
                            }
                        } else {
                            false
                        };

                        if should_save {
                            // Remove from dirty set since we're saving now
                            if let Ok(mut dirty) = PTY_SCROLLBACK_DIRTY.lock() {
                                dirty.remove(&id);
                            }
                            Some(buf.clone())
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                // Persist to disk outside of lock
                if let Some(buf) = should_save {
                    let _ = save_scrollback_to_disk(&id, &buf);
                }

                let _ = app_handle.emit("pty-data", PtyDataEvent { id: id.clone(), data });
            }
            Err(e) => {
                // Check if we should still be running
                if running.load(Ordering::Relaxed) {
                    eprintln!("PTY read error for {}: {}", id, e);
                    let _ = app_handle.emit("pty-exit", PtyExitEvent { id: id.clone() });
                }
                break;
            }
        }
    }

    // Cleanup on exit
    cleanup_session(&id);
}

/// Internal cleanup (called from reader thread)
/// Note: This does NOT delete the scrollback file - it persists for app restart recovery
fn cleanup_session(id: &str) {
    // Save any dirty scrollback before cleanup
    if let Ok(scrollback) = PTY_SCROLLBACK.lock() {
        if let Some(buf) = scrollback.get(id) {
            let is_dirty = PTY_SCROLLBACK_DIRTY
                .lock()
                .map(|dirty| dirty.contains(id))
                .unwrap_or(false);
            if is_dirty || !buf.is_empty() {
                let _ = save_scrollback_to_disk(id, buf);
            }
        }
    }

    if let Ok(mut sessions) = PTY_SESSIONS.lock() {
        sessions.remove(id);
    }
    if let Ok(mut controls) = PTY_CONTROLS.lock() {
        controls.remove(id);
    }
    if let Ok(mut masters) = PTY_MASTERS.lock() {
        masters.remove(id);
    }
    if let Ok(mut scrollback) = PTY_SCROLLBACK.lock() {
        scrollback.remove(id);
    }
    if let Ok(mut last_save) = PTY_SCROLLBACK_LAST_SAVE.lock() {
        last_save.remove(id);
    }
    if let Ok(mut dirty) = PTY_SCROLLBACK_DIRTY.lock() {
        dirty.remove(id);
    }
}

/// Write data to a PTY session
pub fn write_to_session(id: &str, data: &[u8]) -> Result<(), String> {
    let sessions = PTY_SESSIONS.lock().map_err(|e| e.to_string())?;

    let io = sessions
        .get(id)
        .ok_or_else(|| format!("PTY session '{}' not found", id))?;

    let mut io_guard = io.lock().map_err(|e| e.to_string())?;

    io_guard
        .writer
        .write_all(data)
        .map_err(|e| format!("Failed to write: {}", e))?;

    io_guard
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    Ok(())
}

/// Resize a PTY session
pub fn resize_session(id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let mut masters = PTY_MASTERS.lock().map_err(|e| e.to_string())?;

    let master = masters
        .get_mut(id)
        .ok_or_else(|| format!("PTY session '{}' not found", id))?;

    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize: {}", e))?;

    Ok(())
}

/// Kill a PTY session
pub fn kill_session(id: &str) -> Result<(), String> {
    // Signal reader thread to stop
    if let Ok(controls) = PTY_CONTROLS.lock() {
        if let Some(ctrl) = controls.get(id) {
            ctrl.running.store(false, Ordering::Relaxed);
        }
    }

    // Cleanup will happen in reader thread, but also do immediate cleanup
    cleanup_session(id);

    Ok(())
}

/// List all active PTY session IDs
pub fn list_sessions() -> Vec<String> {
    PTY_SESSIONS
        .lock()
        .map(|sessions| sessions.keys().cloned().collect())
        .unwrap_or_default()
}

/// Check if a session exists
pub fn session_exists(id: &str) -> bool {
    PTY_SESSIONS
        .lock()
        .map(|sessions| sessions.contains_key(id))
        .unwrap_or(false)
}

/// Get scrollback buffer for a session (for replay after page refresh)
/// First checks memory, then falls back to disk
pub fn get_scrollback(id: &str) -> Vec<u8> {
    // Try memory first
    if let Ok(scrollback) = PTY_SCROLLBACK.lock() {
        if let Some(buf) = scrollback.get(id) {
            return buf.iter().copied().collect();
        }
    }
    // Fall back to disk (for app restart recovery)
    load_scrollback_from_disk(id)
        .map(|buf| buf.into_iter().collect())
        .unwrap_or_default()
}

/// Delete scrollback from disk (called when session is permanently removed)
pub fn purge_scrollback(id: &str) {
    delete_scrollback_from_disk(id);
}

/// Flush all dirty scrollback buffers to disk (called on app shutdown)
pub fn flush_all_scrollback() {
    let dirty_ids: Vec<String> = PTY_SCROLLBACK_DIRTY
        .lock()
        .map(|dirty| dirty.iter().cloned().collect())
        .unwrap_or_default();

    if let Ok(scrollback) = PTY_SCROLLBACK.lock() {
        for id in dirty_ids {
            if let Some(buf) = scrollback.get(&id) {
                let _ = save_scrollback_to_disk(&id, buf);
            }
        }
    }

    // Clear dirty set
    if let Ok(mut dirty) = PTY_SCROLLBACK_DIRTY.lock() {
        dirty.clear();
    }
}

/// Legacy read function - kept for compatibility but should not be used
#[deprecated(note = "Use event-based reading via pty-data events instead")]
pub fn read_from_session(_id: &str) -> Result<Vec<u8>, String> {
    // Return empty - data now comes via events
    Ok(Vec::new())
}
