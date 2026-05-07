use super::*;

// ============================================================================
// Context Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ContextFile {
    pub name: String,
    pub path: String,
    pub scope: String, // "global" or "project"
    pub content: String,
    pub last_modified: u64,
}

#[tauri::command]
pub(crate) fn get_context_files() -> Result<Vec<ContextFile>, String> {
    let mut files = Vec::new();

    // Global CLAUDE.md
    let global_path = get_claude_dir().join("CLAUDE.md");
    if global_path.exists() {
        if let Ok(content) = fs::read_to_string(&global_path) {
            let last_modified = fs::metadata(&global_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: "CLAUDE.md".to_string(),
                path: global_path.to_string_lossy().to_string(),
                scope: "global".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check each project directory for CLAUDE.md
    let projects_dir = get_claude_dir().join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let project_path = entry.path();
                if project_path.is_dir() {
                    let project_id = project_path
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .to_string();
                    let display_path = decode_project_path(&project_id);

                    // Convert project_id back to real path and check for CLAUDE.md
                    let real_project_path = PathBuf::from(&display_path);
                    let claude_md_path = real_project_path.join("CLAUDE.md");

                    if claude_md_path.exists() {
                        if let Ok(content) = fs::read_to_string(&claude_md_path) {
                            let last_modified = fs::metadata(&claude_md_path)
                                .ok()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);

                            files.push(ContextFile {
                                name: format!("{}/CLAUDE.md", display_path),
                                path: claude_md_path.to_string_lossy().to_string(),
                                scope: "project".to_string(),
                                content,
                                last_modified,
                            });
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(files)
}

#[tauri::command]
pub(crate) fn get_project_context(project_path: String) -> Result<Vec<ContextFile>, String> {
    let mut files = Vec::new();
    let project_dir = PathBuf::from(&project_path);

    // Check for CLAUDE.md in project root
    let claude_md = project_dir.join("CLAUDE.md");
    if claude_md.exists() {
        if let Ok(content) = fs::read_to_string(&claude_md) {
            let last_modified = fs::metadata(&claude_md)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: "CLAUDE.md".to_string(),
                path: claude_md.to_string_lossy().to_string(),
                scope: "project".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check for .claude/CLAUDE.md in project
    let dot_claude_md = project_dir.join(".claude").join("CLAUDE.md");
    if dot_claude_md.exists() {
        if let Ok(content) = fs::read_to_string(&dot_claude_md) {
            let last_modified = fs::metadata(&dot_claude_md)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: ".claude/CLAUDE.md".to_string(),
                path: dot_claude_md.to_string_lossy().to_string(),
                scope: "project".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check for project-local commands in .claude/commands/
    let commands_dir = project_dir.join(".claude").join("commands");
    if commands_dir.exists() && commands_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&commands_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        let name = path.file_name().unwrap().to_string_lossy().to_string();
                        let last_modified = fs::metadata(&path)
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);

                        files.push(ContextFile {
                            name: format!(".claude/commands/{}", name),
                            path: path.to_string_lossy().to_string(),
                            scope: "command".to_string(),
                            content,
                            last_modified,
                        });
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(files)
}
