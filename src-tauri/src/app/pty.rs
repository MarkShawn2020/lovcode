use super::*;

// ============================================================================
// PTY Terminal Commands
// ============================================================================

pub(crate) fn pty_create(
    id: String,
    cwd: String,
    shell: Option<String>,
    command: Option<String>,
) -> Result<String, String> {
    let command = command.map(|command| apply_agent_cli_path_override(&command));
    pty_manager::create_session(id.clone(), cwd, shell, command)?;
    Ok(id)
}

pub(crate) fn pty_write(id: String, data: Vec<u8>) -> Result<(), String> {
    pty_manager::write_to_session(&id, &data)
}

#[allow(deprecated)]
pub(crate) fn pty_read(id: String) -> Result<Vec<u8>, String> {
    // Legacy - data now comes via pty-data events
    pty_manager::read_from_session(&id)
}

pub(crate) fn pty_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty_manager::resize_session(&id, cols, rows)
}

pub(crate) fn pty_kill(id: String) -> Result<(), String> {
    pty_manager::kill_session(&id)
}

pub(crate) fn pty_list() -> Vec<String> {
    pty_manager::list_sessions()
}

pub(crate) fn pty_exists(id: String) -> bool {
    pty_manager::session_exists(&id)
}

pub(crate) fn pty_scrollback(id: String) -> Vec<u8> {
    pty_manager::get_scrollback(&id)
}

pub(crate) fn pty_purge_scrollback(id: String) {
    pty_manager::purge_scrollback(&id)
}

pub(crate) fn pty_flush_scrollback() {
    pty_manager::flush_all_scrollback()
}
