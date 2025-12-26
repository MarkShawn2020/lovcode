//! PTY session management for terminal panels
//!
//! Event-driven architecture: data pushed via Tauri events instead of polling.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

/// Maximum scrollback buffer size per session (256KB)
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;

/// Global AppHandle for emitting events
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

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

    // Determine shell
    let shell_cmd = shell.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    });

    // Build command: either run custom command via shell -c, or just start shell
    let mut cmd = if let Some(ref command_str) = command {
        let mut c = CommandBuilder::new(&shell_cmd);
        c.arg("-c");
        c.arg(command_str);
        c
    } else {
        CommandBuilder::new(&shell_cmd)
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

    // Initialize scrollback buffer
    {
        let mut scrollback = PTY_SCROLLBACK.lock().map_err(|e| e.to_string())?;
        scrollback.insert(id.clone(), VecDeque::with_capacity(SCROLLBACK_MAX_BYTES));
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

                // Save to scrollback buffer
                if let Ok(mut scrollback) = PTY_SCROLLBACK.lock() {
                    if let Some(buf) = scrollback.get_mut(&id) {
                        // Remove old data if buffer would exceed max
                        let overflow = (buf.len() + n).saturating_sub(SCROLLBACK_MAX_BYTES);
                        if overflow > 0 {
                            buf.drain(..overflow);
                        }
                        buf.extend(&data);
                    }
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
fn cleanup_session(id: &str) {
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
pub fn get_scrollback(id: &str) -> Vec<u8> {
    PTY_SCROLLBACK
        .lock()
        .ok()
        .and_then(|scrollback| scrollback.get(id).map(|buf| buf.iter().copied().collect()))
        .unwrap_or_default()
}

/// Legacy read function - kept for compatibility but should not be used
#[deprecated(note = "Use event-based reading via pty-data events instead")]
pub fn read_from_session(_id: &str) -> Result<Vec<u8>, String> {
    // Return empty - data now comes via events
    Ok(Vec::new())
}
