use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

static SESSION_STREAM_CANCELS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_session_stream(stream_id: &str) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    let mut streams = SESSION_STREAM_CANCELS.lock().unwrap();
    if let Some(previous) = streams.insert(stream_id.to_string(), token.clone()) {
        previous.store(true, Ordering::Relaxed);
    }
    token
}

fn unregister_session_stream(stream_id: &str, token: &Arc<AtomicBool>) {
    let mut streams = SESSION_STREAM_CANCELS.lock().unwrap();
    let should_remove = streams
        .get(stream_id)
        .map(|current| Arc::ptr_eq(current, token))
        .unwrap_or(false);
    if should_remove {
        streams.remove(stream_id);
    }
}

#[tauri::command]
pub(crate) fn cancel_session_stream(stream_id: String) -> Result<(), String> {
    if let Some(token) = SESSION_STREAM_CANCELS.lock().unwrap().remove(&stream_id) {
        token.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ============================================================================
// Sessions cache (B): persist computed Session list keyed by (path,size,mtime)
// so cold reload doesn't re-read 1000+ jsonl files. Entries whose stat hasn't
// changed are reused verbatim; only new/modified files run read_session_head.
// Cache lives at ~/.lovstudio/lovcode/sessions-cache.json.
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SessionCacheEntry {
    pub(crate) path: String,
    pub(crate) size: u64,
    pub(crate) mtime: u64,
    pub(crate) session: Session,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct SessionsCache {
    /// Bumped whenever Session shape / read_session_head logic changes so old
    /// cache files are silently discarded.
    pub(crate) version: u32,
    pub(crate) entries: Vec<SessionCacheEntry>,
}

pub(crate) const SESSIONS_CACHE_VERSION: u32 = 2;

pub(crate) fn sessions_cache_path() -> PathBuf {
    get_lovstudio_dir().join("sessions-cache.json")
}

pub(crate) fn load_sessions_cache() -> HashMap<String, SessionCacheEntry> {
    let path = sessions_cache_path();
    let Ok(bytes) = fs::read(&path) else {
        return HashMap::new();
    };
    let Ok(cache) = serde_json::from_slice::<SessionsCache>(&bytes) else {
        return HashMap::new();
    };
    if cache.version != SESSIONS_CACHE_VERSION {
        return HashMap::new();
    }
    cache
        .entries
        .into_iter()
        .map(|e| (e.path.clone(), e))
        .collect()
}

pub(crate) fn save_sessions_cache(entries: Vec<SessionCacheEntry>) {
    let path = sessions_cache_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let cache = SessionsCache {
        version: SESSIONS_CACHE_VERSION,
        entries,
    };
    if let Ok(bytes) = serde_json::to_vec(&cache) {
        let _ = fs::write(&path, bytes);
    }
}

/// Core sync logic: build the full Session list (cli + app sources, deduped,
/// sorted desc by last_modified). Used by both the bulk command and the
/// streamed command — they only differ in how they ship the result back.
pub(crate) fn compute_all_sessions() -> Vec<Session> {
    let projects_dir = get_claude_dir().join("projects");
    if !projects_dir.exists() {
        return Vec::new();
    }
    let history_index = build_session_index_from_history();
    let cache = load_sessions_cache();
    // Collected during pass1/pass2 (cache hits + fresh reads alike) so we
    // can persist the up-to-date set after this run. Mutex<Vec> is fine —
    // contention is low (one push per file).
    let new_cache_entries: std::sync::Mutex<Vec<SessionCacheEntry>> =
        std::sync::Mutex::new(Vec::new());

    use rayon::prelude::*;

    // First pass: use history index for sessions with sessionId.
    // Parallelized: read_session_head is ~16ms each (head+tail IO + UTF-8
    // decode + regex), serial loop over 1000+ files dominates wall time.
    let pass1_inputs: Vec<(String, String, u64)> = history_index
        .iter()
        .map(|((p, s), (ts, _))| (p.clone(), s.clone(), *ts))
        .collect();

    let mut all_sessions: Vec<Session> = pass1_inputs
        .par_iter()
        .filter_map(|(project_id, session_id, timestamp)| {
            let session_path = projects_dir
                .join(project_id)
                .join(format!("{}.jsonl", session_id));
            let metadata = fs::metadata(&session_path).ok()?;
            let size = metadata.len();
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            // Cache hit: file size & mtime unchanged → reuse stored Session.
            let path_key = session_path.to_string_lossy().into_owned();
            if let Some(entry) = cache.get(&path_key) {
                if entry.size == size && entry.mtime == mtime {
                    let s = entry.session.clone();
                    new_cache_entries.lock().unwrap().push(SessionCacheEntry {
                        path: path_key,
                        size,
                        mtime,
                        session: s.clone(),
                    });
                    return Some(s);
                }
            }

            let head = read_session_head(&session_path, 20);
            let final_summary = head.summary;

            let last_modified = if mtime > 0 { mtime } else { *timestamp / 1000 };
            let created_at = metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(last_modified);

            let display_path = head
                .cwd
                .clone()
                .unwrap_or_else(|| decode_project_path(project_id));

            let session = Session {
                id: session_id.clone(),
                project_id: project_id.clone(),
                project_path: Some(display_path),
                title: head.title,
                summary: final_summary,
                last_prompt: head.last_prompt,
                title_source: head.title_source,
                rounds: head.rounds,
                message_count: head.message_count,
                created_at,
                last_modified,
                usage: None,
                source: "cli".to_string(),
            };
            new_cache_entries.lock().unwrap().push(SessionCacheEntry {
                path: path_key,
                size,
                mtime,
                session: session.clone(),
            });
            Some(session)
        })
        .collect();

    // Build seen-set from successful pass1 entries for pass2/pass3 dedup.
    let mut seen_sessions: std::collections::HashSet<(String, String)> = all_sessions
        .iter()
        .map(|s| (s.project_id.clone(), s.id.clone()))
        .collect();

    // Second pass: scan for sessions not in history (older sessions without sessionId).
    // Collect candidate (project_id, display_path, session_path, session_id) tuples
    // serially (cheap dir walk), then process them in parallel.
    let mut pass2_candidates: Vec<(String, String, std::path::PathBuf, String)> = Vec::new();
    for project_entry in fs::read_dir(&projects_dir).into_iter().flatten().flatten() {
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

        for entry in fs::read_dir(&project_path).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if !name.ends_with(".jsonl") || name.starts_with("agent-") {
                continue;
            }
            let session_id = name.trim_end_matches(".jsonl").to_string();
            if seen_sessions.contains(&(project_id.clone(), session_id.clone())) {
                continue;
            }
            pass2_candidates.push((project_id.clone(), display_path.clone(), path, session_id));
        }
    }

    let pass2_sessions: Vec<Session> = pass2_candidates
        .par_iter()
        .filter_map(|(project_id, display_path, path, session_id)| {
            let metadata = fs::metadata(path).ok()?;
            let size = metadata.len();
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let path_key = path.to_string_lossy().into_owned();
            if let Some(entry) = cache.get(&path_key) {
                if entry.size == size && entry.mtime == mtime {
                    let s = entry.session.clone();
                    new_cache_entries.lock().unwrap().push(SessionCacheEntry {
                        path: path_key,
                        size,
                        mtime,
                        session: s.clone(),
                    });
                    return Some(s);
                }
            }

            let head = read_session_head(path, 20);
            let session_path = head.cwd.clone().unwrap_or_else(|| display_path.clone());

            let last_modified = mtime;
            let created_at = metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(last_modified);

            let session = Session {
                id: session_id.clone(),
                project_id: project_id.clone(),
                project_path: Some(session_path),
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
            };
            new_cache_entries.lock().unwrap().push(SessionCacheEntry {
                path: path_key,
                size,
                mtime,
                session: session.clone(),
            });
            Some(session)
        })
        .collect();
    all_sessions.extend(pass2_sessions);

    // Third pass: Claude desktop app Code tab sessions
    // ~/Library/Application Support/Claude/claude-code-sessions/<deviceId>/<accountId>/local_*.json
    // These have richer metadata (title, cwd, lastActivityAt) and link to the same CLI .jsonl files.
    if let Some(home) = dirs::home_dir() {
        let app_sessions_root = home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude-code-sessions");
        if app_sessions_root.exists() {
            // walk deviceId / accountId levels
            for device_entry in fs::read_dir(&app_sessions_root)
                .into_iter()
                .flatten()
                .flatten()
            {
                for account_entry in fs::read_dir(device_entry.path())
                    .into_iter()
                    .flatten()
                    .flatten()
                {
                    for file_entry in fs::read_dir(account_entry.path())
                        .into_iter()
                        .flatten()
                        .flatten()
                    {
                        let file_path = file_entry.path();
                        let fname = file_path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        if !fname.starts_with("local_") || !fname.ends_with(".json") {
                            continue;
                        }
                        let Ok(content) = fs::read_to_string(&file_path) else {
                            continue;
                        };
                        let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) else {
                            continue;
                        };

                        let cli_session_id = match meta.get("cliSessionId").and_then(|v| v.as_str())
                        {
                            Some(id) => id.to_string(),
                            None => continue,
                        };
                        let cwd = match meta.get("cwd").and_then(|v| v.as_str()) {
                            Some(p) => p.to_string(),
                            None => continue,
                        };

                        // Claude CLI encodes non-ASCII chars (e.g. 手工川 -> ----) in
                        // a lossy way that cannot be reversed by string substitution.
                        // Instead, scan project_dirs for the dir containing this jsonl.
                        let jsonl_filename = format!("{}.jsonl", cli_session_id);
                        let project_id =
                            match seen_sessions.iter().find(|(_, sid)| sid == &cli_session_id) {
                                Some((pid, _)) => pid.clone(),
                                None => {
                                    // Fall back to filesystem scan
                                    let mut found = None;
                                    if let Ok(entries) = fs::read_dir(&projects_dir) {
                                        for e in entries.flatten() {
                                            if e.path().join(&jsonl_filename).exists() {
                                                found = Some(
                                                    e.file_name().to_string_lossy().to_string(),
                                                );
                                                break;
                                            }
                                        }
                                    }
                                    // Last resort: synthesize encoded id (works for ASCII-only paths)
                                    found.unwrap_or_else(|| encode_project_path(&cwd))
                                }
                            };

                        // Skip if CLI already loaded this session with better data
                        if seen_sessions.contains(&(project_id.clone(), cli_session_id.clone())) {
                            // Upgrade title if app has one and CLI didn't
                            if let Some(s) = all_sessions
                                .iter_mut()
                                .find(|s| s.id == cli_session_id && s.project_id == project_id)
                            {
                                if s.title.is_none() {
                                    s.title = meta
                                        .get("title")
                                        .and_then(|v| v.as_str())
                                        .map(|t| t.to_string());
                                }
                                s.source = "app-code".to_string();
                            }
                            continue;
                        }

                        // Find the CLI .jsonl to get rounds / message_count
                        let jsonl_path = projects_dir.join(&project_id).join(&jsonl_filename);
                        let (rounds, message_count, jsonl_modified, jsonl_created) =
                            if jsonl_path.exists() {
                                let head = read_session_head(&jsonl_path, 20);
                                let metadata = fs::metadata(&jsonl_path).ok();
                                let modified = metadata
                                    .as_ref()
                                    .and_then(|m| m.modified().ok())
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs())
                                    .unwrap_or(0);
                                let created = metadata
                                    .as_ref()
                                    .and_then(|m| m.created().ok())
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs())
                                    .unwrap_or(modified);
                                (head.rounds, head.message_count, modified, created)
                            } else {
                                (0, 0, 0, 0)
                            };

                        let last_activity_ms = meta
                            .get("lastActivityAt")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let last_modified = if jsonl_modified > 0 {
                            jsonl_modified
                        } else {
                            last_activity_ms / 1000
                        };
                        let created_at = if jsonl_created > 0 {
                            jsonl_created
                        } else {
                            meta.get("createdAt")
                                .and_then(|v| v.as_u64())
                                .map(|ms| ms / 1000)
                                .unwrap_or(last_modified)
                        };

                        let title = meta
                            .get("title")
                            .and_then(|v| v.as_str())
                            .map(|t| t.to_string());
                        let title_source = if title.is_some() {
                            Some("custom".to_string())
                        } else {
                            None
                        };

                        seen_sessions.insert((project_id.clone(), cli_session_id.clone()));
                        all_sessions.push(Session {
                            id: cli_session_id,
                            project_id,
                            project_path: Some(cwd),
                            title,
                            summary: None,
                            last_prompt: None,
                            title_source,
                            rounds,
                            message_count,
                            created_at,
                            last_modified,
                            usage: None,
                            source: "app-code".to_string(),
                        });
                    }
                }
            }
        }
    }

    // Mark sessions living under the synthetic "-claude-ai" project as
    // app-web (synced from claude.ai). This stays after the desktop-app
    // Code pass so app-code wins if the same id ever appeared in both
    // (shouldn't happen — different id space — but defensive).
    for s in all_sessions.iter_mut() {
        if s.project_id == "-claude-ai" && s.source == "cli" {
            s.source = "app-web".to_string();
        }
    }

    // Fourth pass: Codex Desktop / CLI rollout sessions.
    let codex_paths = collect_codex_session_paths();
    let codex_sessions: Vec<Session> = codex_paths
        .par_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(path).ok()?;
            let size = metadata.len();
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let path_key = path.to_string_lossy().into_owned();
            if let Some(entry) = cache.get(&path_key) {
                if entry.size == size && entry.mtime == mtime {
                    let s = entry.session.clone();
                    new_cache_entries.lock().unwrap().push(SessionCacheEntry {
                        path: path_key,
                        size,
                        mtime,
                        session: s.clone(),
                    });
                    return Some(s);
                }
            }

            let session = build_codex_session(path)?;
            new_cache_entries.lock().unwrap().push(SessionCacheEntry {
                path: path_key,
                size,
                mtime,
                session: session.clone(),
            });
            Some(session)
        })
        .collect();
    all_sessions.extend(codex_sessions);

    // De-duplicate by session id. The same cliSessionId can be registered
    // from multiple passes if its project path encodes inconsistently
    // (e.g. CLI uses a different lossy encoding than ours for non-ASCII
    // cwds). When duplicates appear, keep the entry with the most
    // complete data (highest rounds, prefer source=app for title).
    let mut by_id: std::collections::HashMap<String, Session> = std::collections::HashMap::new();
    for s in all_sessions.into_iter() {
        let key = if s.source == "codex" {
            format!("codex:{}", s.id)
        } else {
            s.id.clone()
        };
        match by_id.get(&key) {
            Some(existing) => {
                let existing_path_exists = existing
                    .project_path
                    .as_deref()
                    .is_some_and(|path| Path::new(path).is_dir());
                let new_path_exists = s
                    .project_path
                    .as_deref()
                    .is_some_and(|path| Path::new(path).is_dir());
                let app_metadata_upgrade =
                    s.source.starts_with("app") && !existing.source.starts_with("app");
                let take_new = s.rounds > existing.rounds
                    || (app_metadata_upgrade && (new_path_exists || !existing_path_exists));
                if take_new {
                    let merged = Session {
                        title: s.title.clone().or_else(|| existing.title.clone()),
                        summary: s.summary.clone().or_else(|| existing.summary.clone()),
                        ..s
                    };
                    by_id.insert(key, merged);
                } else if app_metadata_upgrade {
                    let merged = Session {
                        title: s.title.clone().or_else(|| existing.title.clone()),
                        summary: s.summary.clone().or_else(|| existing.summary.clone()),
                        source: s.source.clone(),
                        ..existing.clone()
                    };
                    by_id.insert(key, merged);
                }
            }
            None => {
                by_id.insert(key, s);
            }
        }
    }
    let mut all_sessions: Vec<Session> = by_id.into_values().collect();

    all_sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    let entries = new_cache_entries.into_inner().unwrap();
    save_sessions_cache(entries);

    all_sessions
}

/// Single-flight guard: when a webview reload races with the previous instance
/// (or multiple components mount in parallel), every caller would otherwise
/// trigger its own `compute_all_sessions` (1+ second of disk IO + 1MB JSON
/// serialization × N). This serializes them — the first call computes, the
/// rest await the same Mutex and reuse the cached result if it's fresh.
pub(crate) static SESSIONS_INFLIGHT: std::sync::OnceLock<
    tokio::sync::Mutex<Option<(std::time::Instant, Vec<Session>)>>,
> = std::sync::OnceLock::new();

pub(crate) const SESSIONS_CACHE_TTL_MS: u128 = 3000;

pub(crate) fn emit_sessions_changed_with_fresh_cache(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = compute_all_sessions_dedup().await;
        let _ = app_handle.emit("sessions-changed", ());
    });
}

pub(crate) async fn compute_all_sessions_dedup() -> Vec<Session> {
    let lock = SESSIONS_INFLIGHT.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut guard = lock.lock().await;
    if let Some((computed_at, ref cached)) = *guard {
        if computed_at.elapsed().as_millis() < SESSIONS_CACHE_TTL_MS {
            return cached.clone();
        }
    }
    let fresh = tauri::async_runtime::spawn_blocking(compute_all_sessions)
        .await
        .unwrap_or_default();
    *guard = Some((std::time::Instant::now(), fresh.clone()));
    fresh
}

#[tauri::command]
pub(crate) async fn list_all_sessions() -> Result<Vec<Session>, String> {
    Ok(compute_all_sessions_dedup().await)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum SessionStreamEvent {
    /// One batch of sessions — front-end appends as they arrive.
    Batch { sessions: Vec<Session> },
    /// All batches sent. Front-end can flip loading=false for sure.
    Done { total: usize },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionFileActivityRequest {
    pub(crate) project_id: String,
    pub(crate) session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionFileActivity {
    pub(crate) project_id: String,
    pub(crate) session_id: String,
    pub(crate) modified_at: u64,
    pub(crate) size: u64,
}

/// Streamed variant of list_all_sessions. The Rust side still computes the
/// full list (sorted), then ships it to the webview in 200-session batches
/// over a Tauri Channel — each batch is a separate IPC message, so the
/// webview can render the first slice (~200 most-recent sessions) within a
/// few hundred ms instead of waiting for the whole 5-6s JSON.parse.
#[tauri::command]
pub(crate) async fn list_all_sessions_streamed(
    stream_id: String,
    on_event: Channel<SessionStreamEvent>,
) -> Result<(), String> {
    let token = register_session_stream(&stream_id);

    tauri::async_runtime::spawn(async move {
        let mut all = compute_all_sessions_dedup().await;
        if token.load(Ordering::Relaxed) {
            unregister_session_stream(&stream_id, &token);
            return;
        }

        let total = all.len();
        let send_token = token.clone();
        let send_stream_id = stream_id.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            const BATCH: usize = 200;
            // Drain front-to-back so the most-recent sessions ship first
            // (compute_all_sessions sorts desc by last_modified).
            while !all.is_empty() {
                if send_token.load(Ordering::Relaxed) {
                    return;
                }
                let take = std::cmp::min(BATCH, all.len());
                let batch: Vec<Session> = all.drain(..take).collect();
                if on_event
                    .send(SessionStreamEvent::Batch { sessions: batch })
                    .is_err()
                {
                    send_token.store(true, Ordering::Relaxed);
                    return;
                }
            }
            if !send_token.load(Ordering::Relaxed) {
                let _ = on_event.send(SessionStreamEvent::Done { total });
            }
        })
        .await;

        unregister_session_stream(&send_stream_id, &token);
    });

    Ok(())
}

#[tauri::command]
pub(crate) async fn get_session_file_activity(
    sessions: Vec<SessionFileActivityRequest>,
) -> Result<Vec<SessionFileActivity>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut codex_paths_by_id: Option<HashMap<String, PathBuf>> = None;
        let mut result = Vec::with_capacity(sessions.len());

        for session in sessions {
            let claude_path = get_session_path(&session.project_id, &session.session_id);
            let path = if claude_path.exists() {
                Some(claude_path)
            } else {
                if codex_paths_by_id.is_none() {
                    codex_paths_by_id = Some(
                        collect_codex_session_paths()
                            .into_iter()
                            .filter_map(|path| {
                                codex_session_id_from_path(&path).map(|id| (id, path))
                            })
                            .collect(),
                    );
                }
                codex_paths_by_id
                    .as_ref()
                    .and_then(|paths| paths.get(&session.session_id).cloned())
            };

            let Some(path) = path else {
                continue;
            };
            let Ok(metadata) = fs::metadata(path) else {
                continue;
            };
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);

            result.push(SessionFileActivity {
                project_id: session.project_id,
                session_id: session.session_id,
                modified_at,
                size: metadata.len(),
            });
        }

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read Claude desktop app's "starredIds" (its name for pinned sessions) and
/// translate them into our session ids (cliSessionIds).
///
/// The state lives in IndexedDB LevelDB at:
///   ~/Library/Application Support/Claude/IndexedDB/https_claude.ai_0.indexeddb.leveldb/*.log
///
/// We can't open the LevelDB while Claude app is running (it holds an exclusive
/// lock). Instead we scan the .log file (an append-only text-ish format) and
/// extract the most recent `{"state":{"starredIds":[...]}}` blob — last write
/// wins. This is read-only and lock-free.
///
/// The starredIds use app session ids (`local_<uuid>`); we map each to its
/// cliSessionId by reading the matching `local_<uuid>.json` metadata file.
#[tauri::command]
pub(crate) async fn get_app_starred_session_ids() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(home) = dirs::home_dir() else {
            return Ok(vec![]);
        };
        let leveldb_dir = home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("IndexedDB")
            .join("https_claude.ai_0.indexeddb.leveldb");
        if !leveldb_dir.exists() {
            return Ok(vec![]);
        }

        // Find the most recent starredIds entry across all .log/.ldb files
        let mut latest: Option<(u64, Vec<String>)> = None;
        let needle = b"\"starredIds\"";

        for entry in fs::read_dir(&leveldb_dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "log" && ext != "ldb" {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else { continue };

            // Find every occurrence of `"starredIds"` and back up to the
            // enclosing `{"state":...,"updatedAt":<num>}` object.
            let mut search_from = 0;
            while let Some(idx) = find_subslice(&bytes[search_from..], needle) {
                let abs_idx = search_from + idx;
                // Walk backward to nearest `{"state":` (start of the JSON object)
                let start_marker = b"{\"state\":";
                let start = match find_subslice_rev(&bytes[..abs_idx], start_marker) {
                    Some(s) => s,
                    None => {
                        search_from = abs_idx + needle.len();
                        continue;
                    }
                };
                // Walk forward to find the matching closing `}` by brace counting
                let end = match scan_balanced_json(&bytes, start) {
                    Some(e) => e,
                    None => {
                        search_from = abs_idx + needle.len();
                        continue;
                    }
                };
                if let Ok(text) = std::str::from_utf8(&bytes[start..end]) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
                        let updated_at = v.get("updatedAt").and_then(|x| x.as_u64()).unwrap_or(0);
                        let ids: Vec<String> = v
                            .get("state")
                            .and_then(|s| s.get("starredIds"))
                            .and_then(|a| a.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|x| x.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default();
                        if !ids.is_empty() {
                            match &latest {
                                Some((ts, _)) if *ts >= updated_at => {}
                                _ => latest = Some((updated_at, ids)),
                            }
                        }
                    }
                }
                search_from = end;
            }
        }

        let app_ids = match latest {
            Some((_, ids)) => ids,
            None => return Ok(vec![]),
        };

        // Map app session ids (local_<uuid>) -> cliSessionId by scanning
        // claude-code-sessions/<deviceId>/<accountId>/local_*.json
        let app_sessions_root = home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude-code-sessions");

        let mut id_to_cli: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        if app_sessions_root.exists() {
            for d in fs::read_dir(&app_sessions_root)
                .into_iter()
                .flatten()
                .flatten()
            {
                for a in fs::read_dir(d.path()).into_iter().flatten().flatten() {
                    for f in fs::read_dir(a.path()).into_iter().flatten().flatten() {
                        let p = f.path();
                        let name = p
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        if !name.starts_with("local_") || !name.ends_with(".json") {
                            continue;
                        }
                        let Ok(content) = fs::read_to_string(&p) else {
                            continue;
                        };
                        let Ok(meta) = serde_json::from_str::<serde_json::Value>(&content) else {
                            continue;
                        };
                        let session_id = meta
                            .get("sessionId")
                            .and_then(|v| v.as_str())
                            .map(String::from);
                        let cli_id = meta
                            .get("cliSessionId")
                            .and_then(|v| v.as_str())
                            .map(String::from);
                        if let (Some(sid), Some(cli)) = (session_id, cli_id) {
                            id_to_cli.insert(sid, cli);
                        }
                    }
                }
            }
        }

        let mut resolved: Vec<String> = app_ids
            .into_iter()
            .filter_map(|aid| id_to_cli.get(&aid).cloned())
            .collect();

        // Also include web-starred conversation uuids cached by the latest
        // sync_claude_web_conversations run. These are claude.ai web pins
        // (separate from Code-tab starredIds) — we union them here so the
        // frontend gets a single source of "what's app-starred".
        let web_cache = get_lovstudio_dir().join("claude-web-starred.json");
        if let Ok(content) = fs::read_to_string(&web_cache) {
            if let Ok(arr) = serde_json::from_str::<Vec<String>>(&content) {
                for uuid in arr {
                    resolved.push(uuid);
                }
            }
        }

        Ok(resolved)
    })
    .await
    .map_err(|e| e.to_string())?
}
