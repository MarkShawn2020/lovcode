use super::*;

pub(crate) fn truncate_handoff_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut out = value
        .chars()
        .take(max_chars.saturating_sub(32))
        .collect::<String>();
    out.push_str("\n[truncated]");
    out
}

pub(crate) fn is_reasoning_only_message(message: &Message) -> bool {
    message.content_blocks.as_ref().is_some_and(|blocks| {
        !blocks.is_empty()
            && blocks
                .iter()
                .all(|block| matches!(block, ContentBlock::Thinking { .. }))
    })
}

pub(crate) fn handoff_message_text(message: &Message) -> Option<String> {
    if message.is_meta || is_reasoning_only_message(message) {
        return None;
    }
    let content = message.content.trim();
    if content.is_empty() {
        return None;
    }
    let role = match message.role.as_str() {
        "user" => "User",
        "assistant" => "Assistant",
        other => other,
    };
    let label = if message.is_tool {
        format!("{} tool event", role)
    } else {
        role.to_string()
    };
    Some(format!(
        "### {}\n{}",
        label,
        truncate_handoff_chars(content, HANDOFF_MAX_MESSAGE_CHARS)
    ))
}

pub(crate) fn select_handoff_messages(messages: &[Message]) -> (Vec<&Message>, bool) {
    let usable: Vec<&Message> = messages
        .iter()
        .filter(|m| handoff_message_text(m).is_some())
        .collect();
    if usable.len() <= HANDOFF_HEAD_MESSAGES + HANDOFF_TAIL_MESSAGES {
        return (usable, false);
    }
    let mut selected = Vec::with_capacity(HANDOFF_HEAD_MESSAGES + HANDOFF_TAIL_MESSAGES);
    selected.extend(usable.iter().take(HANDOFF_HEAD_MESSAGES).copied());
    selected.extend(
        usable
            .iter()
            .rev()
            .take(HANDOFF_TAIL_MESSAGES)
            .copied()
            .rev(),
    );
    (selected, true)
}

pub(crate) fn build_handoff_transcript(messages: &[Message]) -> (String, usize, bool) {
    let (selected, omitted_middle) = select_handoff_messages(messages);
    let mut transcript = String::new();
    let mut included = 0usize;
    let mut truncated = omitted_middle;
    let mut inserted_gap = false;

    for (idx, message) in selected.iter().enumerate() {
        if omitted_middle && !inserted_gap && idx == HANDOFF_HEAD_MESSAGES {
            transcript.push_str("\n\n[Earlier and middle messages omitted. The following entries are the most recent context.]\n");
            inserted_gap = true;
        }
        let Some(text) = handoff_message_text(message) else {
            continue;
        };
        let separator_len = if transcript.is_empty() { 0 } else { 2 };
        let next_len = transcript.chars().count() + separator_len + text.chars().count();
        if next_len > HANDOFF_MAX_TRANSCRIPT_CHARS {
            let used = transcript.chars().count() + separator_len;
            if used < HANDOFF_MAX_TRANSCRIPT_CHARS {
                if !transcript.is_empty() {
                    transcript.push_str("\n\n");
                }
                transcript.push_str(&truncate_handoff_chars(
                    &text,
                    HANDOFF_MAX_TRANSCRIPT_CHARS - used,
                ));
                included += 1;
            }
            truncated = true;
            break;
        }
        if !transcript.is_empty() {
            transcript.push_str("\n\n");
        }
        transcript.push_str(&text);
        included += 1;
    }

    (transcript, included, truncated)
}

pub(crate) fn source_provider_for_session_path(path: &Path) -> &'static str {
    if is_codex_session_path(path) {
        "codex"
    } else {
        "claude"
    }
}

pub(crate) fn source_title_for_session_path(path: &Path) -> Option<String> {
    if is_codex_session_path(path) {
        let head = read_codex_session_head(path);
        head.title.or(head.last_prompt)
    } else {
        let head = read_session_head(path, 20);
        head.title.or(head.summary).or(head.last_prompt)
    }
}

pub(crate) fn source_project_path_for_session_path(path: &Path) -> Option<String> {
    if is_codex_session_path(path) {
        read_codex_session_head(path).cwd
    } else {
        read_session_head(path, 20).cwd
    }
}

pub(crate) fn build_session_handoff_prompt(
    project_id: &str,
    session_id: &str,
    target_provider: &str,
    user_prompt: Option<String>,
) -> Result<SessionHandoff, String> {
    if target_provider != "claude" && target_provider != "codex" {
        return Err("targetProvider must be \"claude\" or \"codex\"".to_string());
    }

    let session_path = resolve_session_path(project_id, session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let source_provider = source_provider_for_session_path(&session_path).to_string();
    let source_title = source_title_for_session_path(&session_path);
    let project_path = source_project_path_for_session_path(&session_path);
    let messages = if is_codex_session_path(&session_path) {
        parse_codex_rollout_messages(&session_path)?
    } else {
        parse_claude_session_messages(&session_path)?
    };
    let (transcript, included_message_count, truncated) = build_handoff_transcript(&messages);
    let target_label = if target_provider == "codex" {
        "Codex"
    } else {
        "Claude Code"
    };
    let source_label = if source_provider == "codex" {
        "Codex"
    } else {
        "Claude Code"
    };
    let follow_up = user_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Continue from the prior conversation context.");
    let project_line = project_path.as_deref().unwrap_or("(unknown)");
    let title_line = source_title.as_deref().unwrap_or("Untitled conversation");
    let truncation_note = if truncated {
        "\n- The transcript excerpt is truncated. Inspect the repository and original session file if you need more detail."
    } else {
        ""
    };
    let prompt = format!(
        r#"# Cross-Agent Session Fork

You are {target_label}, forking work from a {source_label} conversation into a new independent session. You cannot attach to the original session state directly; treat this fork context as prior context and use the current repository on disk as the source of truth.

## Source Session
- Source: {source_label}
- Target: {target_label}
- Session ID: {session_id}
- Project ID: {project_id}
- Project path: {project_line}
- Title: {title_line}
- Messages parsed: {message_count}
- Messages included: {included_message_count}{truncation_note}

## Follow-Up Request
{follow_up}

## Operating Notes
- Verify file state before editing; the filesystem may have changed since the source session.
- Preserve user changes and avoid reverting unrelated work.
- Do not assume prior tool calls, terminals, approvals, or hidden model state are still active.
- If context is ambiguous, inspect the repo and ask for clarification before making broad changes.

## Prior Conversation Excerpt
{transcript}
"#,
        target_label = target_label,
        source_label = source_label,
        session_id = session_id,
        project_id = project_id,
        project_line = project_line,
        title_line = title_line,
        message_count = messages.len(),
        included_message_count = included_message_count,
        truncation_note = truncation_note,
        follow_up = follow_up,
        transcript = if transcript.trim().is_empty() {
            "(No readable transcript messages were found.)"
        } else {
            transcript.trim()
        }
    );

    Ok(SessionHandoff {
        source_provider,
        target_provider: target_provider.to_string(),
        source_session_id: session_id.to_string(),
        source_project_id: project_id.to_string(),
        project_path,
        source_title,
        prompt,
        message_count: messages.len(),
        included_message_count,
        truncated,
    })
}

pub(crate) struct RuntimeBridgeMessage {
    pub(crate) role: String,
    pub(crate) text: String,
    pub(crate) timestamp: String,
    pub(crate) is_tool: bool,
}

pub(crate) fn collect_runtime_bridge_messages(messages: &[Message]) -> Vec<RuntimeBridgeMessage> {
    messages
        .iter()
        .filter_map(|message| {
            if message.is_meta || is_reasoning_only_message(message) {
                return None;
            }
            if message.role != "user" && message.role != "assistant" {
                return None;
            }
            let text = if !message.content.trim().is_empty() {
                message.content.trim().to_string()
            } else {
                message
                    .content_blocks
                    .as_deref()
                    .map(content_blocks_to_text)
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };
            if text.is_empty() {
                return None;
            }
            Some(RuntimeBridgeMessage {
                role: message.role.clone(),
                text,
                timestamp: message.timestamp.clone(),
                is_tool: message.is_tool,
            })
        })
        .collect()
}

pub(crate) fn push_jsonl_line(out: &mut String, value: serde_json::Value) -> Result<(), String> {
    let line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    out.push_str(&line);
    out.push('\n');
    Ok(())
}

pub(crate) fn bridge_timestamp_or_now(timestamp: &str, fallback: &str) -> String {
    if timestamp_to_secs(timestamp).is_some() {
        timestamp.to_string()
    } else {
        fallback.to_string()
    }
}

pub(crate) fn bridge_title_slug(title: Option<&str>, target_session_id: &str) -> String {
    let mut slug = title
        .unwrap_or("")
        .chars()
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        slug = format!(
            "lovcode-bridge-{}",
            &target_session_id[..8.min(target_session_id.len())]
        );
    }
    slug
}

pub(crate) fn bridge_last_user_prompt(messages: &[RuntimeBridgeMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user" && !message.is_tool)
        .map(|message| message.text.clone())
}

pub(crate) fn build_target_session_record(
    target_provider: &str,
    target_session_id: &str,
    target_project_id: &str,
    project_path: &str,
    source_title: Option<String>,
    messages: &[RuntimeBridgeMessage],
    now_secs: u64,
) -> Session {
    let rounds = messages
        .iter()
        .filter(|message| message.role == "user" && !message.is_tool)
        .count();
    Session {
        id: target_session_id.to_string(),
        project_id: target_project_id.to_string(),
        project_path: Some(project_path.to_string()),
        title: source_title,
        summary: None,
        last_prompt: bridge_last_user_prompt(messages),
        title_source: Some("custom".to_string()),
        rounds,
        message_count: messages.len(),
        created_at: now_secs,
        last_modified: now_secs,
        usage: None,
        source: if target_provider == "codex" {
            "codex".to_string()
        } else {
            "cli".to_string()
        },
    }
}

pub(crate) fn write_claude_runtime_fork_session(
    target_session_id: &str,
    project_path: &str,
    source_title: Option<&str>,
    messages: &[RuntimeBridgeMessage],
    now_rfc3339: &str,
) -> Result<(PathBuf, String), String> {
    let target_project_id = encode_project_path(project_path);
    let target_dir = get_claude_dir().join("projects").join(&target_project_id);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target_path = target_dir.join(format!("{}.jsonl", target_session_id));
    if target_path.exists() {
        return Err("Target Claude session already exists".to_string());
    }

    let slug = bridge_title_slug(source_title, target_session_id);
    let mut parent_uuid: Option<String> = None;
    let mut content = String::new();

    for message in messages {
        let uuid = uuid::Uuid::new_v4().to_string();
        let timestamp = bridge_timestamp_or_now(&message.timestamp, now_rfc3339);
        let role = message.role.as_str();
        let text = message.text.as_str();
        let mut line = serde_json::json!({
            "type": role,
            "uuid": uuid,
            "parentUuid": parent_uuid.clone(),
            "sessionId": target_session_id,
            "timestamp": timestamp,
            "cwd": project_path,
            "isSidechain": false,
            "userType": "external",
            "entrypoint": "cli",
            "slug": slug,
            "message": {
                "role": role,
                "content": [
                    {
                        "type": "text",
                        "text": text,
                    }
                ],
            },
        });
        if role == "assistant" {
            if let Some(obj) = line.get_mut("message").and_then(|v| v.as_object_mut()) {
                obj.insert(
                    "type".to_string(),
                    serde_json::Value::String("message".to_string()),
                );
            }
        }
        if let Some(title) = source_title.filter(|title| !title.trim().is_empty()) {
            if let Some(obj) = line.as_object_mut() {
                obj.insert(
                    "customTitle".to_string(),
                    serde_json::Value::String(title.to_string()),
                );
            }
        }
        push_jsonl_line(&mut content, line)?;
        parent_uuid = Some(uuid);
    }

    fs::write(&target_path, content).map_err(|e| e.to_string())?;
    Ok((target_path, target_project_id))
}

pub(crate) fn write_codex_runtime_fork_session(
    target_session_id: &str,
    project_path: &str,
    source_title: Option<&str>,
    messages: &[RuntimeBridgeMessage],
    now: chrono::DateTime<chrono::Utc>,
    now_rfc3339: &str,
) -> Result<(PathBuf, String), String> {
    use chrono::Datelike;

    let target_project_id = encode_project_path(project_path);
    let target_dir = get_codex_sessions_dir()
        .join(format!("{:04}", now.year()))
        .join(format!("{:02}", now.month()))
        .join(format!("{:02}", now.day()));
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target_path = target_dir.join(format!(
        "rollout-{}-{}.jsonl",
        now.format("%Y-%m-%dT%H-%M-%S"),
        target_session_id
    ));
    if target_path.exists() {
        return Err("Target Codex session already exists".to_string());
    }

    let mut content = String::new();
    push_jsonl_line(
        &mut content,
        serde_json::json!({
            "timestamp": now_rfc3339,
            "type": "session_meta",
            "payload": {
                "id": target_session_id,
                "timestamp": now_rfc3339,
                "cwd": project_path,
                "originator": "Lovcode",
                "source": "lovcode",
                "cli_version": "lovcode-bridge",
                "model_provider": "openai",
            },
        }),
    )?;
    if let Some(title) = source_title.filter(|title| !title.trim().is_empty()) {
        push_jsonl_line(
            &mut content,
            serde_json::json!({
                "timestamp": now_rfc3339,
                "type": "event_msg",
                "payload": {
                    "type": "thread_name_updated",
                    "thread_id": target_session_id,
                    "thread_name": title,
                },
            }),
        )?;
    }

    for message in messages {
        let timestamp = bridge_timestamp_or_now(&message.timestamp, now_rfc3339);
        let role = message.role.as_str();
        let text = message.text.as_str();
        let content_type = if role == "assistant" {
            "output_text"
        } else {
            "input_text"
        };
        let mut response_payload = serde_json::json!({
            "type": "message",
            "role": role,
            "content": [
                {
                    "type": content_type,
                    "text": text,
                }
            ],
        });
        if role == "assistant" {
            response_payload["phase"] = serde_json::Value::String("final_answer".to_string());
        }
        if role == "user" && !message.is_tool {
            push_jsonl_line(
                &mut content,
                serde_json::json!({
                    "timestamp": timestamp,
                    "type": "event_msg",
                    "payload": {
                        "type": "user_message",
                        "message": text,
                        "images": [],
                        "local_images": [],
                        "text_elements": [],
                    },
                }),
            )?;
        } else if role == "assistant" && !message.is_tool {
            push_jsonl_line(
                &mut content,
                serde_json::json!({
                    "timestamp": timestamp,
                    "type": "event_msg",
                    "payload": {
                        "type": "agent_message",
                        "message": text,
                        "phase": "final_answer",
                        "memory_citation": null,
                    },
                }),
            )?;
        }
        push_jsonl_line(
            &mut content,
            serde_json::json!({
                "timestamp": timestamp,
                "type": "response_item",
                "payload": response_payload,
            }),
        )?;
    }

    fs::write(&target_path, content).map_err(|e| e.to_string())?;
    Ok((target_path, target_project_id))
}

pub(crate) fn build_session_runtime_fork(
    project_id: &str,
    session_id: &str,
    target_provider: &str,
) -> Result<SessionRuntimeFork, String> {
    if target_provider != "claude" && target_provider != "codex" {
        return Err("targetProvider must be \"claude\" or \"codex\"".to_string());
    }

    let session_path = resolve_session_path(project_id, session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let source_provider = source_provider_for_session_path(&session_path).to_string();
    let source_title = source_title_for_session_path(&session_path);
    let project_path = source_project_path_for_session_path(&session_path)
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| "Source session has no project path".to_string())?;
    let source_messages = if is_codex_session_path(&session_path) {
        parse_codex_rollout_messages(&session_path)?
    } else {
        parse_claude_session_messages(&session_path)?
    };
    let bridge_messages = collect_runtime_bridge_messages(&source_messages);
    if bridge_messages.is_empty() {
        return Err("Source session has no replayable messages".to_string());
    }

    let target_session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let now_rfc3339 = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let now_secs = u64::try_from(now.timestamp()).unwrap_or(0);
    let (target_path, target_project_id) = if target_provider == "codex" {
        write_codex_runtime_fork_session(
            &target_session_id,
            &project_path,
            source_title.as_deref(),
            &bridge_messages,
            now,
            &now_rfc3339,
        )?
    } else {
        write_claude_runtime_fork_session(
            &target_session_id,
            &project_path,
            source_title.as_deref(),
            &bridge_messages,
            &now_rfc3339,
        )?
    };
    let target_session = build_target_session_record(
        target_provider,
        &target_session_id,
        &target_project_id,
        &project_path,
        source_title.clone(),
        &bridge_messages,
        now_secs,
    );

    Ok(SessionRuntimeFork {
        source_provider,
        target_provider: target_provider.to_string(),
        source_session_id: session_id.to_string(),
        source_project_id: project_id.to_string(),
        target_session_id,
        target_project_id,
        project_path,
        source_title,
        target_path: target_path.to_string_lossy().to_string(),
        target_session,
        message_count: bridge_messages.len(),
    })
}

pub(crate) fn build_codex_session(path: &Path) -> Option<Session> {
    let head = read_codex_session_head(path);
    let metadata = fs::metadata(path).ok();
    let last_modified = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or_else(|| head.created_at.unwrap_or(0));
    let created_at = metadata
        .as_ref()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .or(head.created_at)
        .unwrap_or(last_modified);
    let cwd = head.cwd.clone()?;
    let mut usage = SessionUsage::default();
    usage.model = head.model.clone();
    let title_source = if head.title.is_some() {
        Some("ai".to_string())
    } else {
        None
    };

    Some(Session {
        id: head.id,
        project_id: encode_project_path(&cwd),
        project_path: Some(cwd),
        title: head.title,
        summary: None,
        last_prompt: head.last_prompt,
        title_source,
        rounds: head.rounds,
        message_count: head.message_count,
        created_at,
        last_modified,
        usage: if usage.model.is_some() {
            Some(usage)
        } else {
            None
        },
        source: "codex".to_string(),
    })
}

/// Build session index from history.jsonl (fast: only reads one file)
/// Cached form of build_session_index_from_history. The 13MB history.jsonl
/// takes ~5s to fully parse on cold cache; this snapshots the result keyed by
/// the file's (size, mtime) so reloads with no new history reuse it instantly.
#[derive(Serialize, Deserialize)]
pub(crate) struct HistoryIndexCache {
    pub(crate) version: u32,
    pub(crate) history_size: u64,
    pub(crate) history_mtime: u64,
    /// Flat array because HashMap<(K1,K2),V> doesn't serialize cleanly to JSON.
    pub(crate) entries: Vec<(String, String, u64, Option<String>)>,
}

pub(crate) const HISTORY_INDEX_CACHE_VERSION: u32 = 1;

pub(crate) fn history_index_cache_path() -> PathBuf {
    get_lovstudio_dir().join("history-index.json")
}

pub(crate) fn build_session_index_from_history() -> HashMap<(String, String), (u64, Option<String>)>
{
    use std::io::{BufRead, BufReader};

    let history_path = get_claude_dir().join("history.jsonl");

    // Try cache first: if history.jsonl size+mtime match, reuse parsed index.
    let history_meta = fs::metadata(&history_path).ok();
    let history_size = history_meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let history_mtime = history_meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let cache_path = history_index_cache_path();
    if let Ok(bytes) = fs::read(&cache_path) {
        if let Ok(cached) = serde_json::from_slice::<HistoryIndexCache>(&bytes) {
            if cached.version == HISTORY_INDEX_CACHE_VERSION
                && cached.history_size == history_size
                && cached.history_mtime == history_mtime
            {
                return cached
                    .entries
                    .into_iter()
                    .map(|(p, s, ts, disp)| ((p, s), (ts, disp)))
                    .collect();
            }
        }
    }

    let mut index: HashMap<(String, String), (u64, Option<String>)> = HashMap::new();

    let file = match fs::File::open(&history_path) {
        Ok(f) => f,
        Err(_) => return index,
    };

    let reader = BufReader::new(file);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if let Ok(entry) = serde_json::from_str::<HistoryEntry>(&line) {
            if let (Some(session_id), Some(project), Some(timestamp)) =
                (entry.session_id, entry.project, entry.timestamp)
            {
                let project_id = encode_project_path(&project);
                // Keep both the latest timestamp (for sort order) and the latest
                // *non-command* display (for the session label). Command-only entries
                // like "/clear" are preserved only when no real prompt exists yet.
                let is_useful_display = entry
                    .display
                    .as_deref()
                    .map(|s| {
                        let trimmed = s.trim();
                        !trimmed.is_empty() && !trimmed.starts_with('/')
                    })
                    .unwrap_or(false);
                index
                    .entry((project_id, session_id))
                    .and_modify(|(ts, disp)| {
                        if timestamp > *ts {
                            *ts = timestamp;
                        }
                        if is_useful_display {
                            *disp = entry.display.clone();
                        } else if disp.is_none() {
                            *disp = entry.display.clone();
                        }
                    })
                    .or_insert((timestamp, entry.display));
            }
        }
    }

    // Persist for next reload. Best-effort: failure here just costs a re-parse.
    let cache_payload = HistoryIndexCache {
        version: HISTORY_INDEX_CACHE_VERSION,
        history_size,
        history_mtime,
        entries: index
            .iter()
            .map(|((p, s), (ts, disp))| (p.clone(), s.clone(), *ts, disp.clone()))
            .collect(),
    };
    if let Some(parent) = cache_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(&cache_payload) {
        let _ = fs::write(&cache_path, bytes);
    }

    index
}
