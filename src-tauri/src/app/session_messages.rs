use super::*;

#[tauri::command]
pub(crate) async fn get_session_messages(
    project_id: String,
    session_id: String,
) -> Result<Vec<Message>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session_path = resolve_session_path(&project_id, &session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        if is_codex_session_path(&session_path) {
            parse_codex_rollout_messages(&session_path)
        } else {
            parse_claude_session_messages(&session_path)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
