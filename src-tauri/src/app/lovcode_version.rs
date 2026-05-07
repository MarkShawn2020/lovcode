use super::*;

// ============================================================================
// Lovcode Version Management
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct LovcodeRelease {
    pub(crate) version: String,
    pub(crate) tag_name: String,
    pub(crate) name: Option<String>,
    pub(crate) published_at: Option<String>,
    pub(crate) html_url: String,
    pub(crate) body: Option<String>,
    pub(crate) prerelease: bool,
    pub(crate) draft: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LovcodeReleaseSource {
    GithubApi,
    Cache,
    GithubAtom,
}

#[derive(Debug, Serialize)]
pub(crate) struct LovcodeVersionInfo {
    pub(crate) current_version: String,
    pub(crate) latest_version: Option<String>,
    pub(crate) releases: Vec<LovcodeRelease>,
    pub(crate) auto_update_enabled: bool,
    pub(crate) release_source: LovcodeReleaseSource,
    pub(crate) releases_truncated: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GithubRelease {
    pub(crate) tag_name: String,
    pub(crate) name: Option<String>,
    pub(crate) published_at: Option<String>,
    pub(crate) html_url: String,
    pub(crate) body: Option<String>,
    pub(crate) prerelease: bool,
    pub(crate) draft: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LovcodeReleaseCacheFile {
    pub(crate) fetched_at_unix: u64,
    pub(crate) releases: Vec<LovcodeRelease>,
}

pub(crate) struct LovcodeReleaseFetch {
    pub(crate) releases: Vec<LovcodeRelease>,
    pub(crate) source: LovcodeReleaseSource,
    pub(crate) releases_truncated: bool,
}

pub(crate) fn decode_xml_entities(input: &str) -> String {
    input
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

pub(crate) fn capture_first(input: &str, pattern: &str) -> Option<String> {
    regex::Regex::new(pattern)
        .ok()?
        .captures(input)?
        .get(1)
        .map(|m| decode_xml_entities(m.as_str().trim()))
}

pub(crate) fn github_token() -> Option<String> {
    ["GITHUB_TOKEN", "GH_TOKEN"]
        .iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

pub(crate) async fn github_cli_token() -> Option<String> {
    let mut candidates = vec!["gh".to_string()];
    candidates.extend(
        ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]
            .iter()
            .map(|path| path.to_string()),
    );
    candidates.dedup();

    for command in candidates {
        let output = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::process::Command::new(&command)
                .args(["auth", "token"])
                .output(),
        )
        .await
        .ok()
        .and_then(Result::ok);

        let Some(output) = output else {
            continue;
        };
        if !output.status.success() {
            continue;
        }

        let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !token.is_empty() {
            return Some(token);
        }
    }

    None
}

pub(crate) async fn github_token_for_write(action: &str) -> Result<String, String> {
    if let Some(token) = github_token() {
        return Ok(token);
    }
    if let Some(token) = github_cli_token().await {
        return Ok(token);
    }

    Err(format!(
        "需要设置 GITHUB_TOKEN/GH_TOKEN，或先运行 `gh auth login`，才能{}。",
        action
    ))
}

pub(crate) fn release_cache_is_fresh(fetched_at: SystemTime) -> bool {
    fetched_at
        .elapsed()
        .map(|age| age < LOVCODE_RELEASES_CACHE_TTL)
        .unwrap_or(false)
}

pub(crate) fn read_lovcode_releases_cache_file() -> Option<(SystemTime, Vec<LovcodeRelease>)> {
    let content = fs::read_to_string(get_lovcode_releases_cache_path()).ok()?;
    let parsed: LovcodeReleaseCacheFile = serde_json::from_str(&content).ok()?;
    let fetched_at = UNIX_EPOCH + Duration::from_secs(parsed.fetched_at_unix);
    Some((fetched_at, parsed.releases))
}

pub(crate) fn write_lovcode_releases_cache_file(releases: &[LovcodeRelease]) {
    let cache_path = get_lovcode_releases_cache_path();
    if let Some(parent) = cache_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let fetched_at_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let cache = LovcodeReleaseCacheFile {
        fetched_at_unix,
        releases: releases.to_vec(),
    };
    if let Ok(content) = serde_json::to_string_pretty(&cache) {
        let _ = fs::write(cache_path, content);
    }
}

pub(crate) fn get_fresh_lovcode_releases_cache() -> Option<Vec<LovcodeRelease>> {
    if let Ok(cache) = LOVCODE_RELEASES_CACHE.lock() {
        if let Some((fetched_at, releases)) = cache.as_ref() {
            if release_cache_is_fresh(*fetched_at) {
                return Some(releases.clone());
            }
        }
    }

    let (fetched_at, releases) = read_lovcode_releases_cache_file()?;
    if !release_cache_is_fresh(fetched_at) {
        return None;
    }

    if let Ok(mut cache) = LOVCODE_RELEASES_CACHE.lock() {
        *cache = Some((fetched_at, releases.clone()));
    }
    Some(releases)
}

pub(crate) fn get_any_lovcode_releases_cache() -> Option<Vec<LovcodeRelease>> {
    if let Ok(cache) = LOVCODE_RELEASES_CACHE.lock() {
        if let Some((_, releases)) = cache.as_ref() {
            return Some(releases.clone());
        }
    }

    let (fetched_at, releases) = read_lovcode_releases_cache_file()?;
    if let Ok(mut cache) = LOVCODE_RELEASES_CACHE.lock() {
        *cache = Some((fetched_at, releases.clone()));
    }
    Some(releases)
}

pub(crate) fn store_lovcode_releases_cache(releases: &[LovcodeRelease]) {
    if let Ok(mut cache) = LOVCODE_RELEASES_CACHE.lock() {
        *cache = Some((SystemTime::now(), releases.to_vec()));
    }
    write_lovcode_releases_cache_file(releases);
}

pub(crate) async fn fetch_lovcode_releases_from_api(
    client: &reqwest::Client,
) -> Result<Vec<LovcodeRelease>, String> {
    let mut releases: Vec<LovcodeRelease> = Vec::new();
    let token = github_token();

    for page in 1..=10 {
        let url = format!(
            "https://api.github.com/repos/lovstudio/lovcode/releases?per_page=100&page={}",
            page
        );
        let mut request = client
            .get(&url)
            .header(
                "User-Agent",
                format!("lovcode/{}", env!("CARGO_PKG_VERSION")),
            )
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");

        if let Some(token) = token.as_deref() {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Failed to fetch Lovcode releases: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let body = body.chars().take(240).collect::<String>();
            return Err(if body.trim().is_empty() {
                format!("GitHub API returned {}", status)
            } else {
                format!("GitHub API returned {}: {}", status, body)
            });
        }

        let page_releases = response
            .json::<Vec<GithubRelease>>()
            .await
            .map_err(|e| format!("Failed to parse Lovcode releases: {}", e))?;

        if page_releases.is_empty() {
            break;
        }

        let page_len = page_releases.len();
        releases.extend(page_releases.into_iter().map(|release| LovcodeRelease {
            version: release.tag_name.trim_start_matches('v').to_string(),
            tag_name: release.tag_name,
            name: release.name,
            published_at: release.published_at,
            html_url: release.html_url,
            body: release.body,
            prerelease: release.prerelease,
            draft: release.draft,
        }));

        if page_len < 100 {
            break;
        }
    }

    Ok(releases)
}

pub(crate) async fn fetch_lovcode_releases_from_atom(
    client: &reqwest::Client,
) -> Result<Vec<LovcodeRelease>, String> {
    let text = client
        .get("https://github.com/lovstudio/lovcode/releases.atom")
        .header(
            "User-Agent",
            format!("lovcode/{}", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Lovcode releases feed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read Lovcode releases feed: {}", e))?;

    let entry_re = regex::Regex::new(r"(?s)<entry>(.*?)</entry>").map_err(|e| e.to_string())?;
    let mut releases = Vec::new();

    for entry in entry_re.captures_iter(&text) {
        let Some(entry) = entry.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let Some(tag_name) = capture_first(entry, r"(?s)<title>(.*?)</title>") else {
            continue;
        };
        let html_url = capture_first(entry, r#"<link[^>]+href="([^"]+)""#).unwrap_or_else(|| {
            format!(
                "https://github.com/lovstudio/lovcode/releases/tag/{}",
                tag_name
            )
        });
        let published_at = capture_first(entry, r"(?s)<updated>(.*?)</updated>");
        let body = capture_first(entry, r"(?s)<content(?:\s[^>]*)?>(.*?)</content>");
        let prerelease = tag_name.contains('-');

        releases.push(LovcodeRelease {
            version: tag_name.trim_start_matches('v').to_string(),
            tag_name: tag_name.clone(),
            name: Some(tag_name),
            published_at,
            html_url,
            body,
            prerelease,
            draft: false,
        });
    }

    Ok(releases)
}

pub(crate) async fn fetch_lovcode_releases(
    client: &reqwest::Client,
    force_refresh: bool,
) -> Result<LovcodeReleaseFetch, String> {
    if !force_refresh {
        if let Some(releases) = get_fresh_lovcode_releases_cache() {
            return Ok(LovcodeReleaseFetch {
                releases,
                source: LovcodeReleaseSource::Cache,
                releases_truncated: false,
            });
        }
    }

    let api_result = match fetch_lovcode_releases_from_api(client).await {
        Ok(releases) if !releases.is_empty() => Ok(releases),
        Ok(_) => Err("GitHub API returned no Lovcode releases".to_string()),
        Err(error) => Err(error),
    };

    match api_result {
        Ok(releases) => {
            store_lovcode_releases_cache(&releases);
            Ok(LovcodeReleaseFetch {
                releases,
                source: LovcodeReleaseSource::GithubApi,
                releases_truncated: false,
            })
        }
        Err(api_error) => {
            if let Some(releases) = get_any_lovcode_releases_cache() {
                return Ok(LovcodeReleaseFetch {
                    releases,
                    source: LovcodeReleaseSource::Cache,
                    releases_truncated: false,
                });
            }

            let releases =
                fetch_lovcode_releases_from_atom(client)
                    .await
                    .map_err(|fallback_error| {
                        format!("{}; fallback failed: {}", api_error, fallback_error)
                    })?;

            Ok(LovcodeReleaseFetch {
                releases,
                source: LovcodeReleaseSource::GithubAtom,
                releases_truncated: true,
            })
        }
    }
}

#[tauri::command]
pub(crate) fn get_lovcode_autoupdater_enabled() -> Result<bool, String> {
    let settings_path = get_lovcode_updater_settings_path();
    if !settings_path.exists() {
        return Ok(true);
    }

    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let settings: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(settings
        .get("autoUpdateEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true))
}

#[tauri::command]
pub(crate) fn set_lovcode_autoupdater(enabled: bool) -> Result<(), String> {
    let settings_path = get_lovcode_updater_settings_path();
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut settings: Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    settings["autoUpdateEnabled"] = Value::Bool(enabled);
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) async fn get_lovcode_version_info_inner(
    force_refresh: bool,
) -> Result<LovcodeVersionInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let fetch = fetch_lovcode_releases(&client, force_refresh).await?;

    let latest_version = fetch
        .releases
        .iter()
        .find(|release| !release.draft && !release.prerelease)
        .or_else(|| fetch.releases.iter().find(|release| !release.draft))
        .map(|release| release.version.clone());

    let auto_update_enabled = get_lovcode_autoupdater_enabled()?;

    Ok(LovcodeVersionInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        latest_version,
        releases: fetch.releases,
        auto_update_enabled,
        release_source: fetch.source,
        releases_truncated: fetch.releases_truncated,
    })
}

#[tauri::command]
pub(crate) async fn get_lovcode_version_info() -> Result<LovcodeVersionInfo, String> {
    get_lovcode_version_info_inner(false).await
}

#[tauri::command]
pub(crate) async fn refresh_lovcode_version_info() -> Result<LovcodeVersionInfo, String> {
    get_lovcode_version_info_inner(true).await
}

pub(crate) fn shell_quote_command_path(path: &str) -> String {
    #[cfg(windows)]
    {
        format!("\"{}\"", path.replace('"', "\\\""))
    }

    #[cfg(not(windows))]
    {
        shell_escape::unix::escape(path.into()).into_owned()
    }
}

pub(crate) fn is_env_assignment_token(token: &str) -> bool {
    let Some((name, _)) = token.split_once('=') else {
        return false;
    };
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

pub(crate) fn command_token_spans(input: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start: Option<usize> = None;
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for (index, ch) in input.char_indices() {
        if start.is_none() {
            if ch.is_whitespace() {
                continue;
            }
            start = Some(index);
        }

        if escaped {
            escaped = false;
            continue;
        }

        if ch == '\\' && !in_single {
            escaped = true;
            continue;
        }

        if ch == '\'' && !in_double {
            in_single = !in_single;
            continue;
        }

        if ch == '"' && !in_single {
            in_double = !in_double;
            continue;
        }

        if ch.is_whitespace() && !in_single && !in_double {
            if let Some(token_start) = start.take() {
                spans.push((token_start, index));
            }
        }
    }

    if let Some(token_start) = start {
        spans.push((token_start, input.len()));
    }

    spans
}

pub(crate) fn apply_agent_cli_path_override(command: &str) -> String {
    for (start, end) in command_token_spans(command) {
        let token = &command[start..end];
        if is_env_assignment_token(token) {
            continue;
        }
        let provider = match token {
            "claude" => "claude",
            "codex" => "codex",
            _ => return command.to_string(),
        };
        let Some(path) = get_agent_runtime_path_override(provider) else {
            return command.to_string();
        };
        if !Path::new(&path).is_file() {
            return command.to_string();
        }
        let mut rewritten = String::with_capacity(command.len() + path.len());
        rewritten.push_str(&command[..start]);
        rewritten.push_str(&shell_quote_command_path(&path));
        rewritten.push_str(&command[end..]);
        return rewritten;
    }

    command.to_string()
}
