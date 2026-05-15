use super::*;

#[tauri::command]
pub(crate) async fn find_relocation_candidates(from: String) -> Result<RelocationResult, String> {
    if from.is_empty() {
        return Err("from is required".into());
    }
    let from_path = std::path::PathBuf::from(&from);

    let (nearest, lost_root_opt) = analyze_lost_path(&from_path);
    let lost_root = match lost_root_opt {
        Some(p) => p,
        None => {
            return Ok(RelocationResult {
                nearest_existing_ancestor: nearest.map(|p| p.to_string_lossy().to_string()),
                lost_root: None,
                tail: String::new(),
                candidates: Vec::new(),
            });
        }
    };

    // Tail = path components below lost_root (relative).
    let tail: std::path::PathBuf = from_path
        .strip_prefix(&lost_root)
        .map(|p| p.to_path_buf())
        .unwrap_or_default();

    let leaf_name = lost_root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut candidates: Vec<RelocationCandidate> = Vec::new();

    // Strategy 0: Claude worktree heuristic — paths shaped as
    // `<origin>/.claude/worktrees/<slug>` are git worktrees that get cleaned up
    // after a merge. The origin almost always exists and is the right target.
    if let Some(origin) = parse_worktree_origin(&from) {
        let origin_path = std::path::PathBuf::from(&origin);
        if origin_path.is_dir() {
            candidates.push(RelocationCandidate {
                path: origin,
                source: "worktree-origin".into(),
                full_match: true,
            });
        }
    }

    // Strategy: Spotlight (macOS) global search for the leaf folder name.
    #[cfg(target_os = "macos")]
    if !leaf_name.is_empty() {
        let leaf_owned = leaf_name.clone();
        let mdfind_out = tauri::async_runtime::spawn_blocking(move || {
            std::process::Command::new("/usr/bin/mdfind")
                .args([
                    "-onlyin",
                    "/Users",
                    &format!(
                        "kMDItemFSName == \"{}\" && kMDItemContentType == \"public.folder\"",
                        leaf_owned.replace('"', "\\\"")
                    ),
                ])
                .output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        if mdfind_out.status.success() {
            let stdout = String::from_utf8_lossy(&mdfind_out.stdout);
            for line in stdout.lines().take(50) {
                let cand_root = std::path::PathBuf::from(line.trim());
                if !cand_root.is_dir() {
                    continue;
                }
                if cand_root == lost_root {
                    continue;
                }
                let full = cand_root.join(&tail);
                let full_match = full.exists();
                candidates.push(RelocationCandidate {
                    path: if full_match {
                        full.to_string_lossy().to_string()
                    } else {
                        cand_root.to_string_lossy().to_string()
                    },
                    source: "spotlight".into(),
                    full_match,
                });
            }
        }
    }

    // Sort: full matches first, then worktree-origin (canonical recovery for merged
    // worktrees) above spotlight, then by path length (shorter = closer to home).
    let source_rank = |s: &str| match s {
        "worktree-origin" => 0,
        "spotlight" => 1,
        _ => 2,
    };
    candidates.sort_by(|a, b| {
        b.full_match
            .cmp(&a.full_match)
            .then_with(|| source_rank(&a.source).cmp(&source_rank(&b.source)))
            .then_with(|| a.path.len().cmp(&b.path.len()))
    });

    // Dedupe by path
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| seen.insert(c.path.clone()));

    Ok(RelocationResult {
        nearest_existing_ancestor: nearest.map(|p| p.to_string_lossy().to_string()),
        lost_root: Some(lost_root.to_string_lossy().to_string()),
        tail: tail.to_string_lossy().to_string(),
        candidates,
    })
}

#[derive(Serialize)]
pub(crate) struct MigrateCwdResult {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    /// Parsed `migrated` count from cc-mv `--json` output if available.
    pub(crate) migrated: Option<u64>,
}

/// Find a usable `npx` executable. Tauri-spawned children on macOS GUI apps don't
/// inherit the login shell PATH, so absolute paths must be probed explicitly.
pub(crate) fn find_npx() -> Option<String> {
    if let Ok(p) = std::env::var("PATH") {
        for dir in p.split(':') {
            let candidate = std::path::PathBuf::from(dir).join("npx");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    for fallback in [
        "/opt/homebrew/bin/npx",
        "/usr/local/bin/npx",
        "/usr/bin/npx",
    ] {
        if std::path::Path::new(fallback).exists() {
            return Some(fallback.to_string());
        }
    }
    None
}

/// Rewrite the `cwd` field in Claude desktop app's per-session local_*.json files
/// for any session whose cwd has `from` as a prefix. Returns count of files updated.
/// cc-mv only knows about ~/.claude/projects/*; this companion store is lovcode-specific.
pub(crate) fn rewrite_app_session_cwds(from: &str, to: &str) -> Result<usize, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    let root = home
        .join("Library")
        .join("Application Support")
        .join("Claude")
        .join("claude-code-sessions");
    if !root.exists() {
        return Ok(0);
    }

    let mut updated = 0usize;

    for device in fs::read_dir(&root).into_iter().flatten().flatten() {
        for account in fs::read_dir(device.path()).into_iter().flatten().flatten() {
            for entry in fs::read_dir(account.path()).into_iter().flatten().flatten() {
                let path = entry.path();
                let fname = path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !fname.starts_with("local_") || !fname.ends_with(".json") {
                    continue;
                }
                let content = match fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let mut value: serde_json::Value = match serde_json::from_str(&content) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let Some(cwd) = value
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                else {
                    continue;
                };
                if cwd != from && !cwd.starts_with(&format!("{}/", from)) {
                    continue;
                }
                let new_cwd = if cwd == from {
                    to.to_string()
                } else {
                    format!("{}{}", to, &cwd[from.len()..])
                };
                value["cwd"] = serde_json::Value::String(new_cwd);
                if let Ok(serialized) = serde_json::to_string_pretty(&value) {
                    if fs::write(&path, serialized).is_ok() {
                        updated += 1;
                    }
                }
            }
        }
    }

    Ok(updated)
}

#[tauri::command]
pub(crate) async fn migrate_session_cwd(
    app_handle: tauri::AppHandle,
    from: String,
    to: String,
) -> Result<MigrateCwdResult, String> {
    if from.is_empty() || to.is_empty() {
        return Err("from and to are required".into());
    }
    let npx = find_npx().ok_or_else(|| {
        "找不到 npx — 请确认 Node.js 已安装并在 PATH 中（/opt/homebrew/bin 或 /usr/local/bin）"
            .to_string()
    })?;

    let from_clone = from.clone();
    let to_clone = to.clone();
    let npx_clone = npx.clone();

    let output = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new(&npx_clone)
            .args([
                "-y",
                "@lovstudio/cc-mv",
                &from_clone,
                &to_clone,
                "--no-mv",
                "--yes",
                "--json",
                // Repair scenario: old slug points to a non-existent dir, so keeping
                // it as a safety net only causes duplicate session rows in the UI.
                // We always rewrite — never move files — so this only deletes redundant
                // jsonl copies under ~/.claude/projects/<old-slug>/.
                "--delete-source",
            ])
            .output()
    })
    .await
    .map_err(|e| format!("spawn join error: {}", e))?
    .map_err(|e| format!("spawn cc-mv failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();

    // cc-mv with --json prints a JSON object on stdout. Try to extract `migrated`.
    let migrated = serde_json::from_str::<serde_json::Value>(stdout.trim())
        .ok()
        .and_then(|v| v.get("migrated").and_then(|x| x.as_u64()));

    // After cc-mv succeeds, also rewrite metadata stores that cc-mv doesn't
    // reliably cover. lovcode reads `cwd` from these files in list_all_sessions,
    // so without these companion rewrites the missing-cwd banner can remain
    // stuck on the old path even though the file move succeeded.
    if success {
        match rewrite_claude_jsonl_session_cwds(&from, &to) {
            Ok((files, lines)) if files > 0 => {
                stderr.push_str(&format!(
                    "\n[lovcode] rewrote cwd in {} Claude jsonl file(s), {} line(s)",
                    files, lines
                ));
            }
            Ok(_) => {}
            Err(e) => {
                stderr.push_str(&format!(
                    "\n[lovcode] failed to rewrite Claude jsonl cwd: {}",
                    e
                ));
            }
        }

        match rewrite_codex_session_cwds(&from, &to) {
            Ok((files, lines)) if files > 0 => {
                stderr.push_str(&format!(
                    "\n[lovcode] rewrote cwd in {} Codex jsonl file(s), {} line(s)",
                    files, lines
                ));
            }
            Ok(_) => {}
            Err(e) => {
                stderr.push_str(&format!(
                    "\n[lovcode] failed to rewrite Codex jsonl cwd: {}",
                    e
                ));
            }
        }

        match rewrite_app_session_cwds(&from, &to) {
            Ok(n) if n > 0 => {
                stderr.push_str(&format!(
                    "\n[lovcode] rewrote cwd in {} app session metadata files",
                    n
                ));
            }
            Ok(_) => {}
            Err(e) => {
                stderr.push_str(&format!(
                    "\n[lovcode] failed to rewrite app session metadata: {}",
                    e
                ));
            }
        }

        emit_session_list_changed_after_migration(&app_handle).await;
    }

    Ok(MigrateCwdResult {
        success,
        stdout,
        stderr,
        migrated,
    })
}

/// Scoped variant of rewrite_app_session_cwds: only rewrites Claude Desktop
/// local_*.json files whose local session id or embedded cliSessionId is in
/// `session_ids`. Used for the auto-fix worktree flow so that `undo` can safely
/// reverse only the sessions we touched, without clobbering pre-existing
/// sessions that legitimately had cwd == to before the forward migration.
pub(crate) fn rewrite_app_session_cwds_scoped(
    session_ids: &[String],
    from: &str,
    to: &str,
) -> Result<usize, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    let root = home
        .join("Library")
        .join("Application Support")
        .join("Claude")
        .join("claude-code-sessions");
    if !root.exists() {
        return Ok(0);
    }

    let id_set: std::collections::HashSet<&str> = session_ids.iter().map(String::as_str).collect();
    let mut updated = 0usize;

    for device in fs::read_dir(&root).into_iter().flatten().flatten() {
        for account in fs::read_dir(device.path()).into_iter().flatten().flatten() {
            for entry in fs::read_dir(account.path()).into_iter().flatten().flatten() {
                let path = entry.path();
                let fname = path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let local_sid = match fname
                    .strip_prefix("local_")
                    .and_then(|s| s.strip_suffix(".json"))
                {
                    Some(s) => s,
                    None => continue,
                };
                let content = match fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let mut value: serde_json::Value = match serde_json::from_str(&content) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let cli_sid = value.get("cliSessionId").and_then(|v| v.as_str());
                if !id_set.contains(local_sid) && !cli_sid.is_some_and(|sid| id_set.contains(sid)) {
                    continue;
                }
                let Some(cwd) = value
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                else {
                    continue;
                };
                if cwd != from && !cwd.starts_with(&format!("{}/", from)) {
                    continue;
                }
                let new_cwd = if cwd == from {
                    to.to_string()
                } else {
                    format!("{}{}", to, &cwd[from.len()..])
                };
                value["cwd"] = serde_json::Value::String(new_cwd);
                if let Ok(serialized) = serde_json::to_string_pretty(&value) {
                    if fs::write(&path, serialized).is_ok() {
                        updated += 1;
                    }
                }
            }
        }
    }

    Ok(updated)
}

pub(crate) fn rewrite_cwd_value(value: &mut serde_json::Value, from: &str, to: &str) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            let mut changed = false;
            for (key, child) in map.iter_mut() {
                if key == "cwd" {
                    if let serde_json::Value::String(cwd) = child {
                        if cwd == from {
                            *cwd = to.to_string();
                            changed = true;
                            continue;
                        }
                        let from_prefix = format!("{}/", from);
                        if cwd.starts_with(&from_prefix) {
                            let rewritten = format!("{}{}", to, &cwd[from.len()..]);
                            *cwd = rewritten;
                            changed = true;
                            continue;
                        }
                    }
                }
                changed |= rewrite_cwd_value(child, from, to);
            }
            changed
        }
        serde_json::Value::Array(items) => items.iter_mut().fold(false, |changed, item| {
            rewrite_cwd_value(item, from, to) || changed
        }),
        _ => false,
    }
}

pub(crate) fn rewrite_jsonl_cwds_in_file(
    path: &std::path::Path,
    from: &str,
    to: &str,
) -> Result<usize, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let had_trailing_newline = content.ends_with('\n');
    let mut changed_lines = 0usize;
    let mut next_lines: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim_end_matches('\r');
        if trimmed.trim().is_empty() {
            next_lines.push(line.to_string());
            continue;
        }

        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            next_lines.push(line.to_string());
            continue;
        };

        if rewrite_cwd_value(&mut value, from, to) {
            let serialized = serde_json::to_string(&value).map_err(|e| e.to_string())?;
            next_lines.push(serialized);
            changed_lines += 1;
        } else {
            next_lines.push(line.to_string());
        }
    }

    if changed_lines > 0 {
        let mut output = next_lines.join("\n");
        if had_trailing_newline {
            output.push('\n');
        }
        fs::write(path, output).map_err(|e| e.to_string())?;
    }

    Ok(changed_lines)
}

/// Rewrite `cwd` inside all Claude JSONL files in the source and destination
/// project slugs. Full relocation is intentionally unscoped: it represents a
/// user-confirmed path migration from `from` to `to` for every matching session.
pub(crate) fn rewrite_claude_jsonl_session_cwds(
    from: &str,
    to: &str,
) -> Result<(usize, usize), String> {
    let projects_dir = get_claude_dir().join("projects");
    let from_slug = encode_project_path(from);
    let to_slug = encode_project_path(to);
    let mut changed_files = 0usize;
    let mut changed_lines = 0usize;
    let mut seen_paths = std::collections::HashSet::new();

    for slug in [&from_slug, &to_slug] {
        let dir = projects_dir.join(slug);
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !name.ends_with(".jsonl") || name.starts_with("agent-") {
                continue;
            }
            if !seen_paths.insert(path.clone()) {
                continue;
            }
            let line_count = rewrite_jsonl_cwds_in_file(&path, from, to)?;
            if line_count > 0 {
                changed_files += 1;
                changed_lines += line_count;
            }
        }
    }

    Ok((changed_files, changed_lines))
}

/// Codex rollout sessions are stored by date under ~/.codex instead of Claude's
/// project slugs, so cc-mv cannot move them. Rewriting their embedded `cwd`
/// keeps Lovcode's shared history list consistent after a relocation.
pub(crate) fn rewrite_codex_session_cwds(from: &str, to: &str) -> Result<(usize, usize), String> {
    let mut changed_files = 0usize;
    let mut changed_lines = 0usize;

    for path in collect_codex_session_paths() {
        let line_count = rewrite_jsonl_cwds_in_file(&path, from, to)?;
        if line_count > 0 {
            changed_files += 1;
            changed_lines += line_count;
        }
    }

    Ok((changed_files, changed_lines))
}

/// Rewrite `cwd` inside scoped Claude JSONL session files. This is a companion
/// to cc-mv for the auto-fix path: after a previous partial migration the
/// source slug may already be deleted, while the destination jsonl still has
/// the dead worktree cwd in its first metadata line.
pub(crate) fn rewrite_claude_jsonl_session_cwds_scoped(
    session_ids: &[String],
    from: &str,
    to: &str,
) -> Result<(usize, usize), String> {
    let projects_dir = get_claude_dir().join("projects");
    let from_slug = encode_project_path(from);
    let to_slug = encode_project_path(to);
    let mut changed_files = 0usize;
    let mut changed_lines = 0usize;
    let mut seen_paths = std::collections::HashSet::new();

    for sid in session_ids {
        for slug in [&from_slug, &to_slug] {
            let path = projects_dir.join(slug).join(format!("{}.jsonl", sid));
            if !seen_paths.insert(path.clone()) || !path.exists() {
                continue;
            }
            let line_count = rewrite_jsonl_cwds_in_file(&path, from, to)?;
            if line_count > 0 {
                changed_files += 1;
                changed_lines += line_count;
            }
        }
    }

    Ok((changed_files, changed_lines))
}

/// Migrate cwds for a specific set of sessions only — used for auto-fix of dead
/// worktree paths so `undo` can safely target the same set without clobbering
/// pre-existing sessions at the destination.
///
/// Sessions whose jsonl file isn't actually present in the `from` slug are
/// silently dropped — they were already migrated by a previous run. If after
/// filtering there are no jsonls left to move, we still rewrite the lovcode
/// app-side metadata (which can lag behind cc-mv) and report success.
#[tauri::command]
pub(crate) async fn migrate_sessions_cwd_scoped(
    app_handle: tauri::AppHandle,
    session_ids: Vec<String>,
    from: String,
    to: String,
) -> Result<MigrateCwdResult, String> {
    if from.is_empty() || to.is_empty() {
        return Err("from and to are required".into());
    }
    if session_ids.is_empty() {
        return Err("session_ids is required".into());
    }

    // Pre-filter to sessions whose jsonl actually lives at the from-slug. cc-mv
    // hard-errors on missing session ids, but for our auto-fix flow it's normal
    // for the file to already be at the destination slug (left over from a
    // previous partial migration).
    let from_slug = encode_project_path(&from);
    let from_slug_dir = get_claude_dir().join("projects").join(&from_slug);
    let present_ids: Vec<String> = session_ids
        .iter()
        .filter(|sid| from_slug_dir.join(format!("{}.jsonl", sid)).exists())
        .cloned()
        .collect();

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut migrated: Option<u64> = None;
    let mut cc_mv_success = true;

    if !present_ids.is_empty() {
        let npx = find_npx().ok_or_else(|| {
            "找不到 npx — 请确认 Node.js 已安装并在 PATH 中（/opt/homebrew/bin 或 /usr/local/bin）"
                .to_string()
        })?;

        let from_clone = from.clone();
        let to_clone = to.clone();
        let npx_clone = npx.clone();
        let present_ids_clone = present_ids.clone();

        let output = tauri::async_runtime::spawn_blocking(move || {
            let mut cmd = std::process::Command::new(&npx_clone);
            cmd.args(["-y", "@lovstudio/cc-mv", &from_clone, &to_clone]);
            for sid in &present_ids_clone {
                cmd.args(["--session", sid]);
            }
            cmd.args(["--no-mv", "--yes", "--json", "--delete-source"]);
            cmd.output()
        })
        .await
        .map_err(|e| format!("spawn join error: {}", e))?
        .map_err(|e| format!("spawn cc-mv failed: {}", e))?;

        stdout = String::from_utf8_lossy(&output.stdout).to_string();
        stderr = String::from_utf8_lossy(&output.stderr).to_string();
        cc_mv_success = output.status.success();

        migrated = serde_json::from_str::<serde_json::Value>(stdout.trim())
            .ok()
            .and_then(|v| v.get("migrated").and_then(|x| x.as_u64()));
    } else {
        stderr.push_str(&format!(
            "[lovcode] all {} session jsonl(s) already at destination slug — skipping cc-mv\n",
            session_ids.len()
        ));
    }

    if cc_mv_success {
        match rewrite_claude_jsonl_session_cwds_scoped(&session_ids, &from, &to) {
            Ok((files, lines)) if files > 0 => {
                stderr.push_str(&format!(
                    "\n[lovcode] rewrote cwd in {} Claude jsonl file(s), {} line(s) (scoped)",
                    files, lines
                ));
            }
            Ok(_) => {}
            Err(e) => {
                stderr.push_str(&format!(
                    "\n[lovcode] failed to rewrite Claude jsonl cwd: {}",
                    e
                ));
            }
        }

        match rewrite_app_session_cwds_scoped(&session_ids, &from, &to) {
            Ok(n) if n > 0 => {
                stderr.push_str(&format!(
                    "\n[lovcode] rewrote cwd in {} app session metadata files (scoped)",
                    n
                ));
            }
            Ok(_) => {}
            Err(e) => {
                stderr.push_str(&format!(
                    "\n[lovcode] failed to rewrite app session metadata: {}",
                    e
                ));
            }
        }

        emit_session_list_changed_after_migration(&app_handle).await;
    }

    Ok(MigrateCwdResult {
        success: cc_mv_success,
        stdout,
        stderr,
        migrated,
    })
}

async fn emit_session_list_changed_after_migration(app_handle: &tauri::AppHandle) {
    // Invalidate the session-list cache so the next list_all_sessions_streamed
    // call recomputes from disk. Without this, the 3s TTL on SESSIONS_INFLIGHT
    // can let a post-migration refresh return stale data.
    if let Some(lock) = SESSIONS_INFLIGHT.get() {
        *lock.lock().await = None;
    }

    // Trigger session list refresh in the UI. The fs watcher would also pick up
    // file writes/deletes with a debounce, but explicit emit clears banners as
    // soon as the migration's companion rewrites complete.
    let _ = app_handle.emit("sessions-changed", ());
}
