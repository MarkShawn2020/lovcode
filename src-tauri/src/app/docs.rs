use super::*;

// ============================================================================
// Doc sources registry (sources.json) — flat list of all doc roots:
// symlink (legacy ~/.lovstudio/docs/reference/*), github (same dir + meta),
// vault (arbitrary local folder, e.g. Obsidian).
// ============================================================================

pub(crate) fn sources_registry_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio/docs/sources.json")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DocSourceKind {
    Symlink,
    Github,
    Vault,
    Bundled,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct DocSource {
    /// Stable identifier (slug). Used in URLs and as React key.
    pub id: String,
    /// User-visible label (renamable).
    pub name: String,
    pub kind: DocSourceKind,
    /// Absolute path to the source root directory.
    pub path: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ReferenceOrigin>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub(crate) struct DocSourcesRegistry {
    #[serde(default)]
    pub(crate) sources: Vec<DocSource>,
    #[serde(default)]
    pub(crate) migrated: bool,
}

pub(crate) fn read_sources_registry() -> DocSourcesRegistry {
    let path = sources_registry_path();
    if !path.exists() {
        return DocSourcesRegistry::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn write_sources_registry(reg: &DocSourcesRegistry) -> Result<(), String> {
    let path = sources_registry_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent: {}", e))?;
    }
    let json = serde_json::to_string_pretty(reg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write registry: {}", e))
}

pub(crate) fn slugify_doc_source_id(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else if c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    s.trim_matches('-').to_string()
}

pub(crate) fn unique_doc_source_id(base: &str, existing: &[DocSource]) -> String {
    let base = if base.is_empty() {
        "source".to_string()
    } else {
        base.to_string()
    };
    if !existing.iter().any(|s| s.id == base) {
        return base;
    }
    for i in 2..1000 {
        let candidate = format!("{}-{}", base, i);
        if !existing.iter().any(|s| s.id == candidate) {
            return candidate;
        }
    }
    format!("{}-{}", base, chrono::Utc::now().timestamp())
}

/// One-shot migration: import existing symlink dirs + bundled docs into the registry.
pub(crate) fn migrate_sources_if_needed(app_handle: &tauri::AppHandle) -> DocSourcesRegistry {
    let mut reg = read_sources_registry();
    if reg.migrated {
        return reg;
    }

    // Import user reference dirs (symlinks and github-cloned)
    let ref_dir = get_reference_dir();
    let mut next_order: i32 = 0;
    for src in scan_reference_dir(&ref_dir) {
        let kind = if src.origin.is_some() {
            DocSourceKind::Github
        } else {
            DocSourceKind::Symlink
        };
        let id = unique_doc_source_id(&slugify_doc_source_id(&src.name), &reg.sources);
        reg.sources.push(DocSource {
            id,
            name: src.name,
            kind,
            path: src.path,
            hidden: false,
            order: next_order,
            origin: src.origin,
        });
        next_order += 1;
    }

    // Import bundled docs
    for (name, path) in get_bundled_reference_dirs(app_handle) {
        if reg.sources.iter().any(|s| s.path == path.to_string_lossy()) {
            continue;
        }
        let id = unique_doc_source_id(&slugify_doc_source_id(&name), &reg.sources);
        reg.sources.push(DocSource {
            id,
            name,
            kind: DocSourceKind::Bundled,
            path: path.to_string_lossy().to_string(),
            hidden: false,
            order: next_order,
            origin: None,
        });
        next_order += 1;
    }

    reg.migrated = true;
    let _ = write_sources_registry(&reg);
    reg
}

/// Recursive doc tree node.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum DocNode {
    Dir {
        name: String,
        path: String,
        children: Vec<DocNode>,
    },
    File {
        name: String,
        path: String,
    },
}

pub(crate) fn read_dir_recursive(dir: &Path, max_depth: usize) -> Vec<DocNode> {
    if max_depth == 0 {
        return vec![];
    }
    let mut nodes: Vec<DocNode> = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return nodes,
    };

    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    let mut files: Vec<(String, PathBuf)> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // skip dotfiles (.obsidian/, .meta.json, etc.)
        }
        let path = entry.path();
        let md = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if md.is_dir() {
            dirs.push((name, path));
        } else if md.is_file() {
            let lower = name.to_lowercase();
            if lower.ends_with(".md") || lower.ends_with(".markdown") {
                files.push((name, path));
            }
        }
    }

    dirs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    files.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    for (name, path) in dirs {
        let children = read_dir_recursive(&path, max_depth - 1);
        if children.is_empty() {
            continue; // hide empty dirs
        }
        nodes.push(DocNode::Dir {
            name,
            path: path.to_string_lossy().to_string(),
            children,
        });
    }
    for (name, path) in files {
        let stem = Path::new(&name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(name.clone());
        nodes.push(DocNode::File {
            name: stem,
            path: path.to_string_lossy().to_string(),
        });
    }
    nodes
}

#[tauri::command]
pub(crate) fn list_doc_sources(app_handle: tauri::AppHandle) -> Result<Vec<DocSource>, String> {
    let mut reg = migrate_sources_if_needed(&app_handle);
    reg.sources
        .sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.cmp(&b.name)));
    Ok(reg.sources)
}

#[tauri::command]
pub(crate) fn list_doc_tree(
    app_handle: tauri::AppHandle,
    source_id: String,
) -> Result<Vec<DocNode>, String> {
    let reg = migrate_sources_if_needed(&app_handle);
    let src = reg
        .sources
        .iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("Unknown source: {}", source_id))?;
    let root = PathBuf::from(&src.path);
    if !root.exists() {
        return Err(format!("Source path does not exist: {}", src.path));
    }
    Ok(read_dir_recursive(&root, 12))
}

#[tauri::command]
pub(crate) fn add_vault_source(path: String, name: Option<String>) -> Result<DocSource, String> {
    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let mut reg = read_sources_registry();
    if reg.sources.iter().any(|s| s.path == path) {
        return Err("This folder is already added".into());
    }
    let display = name
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "vault".into());
    let id = unique_doc_source_id(&slugify_doc_source_id(&display), &reg.sources);
    let next_order = reg.sources.iter().map(|s| s.order).max().unwrap_or(-1) + 1;
    let src = DocSource {
        id,
        name: display,
        kind: DocSourceKind::Vault,
        path: p.to_string_lossy().to_string(),
        hidden: false,
        order: next_order,
        origin: None,
    };
    reg.sources.push(src.clone());
    write_sources_registry(&reg)?;
    Ok(src)
}

#[derive(Debug, Deserialize)]
pub(crate) struct DocSourceUpdate {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub order: Option<i32>,
}

#[tauri::command]
pub(crate) fn update_doc_source(update: DocSourceUpdate) -> Result<DocSource, String> {
    let mut reg = read_sources_registry();
    let src = reg
        .sources
        .iter_mut()
        .find(|s| s.id == update.id)
        .ok_or_else(|| format!("Unknown source: {}", update.id))?;
    if let Some(n) = update.name {
        let trimmed = n.trim();
        if !trimmed.is_empty() {
            src.name = trimmed.to_string();
        }
    }
    if let Some(h) = update.hidden {
        src.hidden = h;
    }
    if let Some(o) = update.order {
        src.order = o;
    }
    let result = src.clone();
    write_sources_registry(&reg)?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn remove_doc_source(id: String, delete_files: Option<bool>) -> Result<(), String> {
    let mut reg = read_sources_registry();
    let pos = reg
        .sources
        .iter()
        .position(|s| s.id == id)
        .ok_or_else(|| format!("Unknown source: {}", id))?;
    let removed = reg.sources.remove(pos);
    write_sources_registry(&reg)?;

    // Only delete the on-disk folder for github/symlink sources we own;
    // never touch vaults (they're external) or bundled (they're app resources).
    if delete_files.unwrap_or(false) {
        match removed.kind {
            DocSourceKind::Symlink | DocSourceKind::Github => {
                let p = PathBuf::from(&removed.path);
                if p.exists() && p.starts_with(get_reference_dir()) {
                    let _ = fs::remove_dir_all(&p);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(crate) fn reorder_doc_sources(ids: Vec<String>) -> Result<(), String> {
    let mut reg = read_sources_registry();
    for (i, id) in ids.iter().enumerate() {
        if let Some(s) = reg.sources.iter_mut().find(|s| s.id == *id) {
            s.order = i as i32;
        }
    }
    write_sources_registry(&reg)
}

#[tauri::command]
pub(crate) async fn add_github_doc_source(
    repo: String,
    sub_path: Option<String>,
    display_name: Option<String>,
) -> Result<DocSource, String> {
    let canonical_repo = parse_github_repo(&repo)?;
    let raw_name = display_name
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_source_name(&canonical_repo));
    let safe = sanitize_source_name(&raw_name);
    if safe.is_empty() {
        return Err("Invalid display name".into());
    }
    let dest_dir = get_reference_dir().join(&safe);
    let sub = sub_path
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    fetch_github_md_to_dir(&canonical_repo, sub.as_deref(), &dest_dir).await?;

    let origin = ReferenceOrigin {
        repo: canonical_repo,
        sub_path: sub,
        fetched_at: chrono::Utc::now().to_rfc3339(),
    };
    let meta_json =
        serde_json::to_string_pretty(&origin).map_err(|e| format!("serialize meta: {}", e))?;
    fs::write(reference_meta_path(&dest_dir), meta_json)
        .map_err(|e| format!("write meta: {}", e))?;

    let mut reg = read_sources_registry();
    let id = unique_doc_source_id(&slugify_doc_source_id(&raw_name), &reg.sources);
    let next_order = reg.sources.iter().map(|s| s.order).max().unwrap_or(-1) + 1;
    let src = DocSource {
        id,
        name: raw_name,
        kind: DocSourceKind::Github,
        path: dest_dir.to_string_lossy().to_string(),
        hidden: false,
        order: next_order,
        origin: Some(origin),
    };
    reg.sources.push(src.clone());
    write_sources_registry(&reg)?;
    Ok(src)
}

#[tauri::command]
pub(crate) async fn refresh_doc_source(id: String) -> Result<DocSource, String> {
    let mut reg = read_sources_registry();
    let src = reg
        .sources
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Unknown source: {}", id))?;
    let origin = src
        .origin
        .clone()
        .ok_or_else(|| "Source has no origin metadata; cannot refresh".to_string())?;
    let dest_dir = PathBuf::from(&src.path);
    fetch_github_md_to_dir(&origin.repo, origin.sub_path.as_deref(), &dest_dir).await?;
    let new_origin = ReferenceOrigin {
        fetched_at: chrono::Utc::now().to_rfc3339(),
        ..origin
    };
    let meta_json =
        serde_json::to_string_pretty(&new_origin).map_err(|e| format!("serialize meta: {}", e))?;
    fs::write(reference_meta_path(&dest_dir), meta_json)
        .map_err(|e| format!("write meta: {}", e))?;
    src.origin = Some(new_origin);
    let result = src.clone();
    write_sources_registry(&reg)?;
    Ok(result)
}

#[tauri::command]
pub(crate) fn list_distill_documents() -> Result<Vec<DistillDocument>, String> {
    let distill_dir = get_distill_dir();
    let index_path = distill_dir.join("index.jsonl");

    if !index_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let mut docs: Vec<DistillDocument> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut doc: DistillDocument = serde_json::from_str(line).ok()?;
            // Use actual file modification time instead of index.jsonl date
            let file_path = distill_dir.join(&doc.file);
            if let Ok(metadata) = fs::metadata(&file_path) {
                if let Ok(modified) = metadata.modified() {
                    let datetime: chrono::DateTime<chrono::Local> = modified.into();
                    doc.date = datetime.format("%Y-%m-%dT%H:%M:%S").to_string();
                }
            }
            Some(doc)
        })
        .collect();

    // Sort by date descending (newest first)
    docs.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(docs)
}

#[tauri::command]
pub(crate) fn find_session_project(session_id: String) -> Result<Option<Session>, String> {
    let projects_dir = get_claude_dir().join("projects");
    if !projects_dir.exists() {
        return Ok(None);
    }

    for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
        let project_entry = project_entry.map_err(|e| e.to_string())?;
        let project_path = project_entry.path();

        if !project_path.is_dir() {
            continue;
        }

        let session_file = project_path.join(format!("{}.jsonl", session_id));
        if session_file.exists() {
            let project_id = project_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let display_path = decode_project_path(&project_id);
            let content = fs::read_to_string(&session_file).unwrap_or_default();

            let mut summary = None;
            for line in content.lines() {
                if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                    if parsed.line_type.as_deref() == Some("summary") {
                        summary = parsed.summary;
                        break;
                    }
                }
            }

            return Ok(Some(Session {
                id: session_id,
                project_id,
                project_path: Some(display_path),
                title: None,
                summary,
                last_prompt: None,
                title_source: None,
                rounds: 0,
                message_count: 0,
                created_at: 0,
                last_modified: 0,
                usage: None,
                source: "cli".to_string(),
            }));
        }
    }
    Ok(None)
}

#[tauri::command]
pub(crate) fn get_distill_watch_enabled() -> bool {
    DISTILL_WATCH_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub(crate) fn set_distill_watch_enabled(enabled: bool) {
    DISTILL_WATCH_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}
