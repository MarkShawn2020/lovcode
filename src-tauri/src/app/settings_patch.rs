use super::*;

pub(crate) fn open_in_editor(path: String) -> Result<(), String> {
    let editor_commands = ["cursor", "code", "zed"];
    for editor in editor_commands {
        if std::process::Command::new(editor)
            .arg(&path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }

    #[cfg(target_os = "macos")]
    {
        let editor_apps = ["Cursor", "Visual Studio Code", "Zed"];
        for app in editor_apps {
            if let Ok(status) = std::process::Command::new("open")
                .arg("-a")
                .arg(app)
                .arg(&path)
                .status()
            {
                if status.success() {
                    return Ok(());
                }
            }
        }
    }

    Err(
        "No supported editor found. Install the Cursor, VS Code, or Zed command-line launcher."
            .to_string(),
    )
}

pub(crate) fn open_file_at_line(path: String, line: usize) -> Result<(), String> {
    // 尝试用 cursor，失败则用 code (VSCode)
    let editors = ["cursor", "code", "zed"];

    for editor in editors {
        let result = std::process::Command::new(editor)
            .arg("--goto")
            .arg(format!("{}:{}", path, line))
            .spawn();

        if result.is_ok() {
            return Ok(());
        }
    }

    // 都失败则用系统默认方式打开
    open_in_editor(path)
}

pub(crate) fn get_settings_path() -> String {
    get_claude_dir()
        .join("settings.json")
        .to_string_lossy()
        .to_string()
}

pub(crate) fn get_mcp_config_path() -> String {
    get_claude_json_path().to_string_lossy().to_string()
}

pub(crate) fn get_home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

pub(crate) fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TodayCodingStats {
    pub lines_added: usize,
    pub lines_deleted: usize,
}

pub(crate) static TODAY_STATS_CACHE: LazyLock<
    Mutex<Option<(std::time::SystemTime, TodayCodingStats)>>,
> = LazyLock::new(|| Mutex::new(None));

pub(crate) const TODAY_STATS_TTL: Duration = Duration::from_secs(30);

#[tauri::command]
pub(crate) async fn get_today_coding_stats() -> Result<TodayCodingStats, String> {
    if let Ok(guard) = TODAY_STATS_CACHE.lock() {
        if let Some((fetched_at, stats)) = guard.as_ref() {
            if fetched_at
                .elapsed()
                .map(|elapsed| elapsed < TODAY_STATS_TTL)
                .unwrap_or(false)
            {
                return Ok(stats.clone());
            }
        }
    }

    let stats = tauri::async_runtime::spawn_blocking(get_today_coding_stats_blocking)
        .await
        .map_err(|e| e.to_string())??;

    if let Ok(mut guard) = TODAY_STATS_CACHE.lock() {
        *guard = Some((std::time::SystemTime::now(), stats.clone()));
    }

    Ok(stats)
}

pub(crate) fn get_today_coding_stats_blocking() -> Result<TodayCodingStats, String> {
    use std::process::Command;

    let projects_dir = get_claude_dir().join("projects");
    if !projects_dir.exists() {
        return Ok(TodayCodingStats {
            lines_added: 0,
            lines_deleted: 0,
        });
    }

    // Collect project paths by decoding ~/.claude/projects/<encoded> dir names.
    let mut project_paths: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_dir() {
                let id = p.file_name().unwrap().to_string_lossy().to_string();
                project_paths.push(decode_project_path(&id));
            }
        }
    }

    let mut total_added: usize = 0;
    let mut total_deleted: usize = 0;
    let mut git_roots: std::collections::HashSet<String> = std::collections::HashSet::new();

    for path in &project_paths {
        let path = path.as_str();
        if !PathBuf::from(path).exists() {
            continue;
        }

        let output = Command::new("git")
            .args(["-C", path, "rev-parse", "--show-toplevel"])
            .output();

        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }

        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !root.is_empty() {
            git_roots.insert(root);
        }
    }

    let mut add_numstat = |bytes: &[u8]| {
        let stdout = String::from_utf8_lossy(bytes);
        for line in stdout.lines() {
            let mut cols = line.split('\t');
            let added = cols.next().unwrap_or("");
            let deleted = cols.next().unwrap_or("");
            if added == "-" || deleted == "-" {
                continue;
            }
            total_added += added.parse::<usize>().unwrap_or(0);
            total_deleted += deleted.parse::<usize>().unwrap_or(0);
        }
    };

    for root in git_roots {
        for args in [
            vec![
                "-C",
                root.as_str(),
                "log",
                "--since=midnight",
                "--numstat",
                "--pretty=format:",
            ],
            vec!["-C", root.as_str(), "diff", "--cached", "--numstat"],
            vec!["-C", root.as_str(), "diff", "--numstat"],
        ] {
            let output = Command::new("git").args(args).output();
            if let Ok(output) = output {
                if output.status.success() {
                    add_numstat(&output.stdout);
                }
            }
        }
    }

    Ok(TodayCodingStats {
        lines_added: total_added,
        lines_deleted: total_deleted,
    })
}

pub(crate) fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub(crate) fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn update_mcp_env(
    server_name: String,
    env_key: String,
    env_value: String,
) -> Result<(), String> {
    let claude_json_path = get_claude_json_path();

    let mut claude_json: serde_json::Value = if claude_json_path.exists() {
        let content = fs::read_to_string(&claude_json_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("~/.claude.json not found".to_string());
    };

    let server = claude_json
        .get_mut("mcpServers")
        .and_then(|s| s.get_mut(&server_name))
        .ok_or_else(|| format!("MCP server '{}' not found", server_name))?;

    if !server.get("env").is_some() {
        server["env"] = serde_json::json!({});
    }
    server["env"][&env_key] = serde_json::Value::String(env_value);

    let output = serde_json::to_string_pretty(&claude_json).map_err(|e| e.to_string())?;
    fs::write(&claude_json_path, output).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum SettingsPatch {
    SetEnv {
        #[serde(rename = "envKey")]
        env_key: String,
        #[serde(rename = "envValue")]
        env_value: String,
        #[serde(rename = "isNew")]
        is_new: Option<bool>,
    },
    DeleteEnv {
        #[serde(rename = "envKey")]
        env_key: String,
    },
    DisableEnv {
        #[serde(rename = "envKey")]
        env_key: String,
    },
    EnableEnv {
        #[serde(rename = "envKey")]
        env_key: String,
    },
    SetDisabledEnv {
        #[serde(rename = "envKey")]
        env_key: String,
        #[serde(rename = "envValue")]
        env_value: String,
    },
    SetField {
        field: String,
        value: Value,
    },
    SetPermissionField {
        field: String,
        value: Value,
    },
    AddPermissionDirectory {
        path: String,
    },
    RemovePermissionDirectory {
        path: String,
    },
    TogglePlugin {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        enabled: bool,
    },
}

pub(crate) fn ensure_settings_object(settings: &mut Value) {
    if !settings.is_object() {
        *settings = serde_json::json!({});
    }
}

pub(crate) fn ensure_settings_child_object(settings: &mut Value, key: &str) {
    ensure_settings_object(settings);
    if !settings
        .get(key)
        .and_then(|value| value.as_object())
        .is_some()
    {
        settings[key] = serde_json::json!({});
    }
}

pub(crate) fn remove_settings_overlay_fields(settings: &mut Value) {
    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }
}

pub(crate) fn apply_settings_patches(patches: Vec<SettingsPatch>) -> Result<(), String> {
    let _guard = SETTINGS_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let settings_path = get_claude_settings_path();
    let disabled_env_path = get_disabled_env_path();
    let mut settings = load_json_object_file(&settings_path)?;
    let mut disabled_env = load_disabled_env()?;

    ensure_settings_object(&mut settings);

    for patch in patches {
        match patch {
            SettingsPatch::SetEnv {
                env_key,
                env_value,
                is_new,
            } => {
                ensure_settings_child_object(&mut settings, "env");
                settings["env"][&env_key] = Value::String(env_value);

                if is_new == Some(true) {
                    let custom_keys = settings
                        .get("_lovcode_custom_env_keys")
                        .and_then(|value| value.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let key_value = Value::String(env_key);
                    if !custom_keys.contains(&key_value) {
                        let mut next_keys = custom_keys;
                        next_keys.push(key_value);
                        settings["_lovcode_custom_env_keys"] = Value::Array(next_keys);
                    }
                }
            }
            SettingsPatch::DeleteEnv { env_key } => {
                if let Some(env) = settings
                    .get_mut("env")
                    .and_then(|value| value.as_object_mut())
                {
                    env.remove(&env_key);
                }
                if let Some(custom_keys) = settings
                    .get_mut("_lovcode_custom_env_keys")
                    .and_then(|value| value.as_array_mut())
                {
                    custom_keys.retain(|value| value.as_str() != Some(&env_key));
                }
                disabled_env.remove(&env_key);
            }
            SettingsPatch::DisableEnv { env_key } => {
                let current_value = settings
                    .get("env")
                    .and_then(|env| env.get(&env_key))
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(env) = settings
                    .get_mut("env")
                    .and_then(|value| value.as_object_mut())
                {
                    env.remove(&env_key);
                }
                disabled_env.insert(env_key, Value::String(current_value));
            }
            SettingsPatch::EnableEnv { env_key } => {
                let disabled_value = disabled_env
                    .remove(&env_key)
                    .and_then(|value| value.as_str().map(str::to_string))
                    .unwrap_or_default();
                ensure_settings_child_object(&mut settings, "env");
                settings["env"][&env_key] = Value::String(disabled_value);
            }
            SettingsPatch::SetDisabledEnv { env_key, env_value } => {
                disabled_env.insert(env_key, Value::String(env_value));
            }
            SettingsPatch::SetField { field, value } => {
                ensure_settings_object(&mut settings);
                if let Some(obj) = settings.as_object_mut() {
                    obj.insert(field, value);
                }
            }
            SettingsPatch::SetPermissionField { field, value } => {
                ensure_settings_child_object(&mut settings, "permissions");
                settings["permissions"][&field] = value;
            }
            SettingsPatch::AddPermissionDirectory { path } => {
                ensure_settings_child_object(&mut settings, "permissions");
                let dirs = settings["permissions"]
                    .get("additionalDirectories")
                    .and_then(|value| value.as_array())
                    .cloned()
                    .unwrap_or_default();
                let path_value = Value::String(path);
                if !dirs.contains(&path_value) {
                    let mut next_dirs = dirs;
                    next_dirs.push(path_value);
                    settings["permissions"]["additionalDirectories"] = Value::Array(next_dirs);
                }
            }
            SettingsPatch::RemovePermissionDirectory { path } => {
                if let Some(dirs) = settings["permissions"]
                    .get_mut("additionalDirectories")
                    .and_then(|value| value.as_array_mut())
                {
                    dirs.retain(|value| value.as_str() != Some(&path));
                }
            }
            SettingsPatch::TogglePlugin { plugin_id, enabled } => {
                ensure_settings_child_object(&mut settings, "enabledPlugins");
                settings["enabledPlugins"][&plugin_id] = Value::Bool(enabled);
            }
        }
    }

    remove_settings_overlay_fields(&mut settings);
    write_json_file(&settings_path, &settings)?;
    write_json_file(&disabled_env_path, &Value::Object(disabled_env))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn patch_settings(patches: Vec<SettingsPatch>) -> Result<(), String> {
    apply_settings_patches(patches)
}

pub(crate) fn snake_to_camel(name: &str) -> String {
    let mut output = String::with_capacity(name.len());
    let mut uppercase_next = false;
    for ch in name.chars() {
        if ch == '_' {
            uppercase_next = true;
        } else if uppercase_next {
            output.push(ch.to_ascii_uppercase());
            uppercase_next = false;
        } else {
            output.push(ch);
        }
    }
    output
}

pub(crate) fn command_payload_value(payload: &Value, name: &str) -> Option<Value> {
    payload
        .get(name)
        .cloned()
        .or_else(|| payload.get(snake_to_camel(name)).cloned())
}

pub(crate) fn command_arg<T: DeserializeOwned>(payload: &Value, name: &str) -> Result<T, String> {
    let value = command_payload_value(payload, name)
        .ok_or_else(|| format!("missing command payload field '{}'", snake_to_camel(name)))?;
    serde_json::from_value(value).map_err(|e| {
        format!(
            "invalid command payload field '{}': {}",
            snake_to_camel(name),
            e
        )
    })
}

pub(crate) fn command_optional_arg<T: DeserializeOwned>(
    payload: &Value,
    name: &str,
) -> Result<Option<T>, String> {
    let Some(value) = command_payload_value(payload, name) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value).map(Some).map_err(|e| {
        format!(
            "invalid command payload field '{}': {}",
            snake_to_camel(name),
            e
        )
    })
}

pub(crate) fn command_json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}
