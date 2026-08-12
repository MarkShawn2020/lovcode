use super::*;
use std::process::Command;

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
    path.starts_with(get_codex_sessions_dir())
        || path.starts_with(get_codex_archived_sessions_dir())
}

fn session_path_or_error(project_id: &str, session_id: &str) -> Result<PathBuf, String> {
    resolve_session_path(project_id, session_id)
        .ok_or_else(|| format!("Session not found: projectId={project_id}, sessionId={session_id}"))
}

#[tauri::command]
pub(crate) fn get_session_source_path(
    project_id: String,
    session_id: String,
) -> Result<String, String> {
    Ok(session_path_or_error(&project_id, &session_id)?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub(crate) fn reveal_session_in_finder(
    project_id: String,
    session_id: String,
) -> Result<(), String> {
    let path = session_path_or_error(&project_id, &session_id)?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(&path).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .status();

    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open")
        .arg(path.parent().unwrap_or_else(|| Path::new(".")))
        .status();

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("当前平台不支持在文件管理器中显示会话文件".to_string());

    let status = status.map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("文件管理器退出状态异常: {status}"))
    }
}

#[tauri::command]
pub(crate) fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}
