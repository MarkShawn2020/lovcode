use super::*;

// ============================================================================
// Knowledge Base (Distill Documents)
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct DistillDocument {
    pub date: String,
    pub file: String,
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub session: Option<String>,
}

pub(crate) fn get_distill_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio/docs/distill")
}

pub(crate) fn get_reference_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio/docs/reference")
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ReferenceSource {
    pub name: String,
    pub path: String,
    pub doc_count: usize,
    /// User-added (under ~/.lovstudio/docs/reference) vs bundled.
    /// Only user sources can be refreshed / removed.
    #[serde(default)]
    pub is_user: bool,
    /// Origin metadata if this source was added from a GitHub repo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ReferenceOrigin>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ReferenceOrigin {
    /// e.g. "anthropics/claude-code"
    pub repo: String,
    /// Optional sub-path inside repo (e.g. "docs")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_path: Option<String>,
    /// ISO-8601 of last successful fetch
    pub fetched_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ReferenceDoc {
    pub name: String,
    pub path: String,
    pub group: Option<String>,
}

/// Scan a directory for reference sources (subdirectories with markdown files)
pub(crate) fn scan_reference_dir(dir: &Path) -> Vec<ReferenceSource> {
    if !dir.exists() {
        return vec![];
    }

    let mut sources = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Follow symlinks and check if it's a directory
            if let Ok(metadata) = fs::metadata(&path) {
                if metadata.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let doc_count = fs::read_dir(&path)
                        .map(|entries| {
                            entries
                                .filter(|e| {
                                    e.as_ref()
                                        .ok()
                                        .map(|e| {
                                            e.path()
                                                .extension()
                                                .map(|ext| ext == "md")
                                                .unwrap_or(false)
                                        })
                                        .unwrap_or(false)
                                })
                                .count()
                        })
                        .unwrap_or(0);

                    let origin = read_reference_origin(&path);
                    sources.push(ReferenceSource {
                        name,
                        path: path.to_string_lossy().to_string(),
                        doc_count,
                        is_user: true,
                        origin,
                    });
                }
            }
        }
    }
    sources
}

pub(crate) fn reference_meta_path(source_dir: &Path) -> PathBuf {
    source_dir.join(".meta.json")
}

pub(crate) fn read_reference_origin(source_dir: &Path) -> Option<ReferenceOrigin> {
    let meta_path = reference_meta_path(source_dir);
    let content = fs::read_to_string(&meta_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Get bundled reference docs directories from app resources
pub(crate) fn get_bundled_reference_dirs(app_handle: &tauri::AppHandle) -> Vec<(String, PathBuf)> {
    let bundled_docs = [
        ("claude-code", "third-parties/claude-code-docs/docs"),
        ("codex", "third-parties/codex/docs"),
    ];

    let mut result = Vec::new();

    // Try resource directory (production)
    if let Ok(resource_path) = app_handle.path().resource_dir() {
        for (name, rel_path) in &bundled_docs {
            let path = resource_path.join(rel_path);
            if path.exists() {
                result.push((name.to_string(), path));
            }
        }
    }

    // If not found in resources, try development paths
    if result.is_empty() {
        let candidates = [
            std::env::current_dir().ok(),
            std::env::current_dir()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf())),
        ];

        for candidate in candidates.into_iter().flatten() {
            for (name, rel_path) in &bundled_docs {
                let path = candidate.join(rel_path);
                if path.exists() && !result.iter().any(|(n, _)| n == *name) {
                    result.push((name.to_string(), path));
                }
            }
        }
    }

    result
}

pub(crate) fn list_reference_sources(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ReferenceSource>, String> {
    let mut sources = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    // 1. Scan user's custom reference directory first (higher priority)
    let ref_dir = get_reference_dir();
    for source in scan_reference_dir(&ref_dir) {
        seen_names.insert(source.name.clone());
        sources.push(source);
    }

    // 2. Add bundled reference docs (if not overridden by user)
    for (name, path) in get_bundled_reference_dirs(&app_handle) {
        if !seen_names.contains(&name) {
            let doc_count = fs::read_dir(&path)
                .map(|entries| {
                    entries
                        .filter(|e| {
                            e.as_ref()
                                .ok()
                                .map(|e| {
                                    e.path().extension().map(|ext| ext == "md").unwrap_or(false)
                                })
                                .unwrap_or(false)
                        })
                        .count()
                })
                .unwrap_or(0);

            sources.push(ReferenceSource {
                name,
                path: path.to_string_lossy().to_string(),
                doc_count,
                is_user: false,
                origin: None,
            });
        }
    }

    sources.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sources)
}

/// Find reference source directory by name (checks user dir first, then bundled)
pub(crate) fn find_reference_source_dir(
    app_handle: &tauri::AppHandle,
    source: &str,
) -> Option<PathBuf> {
    // 1. Check user's custom reference directory first
    let user_dir = get_reference_dir().join(source);
    if user_dir.exists() {
        return Some(user_dir);
    }

    // 2. Check bundled reference docs
    for (name, path) in get_bundled_reference_dirs(app_handle) {
        if name == source {
            return Some(path);
        }
    }

    None
}

pub(crate) fn list_reference_docs(
    app_handle: tauri::AppHandle,
    source: String,
) -> Result<Vec<ReferenceDoc>, String> {
    let source_dir = match find_reference_source_dir(&app_handle, &source) {
        Some(dir) => dir,
        None => return Ok(vec![]),
    };

    // Read _order.txt if exists, parse groups from comments
    let order_file = source_dir.join("_order.txt");
    let mut order_map: HashMap<String, (usize, Option<String>)> = HashMap::new(); // name -> (order, group)

    if order_file.exists() {
        if let Ok(content) = fs::read_to_string(&order_file) {
            let mut current_group: Option<String> = None;
            let mut order_idx = 0;

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if trimmed.starts_with('#') {
                    // Comment line = group name (strip # and trim)
                    let group_name = trimmed.trim_start_matches('#').trim();
                    if !group_name.is_empty() {
                        current_group = Some(group_name.to_string());
                    }
                } else {
                    // Doc name
                    order_map.insert(trimmed.to_string(), (order_idx, current_group.clone()));
                    order_idx += 1;
                }
            }
        }
    }

    let mut docs = Vec::new();
    for entry in fs::read_dir(&source_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().map(|e| e == "md").unwrap_or(false) {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let group = order_map.get(&name).and_then(|(_, g)| g.clone());

            docs.push(ReferenceDoc {
                name,
                path: path.to_string_lossy().to_string(),
                group,
            });
        }
    }

    // Sort by _order.txt if available, otherwise alphabetically
    if !order_map.is_empty() {
        docs.sort_by(|a, b| {
            let a_idx = order_map
                .get(&a.name)
                .map(|(i, _)| *i)
                .unwrap_or(usize::MAX);
            let b_idx = order_map
                .get(&b.name)
                .map(|(i, _)| *i)
                .unwrap_or(usize::MAX);
            a_idx.cmp(&b_idx)
        });
    } else {
        docs.sort_by(|a, b| a.name.cmp(&b.name));
    }

    Ok(docs)
}

// ============================================================================
// GitHub-backed reference sources
// ============================================================================

/// Parse a GitHub repo specifier into "owner/name".
/// Accepts:
///   - "owner/name"
///   - "https://github.com/owner/name(.git)?(/...)?"
///   - "git@github.com:owner/name(.git)?"
pub(crate) fn parse_github_repo(input: &str) -> Result<String, String> {
    let s = input.trim().trim_end_matches('/');
    if s.is_empty() {
        return Err("Empty repo".into());
    }

    let owner_name = if let Some(rest) = s.strip_prefix("https://github.com/") {
        rest.to_string()
    } else if let Some(rest) = s.strip_prefix("http://github.com/") {
        rest.to_string()
    } else if let Some(rest) = s.strip_prefix("git@github.com:") {
        rest.to_string()
    } else {
        s.to_string()
    };

    let owner_name = owner_name.trim_end_matches(".git");
    let parts: Vec<&str> = owner_name.split('/').collect();
    if parts.len() < 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(format!("Invalid GitHub repo: {}", input));
    }
    Ok(format!("{}/{}", parts[0], parts[1]))
}

/// Default display name from repo (owner-name) — file-system safe.
pub(crate) fn default_source_name(repo: &str) -> String {
    repo.replace('/', "-")
}

pub(crate) fn sanitize_source_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Download a GitHub zipball, extract all .md files matching `sub_path` filter,
/// and write them flattened into `dest_dir` (overwriting any prior contents).
/// On filename collisions, prefix with the relative path (slashes -> "__").
pub(crate) async fn fetch_github_md_to_dir(
    repo: &str,
    sub_path: Option<&str>,
    dest_dir: &Path,
) -> Result<usize, String> {
    let url = format!("https://api.github.com/repos/{}/zipball", repo);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("User-Agent", "lovcode")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub returned {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read zipball: {}", e))?;

    let dest = dest_dir.to_path_buf();
    let sub = sub_path.map(|s| s.trim_matches('/').to_string());

    tauri::async_runtime::spawn_blocking(move || -> Result<usize, String> {
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| format!("Failed to clear dest: {}", e))?;
        }
        fs::create_dir_all(&dest).map_err(|e| format!("Failed to create dest: {}", e))?;

        let cursor = std::io::Cursor::new(bytes);
        let mut archive =
            zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read zipball: {}", e))?;

        let mut count = 0usize;
        let mut used_names: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("zip entry {}: {}", i, e))?;
            if entry.is_dir() {
                continue;
            }
            let entry_name = entry.name().to_string();
            // GitHub zipballs are wrapped in a single top-level dir like "owner-repo-<sha>/...".
            // Strip the first path segment.
            let inner = match entry_name.split_once('/') {
                Some((_, rest)) => rest,
                None => continue,
            };

            // Apply sub_path filter
            let rel = if let Some(ref sp) = sub {
                if sp.is_empty() {
                    inner
                } else if inner == sp || inner.starts_with(&format!("{}/", sp)) {
                    inner.strip_prefix(sp).unwrap().trim_start_matches('/')
                } else {
                    continue;
                }
            } else {
                inner
            };

            if !rel.to_lowercase().ends_with(".md") {
                continue;
            }

            // Build flat filename; on collision, prefix with path
            let bare = Path::new(rel)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if bare.is_empty() {
                continue;
            }
            let preferred = if rel.contains('/') {
                // Prefer directory-prefixed name to preserve grouping hints
                rel.replace('/', "__")
            } else {
                bare
            };
            let final_name = match used_names.get(&preferred).copied() {
                None => {
                    used_names.insert(preferred.clone(), 1);
                    preferred
                }
                Some(n) => {
                    used_names.insert(preferred.clone(), n + 1);
                    let stem = preferred.trim_end_matches(".md");
                    format!("{}-{}.md", stem, n)
                }
            };

            let out_path = dest.join(&final_name);
            let mut out_file =
                fs::File::create(&out_path).map_err(|e| format!("create {}: {}", final_name, e))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("write {}: {}", final_name, e))?;
            count += 1;
        }

        if count == 0 {
            return Err("No markdown files found (check sub-path)".into());
        }
        Ok(count)
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?
}

pub(crate) async fn add_reference_from_github(
    repo: String,
    sub_path: Option<String>,
    display_name: Option<String>,
) -> Result<ReferenceSource, String> {
    let canonical_repo = parse_github_repo(&repo)?;
    let raw_name = display_name
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_source_name(&canonical_repo));
    let name = sanitize_source_name(&raw_name);
    if name.is_empty() {
        return Err("Invalid display name".into());
    }

    let dest_dir = get_reference_dir().join(&name);
    let sub = sub_path
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let count = fetch_github_md_to_dir(&canonical_repo, sub.as_deref(), &dest_dir).await?;

    let origin = ReferenceOrigin {
        repo: canonical_repo,
        sub_path: sub,
        fetched_at: chrono::Utc::now().to_rfc3339(),
    };
    let meta_json =
        serde_json::to_string_pretty(&origin).map_err(|e| format!("serialize meta: {}", e))?;
    fs::write(reference_meta_path(&dest_dir), meta_json)
        .map_err(|e| format!("write meta: {}", e))?;

    Ok(ReferenceSource {
        name,
        path: dest_dir.to_string_lossy().to_string(),
        doc_count: count,
        is_user: true,
        origin: Some(origin),
    })
}

pub(crate) async fn refresh_reference_source(name: String) -> Result<ReferenceSource, String> {
    let safe = sanitize_source_name(&name);
    if safe.is_empty() {
        return Err("Invalid name".into());
    }
    let dest_dir = get_reference_dir().join(&safe);
    let origin = read_reference_origin(&dest_dir)
        .ok_or_else(|| "Source has no origin metadata; cannot refresh".to_string())?;

    let count = fetch_github_md_to_dir(&origin.repo, origin.sub_path.as_deref(), &dest_dir).await?;

    let new_origin = ReferenceOrigin {
        fetched_at: chrono::Utc::now().to_rfc3339(),
        ..origin
    };
    let meta_json =
        serde_json::to_string_pretty(&new_origin).map_err(|e| format!("serialize meta: {}", e))?;
    fs::write(reference_meta_path(&dest_dir), meta_json)
        .map_err(|e| format!("write meta: {}", e))?;

    Ok(ReferenceSource {
        name: safe,
        path: dest_dir.to_string_lossy().to_string(),
        doc_count: count,
        is_user: true,
        origin: Some(new_origin),
    })
}

pub(crate) fn remove_reference_source(name: String) -> Result<(), String> {
    let safe = sanitize_source_name(&name);
    if safe.is_empty() {
        return Err("Invalid name".into());
    }
    let dir = get_reference_dir().join(&safe);
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove: {}", e))
}
