use super::*;

// ============================================================================
// Claude.ai Web Data Import
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ImportResult {
    pub(crate) conversation_count: usize,
    pub(crate) project_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ClaudeWebConversation {
    pub(crate) uuid: String,
    pub(crate) name: String,
    #[allow(dead_code)]
    pub(crate) summary: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) chat_messages: Vec<ClaudeWebMessage>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ClaudeWebMessage {
    pub(crate) uuid: String,
    #[allow(dead_code)]
    pub(crate) text: Option<String>,
    pub(crate) content: Option<Vec<serde_json::Value>>,
    pub(crate) sender: String,
    pub(crate) created_at: String,
    #[allow(dead_code)]
    pub(crate) updated_at: Option<String>,
    #[allow(dead_code)]
    pub(crate) attachments: Option<Vec<serde_json::Value>>,
    #[allow(dead_code)]
    pub(crate) files: Option<Vec<serde_json::Value>>,
}

/// Convert a claude.ai web message content block to Claude Code compatible format.
/// The web format has extra fields (start_timestamp, stop_timestamp, flags, citations)
/// that we strip, keeping only what Claude Code's parser expects.
pub(crate) fn convert_web_content_block(block: &serde_json::Value) -> Option<serde_json::Value> {
    let obj = block.as_object()?;
    let block_type = obj.get("type").and_then(|v| v.as_str())?;

    match block_type {
        "text" => {
            let text = obj.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if text.is_empty() {
                return None;
            }
            Some(serde_json::json!({
                "type": "text",
                "text": text
            }))
        }
        "thinking" => {
            let thinking = obj.get("thinking").and_then(|v| v.as_str()).unwrap_or("");
            if thinking.is_empty() {
                return None;
            }
            Some(serde_json::json!({
                "type": "thinking",
                "thinking": thinking
            }))
        }
        "tool_use" => {
            let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let input = obj.get("input").cloned().unwrap_or(serde_json::Value::Null);
            Some(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input
            }))
        }
        "tool_result" => {
            let tool_use_id = obj
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // tool_result content can be array of {type, text} or string
            let content = obj
                .get("content")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            // Flatten to string if it's an array of text blocks
            let content_str = match &content {
                serde_json::Value::Array(arr) => arr
                    .iter()
                    .filter_map(|item| {
                        item.as_object()
                            .and_then(|o| o.get("text"))
                            .and_then(|v| v.as_str())
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
                serde_json::Value::String(s) => s.clone(),
                _ => String::new(),
            };
            Some(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": content_str
            }))
        }
        // Skip token_budget and other unknown types
        _ => None,
    }
}

/// Convert a single claude.ai conversation to Claude Code JSONL format
pub(crate) fn convert_conversation_to_jsonl(conv: &ClaudeWebConversation) -> String {
    let mut lines = Vec::new();

    // Summary line
    let summary_line = serde_json::json!({
        "type": "summary",
        "summary": conv.name
    });
    lines.push(serde_json::to_string(&summary_line).unwrap_or_default());

    // Message lines
    for msg in &conv.chat_messages {
        let role = match msg.sender.as_str() {
            "human" => "user",
            "assistant" => "assistant",
            _ => continue,
        };

        // Convert content blocks. claude.ai's detail API returns messages
        // without a `content` array — just a plain `text` field. Fall back to
        // wrapping `text` as a single text block so live-synced conversations
        // render the same way as zip-imported ones.
        let content_blocks: Vec<serde_json::Value> = match msg.content.as_ref() {
            Some(blocks) if !blocks.is_empty() => blocks
                .iter()
                .filter_map(|b| convert_web_content_block(b))
                .collect(),
            _ => {
                if let Some(text) = msg.text.as_deref() {
                    if !text.is_empty() {
                        vec![serde_json::json!({ "type": "text", "text": text })]
                    } else {
                        vec![]
                    }
                } else {
                    vec![]
                }
            }
        };

        // Skip messages with no content
        if content_blocks.is_empty() {
            continue;
        }

        let line = serde_json::json!({
            "type": role,
            "uuid": msg.uuid,
            "timestamp": msg.created_at,
            "message": {
                "role": role,
                "content": content_blocks
            }
        });
        lines.push(serde_json::to_string(&line).unwrap_or_default());
    }

    lines.join("\n")
}

#[tauri::command]
pub(crate) async fn import_claude_web_data(path: String) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = Path::new(&path);

        // Determine if it's a zip or directory
        let conversations_json: String = if source_path.is_dir() {
            // Direct directory - read conversations.json
            let conv_path = source_path.join("conversations.json");
            if !conv_path.exists() {
                return Err("conversations.json not found in directory".to_string());
            }
            fs::read_to_string(&conv_path)
                .map_err(|e| format!("Failed to read conversations.json: {}", e))?
        } else if source_path.extension().map_or(false, |e| e == "zip") {
            // ZIP file - extract conversations.json
            let file =
                fs::File::open(source_path).map_err(|e| format!("Failed to open zip: {}", e))?;
            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;

            // Find conversations.json (might be in a subdirectory)
            let mut found = None;
            for i in 0..archive.len() {
                let entry = archive.by_index(i).map_err(|e| e.to_string())?;
                if entry.name().ends_with("conversations.json") {
                    found = Some(i);
                    break;
                }
            }

            let idx = found.ok_or("conversations.json not found in zip")?;
            let mut entry = archive.by_index(idx).map_err(|e| e.to_string())?;
            let mut content = String::new();
            std::io::Read::read_to_string(&mut entry, &mut content)
                .map_err(|e| format!("Failed to read conversations.json from zip: {}", e))?;
            content
        } else {
            return Err("Path must be a directory or .zip file".to_string());
        };

        // Parse conversations
        let conversations: Vec<ClaudeWebConversation> =
            serde_json::from_str(&conversations_json)
                .map_err(|e| format!("Failed to parse conversations.json: {}", e))?;

        // Create target project directory
        let project_id = "-claude-ai".to_string();
        let project_dir = get_claude_dir().join("projects").join(&project_id);
        fs::create_dir_all(&project_dir)
            .map_err(|e| format!("Failed to create project directory: {}", e))?;

        // Save display name from source path
        let display_name = Path::new(&path)
            .file_stem()
            .or_else(|| Path::new(&path).file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "claude.ai".to_string());
        let _ = fs::write(project_dir.join(".display_name"), &display_name);

        let mut count = 0;

        for conv in &conversations {
            // Skip empty conversations
            if conv.chat_messages.is_empty() {
                continue;
            }

            let jsonl_content = convert_conversation_to_jsonl(conv);
            if jsonl_content.is_empty() {
                continue;
            }

            let session_file = project_dir.join(format!("{}.jsonl", conv.uuid));
            fs::write(&session_file, &jsonl_content)
                .map_err(|e| format!("Failed to write session {}: {}", conv.uuid, e))?;

            // Set file modification time to match conversation's updated_at
            if let Ok(updated) = chrono::DateTime::parse_from_rfc3339(&conv.updated_at) {
                let ft = filetime::FileTime::from_unix_time(updated.timestamp(), 0);
                let _ = filetime::set_file_mtime(&session_file, ft);
            }

            count += 1;
        }

        // Save import metadata
        let import_meta = serde_json::json!({
            "source": path,
            "imported_at": chrono::Utc::now().to_rfc3339(),
            "conversation_count": count
        });
        let meta_path = get_lovstudio_dir().join("claude-web-imports.json");
        let mut imports: Vec<serde_json::Value> = if meta_path.exists() {
            serde_json::from_str(&fs::read_to_string(&meta_path).unwrap_or_default())
                .unwrap_or_default()
        } else {
            vec![]
        };
        imports.push(import_meta);
        let _ = fs::write(
            &meta_path,
            serde_json::to_string_pretty(&imports).unwrap_or_default(),
        );

        Ok(ImportResult {
            conversation_count: count,
            project_id,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
pub(crate) struct WebSyncResult {
    pub fetched: usize,
    pub skipped_unchanged: usize,
    pub failed: usize,
    pub project_id: String,
}

/// Live-sync claude.ai conversations using the Claude desktop app's session cookie.
///
/// Stateless incremental: lists all conversations' metadata from the API,
/// compares each conversation's `updated_at` against the local jsonl file's
/// mtime, only re-downloads when newer. Failures on individual conversations
/// are counted but don't abort the run.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct WebSyncProgress {
    pub(crate) total: usize,
    pub(crate) processed: usize,
    pub(crate) fetched: usize,
    pub(crate) skipped: usize,
    pub(crate) failed: usize,
}

#[tauri::command]
pub(crate) async fn sync_claude_web_conversations(
    app_handle: tauri::AppHandle,
) -> Result<WebSyncResult, String> {
    eprintln!("[web-sync] step 1: reading & decrypting cookies");
    // 1. Read & decrypt cookies (blocking work)
    let cookies = tauri::async_runtime::spawn_blocking(claude_web_sync::read_claude_app_cookies)
        .await
        .map_err(|e| e.to_string())??;
    eprintln!("[web-sync] step 1 ok, got {} cookies", cookies.len());
    let session_key = cookies
        .get("sessionKey")
        .ok_or_else(|| {
            "sessionKey cookie not found — log into Claude desktop app first".to_string()
        })?
        .clone();
    eprintln!("[web-sync] sessionKey length = {}", session_key.len());
    let active_org = cookies.get("lastActiveOrg").cloned();
    eprintln!("[web-sync] lastActiveOrg cookie = {:?}", active_org);

    // 2. HTTP client with timeouts so we never hang
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let cookie_header = format!("sessionKey={}", session_key);

    // 3. Resolve org_id — always fetch from API since the cookie value is
    // URL-encoded JSON and unreliable to parse.
    eprintln!("[web-sync] step 3: GET /api/organizations");
    let org_id = {
        let resp = client
            .get("https://claude.ai/api/organizations")
            .header(reqwest::header::COOKIE, &cookie_header)
            .send()
            .await
            .map_err(|e| format!("fetch orgs: {}", e))?;
        let status = resp.status();
        eprintln!("[web-sync] orgs status: {}", status);
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "fetch orgs: HTTP {} — {}",
                status,
                body.chars().take(200).collect::<String>()
            ));
        }
        let orgs: Vec<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("parse orgs: {}", e))?;
        eprintln!("[web-sync] orgs count: {}", orgs.len());
        let id = orgs
            .first()
            .and_then(|o| o.get("uuid").and_then(|v| v.as_str()))
            .map(String::from)
            .ok_or_else(|| "no organizations found for this account".to_string())?;
        // Prefer the cookie value if it's a clean uuid; otherwise use API result.
        match active_org {
            Some(o) if o.len() == 36 && o.chars().all(|c| c.is_ascii_hexdigit() || c == '-') => o,
            _ => id,
        }
    };
    eprintln!("[web-sync] org_id = {}", org_id);

    // 4. List conversations (lightweight metadata)
    let list_url = format!(
        "https://claude.ai/api/organizations/{}/chat_conversations",
        org_id
    );
    eprintln!("[web-sync] step 4: GET {}", list_url);
    let resp = client
        .get(&list_url)
        .header(reqwest::header::COOKIE, &cookie_header)
        .send()
        .await
        .map_err(|e| format!("list conversations: {}", e))?;
    let status = resp.status();
    eprintln!("[web-sync] list status: {}", status);
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "list conversations: HTTP {} — {}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }
    let conv_list: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("parse conversation list: {}", e))?;
    eprintln!("[web-sync] got {} conversations from API", conv_list.len());

    // Cache web starred conversation uuids to disk so the frontend pin sync
    // can pick them up alongside Claude Code starredIds.
    let web_starred: Vec<String> = conv_list
        .iter()
        .filter(|c| {
            c.get("is_starred")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .filter_map(|c| c.get("uuid").and_then(|v| v.as_str()).map(String::from))
        .collect();
    let cache_path = get_lovstudio_dir().join("claude-web-starred.json");
    if let Some(parent) = cache_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &cache_path,
        serde_json::to_string(&web_starred).unwrap_or_else(|_| "[]".into()),
    );
    eprintln!(
        "[web-sync] cached {} web-starred conversations",
        web_starred.len()
    );

    // 5. Prepare project dir
    let project_id = "-claude-ai".to_string();
    let project_dir = get_claude_dir().join("projects").join(&project_id);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;
    if !project_dir.join(".display_name").exists() {
        let _ = std::fs::write(project_dir.join(".display_name"), "claude.ai");
    }

    // 6. Build the list of conversations that need fetching (skip fresh ones)
    let total = conv_list.len();
    let mut to_fetch: Vec<(String, String)> = Vec::new(); // (uuid, updated_at)
    let mut skipped = 0usize;
    for conv in &conv_list {
        let Some(uuid) = conv.get("uuid").and_then(|v| v.as_str()) else {
            continue;
        };
        let updated_at = conv
            .get("updated_at")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let session_file = project_dir.join(format!("{}.jsonl", uuid));
        if is_local_fresh_for_remote(&session_file, updated_at) {
            skipped += 1;
            continue;
        }
        to_fetch.push((uuid.to_string(), updated_at.to_string()));
    }

    let _ = app_handle.emit(
        "web-sync-progress",
        WebSyncProgress {
            total,
            processed: skipped,
            fetched: 0,
            skipped,
            failed: 0,
        },
    );
    eprintln!(
        "[web-sync] {} to fetch ({} skipped fresh)",
        to_fetch.len(),
        skipped
    );

    // 7. Fetch concurrently with bounded parallelism. claude.ai usually tolerates
    // a handful of in-flight detail requests; 6 keeps us well clear of rate limits
    // while finishing 300+ conversations in minutes instead of hours.
    use futures::stream::StreamExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    let fetched_counter = std::sync::Arc::new(AtomicUsize::new(0));
    let failed_counter = std::sync::Arc::new(AtomicUsize::new(0));
    let processed_counter = std::sync::Arc::new(AtomicUsize::new(skipped));
    let project_dir = std::sync::Arc::new(project_dir);
    let cookie_header = std::sync::Arc::new(cookie_header);
    let org_id = std::sync::Arc::new(org_id);
    let client = std::sync::Arc::new(client);
    let app_handle = std::sync::Arc::new(app_handle);

    const CONCURRENCY: usize = 6;
    let mut stream = futures::stream::iter(to_fetch.into_iter().map(|(uuid, updated_at)| {
        let client = client.clone();
        let cookie_header = cookie_header.clone();
        let org_id = org_id.clone();
        let project_dir = project_dir.clone();
        let fetched = fetched_counter.clone();
        let failed = failed_counter.clone();
        let processed = processed_counter.clone();
        let app_handle = app_handle.clone();
        async move {
            let session_file = project_dir.join(format!("{}.jsonl", uuid));
            let detail_url = format!(
                "https://claude.ai/api/organizations/{}/chat_conversations/{}?rendering_mode=raw",
                org_id, uuid,
            );
            let result: Result<(), String> = (async {
                let resp = client
                    .get(&detail_url)
                    .header(reqwest::header::COOKIE, cookie_header.as_str())
                    .send()
                    .await
                    .map_err(|e| format!("send: {}", e))?;
                if !resp.status().is_success() {
                    return Err(format!("HTTP {}", resp.status()));
                }
                let detail_value: serde_json::Value =
                    resp.json().await.map_err(|e| format!("parse: {}", e))?;

                // DEBUG: dump the very first response to a temp file so we can
                // inspect the actual schema of the detail endpoint.
                let dump_path = std::env::temp_dir().join("lovcode-web-detail-sample.json");
                if !dump_path.exists() {
                    let _ = std::fs::write(
                        &dump_path,
                        serde_json::to_string_pretty(&detail_value).unwrap_or_default(),
                    );
                    eprintln!("[web-sync] dumped sample to {}", dump_path.display());
                }

                let conv_struct: ClaudeWebConversation =
                    serde_json::from_value(detail_value.clone())
                        .map_err(|e| format!("struct: {}", e))?;
                if conv_struct.chat_messages.is_empty() {
                    let top_keys: Vec<&str> = detail_value
                        .as_object()
                        .map(|m| m.keys().map(|s| s.as_str()).collect())
                        .unwrap_or_default();
                    eprintln!(
                        "[web-sync] {} has empty chat_messages; top keys = {:?}",
                        uuid, top_keys
                    );
                    return Ok(()); // empty — counted as success no-op
                }
                let jsonl = convert_conversation_to_jsonl(&conv_struct);
                if jsonl.is_empty() {
                    return Err("empty jsonl after conversion".to_string());
                }
                std::fs::write(&session_file, &jsonl).map_err(|e| format!("write: {}", e))?;
                if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&updated_at) {
                    let ft = filetime::FileTime::from_unix_time(t.timestamp(), 0);
                    let _ = filetime::set_file_mtime(&session_file, ft);
                }
                Ok(())
            })
            .await;

            match result {
                Ok(()) => {
                    fetched.fetch_add(1, Ordering::Relaxed);
                }
                Err(e) => {
                    eprintln!("[web-sync] {} failed: {}", uuid, e);
                    failed.fetch_add(1, Ordering::Relaxed);
                }
            }
            let p = processed.fetch_add(1, Ordering::Relaxed) + 1;
            if p % 5 == 0 || p == total {
                let _ = app_handle.emit(
                    "web-sync-progress",
                    WebSyncProgress {
                        total,
                        processed: p,
                        fetched: fetched.load(Ordering::Relaxed),
                        skipped,
                        failed: failed.load(Ordering::Relaxed),
                    },
                );
            }
        }
    }))
    .buffer_unordered(CONCURRENCY);

    while stream.next().await.is_some() {}

    let fetched = fetched_counter.load(Ordering::Relaxed);
    let failed = failed_counter.load(Ordering::Relaxed);
    eprintln!(
        "[web-sync] done: fetched={} skipped={} failed={}",
        fetched, skipped, failed
    );
    let _ = app_handle.emit(
        "web-sync-progress",
        WebSyncProgress {
            total,
            processed: total,
            fetched,
            skipped,
            failed,
        },
    );

    Ok(WebSyncResult {
        fetched,
        skipped_unchanged: skipped,
        failed,
        project_id,
    })
}

/// Debug command: fetch the raw API response for a single conversation and
/// dump it to /tmp/lovcode-web-probe.json. Use to inspect the real schema.
pub(crate) async fn debug_probe_claude_web(uuid: String) -> Result<String, String> {
    let cookies = tauri::async_runtime::spawn_blocking(claude_web_sync::read_claude_app_cookies)
        .await
        .map_err(|e| e.to_string())??;
    let session_key = cookies
        .get("sessionKey")
        .ok_or_else(|| "no sessionKey".to_string())?
        .clone();
    let active_org = cookies.get("lastActiveOrg").cloned();

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let cookie_header = format!("sessionKey={}", session_key);

    let org_id = active_org.ok_or_else(|| "no lastActiveOrg cookie".to_string())?;

    // Try multiple endpoint variants
    let urls = vec![
        format!("https://claude.ai/api/organizations/{}/chat_conversations/{}", org_id, uuid),
        format!("https://claude.ai/api/organizations/{}/chat_conversations/{}?rendering_mode=raw", org_id, uuid),
        format!("https://claude.ai/api/organizations/{}/chat_conversations/{}?tree=True&rendering_mode=raw", org_id, uuid),
        format!("https://claude.ai/api/organizations/{}/chat_conversations/{}?tree=False&rendering_mode=raw", org_id, uuid),
    ];

    let mut report = String::new();
    for (i, url) in urls.iter().enumerate() {
        report.push_str(&format!("\n=== variant {}: {} ===\n", i, url));
        let resp = match client
            .get(url)
            .header(reqwest::header::COOKIE, &cookie_header)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                report.push_str(&format!("send err: {}\n", e));
                continue;
            }
        };
        let status = resp.status();
        report.push_str(&format!("status: {}\n", status));
        let text = resp.text().await.unwrap_or_default();
        report.push_str(&format!("body len: {} bytes\n", text.len()));

        // Save first variant's body fully for schema inspection
        if i == 0 {
            let _ = std::fs::write("/tmp/lovcode-web-probe.json", &text);
        }

        // Try to parse + count chat_messages
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(obj) = v.as_object() {
                let keys: Vec<&str> = obj.keys().map(|s| s.as_str()).collect();
                report.push_str(&format!("top keys: {:?}\n", keys));
                if let Some(cm) = obj.get("chat_messages").and_then(|v| v.as_array()) {
                    report.push_str(&format!("chat_messages.len: {}\n", cm.len()));
                    if let Some(first) = cm.first().and_then(|v| v.as_object()) {
                        let mk: Vec<&str> = first.keys().map(|s| s.as_str()).collect();
                        report.push_str(&format!("first message keys: {:?}\n", mk));
                    }
                }
                // Also look for alternative field names
                for alt in &[
                    "messages",
                    "current_leaf_message",
                    "chat_messages_leaf",
                    "tree",
                ] {
                    if obj.contains_key(*alt) {
                        report.push_str(&format!("HAS field [{}]\n", alt));
                    }
                }
            }
        } else {
            report.push_str(&format!(
                "non-JSON body head: {:?}\n",
                text.chars().take(200).collect::<String>()
            ));
        }
    }

    let _ = std::fs::write("/tmp/lovcode-web-probe-report.txt", &report);
    Ok(report)
}
