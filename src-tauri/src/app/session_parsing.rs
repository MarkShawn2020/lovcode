use super::*;

#[derive(Debug, Deserialize)]
struct CodexSessionIndexEntry {
    id: Option<String>,
    thread_name: Option<String>,
}

#[derive(Debug, Default)]
struct CodexSessionIndexCache {
    size: u64,
    mtime: u64,
    titles: HashMap<String, String>,
}

static CODEX_SESSION_INDEX_CACHE: LazyLock<Mutex<Option<CodexSessionIndexCache>>> =
    LazyLock::new(|| Mutex::new(None));

fn refresh_codex_session_index_cache() {
    use std::io::{BufRead, BufReader};

    let index_path = get_codex_dir().join("session_index.jsonl");
    let metadata = fs::metadata(&index_path).ok();
    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    {
        let cache = CODEX_SESSION_INDEX_CACHE.lock().unwrap();
        if let Some(cache) = cache.as_ref() {
            if cache.size == size && cache.mtime == mtime {
                return;
            }
        }
    }

    let mut titles = HashMap::new();
    if let Ok(file) = fs::File::open(&index_path) {
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            let Ok(entry) = serde_json::from_str::<CodexSessionIndexEntry>(&line) else {
                continue;
            };
            let (Some(id), Some(title)) = (entry.id, entry.thread_name) else {
                continue;
            };
            let title = title.trim();
            if !id.is_empty() && !title.is_empty() {
                titles.insert(id, title.to_string());
            }
        }
    }

    *CODEX_SESSION_INDEX_CACHE.lock().unwrap() = Some(CodexSessionIndexCache {
        size,
        mtime,
        titles,
    });
}

pub(crate) fn codex_session_index_title(session_id: &str) -> Option<String> {
    refresh_codex_session_index_cache();
    CODEX_SESSION_INDEX_CACHE
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|cache| cache.titles.get(session_id).cloned())
}

pub(crate) fn apply_codex_session_index_title(session: &mut Session) {
    if session.source != "codex" {
        return;
    }
    if let Some(title) = codex_session_index_title(&session.id) {
        session.title = Some(title);
        session.title_source = Some("ai".to_string());
    }
}

fn apply_codex_session_index_title_to_head(head: &mut CodexSessionHead) {
    if let Some(title) = codex_session_index_title(&head.id) {
        head.title = Some(title);
    }
}

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

    apply_codex_session_index_title_to_head(&mut head);
    head
}

/// Read only enough Codex rollout metadata for list/startup surfaces.
/// Full Codex transcripts can be large; startup needs cwd/id/time, not
/// message counts or title quality.
pub(crate) fn read_codex_session_meta_lightweight(path: &Path) -> CodexSessionHead {
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
    let Ok(file) = fs::File::open(path) else {
        return head;
    };
    let reader = BufReader::new(file);
    let mut primary_meta_seen = false;

    for line in reader.lines().map_while(Result::ok).take(200) {
        let Ok(parsed) = serde_json::from_str::<CodexRolloutLine>(&line) else {
            continue;
        };
        if head.created_at.is_none() {
            head.created_at = parsed.timestamp.as_deref().and_then(timestamp_to_secs);
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
                if !is_primary_meta {
                    continue;
                }
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
                if head.cwd.is_some() {
                    break;
                }
            }
            Some("event_msg") => {
                if payload.get("type").and_then(|v| v.as_str()) == Some("thread_name_updated") {
                    let thread_id = payload.get("thread_id").and_then(|v| v.as_str());
                    if thread_id.map_or(true, |id| id == head.id) {
                        if let Some(title) = payload.get("thread_name").and_then(|v| v.as_str()) {
                            if !title.trim().is_empty() {
                                head.title = Some(title.trim().to_string());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    apply_codex_session_index_title_to_head(&mut head);
    head
}

pub(crate) fn parse_codex_rollout_messages(path: &Path) -> Result<Vec<Message>, String> {
    parse_codex_rollout_messages_from_offset(path, 0, 0)
}

/// Parse only the JSONL suffix that was not included in the last index pass.
///
/// Codex rollouts are append-only in normal operation. Keeping the byte and
/// line offsets outside this parser lets the search indexer avoid materializing
/// the entire historical transcript on every file watcher event while retaining
/// the original full-file parser for callers that need a complete session.
pub(crate) fn parse_codex_rollout_messages_from_offset(
    path: &Path,
    offset: u64,
    base_line_count: usize,
) -> Result<Vec<Message>, String> {
    use std::collections::HashSet;
    use std::io::{BufRead, BufReader, Seek, SeekFrom};

    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
    }
    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    let mut seen_user_texts = HashSet::new();

    for (line_offset, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| e.to_string())?;
        let line_number = base_line_count + line_offset + 1;
        let Ok(parsed) = serde_json::from_str::<CodexRolloutLine>(&line) else {
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
                    uuid: format!("{}:{}", path.display(), line_number),
                    role: "user".to_string(),
                    content: text,
                    timestamp,
                    is_meta: false,
                    is_tool: false,
                    line_number,
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
                    let base_uuid = format!("{}:{}", path.display(), line_number);
                    if let Some(blocks) = extract_content_blocks(&payload.get("content").cloned()) {
                        let multiple = blocks.len() > 1;
                        for (block_index, block) in blocks.into_iter().enumerate() {
                            let content = content_blocks_to_text(std::slice::from_ref(&block));
                            if content.trim().is_empty() {
                                continue;
                            }
                            let uuid = if multiple {
                                format!("{base_uuid}:block:{block_index}")
                            } else {
                                base_uuid.clone()
                            };
                            messages.push(Message {
                                uuid,
                                role: role.clone(),
                                content,
                                timestamp: timestamp.clone(),
                                is_meta: false,
                                is_tool: false,
                                line_number,
                                content_blocks: Some(vec![block]),
                            });
                        }
                    } else {
                        messages.push(Message {
                            uuid: base_uuid,
                            role,
                            content: text,
                            timestamp,
                            is_meta: false,
                            is_tool: false,
                            line_number,
                            content_blocks: None,
                        });
                    }
                }
                Some("function_call") => {
                    let Some(block) = codex_tool_use_block(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(std::slice::from_ref(&block));
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), line_number),
                        role: "assistant".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: true,
                        line_number,
                        content_blocks: Some(vec![block]),
                    });
                }
                Some("custom_tool_call") => {
                    let Some(block) = codex_custom_tool_use_block(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(std::slice::from_ref(&block));
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), line_number),
                        role: "assistant".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: true,
                        line_number,
                        content_blocks: Some(vec![block]),
                    });
                }
                Some("function_call_output") | Some("custom_tool_call_output") => {
                    let Some(block) = codex_tool_result_block(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(std::slice::from_ref(&block));
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), line_number),
                        role: "user".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: true,
                        line_number,
                        content_blocks: Some(vec![block]),
                    });
                }
                Some("reasoning") => {
                    let Some(blocks) = codex_reasoning_blocks(&payload) else {
                        continue;
                    };
                    let content = content_blocks_to_text(&blocks);
                    messages.push(Message {
                        uuid: format!("{}:{}", path.display(), line_number),
                        role: "assistant".to_string(),
                        content,
                        timestamp,
                        is_meta: false,
                        is_tool: false,
                        content_blocks: Some(blocks),
                        line_number,
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
                let is_meta = parsed.is_meta.unwrap_or(false);
                let timestamp = parsed.timestamp.unwrap_or_default();
                let base_uuid = parsed.uuid.unwrap_or_default();
                if let Some(blocks) = extract_content_blocks(&msg.content) {
                    let multiple = blocks.len() > 1;
                    for (block_index, block) in blocks.into_iter().enumerate() {
                        let content = content_blocks_to_text(std::slice::from_ref(&block));
                        if content.trim().is_empty()
                            || (role == "assistant" && is_no_response_placeholder(&content))
                        {
                            continue;
                        }
                        let is_tool = matches!(
                            block,
                            ContentBlock::ToolUse { .. } | ContentBlock::ToolResult { .. }
                        );
                        let uuid = if multiple {
                            format!("{base_uuid}:block:{block_index}")
                        } else {
                            base_uuid.clone()
                        };
                        messages.push(Message {
                            uuid,
                            role: role.clone(),
                            content,
                            timestamp: timestamp.clone(),
                            is_meta,
                            is_tool,
                            line_number: idx + 1,
                            content_blocks: Some(vec![block]),
                        });
                    }
                } else {
                    let (content, is_tool) = extract_content_with_meta(&msg.content);
                    if content.trim().is_empty()
                        || (role == "assistant" && is_no_response_placeholder(&content))
                    {
                        continue;
                    }
                    messages.push(Message {
                        uuid: base_uuid,
                        role,
                        content,
                        timestamp,
                        is_meta,
                        is_tool,
                        line_number: idx + 1,
                        content_blocks: None,
                    });
                }
            }
        }
    }

    Ok(messages)
}
