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

pub(crate) const SESSIONS_CACHE_VERSION: u32 = 6;

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

fn load_cached_sessions_snapshot() -> Vec<Session> {
    let mut by_id: std::collections::HashMap<String, Session> = std::collections::HashMap::new();
    for entry in load_sessions_cache().into_values() {
        let mut session = entry.session;
        apply_codex_session_index_title(&mut session);
        let key = if session.source == "codex" {
            format!("codex:{}", session.id)
        } else {
            session.id.clone()
        };

        match by_id.get(&key) {
            Some(existing) if existing.last_modified >= session.last_modified => {}
            _ => {
                by_id.insert(key, session);
            }
        }
    }

    let mut sessions: Vec<Session> = by_id.into_values().collect();
    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
}

fn collect_lightweight_sessions_snapshot() -> Vec<Session> {
    let mut sessions = Vec::new();
    let projects_dir = get_claude_dir().join("projects");

    if projects_dir.exists() {
        for project_entry in fs::read_dir(&projects_dir).into_iter().flatten().flatten() {
            let project_path = project_entry.path();
            if !project_path.is_dir() {
                continue;
            }
            let project_id = project_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let display_path = decode_project_path(&project_id);

            for entry in fs::read_dir(&project_path).into_iter().flatten().flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.ends_with(".jsonl") || name.starts_with("agent-") {
                    continue;
                }
                let metadata = match entry.metadata() {
                    Ok(metadata) => metadata,
                    Err(_) => continue,
                };
                let last_modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let created_at = metadata
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(last_modified);
                sessions.push(Session {
                    id: name.trim_end_matches(".jsonl").to_string(),
                    project_id: project_id.clone(),
                    project_path: Some(display_path.clone()),
                    title: None,
                    summary: None,
                    last_prompt: None,
                    title_source: None,
                    rounds: 0,
                    message_count: 0,
                    created_at,
                    last_modified,
                    usage: None,
                    source: if project_id == "-claude-ai" {
                        "app-web".to_string()
                    } else {
                        "cli".to_string()
                    },
                });
            }
        }
    }

    for path in collect_codex_session_paths() {
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let last_modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let head = read_codex_session_meta_lightweight(&path);
        let cwd = head.cwd.unwrap_or_else(|| "Codex".to_string());
        let created_at = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .or(head.created_at)
            .unwrap_or(last_modified);
        let title_source = if head.title.is_some() {
            Some("ai".to_string())
        } else {
            None
        };
        sessions.push(Session {
            id: head.id,
            project_id: encode_project_path(&cwd),
            project_path: Some(cwd),
            title: head.title,
            summary: None,
            last_prompt: None,
            title_source,
            rounds: 0,
            message_count: 0,
            created_at,
            last_modified,
            usage: None,
            source: "codex".to_string(),
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    sessions
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
                    let mut s = entry.session.clone();
                    apply_codex_session_index_title(&mut s);
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum SessionStreamEvent {
    /// Fast preview from Ataru's own on-disk cache. The full scan will follow.
    Cached {
        sessions: Vec<Session>,
        total: usize,
    },
    /// One batch of sessions — front-end appends as they arrive.
    Batch { sessions: Vec<Session> },
    /// All batches sent. Front-end can flip loading=false for sure.
    Done { total: usize },
}

/// Streamed variant of list_all_sessions. It first ships a small cached preview,
/// then computes the full sorted list and sends it in 200-session batches over a
/// Tauri Channel.
#[tauri::command]
pub(crate) async fn list_all_sessions_streamed(
    stream_id: String,
    on_event: Channel<SessionStreamEvent>,
    refresh: Option<bool>,
) -> Result<(), String> {
    let token = register_session_stream(&stream_id);

    tauri::async_runtime::spawn(async move {
        let refresh = refresh.unwrap_or(false);
        let cached_sessions = tauri::async_runtime::spawn_blocking(load_cached_sessions_snapshot)
            .await
            .unwrap_or_default();
        if token.load(Ordering::Relaxed) {
            unregister_session_stream(&stream_id, &token);
            return;
        }
        if !cached_sessions.is_empty() {
            let total = cached_sessions.len();
            if on_event
                .send(SessionStreamEvent::Cached {
                    sessions: cached_sessions.iter().take(200).cloned().collect(),
                    total,
                })
                .is_err()
            {
                token.store(true, Ordering::Relaxed);
                unregister_session_stream(&stream_id, &token);
                return;
            }

            if !refresh {
                let send_token = token.clone();
                let send_stream_id = stream_id.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    const BATCH: usize = 200;
                    for batch in cached_sessions.chunks(BATCH) {
                        if send_token.load(Ordering::Relaxed) {
                            return;
                        }
                        if on_event
                            .send(SessionStreamEvent::Batch {
                                sessions: batch.to_vec(),
                            })
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
                return;
            }
        }

        if !refresh {
            let lightweight_sessions =
                tauri::async_runtime::spawn_blocking(collect_lightweight_sessions_snapshot)
                    .await
                    .unwrap_or_default();
            if token.load(Ordering::Relaxed) {
                unregister_session_stream(&stream_id, &token);
                return;
            }
            let total = lightweight_sessions.len();
            let send_token = token.clone();
            let send_stream_id = stream_id.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                const BATCH: usize = 200;
                for batch in lightweight_sessions.chunks(BATCH) {
                    if send_token.load(Ordering::Relaxed) {
                        return;
                    }
                    if on_event
                        .send(SessionStreamEvent::Batch {
                            sessions: batch.to_vec(),
                        })
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
            return;
        }

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
