use super::*;

pub(crate) fn read_codex_session_head(path: &Path) -> CodexSessionHead {
    use std::collections::HashSet;
    use std::io::{BufRead, BufReader};

    let canonical_id = codex_session_id_from_path(path);
    let fallback_id = canonical_id.clone().unwrap_or_else(|| {
        path.file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });
    let mut head = CodexSessionHead {
        id: fallback_id,
        cwd: None,
        title: None,
        last_prompt: None,
        rounds: 0,
        message_count: 0,
        model: None,
        created_at: None,
    };
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return head,
    };
    let reader = BufReader::new(file);
    let mut seen_user_texts = HashSet::new();
    let mut primary_meta_seen = false;

    for line in reader.lines().map_while(Result::ok) {
        let Ok(parsed) = serde_json::from_str::<CodexRolloutLine>(&line) else {
            continue;
        };
        let timestamp_secs = parsed.timestamp.as_deref().and_then(timestamp_to_secs);
        if head.created_at.is_none() {
            head.created_at = timestamp_secs;
        }
        let Some(payload) = parsed.payload.as_ref() else {
            continue;
        };

        match parsed.line_type.as_deref() {
            Some("session_meta") => {
                let payload_id = payload.get("id").and_then(|v| v.as_str());
                let is_primary_meta = match canonical_id.as_deref() {
                    Some(id) => payload_id == Some(id),
                    None => !primary_meta_seen,
                };
                if is_primary_meta {
                    primary_meta_seen = true;
                    if let Some(id) = payload_id {
                        head.id = id.to_string();
                    }
                    if let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()) {
                        if !cwd.is_empty() {
                            head.cwd = Some(cwd.to_string());
                        }
                    }
                    if let Some(model) = payload.get("model_provider").and_then(|v| v.as_str()) {
                        if !model.is_empty() {
                            head.model = Some(model.to_string());
                        }
                    }
                    if head.created_at.is_none() {
                        head.created_at = payload
                            .get("timestamp")
                            .and_then(|v| v.as_str())
                            .and_then(timestamp_to_secs);
                    }
                }
            }
            Some("event_msg") => match payload.get("type").and_then(|v| v.as_str()) {
                Some("thread_name_updated") => {
                    let thread_id = payload.get("thread_id").and_then(|v| v.as_str());
                    if thread_id.map_or(true, |id| id == head.id) {
                        if let Some(title) = payload.get("thread_name").and_then(|v| v.as_str()) {
                            if !title.trim().is_empty() {
                                head.title = Some(title.trim().to_string());
                            }
                        }
                    }
                }
                Some("user_message") => {
                    let text = payload
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    let normalized = normalize_message_text(&text);
                    if !normalized.is_empty()
                        && !is_codex_context_message(&text)
                        && seen_user_texts.insert(normalized)
                    {
                        head.rounds += 1;
                        head.message_count += 1;
                        head.last_prompt = Some(text);
                    }
                }
                _ => {}
            },
            Some("response_item") => match payload.get("type").and_then(|v| v.as_str()) {
                Some("message") => {
                    let role = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
                    if role == "assistant" {
                        let text = codex_payload_message_text(payload);
                        if !text.trim().is_empty() && !is_codex_no_response_placeholder(&text) {
                            head.message_count += 1;
                        }
                    } else if role == "user" {
                        let text = codex_payload_message_text(payload);
                        let normalized = normalize_message_text(&text);
                        if !normalized.is_empty()
                            && !is_codex_context_message(&text)
                            && seen_user_texts.insert(normalized)
                        {
                            head.rounds += 1;
                            head.message_count += 1;
                            head.last_prompt = Some(text.trim().to_string());
                        }
                    }
                }
                Some("function_call")
                | Some("function_call_output")
                | Some("custom_tool_call")
                | Some("custom_tool_call_output")
                | Some("local_shell_call") => {
                    head.message_count += 1;
                }
                _ => {}
            },
            _ => {}
        }
    }

    head
}

pub(crate) fn parse_codex_rollout_messages(path: &Path) -> Result<Vec<Message>, String> {
    use std::collections::HashSet;

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    let mut seen_user_texts = HashSet::new();

    for (idx, line) in content.lines().enumerate() {
        let Ok(parsed) = serde_json::from_str::<CodexRolloutLine>(line) else {
            continue;
        };
        let timestamp = parsed.timestamp.unwrap_or_default();
        let Some(payload) = parsed.payload else {
            continue;
        };

        match parsed.line_type.as_deref() {
            Some("event_msg") => {
                if payload.get("type").and_then(|v| v.as_str()) != Some("user_message") {
                    continue;
                }
                let text = payload
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let normalized = normalize_message_text(&text);
                if normalized.is_empty()
                    || is_codex_context_message(&text)
                    || !seen_user_texts.insert(normalized)
                {
                    continue;
                }
                messages.push(Message {
                    uuid: format!("{}:{}", path.display(), idx + 1),
                    role: "user".to_string(),
                    content: text,
                    timestamp,
                    is_meta: false,
                    is_tool: false,
                    line_number: idx + 1,
                    content_blocks: None,
                });
            }
            Some("response_item") => match payload.get("type").and_then(|v| v.as_str()) {
                Some("message") => {
                    let role = payload
                        .get("role")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if role != "user" && role != "assistant" {
                        continue;
                    }
                    let text = codex_payload_message_text(&payload);
                    if role == "user" {
                        let normalized = normalize_message_text(&text);
                        if normalized.is_empty()
                            || is_codex_context_message(&text)
                            || !seen_user_texts.insert(normalized)
                        {
                            continue;
                        }
                    } else if text.trim().is_empty() {
                        continue;
                    } else if is_codex_no_response_placeholder(&text) {
                        continue;
                    }
                    let content_blocks = extract_content_blocks(&payload.get("content").cloned());
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), idx + 1),
                        role,
                        content: text,
                        timestamp,
                        is_meta: false,
                        is_tool: false,
                        line_number: idx + 1,
                        content_blocks,
                    });
                }
                Some("function_call") => {
                    let Some(block) = codex_tool_use_block(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(std::slice::from_ref(&block));
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), idx + 1),
                        role: "assistant".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: true,
                        line_number: idx + 1,
                        content_blocks: Some(vec![block]),
                    });
                }
                Some("custom_tool_call") => {
                    let Some(block) = codex_custom_tool_use_block(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(std::slice::from_ref(&block));
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), idx + 1),
                        role: "assistant".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: true,
                        line_number: idx + 1,
                        content_blocks: Some(vec![block]),
                    });
                }
                Some("function_call_output") | Some("custom_tool_call_output") => {
                    let Some(block) = codex_tool_result_block(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(std::slice::from_ref(&block));
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), idx + 1),
                        role: "user".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: true,
                        line_number: idx + 1,
                        content_blocks: Some(vec![block]),
                    });
                }
                Some("reasoning") => {
                    let Some(blocks) = codex_reasoning_blocks(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(&blocks);
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), idx + 1),
                        role: "assistant".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: false,
                        line_number: idx + 1,
                        content_blocks: Some(blocks),
                    });
                }
                _ => {}
            },
            _ => {}
        }
    }

    Ok(messages)
}

pub(crate) fn parse_claude_session_messages(path: &Path) -> Result<Vec<Message>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();

    for (idx, line) in content.lines().enumerate() {
        if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
            let line_type = parsed.line_type.as_deref();
            let is_msg_line = matches!(
                line_type,
                Some("user") | Some("assistant") | Some("message")
            );
            if !is_msg_line {
                continue;
            }
            if let Some(msg) = &parsed.message {
                let role = msg.role.clone().unwrap_or_default();
                if role != "user" && role != "assistant" {
                    continue;
                }
                let (content, is_tool) = extract_content_with_meta(&msg.content);
                let content_blocks = extract_content_blocks(&msg.content);
                let has_content_blocks = content_blocks
                    .as_ref()
                    .map(|blocks| !blocks.is_empty())
                    .unwrap_or(false);
                let display_content = if content.is_empty() {
                    content_blocks
                        .as_deref()
                        .map(content_blocks_to_text)
                        .unwrap_or_default()
                } else {
                    content
                };
                let is_meta = parsed.is_meta.unwrap_or(false);

                if !display_content.is_empty() || has_content_blocks {
                    messages.push(Message {
                        uuid: parsed.uuid.unwrap_or_default(),
                        role,
                        content: display_content,
                        timestamp: parsed.timestamp.unwrap_or_default(),
                        is_meta,
                        is_tool,
                        line_number: idx + 1,
                        content_blocks,
                    });
                }
            }
        }
    }

    Ok(messages)
}

pub(crate) const HANDOFF_HEAD_MESSAGES: usize = 4;
pub(crate) const HANDOFF_TAIL_MESSAGES: usize = 36;
pub(crate) const HANDOFF_MAX_TRANSCRIPT_CHARS: usize = 36_000;
pub(crate) const HANDOFF_MAX_MESSAGE_CHARS: usize = 2_800;
