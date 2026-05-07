use super::*;

// ============================================================================
// Extensions Management
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub marketplace: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ExtensionMarketplace {
    pub id: String,
    pub name: String,
    pub repo: Option<String>,
    pub path: Option<String>,
    pub is_official: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct MarketplacePlugin {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
}

#[tauri::command]
pub(crate) fn list_installed_plugins() -> Result<Vec<InstalledPlugin>, String> {
    let settings_path = get_claude_dir().join("settings.json");

    if !settings_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let settings: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mut plugins = vec![];

    if let Some(enabled_plugins) = settings.get("enabledPlugins").and_then(|v| v.as_object()) {
        for (id, enabled) in enabled_plugins {
            let parts: Vec<&str> = id.split('@').collect();
            let (name, marketplace) = if parts.len() >= 2 {
                (parts[0].to_string(), parts[1..].join("@"))
            } else {
                (id.clone(), "unknown".to_string())
            };

            plugins.push(InstalledPlugin {
                id: id.clone(),
                name,
                marketplace,
                enabled: enabled.as_bool().unwrap_or(false),
            });
        }
    }

    Ok(plugins)
}

#[tauri::command]
pub(crate) fn list_extension_marketplaces() -> Result<Vec<ExtensionMarketplace>, String> {
    let settings_path = get_claude_dir().join("settings.json");

    let mut marketplaces = vec![ExtensionMarketplace {
        id: "claude-plugins-official".to_string(),
        name: "Claude Plugins Official".to_string(),
        repo: Some("anthropics/claude-code".to_string()),
        path: None,
        is_official: true,
    }];

    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        let settings: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(extra) = settings
            .get("extraKnownMarketplaces")
            .and_then(|v| v.as_object())
        {
            for (id, config) in extra {
                let repo = config
                    .get("source")
                    .and_then(|s| s.get("repo"))
                    .and_then(|r| r.as_str())
                    .map(|s| s.to_string());
                let path = config
                    .get("source")
                    .and_then(|s| s.get("path"))
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());

                marketplaces.push(ExtensionMarketplace {
                    id: id.clone(),
                    name: id.clone(),
                    repo,
                    path,
                    is_official: false,
                });
            }
        }
    }

    Ok(marketplaces)
}

#[tauri::command]
pub(crate) async fn fetch_marketplace_plugins(
    owner: String,
    repo: String,
    plugins_path: Option<String>,
) -> Result<Vec<MarketplacePlugin>, String> {
    let path = plugins_path.unwrap_or_else(|| "plugins".to_string());
    let url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        owner, repo, path
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "lovcode")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    let items: Vec<Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let mut plugins = vec![];

    for item in items {
        if item.get("type").and_then(|t| t.as_str()) == Some("dir") {
            let name = item
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            let path = item
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();

            if !name.is_empty() && !name.starts_with('.') {
                plugins.push(MarketplacePlugin {
                    name: name.clone(),
                    description: None,
                    path,
                });
            }
        }
    }

    Ok(plugins)
}

#[tauri::command]
pub(crate) async fn install_extension(
    plugin_id: String,
    marketplace: Option<String>,
) -> Result<String, String> {
    let full_id = if let Some(mkt) = marketplace {
        format!("{}@{}", plugin_id, mkt)
    } else {
        plugin_id
    };

    let command = format!(
        "claude plugin install {}",
        shell_escape::escape(full_id.into())
    );
    let home = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    exec_shell_command(command, home).await
}

#[tauri::command]
pub(crate) async fn uninstall_extension(plugin_id: String) -> Result<String, String> {
    let command = format!(
        "claude plugin uninstall {}",
        shell_escape::escape(plugin_id.into())
    );
    let home = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    exec_shell_command(command, home).await
}

pub(crate) async fn add_extension_marketplace(source: String) -> Result<String, String> {
    let command = format!(
        "claude plugin marketplace add {}",
        shell_escape::escape(source.into())
    );
    let home = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    exec_shell_command(command, home).await
}

pub(crate) async fn remove_extension_marketplace(name: String) -> Result<String, String> {
    let command = format!(
        "claude plugin marketplace remove {}",
        shell_escape::escape(name.into())
    );
    let home = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string();

    exec_shell_command(command, home).await
}

// Disabled hooks storage path
pub(crate) fn get_disabled_hooks_path() -> std::path::PathBuf {
    get_lovstudio_dir().join("disabled_hooks.json")
}

pub(crate) fn load_disabled_hooks() -> Result<Value, String> {
    let path = get_disabled_hooks_path();
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(serde_json::json!({}))
    }
}

pub(crate) fn save_disabled_hooks(disabled_hooks: &Value) -> Result<(), String> {
    let path = get_disabled_hooks_path();
    let output = serde_json::to_string_pretty(disabled_hooks).map_err(|e| e.to_string())?;
    fs::write(&path, output).map_err(|e| e.to_string())?;
    Ok(())
}

// Generate a unique key for a hook based on its content
pub(crate) fn get_hook_content_key(hook: &Value) -> String {
    // Use command or prompt as the key, with type prefix for uniqueness
    let hook_type = hook
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");
    let content = hook
        .get("command")
        .or_else(|| hook.get("prompt"))
        .and_then(|c| c.as_str())
        .unwrap_or("");
    format!("{}:{}", hook_type, content)
}

#[tauri::command]
pub(crate) fn toggle_hook_item(
    event_type: String,
    matcher_index: usize,
    hook_index: usize,
    disabled: bool,
) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    let mut settings: Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("No settings.json found".to_string());
    };

    let mut disabled_hooks = load_disabled_hooks()?;

    if disabled {
        // Disable: Remove from settings.json and backup to disabled_hooks.json
        // First get matcher info (immutable borrow)
        let matcher = settings
            .get("hooks")
            .and_then(|h| h.get(&event_type))
            .and_then(|arr| arr.get(matcher_index))
            .and_then(|m| m.get("matcher"))
            .cloned()
            .unwrap_or(Value::String("".to_string()));

        // Then get mutable borrow
        let hooks_arr = settings
            .get_mut("hooks")
            .and_then(|h| h.get_mut(&event_type))
            .and_then(|arr| arr.get_mut(matcher_index))
            .and_then(|m| m.get_mut("hooks"))
            .and_then(|hooks| hooks.as_array_mut())
            .ok_or("Hook not found")?;

        if hook_index >= hooks_arr.len() {
            return Err("Hook index out of bounds".to_string());
        }

        // Backup the hook before removing
        let removed_hook = hooks_arr.remove(hook_index);
        let hook_key = get_hook_content_key(&removed_hook);

        // Store in disabled_hooks with context for restoration
        if !disabled_hooks.get(&event_type).is_some() {
            disabled_hooks[&event_type] = serde_json::json!([]);
        }

        // Store as array to preserve order and allow multiple disabled hooks
        if let Some(arr) = disabled_hooks[&event_type].as_array_mut() {
            arr.push(serde_json::json!({
                "matcher": matcher,
                "hook": removed_hook,
                "key": hook_key
            }));
        }

        save_disabled_hooks(&disabled_hooks)?;
    } else {
        // Enable: Restore from disabled_hooks.json to settings.json
        // First, get the hook to restore based on index in disabled list
        let hooks_arr = settings
            .get_mut("hooks")
            .and_then(|h| h.get_mut(&event_type))
            .and_then(|arr| arr.get_mut(matcher_index))
            .and_then(|m| m.get_mut("hooks"))
            .and_then(|hooks| hooks.as_array_mut())
            .ok_or("Hook location not found")?;

        // Get the hook_index-th item from disabled hooks for this event type
        let disabled_arr = disabled_hooks
            .get_mut(&event_type)
            .and_then(|v| v.as_array_mut())
            .ok_or("No disabled hooks for this event type")?;

        if hook_index >= disabled_arr.len() {
            return Err("Disabled hook index out of bounds".to_string());
        }

        let backup = disabled_arr.remove(hook_index);
        let hook_data = backup.get("hook").ok_or("Invalid backup data")?.clone();

        // Insert at the end of the active hooks
        hooks_arr.push(hook_data);

        save_disabled_hooks(&disabled_hooks)?;
    }

    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_disabled_hooks() -> Result<Value, String> {
    load_disabled_hooks()
}

#[tauri::command]
pub(crate) fn delete_hook_item(
    event_type: String,
    matcher_index: usize,
    hook_index: usize,
) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    let mut settings: Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("No settings.json found".to_string());
    };

    let hooks_arr = settings
        .get_mut("hooks")
        .and_then(|h| h.get_mut(&event_type))
        .and_then(|arr| arr.get_mut(matcher_index))
        .and_then(|m| m.get_mut("hooks"))
        .and_then(|hooks| hooks.as_array_mut())
        .ok_or("Hook not found")?;

    if hook_index >= hooks_arr.len() {
        return Err("Hook index out of bounds".to_string());
    }

    // Permanently remove without backup
    hooks_arr.remove(hook_index);

    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_disabled_hook(event_type: String, index: usize) -> Result<(), String> {
    let mut disabled_hooks = load_disabled_hooks()?;

    let disabled_arr = disabled_hooks
        .get_mut(&event_type)
        .and_then(|v| v.as_array_mut())
        .ok_or("No disabled hooks for this event type")?;

    if index >= disabled_arr.len() {
        return Err("Index out of bounds".to_string());
    }

    // Permanently remove from disabled list
    disabled_arr.remove(index);
    save_disabled_hooks(&disabled_hooks)?;
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct ConnectionTestResult {
    pub(crate) ok: bool,
    pub(crate) status: u16,
    pub(crate) body: String,
}

pub(crate) async fn test_anthropic_connection(
    base_url: String,
    auth_token: String,
    model: String,
) -> Result<ConnectionTestResult, String> {
    if auth_token.trim().is_empty() {
        return Err("ANTHROPIC_AUTH_TOKEN is empty".to_string());
    }

    let base = base_url.trim_end_matches('/');
    let url = format!("{}/v1/messages", base);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "model": model,
        "max_tokens": 1,
        "messages": [
            { "role": "user", "content": "ping" }
        ]
    });

    println!("anthropic test request url={}", url);
    println!("anthropic test request headers x-api-key={} anthropic-version=2023-06-01 content-type=application/json", auth_token);
    println!("anthropic test request body={}", payload);

    let response = client
        .post(&url)
        .header("x-api-key", auth_token)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    println!("anthropic test status={} body={}", status, body);

    Ok(ConnectionTestResult {
        ok: status.is_success(),
        status: status.as_u16(),
        body,
    })
}

pub(crate) async fn test_openai_connection(
    base_url: String,
    api_key: String,
) -> Result<ConnectionTestResult, String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let base = base_url.trim_end_matches('/');
    let url = format!("{}/models", base);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    Ok(ConnectionTestResult {
        ok: status.is_success(),
        status: status.as_u16(),
        body,
    })
}

#[derive(Serialize)]
pub(crate) struct ClaudeCliTestResult {
    pub(crate) ok: bool,
    pub(crate) code: i32,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

/// Probe whether the local `claude` CLI is logged in via OAuth (Anthropic
/// Subscription). Runs `claude --print 'ping'` *without* injecting any auth
/// env vars, so the CLI uses its own ~/.claude/.credentials.json. Exit code 0
/// + non-empty stdout → logged in. Otherwise the stderr usually says
/// "not authenticated" or similar.
pub(crate) async fn test_claude_cli_oauth() -> Result<ClaudeCliTestResult, String> {
    // Use login shell so PATH includes nvm / native install
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let fut = tokio::process::Command::new(&shell)
        .args(["-ilc", "claude --print 'ping'"])
        .output();
    let output = tokio::time::timeout(Duration::from_secs(30), fut)
        .await
        .map_err(|_| "claude CLI probe timed out after 30s".to_string())?
        .map_err(|e| format!("Failed to execute claude CLI: {}", e))?;

    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    println!(
        "claude cli oauth probe code={} stdout_len={} stderr={}",
        code,
        stdout.len(),
        stderr
    );

    let ok = output.status.success() && !stdout.trim().is_empty();
    Ok(ClaudeCliTestResult {
        ok,
        code,
        stdout,
        stderr,
    })
}

pub(crate) async fn test_claude_cli(
    base_url: String,
    auth_token: String,
) -> Result<ClaudeCliTestResult, String> {
    if auth_token.trim().is_empty() {
        return Err("ANTHROPIC_AUTH_TOKEN is empty".to_string());
    }

    let output = tokio::process::Command::new("claude")
        .arg("--print")
        .arg("reply 1")
        .env("ANTHROPIC_BASE_URL", &base_url)
        .env("ANTHROPIC_AUTH_TOKEN", &auth_token)
        .output()
        .await
        .map_err(|e| format!("Failed to execute claude CLI: {}", e))?;

    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    println!(
        "claude cli test code={} stdout={} stderr={}",
        code, stdout, stderr
    );

    Ok(ClaudeCliTestResult {
        ok: output.status.success(),
        code,
        stdout,
        stderr,
    })
}
