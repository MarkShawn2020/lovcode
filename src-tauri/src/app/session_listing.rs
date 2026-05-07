use super::*;

/// Get path to ~/.claude.json (MCP servers config)
pub(crate) fn get_claude_json_path() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude.json")
}

/// Encode project path to project ID (inverse of decode_project_path).
/// Claude Code encodes: `/.` -> `--`, then `/` -> `-`
pub(crate) fn encode_project_path(path: &str) -> String {
    path.replace("/.", "--").replace("/", "-")
}

/// Decode project ID to actual filesystem path.
/// Claude Code encodes: `/` -> `-`, and `.` -> `-`
/// So `/.` becomes `--`, but `-` in directory names is NOT escaped
pub(crate) fn decode_project_path(id: &str) -> String {
    // Check for custom display name (used by imported data sources)
    let display_name_file = get_claude_dir()
        .join("projects")
        .join(id)
        .join(".display_name");
    if let Ok(name) = fs::read_to_string(&display_name_file) {
        let name = name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }

    // First, handle `--` which means `/.` (hidden directories like .claude)
    // Replace `--` with a placeholder, then `-` with `/`, then restore `/.`
    let base = id
        .replace("--", "\x00")
        .replace("-", "/")
        .replace("\x00", "/.");

    // Normalize: strip trailing /. and / segments (e.g. /Users/mark/././ → /Users/mark)
    let base = base.trim_end_matches('/').to_string();
    let base = {
        let mut b = base.as_str();
        while b.ends_with("/.") {
            b = b.trim_end_matches("/.").trim_end_matches('/');
        }
        b.to_string()
    };

    // If the base path exists, we're done
    if PathBuf::from(&base).exists() {
        return base;
    }

    // Otherwise, the project name likely contains hyphens
    // Try progressively merging path segments after common base directories
    for base_dir in &["/projects/", "/repos/", "/Documents/", "/Desktop/"] {
        if let Some(idx) = base.find(base_dir) {
            let prefix = &base[..idx + base_dir.len()];
            let rest = &base[idx + base_dir.len()..];

            // Try merging segments: /a/b/c -> a-b-c, a-b/c, a/b-c, etc.
            if let Some(merged) = try_merge_segments(prefix, rest) {
                return merged;
            }
        }
    }

    // Try merging from /Users/mark/ (home dir) as base
    if let Some(home) = dirs::home_dir() {
        let home_str = format!("{}/", home.display());
        if base.starts_with(&home_str) {
            let rest = &base[home_str.len()..];
            if let Some(merged) = try_merge_segments(&home_str, rest) {
                return merged;
            }
        }
    }

    // Fallback to base interpretation
    base
}

/// Try different combinations of merging path segments with hyphens
pub(crate) fn try_merge_segments(prefix: &str, rest: &str) -> Option<String> {
    let segments: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return None;
    }

    // Try merging all segments into one (most common: project-name-here)
    let all_merged = format!("{}{}", prefix, segments.join("-"));
    if PathBuf::from(&all_merged).exists() {
        return Some(all_merged);
    }

    // Try merging first N segments, leaving rest as subdirs
    for merge_count in (1..segments.len()).rev() {
        let merged_part = segments[..=merge_count].join("-");
        let rest_part = segments[merge_count + 1..].join("/");
        let candidate = if rest_part.is_empty() {
            format!("{}{}", prefix, merged_part)
        } else {
            format!("{}{}/{}", prefix, merged_part, rest_part)
        };
        if PathBuf::from(&candidate).exists() {
            return Some(candidate);
        }
    }

    None
}

#[tauri::command]
pub(crate) async fn list_projects() -> Result<Vec<Project>, String> {
    // Run blocking IO on a separate thread to avoid blocking the main thread
    tauri::async_runtime::spawn_blocking(|| {
        let projects_dir = get_claude_dir().join("projects");

        if !projects_dir.exists() {
            return Ok(vec![]);
        }

        let mut projects = Vec::new();

        for entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                let id = path.file_name().unwrap().to_string_lossy().to_string();
                let display_path = decode_project_path(&id);

                let mut session_count = 0;
                let mut last_active: u64 = 0;

                if let Ok(entries) = fs::read_dir(&path) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                            session_count += 1;
                            if let Ok(meta) = entry.metadata() {
                                if let Ok(modified) = meta.modified() {
                                    if let Ok(duration) =
                                        modified.duration_since(std::time::UNIX_EPOCH)
                                    {
                                        last_active = last_active.max(duration.as_secs());
                                    }
                                }
                            }
                        }
                    }
                }

                projects.push(Project {
                    id: id.clone(),
                    path: display_path,
                    session_count,
                    last_active,
                });
            }
        }

        for codex_path in collect_codex_session_paths() {
            let Some(session) = build_codex_session(&codex_path) else {
                continue;
            };
            if let Some(existing) = projects.iter_mut().find(|p| p.id == session.project_id) {
                existing.session_count += 1;
                existing.last_active = existing.last_active.max(session.last_modified);
                if existing.path.is_empty() {
                    existing.path = session.project_path.unwrap_or_default();
                }
            } else {
                projects.push(Project {
                    id: session.project_id,
                    path: session.project_path.unwrap_or_default(),
                    session_count: 1,
                    last_active: session.last_modified,
                });
            }
        }

        projects.sort_by(|a, b| b.last_active.cmp(&a.last_active));
        Ok(projects)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn list_sessions(project_id: String) -> Result<Vec<Session>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project_dir = get_claude_dir().join("projects").join(&project_id);

        let mut sessions = Vec::new();

        if project_dir.exists() {
            for entry in fs::read_dir(&project_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy().to_string();

                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let session_id = name.trim_end_matches(".jsonl").to_string();

                    let head = read_session_head(&path, 20);

                    let metadata = fs::metadata(&path).ok();
                    let last_modified = metadata
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let created_at = metadata
                        .as_ref()
                        .and_then(|m| m.created().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(last_modified);

                    sessions.push(Session {
                        id: session_id,
                        project_id: project_id.clone(),
                        project_path: None,
                        title: head.title,
                        summary: head.summary,
                        last_prompt: head.last_prompt,
                        title_source: head.title_source,
                        rounds: head.rounds,
                        message_count: head.message_count,
                        created_at,
                        last_modified,
                        usage: None,
                        source: "cli".to_string(),
                    });
                }
            }
        }

        for codex_path in collect_codex_session_paths() {
            let Some(session) = build_codex_session(&codex_path) else {
                continue;
            };
            if session.project_id == project_id {
                sessions.push(session);
            }
        }

        if !project_dir.exists() && sessions.is_empty() {
            return Err("Project not found".to_string());
        }

        sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        Ok(sessions)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pricing constants (USD per 1M tokens) - Claude Opus 4.5 pricing as baseline
pub(crate) const PRICE_INPUT_PER_M: f64 = 15.0;
pub(crate) const PRICE_OUTPUT_PER_M: f64 = 75.0;
pub(crate) const PRICE_CACHE_WRITE_PER_M: f64 = 3.75; // cache creation
pub(crate) const PRICE_CACHE_READ_PER_M: f64 = 0.30; // cache read

/// Calculate cost from token counts
pub(crate) fn calculate_cost(usage: &SessionUsage) -> f64 {
    let input_cost = (usage.input_tokens as f64 / 1_000_000.0) * PRICE_INPUT_PER_M;
    let output_cost = (usage.output_tokens as f64 / 1_000_000.0) * PRICE_OUTPUT_PER_M;
    let cache_write_cost =
        (usage.cache_creation_tokens as f64 / 1_000_000.0) * PRICE_CACHE_WRITE_PER_M;
    let cache_read_cost = (usage.cache_read_tokens as f64 / 1_000_000.0) * PRICE_CACHE_READ_PER_M;
    input_cost + output_cost + cache_write_cost + cache_read_cost
}

/// Read usage data from a session file
pub(crate) fn read_session_usage(path: &Path) -> SessionUsage {
    use std::io::{BufRead, BufReader};

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return SessionUsage::default(),
    };

    let reader = BufReader::new(file);
    let mut usage = SessionUsage::default();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if let Ok(parsed) = serde_json::from_str::<RawLine>(&line) {
            // Only assistant messages have usage data. Match both legacy
            // (type=assistant) and Claude desktop app (type=message + role=assistant).
            let lt = parsed.line_type.as_deref();
            let is_assistant = lt == Some("assistant")
                || (lt == Some("message")
                    && parsed.message.as_ref().and_then(|m| m.role.as_deref())
                        == Some("assistant"));
            if is_assistant {
                if let Some(msg) = &parsed.message {
                    if let Some(u) = &msg.usage {
                        let inp = u.input_tokens.unwrap_or(0);
                        let cw = u.cache_creation_input_tokens.unwrap_or(0);
                        let cr = u.cache_read_input_tokens.unwrap_or(0);
                        usage.input_tokens += inp;
                        usage.output_tokens += u.output_tokens.unwrap_or(0);
                        usage.cache_creation_tokens += cw;
                        usage.cache_read_tokens += cr;
                        let turn_ctx = inp + cw + cr;
                        if turn_ctx > usage.context_tokens {
                            usage.context_tokens = turn_ctx;
                        }
                    }
                    if let Some(m) = msg.model.as_ref().filter(|s| !s.is_empty()) {
                        usage.model = Some(m.clone());
                    }
                }
            }
        }
    }

    usage.cost_usd = calculate_cost(&usage);
    usage
}

pub(crate) fn read_codex_session_usage(path: &Path) -> SessionUsage {
    use std::io::{BufRead, BufReader};

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return SessionUsage::default(),
    };
    let reader = BufReader::new(file);
    let mut usage = SessionUsage::default();

    for line in reader.lines().map_while(Result::ok) {
        let Ok(parsed) = serde_json::from_str::<CodexRolloutLine>(&line) else {
            continue;
        };
        let Some(payload) = parsed.payload else {
            continue;
        };
        if parsed.line_type.as_deref() == Some("session_meta") {
            if let Some(model) = payload.get("model_provider").and_then(|v| v.as_str()) {
                if !model.is_empty() {
                    usage.model = Some(model.to_string());
                }
            }
            continue;
        }
        if parsed.line_type.as_deref() != Some("event_msg")
            || payload.get("type").and_then(|v| v.as_str()) != Some("token_count")
        {
            continue;
        }
        let Some(info) = payload.get("info") else {
            continue;
        };
        let Some(total) = info.get("total_token_usage") else {
            continue;
        };
        usage.input_tokens = total
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(usage.input_tokens);
        usage.output_tokens = total
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            + total
                .get("reasoning_output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
        usage.cache_read_tokens = total
            .get("cached_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(usage.cache_read_tokens);
        usage.context_tokens = total
            .get("total_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(usage.context_tokens);
    }

    usage
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SessionUsageEntry {
    pub session_id: String,
    pub usage: SessionUsage,
}

#[tauri::command]
pub(crate) async fn get_session_usage(
    project_id: String,
    session_id: String,
) -> Result<SessionUsage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_session_path(&project_id, &session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        if is_codex_session_path(&path) {
            Ok(read_codex_session_usage(&path))
        } else {
            Ok(read_session_usage(&path))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn get_sessions_usage(
    project_id: String,
) -> Result<Vec<SessionUsageEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project_dir = get_claude_dir().join("projects").join(&project_id);

        let mut results = Vec::new();

        if project_dir.exists() {
            for entry in fs::read_dir(&project_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy().to_string();

                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let session_id = name.trim_end_matches(".jsonl").to_string();
                    let usage = read_session_usage(&path);
                    results.push(SessionUsageEntry { session_id, usage });
                }
            }
        }

        for codex_path in collect_codex_session_paths() {
            let Some(session) = build_codex_session(&codex_path) else {
                continue;
            };
            if session.project_id == project_id {
                results.push(SessionUsageEntry {
                    session_id: session.id,
                    usage: read_codex_session_usage(&codex_path),
                });
            }
        }

        if !project_dir.exists() && results.is_empty() {
            return Err("Project not found".to_string());
        }

        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Session head info parsed from first N lines
pub(crate) struct SessionHead {
    /// User-set or AI-generated title (Claude Code's `customTitle` / `aiTitle`),
    /// or fallback derived from `slug`. This is the human-recognizable session
    /// label — what Claude Code itself shows in its session picker.
    pub(crate) title: Option<String>,
    /// `/compact` summary (Claude Code's `{type:"summary", summary, leafUuid}`).
    /// Independent from `title` — sessions can have a summary without a title.
    pub(crate) summary: Option<String>,
    /// Most-recent user prompt (Claude Code's re-appended `lastPrompt`).
    /// Used by the UI as a last-resort label when no title/summary exists.
    pub(crate) last_prompt: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) rounds: usize,
    pub(crate) message_count: usize,
    /// Which field `title` came from: "custom" | "ai" | "slug" | None.
    pub(crate) title_source: Option<String>,
}

/// Window size for head/tail metadata scans, mirroring Claude Code's
/// `LITE_READ_BUF_SIZE`. Metadata entries (custom-title, ai-title, summary,
/// last-prompt) are guaranteed by the writer to land within these windows
/// (head for stable fields like cwd/slug, tail for re-appended title/summary).
pub(crate) const LITE_READ_BUF: u64 = 65536;

/// Extract the value of `"<key>":"<value>"` (last occurrence wins) from a JSONL
/// chunk via byte-level scan. Mirrors Claude Code's `extractLastJsonStringField`.
///
/// Operates entirely on bytes (memchr-style) to stay safe on inputs containing
/// non-UTF-8 noise or characters that don't align with naive str-indexing.
/// Returns the unescaped string, or None if the key is absent / malformed.
pub(crate) fn extract_last_json_string_field(text: &str, key: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut last: Option<String> = None;

    let mut try_pattern = |pat: &[u8]| {
        let mut from = 0usize;
        while from + pat.len() <= bytes.len() {
            // Naive substring search — chunks here are 64KB, plenty fast.
            let Some(rel) = bytes[from..].windows(pat.len()).position(|w| w == pat) else {
                break;
            };
            let value_start = from + rel + pat.len();
            // Walk the JSON string body, honoring backslash escapes, until
            // the closing quote.
            let mut i = value_start;
            let mut closed_at: Option<usize> = None;
            while i < bytes.len() {
                match bytes[i] {
                    b'\\' if i + 1 < bytes.len() => {
                        i += 2;
                    }
                    b'"' => {
                        closed_at = Some(i);
                        break;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
            let Some(end) = closed_at else { break };
            // Decode the raw value as lossy UTF-8 (non-UTF-8 bytes become
            // U+FFFD), then unescape common JSON escapes.
            let raw = String::from_utf8_lossy(&bytes[value_start..end]);
            let mut out = String::with_capacity(raw.len());
            let mut chars = raw.chars();
            while let Some(c) = chars.next() {
                if c == '\\' {
                    match chars.next() {
                        Some('n') => out.push('\n'),
                        Some('r') => out.push('\r'),
                        Some('t') => out.push('\t'),
                        Some('"') => out.push('"'),
                        Some('\\') => out.push('\\'),
                        Some('/') => out.push('/'),
                        Some('u') => {
                            // Skip 4 hex digits — we don't bother decoding
                            // \uXXXX since title/summary are plain text.
                            for _ in 0..4 {
                                let _ = chars.next();
                            }
                            out.push('\u{FFFD}');
                        }
                        Some(other) => {
                            out.push('\\');
                            out.push(other);
                        }
                        None => out.push('\\'),
                    }
                } else {
                    out.push(c);
                }
            }
            last = Some(out);
            from = end + 1;
        }
    };

    try_pattern(format!("\"{}\":\"", key).as_bytes());
    try_pattern(format!("\"{}\": \"", key).as_bytes());
    last
}

/// Read the first and last `LITE_READ_BUF` bytes of a file as UTF-8 strings.
/// On overlap (small files) returns the same chunk for both. Lossy decode so
/// non-UTF-8 noise doesn't abort the scan.
pub(crate) fn read_head_tail(path: &Path) -> std::io::Result<(String, String)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    let head_len = std::cmp::min(LITE_READ_BUF, size) as usize;
    let mut head_buf = vec![0u8; head_len];
    file.read_exact(&mut head_buf)?;
    let head = String::from_utf8_lossy(&head_buf).into_owned();
    if size <= LITE_READ_BUF {
        return Ok((head.clone(), head));
    }
    let tail_offset = size - LITE_READ_BUF;
    file.seek(SeekFrom::Start(tail_offset))?;
    let mut tail_buf = vec![0u8; LITE_READ_BUF as usize];
    file.read_exact(&mut tail_buf)?;
    let tail = String::from_utf8_lossy(&tail_buf).into_owned();
    Ok((head, tail))
}

/// Approximate rounds/messages by counting markers inside the head+tail
/// buffers we already loaded. Used purely for UI hints (sidebar badge, sort
/// key, hideEmptySessions filter) — nobody needs exact counts on big files.
/// Avoids the multi-second full-file scan over ~1GB of jsonl on reload.
///
/// Accuracy: exact for sessions that fit within 2*LITE_READ_BUF; for larger
/// sessions we report only what's in head+tail (under-counts the middle).
/// `rounds == 0` is still a reliable "empty session" signal because the
/// first user prompt always lands in the head buffer.
pub(crate) fn count_rounds_and_messages_from_buffers(head: &str, tail: &str) -> (usize, usize) {
    let count_in = |buf: &str| -> (usize, usize) {
        let mut rounds = 0usize;
        let mut messages = 0usize;
        for line in buf.lines() {
            if line.contains("\"type\":\"user\"") {
                rounds += 1;
                messages += 1;
            } else if line.contains("\"type\":\"assistant\"") {
                messages += 1;
            } else if line.contains("\"type\":\"message\"") {
                if line.contains("\"role\":\"user\"") {
                    rounds += 1;
                    messages += 1;
                } else if line.contains("\"role\":\"assistant\"") {
                    messages += 1;
                }
            }
        }
        (rounds, messages)
    };
    let (hr, hm) = count_in(head);
    // For small files, read_head_tail returns the same buffer for both —
    // detect by content equality to avoid double-counting.
    if head == tail {
        return (hr, hm);
    }
    let (tr, tm) = count_in(tail);
    (hr + tr, hm + tm)
}

/// Convert slug like "soft-petting-wave" to "Soft Petting Wave"
pub(crate) fn slug_to_title(slug: &str) -> String {
    slug.split('-')
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Read session metadata using Claude Code's lite-read protocol:
/// scan only the first and last ~64KB of the jsonl. Stable fields (cwd, slug,
/// first-prompt) live in the head; volatile / re-appended fields (customTitle,
/// aiTitle, summary, lastPrompt) live in the tail.
///
/// Why not full-file scan: session jsonl can be tens of MB; iterating every
/// line with JSON parse is the bottleneck of `list_all_sessions` (called for
/// hundreds of files at once). Claude Code's writers guarantee tail re-append
/// for `customTitle`/`tag`/`lastPrompt`; `aiTitle` is written once and may
/// scroll out of tail in long sessions, so we also check head.
///
/// `_max_lines` is retained for source-compat with older callers; ignored.
pub(crate) fn read_session_head(path: &Path, _max_lines: usize) -> SessionHead {
    let empty = SessionHead {
        title: None,
        summary: None,
        last_prompt: None,
        cwd: None,
        rounds: 0,
        message_count: 0,
        title_source: None,
    };
    let (head, tail) = match read_head_tail(path) {
        Ok(ht) => ht,
        Err(_) => return empty,
    };

    let cwd = extract_last_json_string_field(&head, "cwd").filter(|s| !s.is_empty());
    let slug = extract_last_json_string_field(&head, "slug").filter(|s| !s.is_empty());

    // Title precedence (matches Claude Code's readLiteMetadata):
    //   customTitle (tail) > customTitle (head) > aiTitle (tail) > aiTitle (head)
    // Tracks which source supplied the title so the UI can badge it.
    let nonempty = |s: String| if s.trim().is_empty() { None } else { Some(s) };
    let (title, title_source) = if let Some(s) =
        extract_last_json_string_field(&tail, "customTitle")
            .and_then(nonempty)
            .or_else(|| extract_last_json_string_field(&head, "customTitle").and_then(nonempty))
    {
        (Some(s), Some("custom".to_string()))
    } else if let Some(s) = extract_last_json_string_field(&tail, "aiTitle")
        .and_then(nonempty)
        .or_else(|| extract_last_json_string_field(&head, "aiTitle").and_then(nonempty))
    {
        (Some(s), Some("ai".to_string()))
    } else if let Some(s) = slug.as_deref().map(slug_to_title) {
        (Some(s), Some("slug".to_string()))
    } else {
        (None, None)
    };

    // /compact summary lives in the tail (latest leaf wins by virtue of
    // last-occurrence semantics in extract_last_json_string_field).
    let summary = extract_last_json_string_field(&tail, "summary").filter(|s| !s.trim().is_empty());

    // lastPrompt is re-appended by Claude Code on every resume, so the latest
    // copy is in the tail. Strip our internal command/caveat markup so the UI
    // can render it cleanly as a fallback label.
    let last_prompt = extract_last_json_string_field(&tail, "lastPrompt")
        .map(|s| {
            strip_local_command_tags(&restore_slash_command(&s))
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty());

    let (rounds, messages) = count_rounds_and_messages_from_buffers(&head, &tail);
    SessionHead {
        title,
        summary,
        last_prompt,
        cwd,
        rounds,
        message_count: messages,
        title_source,
    }
}

/// Strip Claude Code internal `<local-command-{caveat,stdout,stderr}>...</...>` blocks.
/// These are auto-injected on session start / command execution and are not user content.
pub(crate) fn strip_local_command_tags(content: &str) -> String {
    use regex::Regex;
    lazy_static::lazy_static! {
        static ref LOCAL_RE: Regex = Regex::new(
            r"(?s)<local-command-(?:caveat|stdout|stderr)>.*?</local-command-(?:caveat|stdout|stderr)>"
        ).unwrap();
    }
    LOCAL_RE.replace_all(content, "").to_string()
}

/// Convert <command-message>...</command-message><command-name>/cmd</command-name> to /cmd format
pub(crate) fn restore_slash_command(content: &str) -> String {
    use regex::Regex;
    lazy_static::lazy_static! {
        // Extract command name
        static ref NAME_RE: Regex = Regex::new(r"<command-name>(/[^<]+)</command-name>").unwrap();
        // Extract args (handles multi-line)
        static ref ARGS_RE: Regex = Regex::new(r"(?s)<command-args>(.*?)</command-args>").unwrap();
        // Strip all command-related XML tags
        static ref STRIP_RE: Regex = Regex::new(r"(?s)<command-message>.*?</command-message>|</?command-[^>]*>").unwrap();
    }

    // Extract command name and args first
    let cmd = NAME_RE
        .captures(content)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let args = ARGS_RE
        .captures(content)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty());

    // Build result: command + args, then strip remaining tags
    let prefix = match (cmd, args) {
        (Some(c), Some(a)) => format!("{} {}", c, a),
        (Some(c), None) => c,
        _ => String::new(),
    };

    // Strip all command tags from original content
    let cleaned = STRIP_RE.replace_all(content, "").trim().to_string();

    // If we extracted a command, return it; otherwise return cleaned content
    if prefix.is_empty() {
        cleaned
    } else {
        prefix
    }
}

pub(crate) fn timestamp_to_secs(timestamp: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .and_then(|dt| u64::try_from(dt.timestamp()).ok())
}

pub(crate) fn normalize_message_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn is_codex_context_message(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with("# AGENTS.md instructions for ")
        || trimmed.starts_with("<permissions instructions>")
        || trimmed.starts_with("<app-context>")
        || trimmed.starts_with("<collaboration_mode>")
        || trimmed.starts_with("<apps_instructions>")
        || trimmed.starts_with("<plugins_instructions>")
        || trimmed.contains("<environment_context>")
}

pub(crate) fn collect_jsonl_files_recursive(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files_recursive(&path, out);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

pub(crate) fn collect_codex_session_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for root in [get_codex_sessions_dir(), get_codex_archived_sessions_dir()] {
        if root.exists() {
            collect_jsonl_files_recursive(&root, &mut paths);
        }
    }
    paths
}

pub(crate) fn codex_session_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    if stem.len() >= 36 {
        let id = &stem[stem.len() - 36..];
        if id.matches('-').count() == 4 {
            return Some(id.to_string());
        }
    }
    None
}

pub(crate) fn find_codex_session_path(session_id: &str) -> Option<PathBuf> {
    let suffix = format!("-{}.jsonl", session_id);
    collect_codex_session_paths().into_iter().find(|path| {
        path.file_name()
            .and_then(|n| n.to_str())
            .map(|name| name.ends_with(&suffix))
            .unwrap_or(false)
    })
}

pub(crate) fn codex_payload_message_text(payload: &serde_json::Value) -> String {
    match payload.get("content") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|item| {
                let obj = item.as_object()?;
                match obj.get("type").and_then(|v| v.as_str()) {
                    Some("input_text") | Some("output_text") | Some("text") => {
                        obj.get("text").and_then(|v| v.as_str()).map(String::from)
                    }
                    _ => None,
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub(crate) fn codex_function_arguments(payload: &serde_json::Value) -> serde_json::Value {
    let Some(arguments) = payload.get("arguments").and_then(|v| v.as_str()) else {
        return serde_json::Value::Null;
    };
    serde_json::from_str(arguments)
        .unwrap_or_else(|_| serde_json::Value::String(arguments.to_string()))
}

pub(crate) fn codex_tool_use_block(payload: &serde_json::Value) -> Option<ContentBlock> {
    let name = payload.get("name").and_then(|v| v.as_str())?.to_string();
    let id = payload
        .get("call_id")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("id").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let input_value = codex_function_arguments(payload);
    let summary = summarize_tool_input(&name, &input_value);
    let input = if input_value.is_null() {
        None
    } else {
        Some(json_preview(&input_value, 6000))
    };
    Some(ContentBlock::ToolUse {
        id,
        name,
        summary,
        input,
    })
}

pub(crate) fn codex_custom_tool_use_block(payload: &serde_json::Value) -> Option<ContentBlock> {
    let name = payload.get("name").and_then(|v| v.as_str())?.to_string();
    let id = payload
        .get("call_id")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("id").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let input_value = payload
        .get("input")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let parsed_input = match input_value.as_str() {
        Some(s) => {
            serde_json::from_str(s).unwrap_or_else(|_| serde_json::Value::String(s.to_string()))
        }
        None => input_value,
    };
    let summary = summarize_tool_input(&name, &parsed_input);
    let input = if parsed_input.is_null() {
        None
    } else {
        Some(json_preview(&parsed_input, 6000))
    };
    Some(ContentBlock::ToolUse {
        id,
        name,
        summary,
        input,
    })
}

pub(crate) fn codex_output_text(output: &serde_json::Value) -> String {
    match output {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(obj) => obj
            .get("content")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| json_preview(output, 6000)),
        _ => extract_tool_result_content(output),
    }
}

pub(crate) fn codex_tool_result_block(payload: &serde_json::Value) -> Option<ContentBlock> {
    let tool_use_id = payload
        .get("call_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let output = payload.get("output")?;
    let content = codex_output_text(output);
    let raw = match output {
        serde_json::Value::String(_) => None,
        _ => {
            let preview = json_preview(output, 6000);
            if preview.trim() == content.trim() {
                None
            } else {
                Some(preview)
            }
        }
    };
    Some(ContentBlock::ToolResult {
        tool_use_id,
        content,
        images: None,
        raw,
    })
}

pub(crate) fn codex_reasoning_blocks(payload: &serde_json::Value) -> Option<Vec<ContentBlock>> {
    let mut blocks = Vec::new();
    if let Some(summary) = payload.get("summary").and_then(|v| v.as_array()) {
        for item in summary {
            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                if !text.trim().is_empty() {
                    blocks.push(ContentBlock::Thinking {
                        thinking: text.to_string(),
                    });
                }
            }
        }
    }
    if let Some(content) = payload.get("content").and_then(|v| v.as_array()) {
        for item in content {
            if let Some(text) = item
                .get("text")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("thinking").and_then(|v| v.as_str()))
            {
                if !text.trim().is_empty() {
                    blocks.push(ContentBlock::Thinking {
                        thinking: text.to_string(),
                    });
                }
            }
        }
    }
    if blocks.is_empty() {
        None
    } else {
        Some(blocks)
    }
}
