use super::*;

// ============================================================================
// Settings Feature
// ============================================================================

#[tauri::command]
pub(crate) fn get_settings() -> Result<ClaudeSettings, String> {
    let settings_path = get_claude_dir().join("settings.json");
    let claude_json_path = get_claude_json_path();

    // Read ~/.claude/settings.json for permissions, hooks, etc.
    let (mut raw, permissions, hooks) = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        let raw: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let permissions = raw.get("permissions").cloned();
        let hooks = raw.get("hooks").cloned();
        (raw, permissions, hooks)
    } else {
        (Value::Null, None, None)
    };

    // Overlay disabled env from ~/.lovstudio/lovcode (do not persist in settings.json)
    if let Ok(disabled_env) = load_disabled_env() {
        if !disabled_env.is_empty() {
            if let Some(obj) = raw.as_object_mut() {
                obj.insert(
                    "_lovcode_disabled_env".to_string(),
                    Value::Object(disabled_env),
                );
            } else {
                raw = serde_json::json!({
                    "_lovcode_disabled_env": disabled_env
                });
            }
        } else if let Some(obj) = raw.as_object_mut() {
            obj.remove("_lovcode_disabled_env");
        }
    }

    // Read ~/.claude.json for MCP servers
    let mut mcp_servers = Vec::new();
    if claude_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&claude_json_path) {
            if let Ok(claude_json) = serde_json::from_str::<Value>(&content) {
                if let Some(mcp_obj) = claude_json.get("mcpServers").and_then(|v| v.as_object()) {
                    for (name, config) in mcp_obj {
                        if let Some(obj) = config.as_object() {
                            // Handle nested mcpServers format (from some installers)
                            let actual_config = if let Some(nested) =
                                obj.get("mcpServers").and_then(|v| v.as_object())
                            {
                                nested.values().next().and_then(|v| v.as_object())
                            } else {
                                Some(obj)
                            };

                            if let Some(cfg) = actual_config {
                                let description = cfg
                                    .get("description")
                                    .and_then(|v| v.as_str())
                                    .map(String::from);
                                let server_type =
                                    cfg.get("type").and_then(|v| v.as_str()).map(String::from);
                                let url = cfg.get("url").and_then(|v| v.as_str()).map(String::from);
                                let command = cfg
                                    .get("command")
                                    .and_then(|v| v.as_str())
                                    .map(String::from);
                                let args: Vec<String> = cfg
                                    .get("args")
                                    .and_then(|v| v.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|v| v.as_str().map(String::from))
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                let env: HashMap<String, String> = cfg
                                    .get("env")
                                    .and_then(|v| v.as_object())
                                    .map(|m| {
                                        m.iter()
                                            .filter_map(|(k, v)| {
                                                v.as_str().map(|s| (k.clone(), s.to_string()))
                                            })
                                            .collect()
                                    })
                                    .unwrap_or_default();

                                mcp_servers.push(McpServer {
                                    name: name.clone(),
                                    description,
                                    server_type,
                                    url,
                                    command,
                                    args,
                                    env,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ClaudeSettings {
        raw,
        permissions,
        hooks,
        mcp_servers,
    })
}

pub(crate) fn get_session_path(project_id: &str, session_id: &str) -> PathBuf {
    get_claude_dir()
        .join("projects")
        .join(project_id)
        .join(format!("{}.jsonl", session_id))
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

#[tauri::command]
pub(crate) fn open_session_in_editor(
    project_id: String,
    session_id: String,
    editor: Option<String>,
) -> Result<(), String> {
    let path = resolve_session_path(&project_id, &session_id)
        .ok_or_else(|| "Session file not found".to_string())?;

    if editor.as_deref().map(str::trim) == Some("yoda") {
        return open_session_in_yoda(&session_id, &path);
    }

    open_in_editor_with_target(path.to_string_lossy().to_string(), editor)
}

#[tauri::command]
pub(crate) fn get_session_file_path(
    project_id: String,
    session_id: String,
) -> Result<String, String> {
    let path = resolve_session_path(&project_id, &session_id)
        .ok_or_else(|| "Session file not found".to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn get_session_summary(
    project_id: String,
    session_id: String,
) -> Result<Option<String>, String> {
    let path = resolve_session_path(&project_id, &session_id)
        .ok_or_else(|| "Session file not found".to_string())?;
    if is_codex_session_path(&path) {
        let head = read_codex_session_head(&path);
        Ok(head.title.or(head.last_prompt))
    } else {
        let head = read_session_head(&path, 20);
        Ok(head.summary)
    }
}

/// Update the session title in the Claude desktop app's meta file.
/// Walks ~/Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json
/// and rewrites the entry whose `cliSessionId` matches.
/// Returns an error if the session has no app-code meta (i.e. pure CLI session).
#[tauri::command]
pub(crate) fn set_session_title(session_id: String, title: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot get home dir".to_string())?;
    let root = home
        .join("Library")
        .join("Application Support")
        .join("Claude")
        .join("claude-code-sessions");
    if !root.exists() {
        return Err("Claude app session store not found".to_string());
    }
    for device in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        for account in fs::read_dir(device.path()).into_iter().flatten().flatten() {
            for file in fs::read_dir(account.path()).into_iter().flatten().flatten() {
                let path = file.path();
                let fname = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if !fname.starts_with("local_") || !fname.ends_with(".json") {
                    continue;
                }
                let Ok(content) = fs::read_to_string(&path) else {
                    continue;
                };
                let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&content) else {
                    continue;
                };
                if meta.get("cliSessionId").and_then(|v| v.as_str()) != Some(&session_id) {
                    continue;
                }
                if let Some(obj) = meta.as_object_mut() {
                    obj.insert("title".into(), serde_json::Value::String(title.clone()));
                    obj.insert(
                        "titleSource".into(),
                        serde_json::Value::String("user".into()),
                    );
                }
                let serialized = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
                fs::write(&path, serialized).map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }
    Err("Session meta not found (only Claude app sessions can be renamed)".to_string())
}

pub(crate) fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn reveal_session_file(project_id: String, session_id: String) -> Result<(), String> {
    let session_path = resolve_session_path(&project_id, &session_id)
        .ok_or_else(|| "Session file not found".to_string())?;

    let path = session_path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(session_path.parent().unwrap_or(&session_path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn reveal_path(path: String, cwd: Option<String>) -> Result<(), String> {
    let expanded = if path.starts_with("~/") || path == "~" {
        let home = dirs::home_dir().ok_or("Cannot get home dir")?;
        if path == "~" {
            home
        } else {
            home.join(&path[2..])
        }
    } else if path.starts_with('/') {
        std::path::PathBuf::from(&path)
    } else if let Some(base) = cwd.as_ref().filter(|s| !s.is_empty()) {
        std::path::PathBuf::from(base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };

    if !expanded.exists() {
        return Err(format!(
            "Path not found\n  input: {}\n  cwd:   {}\n  tried: {}",
            path,
            cwd.as_deref().unwrap_or("(none)"),
            expanded.display()
        ));
    }

    let path_str = expanded.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(expanded.parent().unwrap_or(&expanded))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn open_path(path: String, cwd: Option<String>) -> Result<(), String> {
    let expanded = if path.starts_with("~/") || path == "~" {
        let home = dirs::home_dir().ok_or("Cannot get home dir")?;
        if path == "~" {
            home
        } else {
            home.join(&path[2..])
        }
    } else if path.starts_with('/') {
        std::path::PathBuf::from(&path)
    } else if let Some(base) = cwd.as_ref().filter(|s| !s.is_empty()) {
        std::path::PathBuf::from(base).join(&path)
    } else {
        std::path::PathBuf::from(&path)
    };

    if !expanded.exists() {
        return Err(format!(
            "Path not found\n  input: {}\n  cwd:   {}\n  tried: {}",
            path,
            cwd.as_deref().unwrap_or("(none)"),
            expanded.display()
        ));
    }

    let path_str = expanded.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct PathCheckResult {
    pub(crate) raw: String,
    pub(crate) resolved: String,
    pub(crate) is_dir: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct PathCandidateResult {
    pub(crate) path: String,
    pub(crate) source: String,
    pub(crate) is_dir: bool,
    pub(crate) full_match: bool,
    pub(crate) exists: bool,
}

#[derive(Serialize)]
pub(crate) struct PathResolveResult {
    pub(crate) raw: String,
    pub(crate) resolved: String,
    pub(crate) is_dir: bool,
    pub(crate) exists: bool,
    pub(crate) candidates: Vec<PathCandidateResult>,
    pub(crate) warning: Option<String>,
}

pub(crate) fn check_paths_exist(paths: Vec<String>, cwd: Option<String>) -> Vec<PathCheckResult> {
    let home = dirs::home_dir();
    let cwd_path = cwd.as_ref().map(std::path::PathBuf::from);

    paths
        .into_iter()
        .filter_map(|raw| {
            let trimmed = raw.trim().trim_end_matches([',', '.', ';', ':', ')', ']']);
            if trimmed.is_empty() {
                return None;
            }

            let candidate = if trimmed.starts_with("~/") || trimmed == "~" {
                let home = home.as_ref()?;
                if trimmed == "~" {
                    home.clone()
                } else {
                    home.join(&trimmed[2..])
                }
            } else if trimmed.starts_with('/') {
                std::path::PathBuf::from(trimmed)
            } else if let Some(base) = &cwd_path {
                base.join(trimmed)
            } else {
                return None;
            };

            let metadata = std::fs::metadata(&candidate).ok()?;
            let canonical = std::fs::canonicalize(&candidate).unwrap_or(candidate);

            Some(PathCheckResult {
                raw,
                resolved: canonical.to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
            })
        })
        .collect()
}

pub(crate) fn normalize_path_input(raw: &str) -> String {
    raw.trim()
        .trim_end_matches([',', '.', ';', ':', ')', ']'])
        .to_string()
}

pub(crate) fn expand_user_path(
    raw: &str,
    cwd: Option<&std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
    let home = dirs::home_dir();

    if raw.starts_with("~/") || raw == "~" {
        let home = home.as_ref()?;
        if raw == "~" {
            Some(home.clone())
        } else {
            Some(home.join(&raw[2..]))
        }
    } else if raw.starts_with('/') {
        Some(std::path::PathBuf::from(raw))
    } else {
        cwd.map(|base| base.join(raw))
    }
}

pub(crate) fn path_metadata_candidate(
    path: std::path::PathBuf,
    source: &str,
    full_match: bool,
) -> Option<PathCandidateResult> {
    let metadata = fs::metadata(&path).ok()?;
    let canonical = fs::canonicalize(&path).unwrap_or(path);

    Some(PathCandidateResult {
        path: canonical.to_string_lossy().to_string(),
        source: source.to_string(),
        is_dir: metadata.is_dir(),
        full_match,
        exists: true,
    })
}

pub(crate) fn push_path_candidate(
    candidates: &mut Vec<PathCandidateResult>,
    path: std::path::PathBuf,
    source: &str,
    full_match: bool,
) {
    if let Some(candidate) = path_metadata_candidate(path, source, full_match) {
        candidates.push(candidate);
    }
}

pub(crate) fn push_path_option(
    candidates: &mut Vec<PathCandidateResult>,
    path: std::path::PathBuf,
    source: &str,
    full_match: bool,
) {
    if let Some(candidate) = path_metadata_candidate(path.clone(), source, full_match) {
        candidates.push(candidate);
        return;
    }

    candidates.push(PathCandidateResult {
        path: path.to_string_lossy().to_string(),
        source: source.to_string(),
        is_dir: false,
        full_match,
        exists: false,
    });
}

pub(crate) fn path_tail_variants(path: &std::path::Path) -> Vec<std::path::PathBuf> {
    let components: Vec<String> = path
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();

    let mut variants = Vec::new();
    for count in (1..=std::cmp::min(4, components.len())).rev() {
        let mut tail = std::path::PathBuf::new();
        for part in &components[components.len() - count..] {
            tail.push(part);
        }
        variants.push(tail);
    }
    variants
}

pub(crate) struct CandidateRoot {
    pub(crate) label: String,
    pub(crate) path: std::path::PathBuf,
}

pub(crate) fn candidate_roots(
    cwd: Option<&std::path::PathBuf>,
    home: Option<&std::path::PathBuf>,
) -> Vec<CandidateRoot> {
    let mut roots = Vec::new();

    if let Some(cwd) = cwd {
        let mut depth = 0usize;
        let mut current = Some(cwd.as_path());
        while let Some(path) = current {
            roots.push(CandidateRoot {
                label: if depth == 0 {
                    "cwd".to_string()
                } else {
                    format!("cwd parent {}", depth)
                },
                path: path.to_path_buf(),
            });
            if home.map(|h| h.as_path() == path).unwrap_or(false) {
                break;
            }
            depth += 1;
            current = path.parent();
        }
    }

    if let Some(home) = home {
        roots.extend([
            CandidateRoot {
                label: "home".to_string(),
                path: home.clone(),
            },
            CandidateRoot {
                label: "~/.agents".to_string(),
                path: home.join(".agents"),
            },
            CandidateRoot {
                label: "~/.agents/skills".to_string(),
                path: home.join(".agents").join("skills"),
            },
            CandidateRoot {
                label: "~/.agent".to_string(),
                path: home.join(".agent"),
            },
            CandidateRoot {
                label: "~/.claude".to_string(),
                path: home.join(".claude"),
            },
            CandidateRoot {
                label: "~/.codex".to_string(),
                path: home.join(".codex"),
            },
            CandidateRoot {
                label: "~/.cache".to_string(),
                path: home.join(".cache"),
            },
            CandidateRoot {
                label: "~/.local".to_string(),
                path: home.join(".local"),
            },
        ]);
    }
    roots.push(CandidateRoot {
        label: "temp".to_string(),
        path: std::env::temp_dir(),
    });

    let mut seen = std::collections::HashSet::new();
    roots.retain(|root| seen.insert(root.path.to_string_lossy().to_string()) && root.path.is_dir());
    roots
}

pub(crate) fn semantic_path_tail(
    normalized: &str,
    expanded: &std::path::Path,
    home: Option<&std::path::PathBuf>,
) -> Option<std::path::PathBuf> {
    if let Some(rest) = normalized.strip_prefix("~/") {
        return Some(std::path::PathBuf::from(rest));
    }

    if let Some(home) = home {
        if let Ok(rest) = expanded.strip_prefix(home) {
            if !rest.as_os_str().is_empty() {
                return Some(rest.to_path_buf());
            }
        }
    }

    path_tail_variants(expanded).into_iter().next()
}

pub(crate) fn add_spotlight_file_candidates(
    candidates: &mut Vec<PathCandidateResult>,
    leaf_name: &str,
    tail_variants: &[std::path::PathBuf],
) {
    #[cfg(target_os = "macos")]
    {
        if leaf_name.is_empty() {
            return;
        }

        let output = std::process::Command::new("/usr/bin/mdfind")
            .args([
                "-onlyin",
                "/Users",
                &format!("kMDItemFSName == \"{}\"", leaf_name.replace('"', "\\\"")),
            ])
            .output();

        let Ok(output) = output else {
            return;
        };
        if !output.status.success() {
            return;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().take(80) {
            let path = std::path::PathBuf::from(line.trim());
            if !path.exists() {
                continue;
            }
            let full_match = tail_variants.iter().any(|tail| path.ends_with(tail));
            push_path_candidate(candidates, path, "spotlight", full_match);
        }
    }
}

pub(crate) fn resolve_path_candidate(
    raw: String,
    cwd_path: Option<&std::path::PathBuf>,
) -> PathResolveResult {
    let normalized = normalize_path_input(&raw);
    let home = dirs::home_dir();
    let expanded = expand_user_path(&normalized, cwd_path);
    let mut candidates = Vec::new();

    if let Some(path) = expanded.as_ref() {
        push_path_candidate(&mut candidates, path.clone(), "exact", true);
    }

    if candidates.is_empty() {
        if let (Some(cwd), Some(rest)) = (cwd_path, normalized.strip_prefix("~/")) {
            push_path_candidate(&mut candidates, cwd.join(rest), "cwd-prefix", true);
        }

        if let Some(path) = expanded.as_ref() {
            let tails = path_tail_variants(path);
            let roots = candidate_roots(cwd_path, home.as_ref());
            if let Some(tail) = semantic_path_tail(&normalized, path, home.as_ref()) {
                for root in &roots {
                    push_path_option(
                        &mut candidates,
                        root.path.join(&tail),
                        &format!("prefix: {}", root.label),
                        true,
                    );
                }
            }

            for root in roots {
                for (index, tail) in tails.iter().enumerate() {
                    push_path_candidate(
                        &mut candidates,
                        root.path.join(tail),
                        &format!("prefix: {}", root.label),
                        index <= 1,
                    );
                }
            }

            if let Some(leaf) = path.file_name().and_then(|value| value.to_str()) {
                add_spotlight_file_candidates(&mut candidates, leaf, &tails);
            }
        }
    }

    candidates.sort_by(|a, b| {
        let priority = |source: &str| match source {
            "exact" => 0,
            "cwd-prefix" => 1,
            source if source.starts_with("prefix:") => 2,
            "spotlight" => 3,
            _ => 9,
        };
        b.exists
            .cmp(&a.exists)
            .then_with(|| b.full_match.cmp(&a.full_match))
            .then_with(|| priority(&a.source).cmp(&priority(&b.source)))
            .then_with(|| a.path.len().cmp(&b.path.len()))
    });

    let mut seen = std::collections::HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.path.clone()));
    candidates.truncate(12);

    if let Some(best) = candidates.iter().find(|candidate| candidate.exists) {
        let exact = best.source == "exact";
        return PathResolveResult {
            raw: normalized,
            resolved: best.path.clone(),
            is_dir: best.is_dir,
            exists: true,
            candidates,
            warning: if exact {
                None
            } else {
                Some("Original path was not found; using the best matching candidate.".to_string())
            },
        };
    }

    let resolved = expanded
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized.clone());

    PathResolveResult {
        raw: normalized,
        resolved,
        is_dir: false,
        exists: false,
        candidates,
        warning: Some("Path not found.".to_string()),
    }
}

pub(crate) async fn resolve_path_candidates(
    paths: Vec<String>,
    cwd: Option<String>,
) -> Result<Vec<PathResolveResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cwd_path = cwd
            .as_ref()
            .filter(|value| !value.is_empty())
            .map(std::path::PathBuf::from);

        Ok(paths
            .into_iter()
            .map(|raw| resolve_path_candidate(raw, cwd_path.as_ref()))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub(crate) struct RelocationCandidate {
    /// Full reconstructed path that exists on disk (lost-root replacement + tail rejoin).
    pub(crate) path: String,
    /// Source classification for ranking + UI display.
    pub(crate) source: String, // "spotlight" | "ancestor"
    /// True if the WHOLE original path can be reconstructed at this candidate.
    pub(crate) full_match: bool,
}

#[derive(Serialize)]
pub(crate) struct RelocationResult {
    /// The deepest ancestor of `from` that exists on disk (informational).
    pub(crate) nearest_existing_ancestor: Option<String>,
    /// The first segment whose parent exists but it doesn't — the "lost" leaf to search for.
    pub(crate) lost_root: Option<String>,
    /// Path tail BELOW lost_root (joined with `/`); empty if `lost_root` IS the original path.
    pub(crate) tail: String,
    /// Best-effort candidates, sorted by quality (full_match first, then source priority).
    pub(crate) candidates: Vec<RelocationCandidate>,
}

/// Returns the origin project path for a Claude worktree path, mirroring
/// `parseWorktreePath` in the frontend. Matches `<origin>/.claude/worktrees/<slug>`.
pub(crate) fn parse_worktree_origin(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches('/');
    let marker = "/.claude/worktrees/";
    let idx = trimmed.find(marker)?;
    let after = &trimmed[idx + marker.len()..];
    if after.is_empty() || after.contains('/') {
        return None;
    }
    let origin = &trimmed[..idx];
    if origin.is_empty() {
        return None;
    }
    Some(origin.to_string())
}

/// Walk up `from`, returning (nearest_existing_ancestor, lost_root_path).
/// `lost_root_path` is the last segment in the chain whose parent exists on disk.
pub(crate) fn analyze_lost_path(
    from: &std::path::Path,
) -> (Option<std::path::PathBuf>, Option<std::path::PathBuf>) {
    let mut lost_root: Option<std::path::PathBuf> = None;
    let mut cur = from.to_path_buf();
    loop {
        if cur.exists() {
            return (Some(cur), lost_root);
        }
        lost_root = Some(cur.clone());
        match cur.parent() {
            Some(p) if !p.as_os_str().is_empty() => cur = p.to_path_buf(),
            _ => return (None, lost_root),
        }
    }
}
