//! PTY session management for terminal panels
//!
//! This module provides PTY (pseudo-terminal) functionality using portable-pty,
//! enabling shell sessions within the Lovcode workspace.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;

/// Session metadata (thread-safe)
struct SessionMeta {
    cwd: String,
    command: Option<String>,
}

/// I/O handles wrapped for thread safety
struct SessionIO {
    writer: Box<dyn Write + Send>,
    reader: Box<dyn Read + Send>,
}

/// Global PTY session storage
/// We separate metadata from I/O handles to work around Sync requirements
static PTY_SESSIONS: LazyLock<Mutex<HashMap<String, Arc<Mutex<SessionIO>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static PTY_META: LazyLock<Mutex<HashMap<String, SessionMeta>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Resize handles stored separately (MasterPty is not Sync)
static PTY_MASTERS: LazyLock<Mutex<HashMap<String, Box<dyn portable_pty::MasterPty + Send>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Create a new PTY session
///
/// # Arguments
/// * `id` - Unique identifier for this session
/// * `cwd` - Working directory for the shell
/// * `shell` - Optional shell command (defaults to user's shell or bash)
pub fn create_session(id: String, cwd: String, shell: Option<String>) -> Result<(), String> {
    let pty_system = native_pty_system();

    // Create PTY pair with default size
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Determine shell to use
    let shell_cmd = shell.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    });

    // Build command
    let mut cmd = CommandBuilder::new(&shell_cmd);
    cmd.cwd(&cwd);

    // Spawn shell in PTY
    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Get reader and writer from master
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    // Store I/O handles
    let io = Arc::new(Mutex::new(SessionIO { writer, reader }));

    {
        let mut sessions = PTY_SESSIONS
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;
        sessions.insert(id.clone(), io);
    }

    // Store metadata
    {
        let mut meta = PTY_META
            .lock()
            .map_err(|e| format!("Failed to acquire meta lock: {}", e))?;
        meta.insert(
            id.clone(),
            SessionMeta {
                cwd,
                command: Some(shell_cmd),
            },
        );
    }

    // Store master for resize operations
    {
        let mut masters = PTY_MASTERS
            .lock()
            .map_err(|e| format!("Failed to acquire masters lock: {}", e))?;
        masters.insert(id, pair.master);
    }

    Ok(())
}

/// Write data to a PTY session
pub fn write_to_session(id: &str, data: &[u8]) -> Result<(), String> {
    let sessions = PTY_SESSIONS
        .lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    let io = sessions
        .get(id)
        .ok_or_else(|| format!("PTY session '{}' not found", id))?;

    let mut io_guard = io
        .lock()
        .map_err(|e| format!("Failed to acquire IO lock: {}", e))?;

    io_guard
        .writer
        .write_all(data)
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;

    io_guard
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY: {}", e))?;

    Ok(())
}

/// Read available data from a PTY session (non-blocking with timeout)
pub fn read_from_session(id: &str) -> Result<Vec<u8>, String> {
    let io = {
        let sessions = PTY_SESSIONS
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        sessions
            .get(id)
            .ok_or_else(|| format!("PTY session '{}' not found", id))?
            .clone()
    };

    // Read with timeout in a separate thread
    let (tx, rx) = std::sync::mpsc::channel();
    let io_clone = Arc::clone(&io);

    thread::spawn(move || {
        let mut buffer = vec![0u8; 8192];
        let result = match io_clone.lock() {
            Ok(mut guard) => match guard.reader.read(&mut buffer) {
                Ok(n) => {
                    buffer.truncate(n);
                    Ok(buffer)
                }
                Err(e) => Err(format!("Read error: {}", e)),
            },
            Err(e) => Err(format!("Lock error: {}", e)),
        };
        let _ = tx.send(result);
    });

    // Wait with timeout
    match rx.recv_timeout(std::time::Duration::from_millis(100)) {
        Ok(result) => result,
        Err(_) => Ok(Vec::new()), // Timeout = no data available
    }
}

/// Resize a PTY session
pub fn resize_session(id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let mut masters = PTY_MASTERS
        .lock()
        .map_err(|e| format!("Failed to acquire masters lock: {}", e))?;

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
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;

    Ok(())
}

/// Kill a PTY session
pub fn kill_session(id: &str) -> Result<(), String> {
    // Remove from all storages
    {
        let mut sessions = PTY_SESSIONS
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;
        sessions.remove(id);
    }
    {
        let mut meta = PTY_META
            .lock()
            .map_err(|e| format!("Failed to acquire meta lock: {}", e))?;
        meta.remove(id);
    }
    {
        let mut masters = PTY_MASTERS
            .lock()
            .map_err(|e| format!("Failed to acquire masters lock: {}", e))?;
        masters.remove(id);
    }

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

/// Get session info (cwd, command)
#[allow(dead_code)]
pub fn get_session_info(id: &str) -> Option<(String, Option<String>)> {
    PTY_META
        .lock()
        .ok()
        .and_then(|meta| meta.get(id).map(|m| (m.cwd.clone(), m.command.clone())))
}
