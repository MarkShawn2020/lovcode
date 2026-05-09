use super::*;

// ============================================================================
// Claude Code Version Management
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ClaudeCodeInstallType {
    Native,
    Npm,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CodexCliInstallType {
    Native,
    Npm,
    None,
}

#[derive(Debug, Serialize)]
pub(crate) struct VersionWithDownloads {
    pub(crate) version: String,
    pub(crate) downloads: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ClaudeCodeVersionInfo {
    pub(crate) install_type: ClaudeCodeInstallType,
    pub(crate) current_version: Option<String>,
    pub(crate) available_versions: Vec<VersionWithDownloads>,
    pub(crate) autoupdater_disabled: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct CodexCliVersionInfo {
    pub(crate) install_type: CodexCliInstallType,
    pub(crate) current_version: Option<String>,
    pub(crate) available_versions: Vec<VersionWithDownloads>,
    pub(crate) autoupdater_disabled: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct AgentRuntimeStatus {
    pub(crate) provider: String,
    pub(crate) command: Option<String>,
    pub(crate) installed: bool,
    pub(crate) runnable: bool,
    pub(crate) path: Option<String>,
    pub(crate) path_source: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) install_route: Option<String>,
}

const NPM_CHINA_MIRROR_REGISTRY: &str = "https://registry.npmmirror.com";
const NPM_REGISTRY_FALLBACKS: [&str; 2] = ["https://registry.npmjs.org", NPM_CHINA_MIRROR_REGISTRY];

fn install_stderr_progress_payload(line: &str) -> String {
    let trimmed = line.trim_start();
    let lower = trimmed.to_ascii_lowercase();
    let is_warning = lower.starts_with("npm warn")
        || lower.starts_with("npm notice")
        || lower.starts_with("warning")
        || lower.starts_with("warn ");

    if is_warning {
        format!("[warn] {}", line)
    } else {
        format!("[error] {}", line)
    }
}

fn npm_package_metadata_url(registry: &str, package_name: &str) -> String {
    format!(
        "{}/{}",
        registry.trim_end_matches('/'),
        package_name.replace('/', "%2F")
    )
}

fn npm_install_registry_arg(npm_registry: Option<&str>) -> Result<Option<&'static str>, String> {
    match npm_registry.unwrap_or("default") {
        "default" | "official" => Ok(None),
        "china_mirror" => Ok(Some(NPM_CHINA_MIRROR_REGISTRY)),
        value => Err(format!("Unsupported npm registry: {}", value)),
    }
}

fn build_npm_global_install_command(
    package: &str,
    npm_registry: Option<&str>,
) -> Result<String, String> {
    let registry_arg = npm_install_registry_arg(npm_registry)?
        .map(|registry| format!(" --registry={}", registry))
        .unwrap_or_default();
    Ok(format!(
        "npm install -g --force{} {}",
        registry_arg, package
    ))
}

/// Run a command in user's interactive login shell (to get proper PATH with nvm, etc.)
pub(crate) fn run_shell_command(cmd: &str) -> std::io::Result<std::process::Output> {
    #[cfg(windows)]
    {
        // On Windows, use PowerShell to run commands (better PATH handling than cmd.exe)
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", cmd])
            .output()
    }

    #[cfg(not(windows))]
    {
        // Use user's default shell from $SHELL, fallback to /bin/zsh (macOS default)
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        std::process::Command::new(&shell)
            .args(["-ilc", cmd]) // -i for interactive (loads .zshrc), -l for login, -c for command
            .output()
    }
}

/// Detect Claude Code installation type
/// Prioritizes native install (~/.local/bin/claude) over npm when both exist
pub(crate) fn detect_claude_code_install_type() -> (ClaudeCodeInstallType, Option<String>) {
    // Helper to get version from a specific claude binary path
    let get_version = |path: &str| -> Option<String> {
        if let Ok(output) = std::process::Command::new(path).arg("--version").output() {
            if output.status.success() {
                let version_str = String::from_utf8_lossy(&output.stdout);
                return version_str
                    .trim()
                    .split_whitespace()
                    .next()
                    .map(|s| s.to_string());
            }
        }
        None
    };

    // Check native install first (preferred) - ~/.local/bin/claude
    let native_path = dirs::home_dir()
        .map(|h| h.join(".local/bin/claude"))
        .filter(|p| p.exists());

    if let Some(ref path) = native_path {
        if let Some(version) = get_version(path.to_str().unwrap_or("")) {
            return (ClaudeCodeInstallType::Native, Some(version));
        }
    }

    // Check npm install via `which claude` in user's shell
    if let Ok(which_output) = run_shell_command("which claude 2>/dev/null") {
        if which_output.status.success() {
            let claude_path = String::from_utf8_lossy(&which_output.stdout);
            let claude_path = claude_path.trim();

            // Skip if it's the native path we already checked
            if !claude_path.contains(".local/bin/claude") && !claude_path.is_empty() {
                if let Some(version) = get_version(claude_path) {
                    return (ClaudeCodeInstallType::Npm, Some(version));
                }
            }
        }
    }

    (ClaudeCodeInstallType::None, None)
}

fn detect_codex_cli_install_type() -> (CodexCliInstallType, Option<String>) {
    let (path, version, _, _, _) = detect_cli_runtime("codex", "codex");
    let Some(path) = path else {
        return (CodexCliInstallType::None, version);
    };

    let resolved_path = std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    let path_text = resolved_path.to_string_lossy();
    if path_text.contains("node_modules/@openai/codex") {
        return (CodexCliInstallType::Npm, version);
    }

    (CodexCliInstallType::Native, version)
}

fn read_codex_config_doc() -> Result<(PathBuf, toml_edit::DocumentMut), String> {
    let config_path = get_codex_config_path();
    let content = if config_path.exists() {
        fs::read_to_string(&config_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let doc = if content.trim().is_empty() {
        toml_edit::DocumentMut::new()
    } else {
        content
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| format!("parse Codex config.toml: {}", e))?
    };
    Ok((config_path, doc))
}

fn read_codex_autoupdater_disabled() -> bool {
    let Ok((_, doc)) = read_codex_config_doc() else {
        return false;
    };
    doc["check_for_update_on_startup"]
        .as_bool()
        .map(|enabled| !enabled)
        .unwrap_or(false)
}

fn codex_native_asset_target() -> Result<&'static str, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok("aarch64-apple-darwin");
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok("x86_64-apple-darwin");
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok("aarch64-unknown-linux-musl");
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok("x86_64-unknown-linux-musl");
    }
    #[allow(unreachable_code)]
    Err(
        "Native Codex install is only supported on macOS arm64/x64 and Linux arm64/x64."
            .to_string(),
    )
}

fn validate_codex_version(version: &str) -> Result<(), String> {
    if version == "latest" {
        return Ok(());
    }
    let version_re =
        regex::Regex::new(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$").map_err(|e| e.to_string())?;
    if version_re.is_match(version) {
        Ok(())
    } else {
        Err(format!("Invalid Codex version: {}", version))
    }
}

fn codex_native_install_command(version: &str) -> Result<String, String> {
    validate_codex_version(version)?;
    let target = codex_native_asset_target()?;
    let url = if version == "latest" {
        format!(
            "https://github.com/openai/codex/releases/latest/download/codex-{}.tar.gz",
            target
        )
    } else {
        format!(
            "https://github.com/openai/codex/releases/download/rust-v{}/codex-{}.tar.gz",
            version, target
        )
    };
    let url = shell_escape::unix::escape(url.into()).into_owned();

    Ok(format!(
        r#"set -e
echo "Downloading Codex CLI..."
tmp="$(mktemp -d)"
cleanup() {{ rm -rf "$tmp"; }}
trap cleanup EXIT
curl -fL --progress-bar -o "$tmp/codex.tar.gz" {url}
tar -xzf "$tmp/codex.tar.gz" -C "$tmp"
bin="$(find "$tmp" -type f -name 'codex-*' -perm -111 | head -n 1)"
if [ -z "$bin" ]; then
  bin="$(find "$tmp" -type f -name 'codex-*' | head -n 1)"
fi
if [ -z "$bin" ]; then
  echo "Codex binary not found in archive" >&2
  exit 1
fi
mkdir -p "$HOME/.local/bin"
install -m 755 "$bin" "$HOME/.local/bin/codex"
echo "Done!""#,
    ))
}

fn codex_npm_install_command(version: &str, npm_registry: Option<&str>) -> Result<String, String> {
    validate_codex_version(version)?;
    let package = if version == "latest" {
        "@openai/codex@latest".to_string()
    } else {
        format!("@openai/codex@{}", version)
    };
    build_npm_global_install_command(&package, npm_registry)
}

pub(crate) fn parse_semver_from_cli_output(output: &str) -> Option<String> {
    regex::Regex::new(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?")
        .ok()?
        .find(output)
        .map(|matched| matched.as_str().to_string())
}

pub(crate) fn normalize_cli_version_output(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| {
            parse_semver_from_cli_output(line).unwrap_or_else(|| line.chars().take(160).collect())
        })
}

async fn fetch_npm_versions_from_registry(
    client: &reqwest::Client,
    registry: &str,
    package_name: &str,
    limit: usize,
) -> Vec<String> {
    let url = npm_package_metadata_url(registry, package_name);
    let Ok(resp) = client.get(url).send().await else {
        return vec![];
    };
    if !resp.status().is_success() {
        return vec![];
    }
    resp.json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|json| {
            json.get("versions")?.as_object().map(|obj| {
                let mut versions: Vec<String> = obj.keys().cloned().collect();
                versions.sort_by(|a, b| {
                    let parse = |s: &str| -> Vec<u32> {
                        s.split(['.', '-'])
                            .filter_map(|part| part.parse().ok())
                            .collect()
                    };
                    parse(b).cmp(&parse(a))
                });
                versions.into_iter().take(limit).collect()
            })
        })
        .unwrap_or_default()
}

pub(crate) async fn fetch_npm_versions_with_downloads(
    package_name: &str,
    limit: usize,
) -> Vec<VersionWithDownloads> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let versions =
        futures::future::join_all(NPM_REGISTRY_FALLBACKS.iter().map(|registry| {
            fetch_npm_versions_from_registry(&client, registry, package_name, limit)
        }))
        .await
        .into_iter()
        .find(|versions| !versions.is_empty())
        .unwrap_or_default();

    let downloads_package = package_name.replace('/', "%2F");
    let downloads_map: std::collections::HashMap<String, u64> = match client
        .get(format!(
            "https://api.npmjs.org/versions/{}/last-week",
            downloads_package
        ))
        .send()
        .await
    {
        Ok(resp) => resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|json| {
                json.get("downloads")?.as_object().map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| Some((k.clone(), v.as_u64()?)))
                        .collect()
                })
            })
            .unwrap_or_default(),
        Err(_) => std::collections::HashMap::new(),
    };

    versions
        .into_iter()
        .map(|version| VersionWithDownloads {
            downloads: downloads_map.get(&version).copied().unwrap_or(0),
            version,
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn get_claude_code_version_info() -> Result<ClaudeCodeVersionInfo, String> {
    // Detect installation type and current version
    let (install_type, current_version) =
        tauri::async_runtime::spawn_blocking(detect_claude_code_install_type)
            .await
            .map_err(|e| e.to_string())?;

    let available_versions =
        fetch_npm_versions_with_downloads("@anthropic-ai/claude-code", 20).await;

    // Check autoupdater setting from Claude Code's config (~/.claude.json)
    let config_path = dirs::home_dir().unwrap().join(".claude.json");
    let autoupdater_disabled = fs::read_to_string(&config_path)
        .ok()
        .and_then(|content| {
            let json: serde_json::Value = serde_json::from_str(&content).ok()?;
            // autoUpdates: false means autoupdater is disabled
            json.get("autoUpdates")?.as_bool().map(|v| !v)
        })
        .unwrap_or(false);

    Ok(ClaudeCodeVersionInfo {
        install_type,
        current_version,
        available_versions,
        autoupdater_disabled,
    })
}

pub(crate) fn find_cli_path(command_name: &str) -> Option<String> {
    #[cfg(windows)]
    let lookup = format!("where.exe {}", command_name);

    #[cfg(not(windows))]
    let lookup = format!("command -v {} 2>/dev/null", command_name);

    let output = run_shell_command(&lookup).ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let command_lower = command_name.to_lowercase();
    let exe_suffix = format!("{}.exe", command_lower);
    let plain_suffix = command_lower.clone();

    stdout
        .lines()
        .map(str::trim)
        .find(|line| {
            if line.is_empty() {
                return false;
            }
            let normalized = line.replace('\\', "/").to_lowercase();
            normalized == plain_suffix
                || normalized.ends_with(&format!("/{}", plain_suffix))
                || normalized.ends_with(&format!("/{}", exe_suffix))
        })
        .map(str::to_string)
        .or_else(|| {
            stdout
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.chars().any(char::is_whitespace))
                .map(str::to_string)
        })
}

pub(crate) fn get_cli_version(path: &str) -> Option<String> {
    let output = std::process::Command::new(path)
        .arg("--version")
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = if stdout.trim().is_empty() {
        stderr.trim()
    } else {
        stdout.trim()
    };
    normalize_cli_version_output(text)
}

pub(crate) fn get_agent_runtime_overrides_path() -> PathBuf {
    get_lovstudio_dir().join("agent-runtime-overrides.json")
}

pub(crate) fn read_agent_runtime_path_overrides() -> HashMap<String, String> {
    let path = get_agent_runtime_overrides_path();
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<HashMap<String, String>>(&content).ok())
        .unwrap_or_default()
}

pub(crate) fn save_agent_runtime_path_overrides(
    overrides: &HashMap<String, String>,
) -> Result<(), String> {
    let path = get_agent_runtime_overrides_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(overrides).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub(crate) fn normalize_agent_cli_provider(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        _ => None,
    }
}

pub(crate) fn get_agent_runtime_path_override(provider: &str) -> Option<String> {
    let provider = normalize_agent_cli_provider(provider)?;
    read_agent_runtime_path_overrides()
        .get(provider)
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
}

pub(crate) fn set_agent_runtime_path_override_inner(
    provider: &str,
    path: Option<String>,
) -> Result<(), String> {
    let provider = normalize_agent_cli_provider(provider)
        .ok_or_else(|| "Unsupported agent runtime provider".to_string())?;
    let mut overrides = read_agent_runtime_path_overrides();
    let normalized_path = path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    if let Some(path) = normalized_path {
        overrides.insert(provider.to_string(), path);
    } else {
        overrides.remove(provider);
    }
    save_agent_runtime_path_overrides(&overrides)
}

pub(crate) fn get_agent_chat_harness_path() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        return std::env::var("LOVCODE_AGENT_CHAT_HARNESS")
            .ok()
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty() && Path::new(path).is_file());
    }

    #[cfg(not(debug_assertions))]
    {
        None
    }
}

pub(crate) fn detect_cli_runtime(
    provider: &str,
    command_name: &str,
) -> (Option<String>, Option<String>, bool, bool, Option<String>) {
    if matches!(provider, "claude" | "codex") {
        if let Some(path) = get_agent_chat_harness_path() {
            return (
                Some(path),
                Some("dev-harness".to_string()),
                true,
                true,
                Some("dev-harness".to_string()),
            );
        }
    }

    if let Some(override_path) = get_agent_runtime_path_override(provider) {
        let exists = Path::new(&override_path).is_file();
        let version = if exists {
            get_cli_version(&override_path)
        } else {
            None
        };
        let runnable = version.is_some();
        return (
            Some(override_path),
            version,
            exists,
            runnable,
            Some("manual".to_string()),
        );
    }

    let path = find_cli_path(command_name);
    let version = path.as_deref().and_then(get_cli_version);
    let runnable = version.is_some();
    let installed = path.is_some();
    (path, version, installed, runnable, Some("path".to_string()))
}

pub(crate) fn build_cli_runtime_status(
    provider: &str,
    command_name: &str,
    install_route: Option<&str>,
) -> AgentRuntimeStatus {
    let (path, version, installed, runnable, path_source) =
        detect_cli_runtime(provider, command_name);
    AgentRuntimeStatus {
        provider: provider.to_string(),
        command: Some(command_name.to_string()),
        installed,
        path,
        path_source,
        runnable,
        version,
        install_route: install_route.map(str::to_string),
    }
}

#[tauri::command]
pub(crate) async fn get_agent_runtime_status(
    provider: String,
) -> Result<AgentRuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || match provider.as_str() {
        "terminal" => {
            #[cfg(windows)]
            let shell = std::env::var("ComSpec")
                .ok()
                .or_else(|| Some("powershell".to_string()));

            #[cfg(not(windows))]
            let shell = std::env::var("SHELL").ok();

            Ok(AgentRuntimeStatus {
                provider,
                command: None,
                installed: true,
                runnable: true,
                path: shell,
                path_source: Some("path".to_string()),
                version: None,
                install_route: None,
            })
        }
        "claude" => Ok(build_cli_runtime_status(
            "claude",
            "claude",
            Some("/settings/runtime?runtime=claude"),
        )),
        "codex" => Ok(build_cli_runtime_status(
            "codex",
            "codex",
            Some("/settings/runtime?runtime=codex"),
        )),
        _ => Err("Unsupported agent runtime provider".to_string()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn set_agent_runtime_path_override(
    provider: String,
    path: Option<String>,
) -> Result<AgentRuntimeStatus, String> {
    let provider_for_status = provider.clone();
    tauri::async_runtime::spawn_blocking(move || {
        set_agent_runtime_path_override_inner(&provider, path)?;
        match provider_for_status.as_str() {
            "claude" => Ok(build_cli_runtime_status(
                "claude",
                "claude",
                Some("/settings/runtime?runtime=claude"),
            )),
            "codex" => Ok(build_cli_runtime_status(
                "codex",
                "codex",
                Some("/settings/runtime?runtime=codex"),
            )),
            _ => Err("Unsupported agent runtime provider".to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn get_codex_cli_version_info() -> Result<CodexCliVersionInfo, String> {
    let (install_type, current_version) =
        tauri::async_runtime::spawn_blocking(detect_codex_cli_install_type)
            .await
            .map_err(|e| e.to_string())?;

    let available_versions = fetch_npm_versions_with_downloads("@openai/codex", 20).await;
    let autoupdater_disabled = read_codex_autoupdater_disabled();

    Ok(CodexCliVersionInfo {
        install_type,
        current_version,
        available_versions,
        autoupdater_disabled,
    })
}

pub(crate) fn run_codex_install_command(
    app: tauri::AppHandle,
    cmd: String,
) -> Result<String, String> {
    use std::process::{Command, Stdio};

    let _ = app.emit("codex-install-progress", "Starting Codex CLI install...");
    println!("[codex-install] cmd={}", cmd);

    #[cfg(windows)]
    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-Command", &cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    #[cfg(not(windows))]
    let mut child = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Command::new(&shell)
            .args(["-ilc", &cmd])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn: {}", e))?
    };

    CODEX_INSTALL_PID.store(child.id(), std::sync::atomic::Ordering::SeqCst);

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_stdout = app.clone();
    let stdout_handle = std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let mut output = String::new();
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let _ = app_stdout.emit("codex-install-progress", &line);
                }
                output.push_str(&line);
                output.push('\n');
            }
        }
        output
    });

    let app_stderr = app.clone();
    let stderr_handle = std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let mut output = String::new();
        if let Some(err) = stderr {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let is_progress =
                        line.contains('%') || line.contains("added ") || line.contains("changed ");
                    let payload = if is_progress {
                        line.clone()
                    } else {
                        install_stderr_progress_payload(&line)
                    };
                    let _ = app_stderr.emit("codex-install-progress", payload);
                }
                output.push_str(&line);
                output.push('\n');
            }
        }
        output
    });

    let stdout_output = stdout_handle.join().unwrap_or_default();
    let stderr_output = stderr_handle.join().unwrap_or_default();
    let status = child.wait().map_err(|e| format!("Failed to wait: {}", e))?;

    CODEX_INSTALL_PID.store(0, std::sync::atomic::Ordering::SeqCst);

    if status.success() {
        let _ = app.emit("codex-install-progress", "Done!");
        Ok(stdout_output)
    } else {
        Err(stderr_output)
    }
}

#[tauri::command]
pub(crate) async fn install_codex_cli_version(
    app: tauri::AppHandle,
    version: String,
    install_type: Option<String>,
    npm_registry: Option<String>,
) -> Result<String, String> {
    let install_type = install_type.unwrap_or_else(|| "native".to_string());
    let cmd = match install_type.as_str() {
        "native" => codex_native_install_command(&version)?,
        "npm" => codex_npm_install_command(&version, npm_registry.as_deref())?,
        other => return Err(format!("Unsupported Codex install type: {}", other)),
    };

    tauri::async_runtime::spawn_blocking(move || run_codex_install_command(app, cmd))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_codex_cli_install() -> Result<(), String> {
    let pid = CODEX_INSTALL_PID.load(std::sync::atomic::Ordering::SeqCst);
    if pid == 0 {
        return Err("No install process running".to_string());
    }

    #[cfg(unix)]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-P", &pid.to_string()])
            .output();

        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    CODEX_INSTALL_PID.store(0, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_claude_code_version(
    app: tauri::AppHandle,
    version: String,
    install_type: Option<String>,
    npm_registry: Option<String>,
) -> Result<String, String> {
    use std::process::{Command, Stdio};

    let is_specific_version = version != "latest";
    let install_type_str = install_type.unwrap_or_else(|| "native".to_string());

    let result = tauri::async_runtime::spawn_blocking(move || {
        let cmd = if install_type_str == "npm" {
            // Remove native binary if exists (so detection shows npm after install)
            if let Some(home) = dirs::home_dir() {
                let native_bin = home.join(".local/bin/claude");
                if native_bin.exists() {
                    let _ = app.emit("cc-install-progress", "Removing native install...");
                    let _ = std::fs::remove_file(&native_bin);
                }
            }

            let package = if version == "latest" {
                "@anthropic-ai/claude-code@latest".to_string()
            } else {
                format!("@anthropic-ai/claude-code@{}", version)
            };
            build_npm_global_install_command(&package, npm_registry.as_deref())?
        } else {
            // Clean up stale downloads that may cause "another process installing" error
            if let Some(home) = dirs::home_dir() {
                let downloads_dir = home.join(".claude/downloads");
                if downloads_dir.exists() {
                    let _ = app.emit("cc-install-progress", "Cleaning up stale downloads...");
                    let _ = std::fs::remove_dir_all(&downloads_dir);
                }
            }

            let version_arg = if version == "latest" { "".to_string() } else { version };
            let display_version = if version_arg.is_empty() { "latest" } else { &version_arg };
            let _ = app.emit("cc-install-progress", format!("Installing Claude Code {}...", display_version));

            // Download script, patch to show progress bar for binary download, then run
            // Change 'curl -fsSL -o' to 'curl -fL --progress-bar -o' for visible download progress
            format!(
                r#"echo "Downloading install script..." && curl -fsSL https://claude.ai/install.sh | sed 's/"$binary_path" install/"$binary_path" install --force/' | sed 's/curl -fsSL -o/curl -fL --progress-bar -o/g' > /tmp/cc-install.sh && echo "Downloading Claude Code (~170MB)..." && CI=1 bash /tmp/cc-install.sh {} </dev/null && echo "Done!" || echo "Installation failed"; rm -f /tmp/cc-install.sh"#,
                version_arg
            )
        };

        // Use appropriate shell based on platform
        println!("[DEBUG] cmd={}", cmd);

        #[cfg(windows)]
        let mut child = {
            // On Windows, use PowerShell for npm commands
            // Native install is not supported on Windows (uses Unix-specific tools)
            if install_type_str != "npm" {
                return Err("Native install is only supported on macOS/Linux. Please use npm install on Windows.".to_string());
            }
            Command::new("powershell")
                .args(["-NoProfile", "-Command", &cmd])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn: {}", e))?
        };

        #[cfg(not(windows))]
        let mut child = Command::new("/bin/bash")
            .args(["-c", &cmd])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn: {}", e))?;

        // Store PID for cancellation support
        CC_INSTALL_PID.store(child.id(), std::sync::atomic::Ordering::SeqCst);
        println!("[DEBUG] Child spawned, pid={}", child.id());

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Read stdout in a thread - use byte reading to capture progress bar updates
        let app_clone = app.clone();
        let stdout_handle = std::thread::spawn(move || {
            use std::io::Read;
            let mut output = String::new();
            if let Some(mut out) = stdout {
                let mut buf = [0u8; 1024];
                let mut current_line = String::new();

                while let Ok(n) = out.read(&mut buf) {
                    if n == 0 { break; }

                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    for ch in chunk.chars() {
                        if ch == '\n' {
                            // Complete line - emit if not debug
                            if !current_line.starts_with("[DEBUG]") && !current_line.is_empty() {
                                let _ = app_clone.emit("cc-install-progress", &current_line);
                            }
                            output.push_str(&current_line);
                            output.push('\n');
                            current_line.clear();
                        } else if ch == '\r' {
                            // Carriage return - emit current content as progress update
                            if !current_line.is_empty() {
                                let _ = app_clone.emit("cc-install-progress", format!("\r{}", &current_line));
                            }
                            current_line.clear();
                        } else {
                            current_line.push(ch);
                        }
                    }
                }
                // Emit any remaining content
                if !current_line.is_empty() && !current_line.starts_with("[DEBUG]") {
                    let _ = app_clone.emit("cc-install-progress", &current_line);
                    output.push_str(&current_line);
                }
            }
            output
        });

        // Read stderr in a thread - curl progress bar goes to stderr
        let app_clone2 = app.clone();
        let stderr_handle = std::thread::spawn(move || {
            use std::io::Read;
            let mut output = String::new();
            if let Some(mut err) = stderr {
                let mut buf = [0u8; 1024];
                let mut current_line = String::new();

                while let Ok(n) = err.read(&mut buf) {
                    if n == 0 { break; }

                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    output.push_str(&chunk);

                    for ch in chunk.chars() {
                        if ch == '\n' || ch == '\r' {
                            if !current_line.is_empty() {
                                // Check if this looks like progress (contains % or is mostly # symbols)
                                let is_progress = current_line.contains('%') ||
                                    current_line.chars().filter(|c| *c == '#').count() > 2;

                                if is_progress {
                                    // Progress update - use \r prefix to replace last line
                                    let _ = app_clone2.emit("cc-install-progress", format!("\r{}", &current_line));
                                } else {
                                    let _ = app_clone2.emit(
                                        "cc-install-progress",
                                        install_stderr_progress_payload(&current_line),
                                    );
                                }
                            }
                            current_line.clear();
                        } else {
                            current_line.push(ch);
                        }
                    }
                }
                // Emit any remaining content
                if !current_line.is_empty() {
                    let _ = app_clone2.emit(
                        "cc-install-progress",
                        install_stderr_progress_payload(&current_line),
                    );
                }
            }
            output
        });

        let stdout_output = stdout_handle.join().unwrap_or_default();
        let stderr_output = stderr_handle.join().unwrap_or_default();

        let status = child.wait().map_err(|e| format!("Failed to wait: {}", e))?;

        // Clear PID after process ends
        CC_INSTALL_PID.store(0, std::sync::atomic::Ordering::SeqCst);

        if status.success() {
            Ok(stdout_output)
        } else {
            Err(stderr_output)
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    if is_specific_version {
        let _ = set_claude_code_autoupdater(true);
    }

    Ok(result)
}

#[tauri::command]
pub(crate) fn cancel_claude_code_install() -> Result<(), String> {
    let pid = CC_INSTALL_PID.load(std::sync::atomic::Ordering::SeqCst);
    if pid == 0 {
        return Err("No install process running".to_string());
    }

    #[cfg(unix)]
    {
        // Use pkill to kill child processes first (curl, bash, etc.)
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-P", &pid.to_string()])
            .output();

        // Kill the main process with SIGKILL
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    {
        // On Windows, use taskkill to kill the process tree
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    CC_INSTALL_PID.store(0, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub(crate) fn set_claude_code_autoupdater(disabled: bool) -> Result<(), String> {
    let config_path = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".claude.json");

    // Read existing config or create empty object
    let mut config: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Set autoUpdates (false = disabled, true = enabled)
    config["autoUpdates"] = serde_json::Value::Bool(!disabled);

    // Write back
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn set_codex_cli_autoupdater(disabled: bool) -> Result<(), String> {
    let (config_path, mut doc) = read_codex_config_doc()?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    doc["check_for_update_on_startup"] = toml_edit::value(!disabled);

    fs::write(&config_path, doc.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}
