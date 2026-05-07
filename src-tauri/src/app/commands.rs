use super::*;

// ============================================================================
// Commands Feature
// ============================================================================

#[tauri::command]
pub(crate) fn list_local_commands() -> Result<Vec<LocalCommand>, String> {
    let claude_dir = get_claude_dir();
    let commands_dir = claude_dir.join("commands");
    let dot_commands_dir = claude_dir.join(".commands");
    let archived_dir = dot_commands_dir.join("archived");

    // One-time migration: check version marker
    let migration_marker = dot_commands_dir.join("migrated");
    let current_version = fs::read_to_string(&migration_marker).unwrap_or_default();

    // Run migrations if needed
    if !current_version.contains("v4") {
        run_command_migrations(&claude_dir, &commands_dir, &archived_dir);
        let _ = fs::create_dir_all(&dot_commands_dir);
        let _ = fs::write(&migration_marker, "v4");
    }

    let mut commands = Vec::new();

    // Collect active commands from commands/
    if commands_dir.exists() {
        collect_commands_from_dir(&commands_dir, &commands_dir, &mut commands, "active")?;
    }

    // Collect deprecated commands from .commands/archived/
    if archived_dir.exists() {
        collect_commands_from_dir(&archived_dir, &archived_dir, &mut commands, "deprecated")?;
    }

    commands.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(commands)
}

/// Run all pending migrations
pub(crate) fn run_command_migrations(
    claude_dir: &PathBuf,
    commands_dir: &PathBuf,
    archived_dir: &PathBuf,
) {
    // Migrate legacy .md.deprecated files
    migrate_deprecated_files_recursive(commands_dir, commands_dir, archived_dir);

    // Migrate files from old .archive/ subdirectories
    migrate_archive_subdirs_recursive(commands_dir, commands_dir, archived_dir);

    // Migrate from old .archived-commands/ directory (v3 format)
    let old_archived_dir = claude_dir.join(".archived-commands");
    if old_archived_dir.exists() {
        migrate_old_archived_commands(&old_archived_dir, archived_dir);
    }

    // Migrate orphan .changelog files
    migrate_orphan_changelogs(commands_dir, archived_dir);
}

/// Migrate from old .archived-commands/ to new .commands/archived/
pub(crate) fn migrate_old_archived_commands(old_dir: &PathBuf, new_dir: &PathBuf) {
    if let Ok(entries) = fs::read_dir(old_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(relative) = path.strip_prefix(old_dir) {
                let dest = new_dir.join(relative);
                if let Some(parent) = dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::rename(&path, &dest);
            }
        }
    }
    // Try to remove old directory
    let _ = fs::remove_dir_all(old_dir);
}

/// Recursively migrate .md.deprecated files to archived directory
pub(crate) fn migrate_deprecated_files_recursive(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    archived_dir: &PathBuf,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir()
                && !path
                    .file_name()
                    .map_or(false, |n| n.to_string_lossy().starts_with('.'))
            {
                migrate_deprecated_files_recursive(base_dir, &path, archived_dir);
            } else if path.extension().map_or(false, |e| e == "deprecated") {
                // Migrate .md.deprecated file
                if let Ok(relative) = path.strip_prefix(base_dir) {
                    let new_name = relative
                        .to_string_lossy()
                        .trim_end_matches(".deprecated")
                        .to_string();
                    let dest = archived_dir.join(&new_name);
                    if let Some(parent) = dest.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let _ = fs::rename(&path, &dest);

                    // Also migrate changelog if exists
                    let changelog_src = PathBuf::from(
                        path.to_string_lossy()
                            .replace(".md.deprecated", ".changelog"),
                    );
                    if changelog_src.exists() {
                        let changelog_dest =
                            archived_dir.join(new_name.replace(".md", ".changelog"));
                        let _ = fs::rename(&changelog_src, &changelog_dest);
                    }
                }
            }
        }
    }
}

/// Recursively migrate files from .archive/ subdirectories
pub(crate) fn migrate_archive_subdirs_recursive(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    archived_dir: &PathBuf,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name == ".archive" {
                    // Found .archive/ directory - migrate its contents
                    if let Ok(archive_entries) = fs::read_dir(&path) {
                        for archive_entry in archive_entries.flatten() {
                            let file_path = archive_entry.path();
                            if file_path.is_file() {
                                // Calculate relative path from base commands dir
                                let parent_relative =
                                    current_dir.strip_prefix(base_dir).unwrap_or(Path::new(""));
                                let filename = file_path.file_name().unwrap_or_default();
                                let dest = archived_dir.join(parent_relative).join(filename);
                                if let Some(parent) = dest.parent() {
                                    let _ = fs::create_dir_all(parent);
                                }
                                let _ = fs::rename(&file_path, &dest);
                            }
                        }
                    }
                    // Try to remove empty .archive/ directory
                    let _ = fs::remove_dir(&path);
                } else if !name.starts_with('.') {
                    migrate_archive_subdirs_recursive(base_dir, &path, archived_dir);
                }
            }
        }
    }
}

/// Migrate orphan .changelog files whose .md is in archived directory
pub(crate) fn migrate_orphan_changelogs(commands_dir: &PathBuf, archived_dir: &PathBuf) {
    if !archived_dir.exists() {
        return;
    }
    migrate_orphan_changelogs_recursive(commands_dir, commands_dir, archived_dir);
}

pub(crate) fn migrate_orphan_changelogs_recursive(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    archived_dir: &PathBuf,
) {
    if let Ok(entries) = fs::read_dir(current_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir()
                && !path
                    .file_name()
                    .map_or(false, |n| n.to_string_lossy().starts_with('.'))
            {
                migrate_orphan_changelogs_recursive(base_dir, &path, archived_dir);
            } else if path.extension().map_or(false, |e| e == "changelog") {
                // Check if corresponding .md exists in archived_dir
                if let Ok(relative) = path.strip_prefix(base_dir) {
                    let md_name = relative.to_string_lossy().replace(".changelog", ".md");
                    let archived_md = archived_dir.join(&md_name);
                    if archived_md.exists() {
                        let dest = archived_dir.join(relative);
                        if let Some(parent) = dest.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        let _ = fs::rename(&path, &dest);
                    }
                }
            }
        }
    }
}

/// Collect commands from a directory with a given status
pub(crate) fn collect_commands_from_dir(
    base_dir: &PathBuf,
    current_dir: &PathBuf,
    commands: &mut Vec<LocalCommand>,
    status: &str,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            // Skip hidden directories
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if !name.starts_with('.') {
                collect_commands_from_dir(base_dir, &path, commands, status)?;
            }
        } else {
            let filename = path.file_name().unwrap_or_default().to_string_lossy();

            // Determine file type
            let (is_command, name_suffix) = if filename.ends_with(".md.archived") {
                (true, ".md.archived")
            } else if filename.ends_with(".md") {
                (true, ".md")
            } else {
                (false, "")
            };

            if is_command {
                let relative = path.strip_prefix(base_dir).unwrap_or(&path);
                let name = relative
                    .to_string_lossy()
                    .trim_end_matches(name_suffix)
                    .replace("\\", "/")
                    .to_string();

                let content = fs::read_to_string(&path).unwrap_or_default();
                let (frontmatter, raw_frontmatter, body) = parse_frontmatter(&content);

                // Use "archived" status for .md.archived files, otherwise use provided status
                let actual_status = if filename.ends_with(".md.archived") {
                    "archived"
                } else {
                    status
                };

                // Read changelog if exists (same directory, .changelog extension)
                let changelog = path
                    .parent()
                    .map(|dir| {
                        let base = path.file_stem().unwrap_or_default().to_string_lossy();
                        dir.join(format!("{}.changelog", base))
                    })
                    .filter(|p| p.exists())
                    .and_then(|p| fs::read_to_string(p).ok());

                // Parse aliases: comma-separated list of previous command names
                let aliases = frontmatter
                    .get("aliases")
                    .map(|s| {
                        s.split(',')
                            .map(|a| {
                                a.trim()
                                    .trim_matches(|c| c == '[' || c == ']' || c == '"' || c == '\'')
                                    .to_string()
                            })
                            .filter(|a| !a.is_empty())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                commands.push(LocalCommand {
                    name: format!("/{}", name),
                    path: path.to_string_lossy().to_string(),
                    description: frontmatter.get("description").cloned(),
                    allowed_tools: frontmatter.get("allowed-tools").cloned(),
                    argument_hint: frontmatter.get("argument-hint").cloned(),
                    content: body,
                    version: frontmatter.get("version").cloned(),
                    status: actual_status.to_string(),
                    deprecated_by: frontmatter.get("replaced-by").cloned(),
                    changelog,
                    aliases,
                    frontmatter: raw_frontmatter,
                });
            }
        }
    }
    Ok(())
}

pub(crate) fn parse_frontmatter(
    content: &str,
) -> (HashMap<String, String>, Option<String>, String) {
    let mut frontmatter = HashMap::new();
    let mut raw_frontmatter: Option<String> = None;
    let mut body = content.to_string();

    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let fm_content = &content[3..end_idx + 3];
            raw_frontmatter = Some(fm_content.trim().to_string());
            body = content[end_idx + 6..].trim_start().to_string();

            for line in fm_content.lines() {
                if let Some(colon_idx) = line.find(':') {
                    let key = line[..colon_idx].trim().to_string();
                    let value = line[colon_idx + 1..].trim();
                    // Strip surrounding quotes from YAML values
                    let value = value.trim_matches('"').trim_matches('\'').to_string();
                    frontmatter.insert(key, value);
                }
            }
        }
    }

    (frontmatter, raw_frontmatter, body)
}

/// Rename a command file (supports path changes like /foo/bar -> /foo/baz/bar)
#[tauri::command]
pub(crate) fn rename_command(
    path: String,
    new_name: String,
    create_dir: Option<bool>,
) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    if !path.ends_with(".md") {
        return Err("Can only rename .md commands".to_string());
    }

    // Parse new_name as a command path (e.g., /lovstudio/repo/takeover)
    let name = new_name.trim().trim_start_matches('/');
    if name.is_empty() {
        return Err("New name cannot be empty".to_string());
    }

    // Build destination path from command name
    let commands_dir = get_claude_dir().join("commands");
    let new_filename = if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{}.md", name)
    };
    let dest = commands_dir.join(&new_filename);

    // Check if destination directory exists
    if let Some(dest_parent) = dest.parent() {
        if !dest_parent.exists() {
            if create_dir.unwrap_or(false) {
                fs::create_dir_all(dest_parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            } else {
                // Return special error for frontend to show confirmation
                return Err(format!("DIR_NOT_EXIST:{}", dest_parent.to_string_lossy()));
            }
        }
    }

    if dest.exists() && dest != src {
        return Err(format!(
            "A command with name '{}' already exists",
            new_filename
        ));
    }

    if dest != src {
        // Calculate old command name (derive from filename without .md)
        let old_basename = src
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Cannot get old filename")?;
        let old_name =
            if let Ok(relative) = src.parent().unwrap_or(&src).strip_prefix(&commands_dir) {
                if relative.as_os_str().is_empty() {
                    format!("/{}", old_basename)
                } else {
                    format!("/{}/{}", relative.to_string_lossy(), old_basename)
                }
            } else {
                format!("/{}", old_basename)
            };

        // Calculate new command name
        let new_basename = dest
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Cannot get new filename")?;
        let new_name =
            if let Ok(relative) = dest.parent().unwrap_or(&dest).strip_prefix(&commands_dir) {
                if relative.as_os_str().is_empty() {
                    format!("/{}", new_basename)
                } else {
                    format!("/{}/{}", relative.to_string_lossy(), new_basename)
                }
            } else {
                format!("/{}", new_basename)
            };

        // Update aliases: add old name, remove new name if it was an alias
        let content = fs::read_to_string(&src).map_err(|e| e.to_string())?;
        let updated = update_aliases_on_rename(&content, &old_name, &new_name);
        if updated != content {
            fs::write(&src, &updated).map_err(|e| e.to_string())?;
        }

        fs::rename(&src, &dest).map_err(|e| e.to_string())?;

        // Also rename associated .changelog file if exists
        let changelog_src = src.with_extension("changelog");
        if changelog_src.exists() {
            let changelog_dest = dest.with_extension("changelog");
            let _ = fs::rename(&changelog_src, &changelog_dest);
        }
    }

    Ok(dest.to_string_lossy().to_string())
}

pub(crate) fn update_aliases_on_rename(content: &str, old_name: &str, new_name: &str) -> String {
    // Parse existing aliases from frontmatter
    let (existing_aliases, has_frontmatter) = if content.starts_with("---") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() >= 3 {
            let frontmatter = parts[1];
            if let Some(line) = frontmatter
                .lines()
                .find(|l| l.trim_start().starts_with("aliases:"))
            {
                let value_part = line.split(':').nth(1).unwrap_or("").trim();
                let aliases: Vec<String> = value_part
                    .trim_matches('"')
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                (aliases, true)
            } else {
                (Vec::new(), true)
            }
        } else {
            (Vec::new(), false)
        }
    } else {
        (Vec::new(), false)
    };

    // Build new aliases: add old_name, remove new_name
    let mut new_aliases: Vec<String> = existing_aliases
        .into_iter()
        .filter(|a| a != new_name)
        .collect();

    if !new_aliases.contains(&old_name.to_string()) {
        new_aliases.push(old_name.to_string());
    }

    // Update frontmatter
    if !has_frontmatter {
        if new_aliases.is_empty() {
            return content.to_string();
        }
        return format!(
            "---\naliases: \"{}\"\n---\n\n{}",
            new_aliases.join(", "),
            content
        );
    }

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    let frontmatter = parts[1];
    let body = parts[2];

    if let Some(aliases_line_idx) = frontmatter
        .lines()
        .position(|l| l.trim_start().starts_with("aliases:"))
    {
        let lines: Vec<&str> = frontmatter.lines().collect();

        let new_frontmatter: Vec<String> = lines
            .iter()
            .enumerate()
            .filter_map(|(i, &l)| {
                if i == aliases_line_idx {
                    if new_aliases.is_empty() {
                        None // Remove the line if no aliases
                    } else {
                        Some(format!("aliases: \"{}\"", new_aliases.join(", ")))
                    }
                } else {
                    Some(l.to_string())
                }
            })
            .collect();

        format!("---{}---{}", new_frontmatter.join("\n"), body)
    } else if !new_aliases.is_empty() {
        // No aliases field, add it
        let new_frontmatter = format!(
            "{}\naliases: \"{}\"",
            frontmatter.trim_end(),
            new_aliases.join(", ")
        );
        format!("---{}---{}", new_frontmatter, body)
    } else {
        content.to_string()
    }
}

/// Deprecate a command by moving it to ~/.claude/.commands/archived/
/// This moves it outside the commands directory so Claude Code won't load it
#[tauri::command]
pub(crate) fn deprecate_command(
    path: String,
    replaced_by: Option<String>,
    note: Option<String>,
) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    let commands_dir = get_claude_dir().join("commands");
    let archived_dir = get_claude_dir().join(".commands").join("archived");

    // Only allow deprecating active .md files from commands directory
    if !path.ends_with(".md") {
        return Err("Can only deprecate .md commands".to_string());
    }

    // Check if already archived
    if src.starts_with(&archived_dir) {
        return Err("Command is already archived".to_string());
    }

    // Update frontmatter with replaced_by and/or note
    let content = fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let mut updated = content.clone();
    if let Some(replacement) = &replaced_by {
        updated = add_frontmatter_field(&updated, "replaced-by", replacement);
    }
    if let Some(n) = &note {
        updated = add_frontmatter_field(&updated, "deprecation-note", n);
    }
    if updated != content {
        fs::write(&src, updated).map_err(|e| e.to_string())?;
    }

    // Calculate relative path from commands directory
    let relative = src
        .strip_prefix(&commands_dir)
        .map_err(|_| "Command is not in commands directory")?;

    // Create destination path in archived directory (preserving subdirectory structure)
    let dest = archived_dir.join(relative);
    if let Some(dest_parent) = dest.parent() {
        fs::create_dir_all(dest_parent).map_err(|e| e.to_string())?;
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    // Also move associated .changelog file if exists
    let base_name = src.with_extension("");
    let changelog_src = base_name.with_extension("changelog");
    if changelog_src.exists() {
        let changelog_relative = changelog_src
            .strip_prefix(&commands_dir)
            .map_err(|_| "Changelog is not in commands directory")?;
        let changelog_dest = archived_dir.join(changelog_relative);
        let _ = fs::rename(&changelog_src, &changelog_dest);
    }

    Ok(dest.to_string_lossy().to_string())
}

/// Archive a command by moving it to versions/ directory with version suffix
pub(crate) fn archive_command(path: String, version: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    // Get the commands directory and create versions/ if needed
    let commands_dir = src.parent().unwrap_or(&src);
    let versions_dir = commands_dir.join("versions");
    fs::create_dir_all(&versions_dir).map_err(|e| e.to_string())?;

    // Get base name and create versioned filename
    let filename = src.file_name().unwrap_or_default().to_string_lossy();
    let base_name = filename.trim_end_matches(".md");
    let versioned_name = format!("{}.v{}.md.archived", base_name, version);
    let dest = versions_dir.join(versioned_name);

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

/// Restore a deprecated or archived command to active status
#[tauri::command]
pub(crate) fn restore_command(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    let commands_dir = get_claude_dir().join("commands");
    let archived_dir = get_claude_dir().join(".commands").join("archived");
    let path_str = src.to_string_lossy();

    // Determine source type and calculate destination
    let dest = if src.starts_with(&archived_dir) {
        // From .commands/archived/ - restore to commands/
        let relative = src
            .strip_prefix(&archived_dir)
            .map_err(|_| "Cannot get relative path")?;
        commands_dir.join(relative)
    } else if path_str.contains("/.archive/") || path_str.contains("\\.archive\\") {
        // Legacy: from .archive/ subdirectory - move to parent
        let archive_dir = src.parent().ok_or("Cannot get parent directory")?;
        let parent = archive_dir
            .parent()
            .ok_or("Cannot get grandparent directory")?;
        let filename = src.file_name().ok_or("Cannot get filename")?;
        parent.join(filename)
    } else if path_str.ends_with(".md.deprecated") {
        // Legacy: remove .deprecated suffix
        PathBuf::from(path_str.trim_end_matches(".deprecated"))
    } else if path_str.ends_with(".md.archived") {
        // From versions/ - restore to parent with base name
        let parent = src.parent().and_then(|p| p.parent()).unwrap_or(&src);
        let file_name = src.file_name().unwrap_or_default().to_string_lossy();
        let base = file_name.split(".v").next().unwrap_or(&file_name);
        parent.join(format!("{}.md", base))
    } else {
        return Err("File is not deprecated or archived".to_string());
    };

    // Check if destination already exists
    if dest.exists() {
        return Err(format!("Cannot restore: {} already exists", dest.display()));
    }

    // Create destination directory if needed
    if let Some(dest_parent) = dest.parent() {
        fs::create_dir_all(dest_parent).map_err(|e| e.to_string())?;
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;

    // Also restore associated .changelog file if exists
    if src.starts_with(&archived_dir) {
        let base_name = src.with_extension("");
        let changelog_src = base_name.with_extension("changelog");
        if changelog_src.exists() {
            let changelog_relative = changelog_src
                .strip_prefix(&archived_dir)
                .map_err(|_| "Cannot get changelog relative path")?;
            let changelog_dest = commands_dir.join(changelog_relative);
            let _ = fs::rename(&changelog_src, &changelog_dest);
        }
    }

    Ok(dest.to_string_lossy().to_string())
}

/// Helper to add a field to frontmatter
pub(crate) fn add_frontmatter_field(content: &str, key: &str, value: &str) -> String {
    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let fm_content = &content[3..end_idx + 3];
            let body = &content[end_idx + 6..];
            return format!("---\n{}{}: {}\n---{}", fm_content, key, value, body);
        }
    }
    // No frontmatter, add one
    format!("---\n{}: {}\n---\n\n{}", key, value, content)
}

/// Helper to update or add a field in frontmatter
pub(crate) fn update_frontmatter_field(content: &str, key: &str, value: &str) -> String {
    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let fm_content = &content[3..end_idx + 3];
            let body = &content[end_idx + 6..];

            // Check if key exists and update it
            let mut found = false;
            let mapped: Vec<String> = fm_content
                .lines()
                .map(|line| {
                    if let Some(colon_idx) = line.find(':') {
                        let k = line[..colon_idx].trim();
                        if k == key {
                            found = true;
                            if value.is_empty() {
                                return String::new(); // Remove the field
                            }
                            return format!("{}: {}", key, value);
                        }
                    }
                    line.to_string()
                })
                .collect();
            let updated_fm: Vec<String> = mapped
                .into_iter()
                .filter(|l| !l.is_empty() || !found)
                .collect();

            let fm_str = updated_fm.join("\n");
            if found {
                return format!("---\n{}\n---{}", fm_str, body);
            } else if !value.is_empty() {
                // Key not found, add it
                return format!("---\n{}\n{}: {}\n---{}", fm_str, key, value, body);
            }
            return format!("---\n{}\n---{}", fm_str, body);
        }
    }
    // No frontmatter, add one if value is not empty
    if value.is_empty() {
        content.to_string()
    } else {
        format!("---\n{}: {}\n---\n\n{}", key, value, content)
    }
}

/// Update aliases for a command
#[tauri::command]
pub(crate) fn update_command_aliases(path: String, aliases: Vec<String>) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("Command file not found: {}", path));
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;

    // Format aliases as comma-separated string
    let aliases_value = aliases.join(", ");
    let updated_content = update_frontmatter_field(&content, "aliases", &aliases_value);

    fs::write(&file_path, updated_content).map_err(|e| e.to_string())?;
    Ok(())
}
