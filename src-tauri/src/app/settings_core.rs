use super::*;

pub(crate) fn get_session_path(project_id: &str, session_id: &str) -> PathBuf {
    get_claude_dir()
        .join("projects")
        .join(project_id)
        .join(format!("{session_id}.jsonl"))
}

pub(crate) fn resolve_session_path(project_id: &str, session_id: &str) -> Option<PathBuf> {
    let claude_path = get_session_path(project_id, session_id);
    if claude_path.exists() {
        return Some(claude_path);
    }
    find_codex_session_path(session_id)
}

pub(crate) fn is_codex_session_path(path: &Path) -> bool {
    path.starts_with(get_codex_sessions_dir()) || path.starts_with(get_codex_archived_sessions_dir())
}

#[tauri::command]
pub(crate) fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}
