use super::*;

pub(crate) fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

pub(crate) fn find_subslice_rev(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).rposition(|w| w == needle)
}

/// Scan a balanced JSON object starting at `start`. Returns one-past-end index.
/// Naively counts braces while skipping over strings (which may contain `{}`).
pub(crate) fn scan_balanced_json(bytes: &[u8], start: usize) -> Option<usize> {
    if start >= bytes.len() || bytes[start] != b'{' {
        return None;
    }
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    for i in start..bytes.len() {
        let b = bytes[i];
        if in_str {
            if escape {
                escape = false;
                continue;
            }
            if b == b'\\' {
                escape = true;
                continue;
            }
            if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            _ => {}
        }
    }
    None
}

pub(crate) async fn list_all_chats(
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<ChatsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let projects_dir = get_claude_dir().join("projects");
        let max_messages = limit.unwrap_or(50);
        let skip = offset.unwrap_or(0);

        if !projects_dir.exists() {
            return Ok(ChatsResponse {
                items: vec![],
                total: 0,
            });
        }

        // Collect all session files with metadata
        let mut session_files: Vec<(PathBuf, String, String, u64)> = Vec::new();

        for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let project_entry = project_entry.map_err(|e| e.to_string())?;
            let project_path = project_entry.path();

            if !project_path.is_dir() {
                continue;
            }

            let project_id = project_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let display_path = decode_project_path(&project_id);

            for entry in fs::read_dir(&project_path).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy().to_string();

                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let last_modified = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    session_files.push((
                        path,
                        project_id.clone(),
                        display_path.clone(),
                        last_modified,
                    ));
                }
            }
        }

        // Sort by last modified (newest first)
        session_files.sort_by(|a, b| b.3.cmp(&a.3));

        let mut all_chats: Vec<ChatMessage> = Vec::new();

        // Process all sessions to get total count
        for (path, project_id, project_path, _) in session_files {
            let session_id = path.file_stem().unwrap().to_string_lossy().to_string();
            let content = fs::read_to_string(&path).unwrap_or_default();

            let mut session_summary: Option<String> = None;
            let mut session_cwd: Option<String> = None;
            let mut session_messages: Vec<ChatMessage> = Vec::new();

            for line in content.lines() {
                if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                    let line_type = parsed.line_type.as_deref();

                    if line_type == Some("summary") {
                        session_summary = parsed.summary;
                    }

                    // Capture cwd from first user message
                    if session_cwd.is_none() {
                        if let Some(c) = &parsed.cwd {
                            if !c.is_empty() {
                                session_cwd = Some(c.clone());
                            }
                        }
                    }

                    let is_msg_line = matches!(
                        line_type,
                        Some("user") | Some("assistant") | Some("message")
                    );
                    if is_msg_line {
                        if let Some(msg) = &parsed.message {
                            let role = msg.role.clone().unwrap_or_default();
                            if role == "user" || role == "assistant" {
                                let (text_content, _is_tool) =
                                    extract_content_with_meta(&msg.content);
                                let is_meta = parsed.is_meta.unwrap_or(false);

                                // Skip meta messages and empty content
                                if !is_meta && !text_content.is_empty() {
                                    session_messages.push(ChatMessage {
                                        uuid: parsed.uuid.unwrap_or_default(),
                                        role,
                                        content: text_content,
                                        timestamp: parsed.timestamp.unwrap_or_default(),
                                        project_id: project_id.clone(),
                                        project_path: project_path.clone(),
                                        session_id: session_id.clone(),
                                        session_summary: None, // Will be filled later
                                    });
                                }
                            }
                        }
                    }
                }
            }

            // Update session_summary and project_path for all messages
            let resolved_path = session_cwd.unwrap_or(project_path);
            for msg in &mut session_messages {
                msg.session_summary = session_summary.clone();
                msg.project_path = resolved_path.clone();
            }

            all_chats.extend(session_messages);
        }

        // Sort all by timestamp (newest first)
        all_chats.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        let total = all_chats.len();
        let items: Vec<ChatMessage> = all_chats
            .into_iter()
            .skip(skip)
            .take(max_messages)
            .collect();

        Ok(ChatsResponse { items, total })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn get_session_messages(
    project_id: String,
    session_id: String,
) -> Result<Vec<Message>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session_path = resolve_session_path(&project_id, &session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        if is_codex_session_path(&session_path) {
            return parse_codex_rollout_messages(&session_path);
        }
        parse_claude_session_messages(&session_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) async fn generate_session_handoff_prompt(
    project_id: String,
    session_id: String,
    target_provider: String,
    user_prompt: Option<String>,
) -> Result<SessionHandoff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        build_session_handoff_prompt(&project_id, &session_id, &target_provider, user_prompt)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn create_session_runtime_fork(
    project_id: String,
    session_id: String,
    target_provider: String,
) -> Result<SessionRuntimeFork, String> {
    tauri::async_runtime::spawn_blocking(move || {
        build_session_runtime_fork(&project_id, &session_id, &target_provider)
    })
    .await
    .map_err(|e| e.to_string())?
}
