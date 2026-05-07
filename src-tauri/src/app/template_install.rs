use super::*;

pub(crate) fn get_templates_catalog(
    app_handle: tauri::AppHandle,
) -> Result<TemplatesCatalog, String> {
    let mut all_components: Vec<TemplateComponent> = Vec::new();
    let mut source_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();

    // Load from each source
    for source in PLUGIN_SOURCES {
        let components = if source.path.ends_with(".json") {
            // Community catalog (JSON file)
            load_community_catalog(Some(&app_handle), source)
        } else if source.id == "lovstudio" {
            // Single plugin directory
            load_single_plugin(Some(&app_handle), source)
        } else {
            // Multi-plugin directory
            load_plugin_directory(Some(&app_handle), source)
        };

        source_counts.insert(source.id.to_string(), components.len());
        all_components.extend(components);
    }

    // Separate by type
    let mut agents = Vec::new();
    let mut commands = Vec::new();
    let mut mcps = Vec::new();
    let mut hooks = Vec::new();
    let mut settings = Vec::new();
    let mut skills = Vec::new();
    let mut statuslines = Vec::new();

    for comp in all_components {
        match comp.component_type.as_str() {
            "agent" => agents.push(comp),
            "command" => commands.push(comp),
            "mcp" => mcps.push(comp),
            "hook" => hooks.push(comp),
            "setting" => settings.push(comp),
            "skill" => skills.push(comp),
            "statusline" => statuslines.push(comp),
            _ => {} // Ignore unknown types
        }
    }

    // Add personal/installed statuslines
    let personal_statuslines = load_personal_statuslines();
    let personal_count = personal_statuslines.len();
    statuslines.extend(personal_statuslines);

    // Build source info
    let mut sources: Vec<SourceInfo> = PLUGIN_SOURCES
        .iter()
        .map(|s| SourceInfo {
            id: s.id.to_string(),
            name: s.name.to_string(),
            icon: s.icon.to_string(),
            count: *source_counts.get(s.id).unwrap_or(&0),
        })
        .collect();

    // Add personal source if there are installed statuslines
    if personal_count > 0 {
        sources.insert(
            0,
            SourceInfo {
                id: "personal".to_string(),
                name: "Installed".to_string(),
                icon: "📦".to_string(),
                count: personal_count,
            },
        );
    }

    Ok(TemplatesCatalog {
        agents,
        commands,
        mcps,
        hooks,
        settings,
        skills,
        statuslines,
        sources,
    })
}

pub(crate) fn install_command_template(name: String, content: String) -> Result<String, String> {
    let commands_dir = get_claude_dir().join("commands");
    fs::create_dir_all(&commands_dir).map_err(|e| e.to_string())?;

    let file_path = safe_template_path(&commands_dir, &name, "md", true)?;
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&file_path, content).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Install a skill template to the active agent skills home.
pub(crate) fn install_skill_template(
    name: String,
    content: String,
    source_id: Option<String>,
    source_name: Option<String>,
    author: Option<String>,
    downloads: Option<i64>,
    template_path: Option<String>,
) -> Result<String, String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("Skill name contains invalid characters".to_string());
    }

    // Update an existing skill in-place. New installs use the preferred agent
    // skills home: ~/.agent, ~/.agents, then legacy ~/.claude.
    let skill_home = find_skill_home(&name).unwrap_or_else(get_preferred_skill_home);
    let skill_dir = skill_home.path.join("skills").join(&name);
    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    // Write SKILL.md file
    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, &content).map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    // Save marketplace metadata if provided
    if source_id.is_some() || source_name.is_some() || author.is_some() {
        let meta = MarketplaceMeta {
            source_id,
            source_name,
            vendor: None,
            author,
            homepage: None,
            downloads,
            template_path,
        };
        let meta_path = skill_dir.join(".meta.json");
        if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
            let _ = fs::write(&meta_path, meta_json);
        }
    }

    Ok(skill_file.to_string_lossy().to_string())
}

/// Uninstall a skill by removing its directory
pub(crate) fn uninstall_skill(name: String) -> Result<String, String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }

    let Some(skill_home) = find_skill_home(&name) else {
        return Err(format!("Skill '{}' not found", name));
    };

    let skill_dir = skill_home.path.join("skills").join(&name);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    fs::remove_dir_all(&skill_dir).map_err(|e| format!("Failed to remove skill: {}", e))?;
    Ok(format!(
        "Uninstalled skill: {} from {}",
        name, skill_home.label
    ))
}

/// Check if a skill is already installed
pub(crate) fn check_skill_installed(name: String) -> bool {
    find_skill_home(&name).is_some()
}

pub(crate) fn install_mcp_template(name: String, config: String) -> Result<String, String> {
    // MCP servers are stored in ~/.claude.json (not ~/.claude/settings.json)
    let claude_json_path = get_claude_json_path();

    // Parse the MCP config
    let mcp_config: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;

    // Helper to check if a value looks like an actual MCP server config
    // (has type, url, or command field)
    fn is_server_config(v: &serde_json::Value) -> bool {
        v.get("type").is_some() || v.get("url").is_some() || v.get("command").is_some()
    }

    // Recursively extract the actual server config, unwrapping any nesting
    fn extract_server_config(v: serde_json::Value) -> serde_json::Value {
        // If it's already a valid config, return it
        if is_server_config(&v) {
            return v;
        }

        // Try to unwrap {"mcpServers": {...}}
        if let Some(mcp_servers) = v.get("mcpServers").and_then(|x| x.as_object()) {
            if let Some(inner) = mcp_servers.values().next() {
                return extract_server_config(inner.clone());
            }
        }

        // Try to unwrap {"someName": {config}}
        if let Some(obj) = v.as_object() {
            if obj.len() == 1 {
                if let Some(inner) = obj.values().next() {
                    if is_server_config(inner) || inner.is_object() {
                        return extract_server_config(inner.clone());
                    }
                }
            }
        }

        v
    }

    let server_config = extract_server_config(mcp_config);

    // Read existing ~/.claude.json or create new
    let mut claude_json: serde_json::Value = if claude_json_path.exists() {
        let content = fs::read_to_string(&claude_json_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure mcpServers exists
    if !claude_json.get("mcpServers").is_some() {
        claude_json["mcpServers"] = serde_json::json!({});
    }

    // Ensure the server config has a 'type' field (required by Claude Code)
    // Infer type from the config if not present:
    // - If has "url" field -> "http" (or "sse" if url contains /sse)
    // - If has "command" field -> "stdio"
    let mut server_config = server_config;
    if server_config.get("type").is_none() {
        if let Some(url) = server_config.get("url").and_then(|v| v.as_str()) {
            // Check if it's an SSE endpoint
            let transport_type = if url.ends_with("/sse") || url.contains("/sse/") {
                "sse"
            } else {
                "http"
            };
            server_config["type"] = serde_json::json!(transport_type);
        } else if server_config.get("command").is_some() {
            server_config["type"] = serde_json::json!("stdio");
        }
    }

    // Add the MCP server with the extracted config
    claude_json["mcpServers"][&name] = server_config;

    // Write back
    let output = serde_json::to_string_pretty(&claude_json).map_err(|e| e.to_string())?;
    fs::write(&claude_json_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Installed MCP: {}", name))
}

pub(crate) fn uninstall_mcp_template(name: String) -> Result<String, String> {
    let claude_json_path = get_claude_json_path();

    if !claude_json_path.exists() {
        return Err("No MCP configuration found".to_string());
    }

    let content = fs::read_to_string(&claude_json_path).map_err(|e| e.to_string())?;
    let mut claude_json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(mcp_servers) = claude_json
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
    {
        if mcp_servers.remove(&name).is_none() {
            return Err(format!("MCP '{}' not found", name));
        }
    } else {
        return Err("No mcpServers found".to_string());
    }

    let output = serde_json::to_string_pretty(&claude_json).map_err(|e| e.to_string())?;
    fs::write(&claude_json_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Uninstalled MCP: {}", name))
}

pub(crate) fn check_mcp_installed(name: String) -> bool {
    let claude_json_path = get_claude_json_path();

    if !claude_json_path.exists() {
        return false;
    }

    let Ok(content) = fs::read_to_string(&claude_json_path) else {
        return false;
    };

    let Ok(claude_json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };

    claude_json
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .map(|servers| servers.contains_key(&name))
        .unwrap_or(false)
}

pub(crate) fn install_hook_template(name: String, config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    // Parse the hook config (should be an object with event type as key)
    let hook_config: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| e.to_string())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure hooks exists
    if !settings.get("hooks").is_some() {
        settings["hooks"] = serde_json::json!({});
    }

    // Merge hook config - hooks are typically structured as {"PreToolUse": [...], "PostToolUse": [...]}
    if let Some(hook_obj) = hook_config.as_object() {
        for (event_type, handlers) in hook_obj {
            if let Some(handlers_arr) = handlers.as_array() {
                // Get existing handlers for this event type
                let existing = settings["hooks"]
                    .get(event_type)
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                // Merge (append new handlers)
                let mut merged: Vec<serde_json::Value> = existing;
                merged.extend(handlers_arr.clone());
                settings["hooks"][event_type] = serde_json::Value::Array(merged);
            }
        }
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Installed hook: {}", name))
}

pub(crate) fn install_setting_template(config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    // Parse the setting config
    let new_settings: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| e.to_string())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Deep merge the new settings
    if let (Some(existing_obj), Some(new_obj)) =
        (settings.as_object_mut(), new_settings.as_object())
    {
        for (key, value) in new_obj {
            existing_obj.insert(key.clone(), value.clone());
        }
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok("Settings updated".to_string())
}

pub(crate) fn update_settings_statusline(statusline: serde_json::Value) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };

    settings["statusLine"] = statusline;

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn remove_settings_statusline() -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(obj) = settings.as_object_mut() {
        obj.remove("statusLine");
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn write_statusline_script(content: String) -> Result<String, String> {
    let script_path = get_claude_dir().join("statusline.sh");
    fs::write(&script_path, &content).map_err(|e| e.to_string())?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&script_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms).map_err(|e| e.to_string())?;
    }

    Ok(script_path.to_string_lossy().to_string())
}

/// Install statusline template to ~/.lovstudio/lovcode/statusline/{name}.sh
pub(crate) fn install_statusline_template(name: String, content: String) -> Result<String, String> {
    let statusline_dir = get_lovstudio_dir().join("statusline");
    fs::create_dir_all(&statusline_dir).map_err(|e| e.to_string())?;

    let script_path = safe_template_path(&statusline_dir, &name, "sh", false)?;
    fs::write(&script_path, &content).map_err(|e| e.to_string())?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&script_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms).map_err(|e| e.to_string())?;
    }

    Ok(script_path.to_string_lossy().to_string())
}

/// Apply statusline: copy from ~/.lovstudio/lovcode/statusline/{name}.sh to ~/.claude/statusline.sh
/// If ~/.claude/statusline.sh exists and is not already installed, backup to ~/.lovstudio/lovcode/statusline/_previous.sh
pub(crate) fn apply_statusline(name: String) -> Result<String, String> {
    let statusline_dir = get_lovstudio_dir().join("statusline");
    let source_path = safe_template_path(&statusline_dir, &name, "sh", false)?;
    if !source_path.exists() {
        return Err(format!("Statusline template not found: {}", name));
    }

    let target_path = get_claude_dir().join("statusline.sh");
    let backup_dir = get_lovstudio_dir().join("statusline");
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    // Backup existing statusline.sh if it exists and differs from source
    if target_path.exists() {
        let existing_content = fs::read_to_string(&target_path).unwrap_or_default();
        let new_content = fs::read_to_string(&source_path).map_err(|e| e.to_string())?;

        if existing_content != new_content {
            let backup_path = backup_dir.join("_previous.sh");
            fs::copy(&target_path, &backup_path).map_err(|e| e.to_string())?;
        }
    }

    let content = fs::read_to_string(&source_path).map_err(|e| e.to_string())?;
    fs::write(&target_path, &content).map_err(|e| e.to_string())?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&target_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&target_path, perms).map_err(|e| e.to_string())?;
    }

    Ok(target_path.to_string_lossy().to_string())
}

/// Restore previous statusline from backup
pub(crate) fn restore_previous_statusline() -> Result<String, String> {
    let backup_path = get_lovstudio_dir().join("statusline").join("_previous.sh");
    if !backup_path.exists() {
        return Err("No previous statusline to restore".to_string());
    }

    let content = fs::read_to_string(&backup_path).map_err(|e| e.to_string())?;
    let target_path = get_claude_dir().join("statusline.sh");
    fs::write(&target_path, &content).map_err(|e| e.to_string())?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&target_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&target_path, perms).map_err(|e| e.to_string())?;
    }

    // Remove backup after restore
    fs::remove_file(&backup_path).ok();

    Ok(target_path.to_string_lossy().to_string())
}

/// Check if previous statusline backup exists
pub(crate) fn has_previous_statusline() -> bool {
    get_lovstudio_dir()
        .join("statusline")
        .join("_previous.sh")
        .exists()
}

/// Context passed to Lovcode statusbar script
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct StatusBarContext {
    pub app_name: String,
    pub version: String,
    pub projects_count: usize,
    pub features_count: usize,
    pub today_lines_added: usize,
    pub today_lines_deleted: usize,
    pub timestamp: String,
    pub home_dir: String,
}

/// Execute Lovcode's GUI statusbar script and return output
pub(crate) fn execute_statusbar_script(
    script_path: String,
    context: StatusBarContext,
) -> Result<String, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    // Expand ~ to home dir
    let home = dirs::home_dir().unwrap_or_default();
    let expanded_path = if script_path.starts_with("~") {
        script_path.replacen("~", &home.to_string_lossy(), 1)
    } else {
        script_path
    };

    let path = std::path::Path::new(&expanded_path);
    if !path.exists() {
        return Err(format!("Script not found: {}", expanded_path));
    }

    // Serialize context to JSON
    let context_json = serde_json::to_string(&context).map_err(|e| e.to_string())?;

    // Determine how to execute the script
    #[cfg(unix)]
    let mut child = Command::new(&expanded_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn script: {}", e))?;

    #[cfg(windows)]
    let mut child = Command::new("powershell")
        .args(["-ExecutionPolicy", "Bypass", "-File", &expanded_path])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn script: {}", e))?;

    // Write context JSON to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(context_json.as_bytes()).ok();
    }

    // Wait for output with timeout
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Script execution failed: {}", e))?;

    // Get first line of stdout
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("").to_string();

    Ok(first_line)
}

/// Get Lovcode statusbar settings from statusbar-settings.json
pub(crate) fn get_statusbar_settings() -> Result<Option<serde_json::Value>, String> {
    let settings_path = get_lovstudio_dir().join("statusbar-settings.json");
    if !settings_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let settings: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(settings))
}

/// Save Lovcode statusbar settings
pub(crate) fn save_statusbar_settings(settings: serde_json::Value) -> Result<(), String> {
    let settings_path = get_lovstudio_dir().join("statusbar-settings.json");
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, content).map_err(|e| e.to_string())
}

/// Write Lovcode statusbar script to ~/.lovstudio/lovcode/statusbar/
pub(crate) fn write_lovcode_statusbar_script(
    name: String,
    content: String,
) -> Result<String, String> {
    let statusbar_dir = get_lovstudio_dir().join("statusbar");
    fs::create_dir_all(&statusbar_dir).map_err(|e| e.to_string())?;

    let script_path = safe_template_path(&statusbar_dir, &name, "sh", false)?;
    fs::write(&script_path, &content).map_err(|e| e.to_string())?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&script_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms).map_err(|e| e.to_string())?;
    }

    Ok(script_path.to_string_lossy().to_string())
}

/// Remove installed statusline template
pub(crate) fn remove_statusline_template(name: String) -> Result<(), String> {
    let statusline_dir = get_lovstudio_dir().join("statusline");
    let script_path = safe_template_path(&statusline_dir, &name, "sh", false)?;
    if script_path.exists() {
        fs::remove_file(&script_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
