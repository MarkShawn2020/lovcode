use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FetchParseResult {
    pub(crate) models: Vec<MaasModel>,
    pub(crate) vendors: Vec<Vendor>,
    pub(crate) raw_preview: String,
    pub(crate) notes: Option<String>,
}

pub(crate) struct SimpleHttpFetch {
    pub(crate) method: reqwest::Method,
    pub(crate) url: String,
}

/// Execute a models-listing request and normalize the response into MaaS
/// models. Supports a shell command for authenticated/private catalogs and a
/// lightweight `GET https://...` shorthand for public catalogs.
///
/// The command should print a JSON model list to stdout. Known provider schemas
/// are parsed locally; unknown shapes fall back to a generic model walker.
pub(crate) async fn fetch_and_parse_maas_models(
    fetch_command: String,
    provider_key: String,
) -> Result<FetchParseResult, String> {
    let _ = provider_key; // reserved for provider-specific overrides
    let cmd = fetch_command.trim();
    if cmd.is_empty() {
        return Err("fetch command is empty".to_string());
    }

    let raw_stdout = if let Some(request) = parse_simple_http_fetch(cmd) {
        println!("[maas-fetch] direct {} {}", request.method, request.url);
        run_simple_http_fetch(request).await?
    } else {
        run_maas_fetch_shell_command(cmd).await?
    };

    let raw_preview: String = raw_stdout.chars().take(1000).collect();

    // Step 2: parse JSON. Try known provider schemas first (zenmux), fall back
    // to a generic heuristic walker for unknown shapes.
    let json: serde_json::Value = serde_json::from_str(&raw_stdout).map_err(|e| {
        format!(
            "Response is not valid JSON: {}. First 500 chars:\n{}",
            e,
            raw_stdout.chars().take(500).collect::<String>()
        )
    })?;

    let (mut models, mut vendors, parser_label) = if let Some((m, v)) = parse_zenmux(&json) {
        (m, v, "zenmux")
    } else {
        let m = extract_models_heuristic(&json);
        let v = synthesize_vendors_from_models(&m);
        (m, v, "heuristic")
    };
    // De-dup by modelName, preserve order
    let mut seen = std::collections::HashSet::new();
    models.retain(|m| seen.insert(m.model_name.clone()));
    // Ensure id uniqueness
    let mut id_seen = std::collections::HashSet::new();
    for m in models.iter_mut() {
        let base = m.id.clone();
        let mut i = 2;
        while !id_seen.insert(m.id.clone()) {
            m.id = format!("{}-{}", base, i);
            i += 1;
        }
    }

    println!(
        "[maas-fetch] {} parser extracted {} models",
        parser_label,
        models.len()
    );

    let notes = if models.is_empty() {
        Some(format!(
            "No models found by {} parser. Response may use a non-standard schema.",
            parser_label
        ))
    } else {
        Some(format!(
            "Extracted {} models via {} parser.",
            models.len(),
            parser_label
        ))
    };

    // Drop vendors that no model references (post de-dup)
    let referenced: std::collections::HashSet<String> =
        models.iter().filter_map(|m| m.vendor.clone()).collect();
    vendors.retain(|v| referenced.contains(&v.id));

    Ok(FetchParseResult {
        models,
        vendors,
        raw_preview,
        notes,
    })
}

pub(crate) fn parse_simple_http_fetch(cmd: &str) -> Option<SimpleHttpFetch> {
    let mut parts = cmd.trim().split_whitespace();
    let method = parts.next()?.to_ascii_uppercase();
    let raw_url = parts.next()?;
    if parts.next().is_some() || method != "GET" {
        return None;
    }
    let url = raw_url
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return None;
    }
    Some(SimpleHttpFetch {
        method: reqwest::Method::GET,
        url,
    })
}

pub(crate) async fn run_simple_http_fetch(request: SimpleHttpFetch) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Lovcode/maas-fetch")
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let response = client
        .request(request.method, &request.url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("Fetch request failed: {}", e))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read fetch response: {}", e))?;
    if !status.is_success() {
        return Err(format!(
            "fetch request failed (HTTP {}): {}",
            status.as_u16(),
            text.chars().take(500).collect::<String>()
        ));
    }
    if text.trim().is_empty() {
        return Err("fetch request produced an empty response".to_string());
    }
    Ok(text)
}

pub(crate) async fn run_maas_fetch_shell_command(cmd: &str) -> Result<String, String> {
    #[cfg(windows)]
    let (shell_label, fetch_fut) = {
        let command = normalize_windows_fetch_command(cmd);
        let command = format!("$ProgressPreference = 'SilentlyContinue'; {}", command);
        let mut process = tokio::process::Command::new("powershell.exe");
        process
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(command);
        ("powershell.exe".to_string(), process.output())
    };

    #[cfg(not(windows))]
    let (shell_label, fetch_fut) = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        (
            shell.clone(),
            tokio::process::Command::new(&shell)
                .args(["-ilc", cmd])
                .output(),
        )
    };

    println!("[maas-fetch] shell={} cmd_bytes={}", shell_label, cmd.len());
    let output = tokio::time::timeout(Duration::from_secs(45), fetch_fut)
        .await
        .map_err(|_| "Fetch step timed out after 45s. Check network / proxy.".to_string())?
        .map_err(|e| format!("Failed to run fetch command: {}", e))?;

    let raw_stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let raw_stderr = String::from_utf8_lossy(&output.stderr).to_string();
    println!(
        "[maas-fetch] shell exit={:?} stdout_bytes={} stderr_bytes={}",
        output.status.code(),
        raw_stdout.len(),
        raw_stderr.len()
    );
    if !output.status.success() && raw_stdout.trim().is_empty() {
        return Err(format!(
            "fetch command failed (exit={:?}): {}",
            output.status.code(),
            raw_stderr.chars().take(500).collect::<String>()
        ));
    }
    if raw_stdout.trim().is_empty() {
        return Err(format!(
            "fetch command produced no stdout. stderr: {}",
            raw_stderr.chars().take(500).collect::<String>()
        ));
    }
    Ok(raw_stdout)
}

#[cfg(windows)]
pub(crate) fn normalize_windows_fetch_command(cmd: &str) -> String {
    let trimmed_start = cmd.trim_start();
    let leading_len = cmd.len() - trimmed_start.len();
    if let Some(rest) = trimmed_start.strip_prefix("curl") {
        if rest.chars().next().map_or(true, char::is_whitespace) {
            return format!("{}curl.exe{}", &cmd[..leading_len], rest);
        }
    }
    cmd.to_string()
}

/// When the heuristic walker finds models without explicit vendor info, build
/// a minimal vendor list from the unique vendor ids it inferred.
pub(crate) fn synthesize_vendors_from_models(models: &[MaasModel]) -> Vec<Vendor> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for m in models {
        if let Some(vid) = &m.vendor {
            if seen.insert(vid.clone()) {
                out.push(Vendor {
                    id: vid.clone(),
                    name: vid.clone(),
                    icon_url: None,
                    description: None,
                    website_url: None,
                });
            }
        }
    }
    out
}

/// ZenMux supports both its rich catalog shape
/// `{"success":true,"data":{"models":[{slug, name, author, ...}]}}` and
/// OpenAI-compatible `/api/v1/models` shape `{"data":[{id, owned_by, ...}]}`.
pub(crate) fn parse_zenmux(root: &serde_json::Value) -> Option<(Vec<MaasModel>, Vec<Vendor>)> {
    let arr = get_zenmux_models_array(root)?;
    let mut out: Vec<MaasModel> = Vec::with_capacity(arr.len());
    let mut vendor_map: std::collections::HashMap<String, Vendor> =
        std::collections::HashMap::new();
    let mut vendor_order: Vec<String> = Vec::new();

    for item in arr {
        let obj = match item.as_object() {
            Some(o) => o,
            None => continue,
        };
        if obj.get("visible").and_then(|x| x.as_i64()) == Some(0)
            || obj.get("visible").and_then(|x| x.as_bool()) == Some(false)
        {
            continue;
        }
        let Some(model_name) = get_string_field_any(
            obj,
            &["slug", "id", "model", "model_name", "modelName", "model_id"],
        ) else {
            continue;
        };
        let raw_name = get_string_field_any(obj, &["name", "display_name", "displayName"])
            .unwrap_or_else(|| derive_display_name(&model_name));
        // "Anthropic: Claude Sonnet 4.6" → "Claude Sonnet 4.6"
        let (vendor_label_from_name, display_name) = match raw_name.split_once(':') {
            Some((vlabel, rest)) => (Some(vlabel.trim().to_string()), rest.trim().to_string()),
            None => (None, raw_name.clone()),
        };
        let display_name = if display_name.is_empty() {
            raw_name
        } else {
            display_name
        };

        let vendor_id_raw = get_string_field_any(
            obj,
            &[
                "author",
                "owned_by",
                "ownedBy",
                "vendor",
                "organization",
                "org",
            ],
        )
        .or_else(|| model_name.split_once('/').map(|(p, _)| p.to_string()));

        let vendor_id = vendor_id_raw.as_ref().map(|s| slugify_id(s));
        let icon_url = get_string_field_any(obj, &["icon_url", "iconUrl", "logo", "logo_url"]);

        if let Some(ref vid) = vendor_id {
            vendor_map
                .entry(vid.clone())
                .and_modify(|v| {
                    if v.icon_url.is_none() {
                        v.icon_url = icon_url.clone();
                    }
                })
                .or_insert_with(|| {
                    vendor_order.push(vid.clone());
                    Vendor {
                        id: vid.clone(),
                        name: vendor_label_from_name.clone().unwrap_or_else(|| {
                            vendor_id_raw.clone().unwrap_or_else(|| vid.clone())
                        }),
                        icon_url: icon_url.clone(),
                        description: None,
                        website_url: None,
                    }
                });
        }

        let description = get_string_field_any(obj, &["description", "summary"]);
        let input_modalities = non_empty_vec(get_string_list_field_any(
            obj,
            &["input_modalities", "inputModalities"],
        ));
        let output_modalities = non_empty_vec(get_string_list_field_any(
            obj,
            &["output_modalities", "outputModalities"],
        ));
        let context_window = get_u64_field_any(
            obj,
            &[
                "context_window",
                "contextWindow",
                "context_length",
                "max_input_tokens",
            ],
        );

        out.push(MaasModel {
            id: slugify_id(&model_name),
            display_name,
            model_name,
            vendor: vendor_id,
            description,
            icon_url,
            input_modalities,
            output_modalities,
            context_window,
        });
    }

    if out.is_empty() {
        return None;
    }
    let vendors = vendor_order
        .into_iter()
        .filter_map(|id| vendor_map.remove(&id))
        .collect();
    Some((out, vendors))
}

pub(crate) fn non_empty_vec(values: Vec<String>) -> Option<Vec<String>> {
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

pub(crate) fn parse_csv_modalities(s: &str) -> Vec<String> {
    s.split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Walk arbitrary JSON looking for objects that look like model entries.
/// A "model object" has at least one of: `id`, `slug`, `model`, `model_id`, `name`
/// that's a non-empty string and looks like a model identifier (contains `-`, `/`,
/// or a digit; or the parent key is `data`/`models`/`list`).
pub(crate) fn extract_models_heuristic(root: &serde_json::Value) -> Vec<MaasModel> {
    let mut out = Vec::new();
    walk_for_models(root, None, &mut out);
    out
}

pub(crate) fn walk_for_models(
    val: &serde_json::Value,
    parent_key: Option<&str>,
    out: &mut Vec<MaasModel>,
) {
    match val {
        serde_json::Value::Array(arr) => {
            // If the parent key suggests this is a model list, try to pull each item
            let parent_is_modelish = matches!(
                parent_key,
                Some("data" | "models" | "list" | "items" | "modelList" | "model_list" | "result")
            );
            for item in arr {
                if parent_is_modelish {
                    if let Some(m) = try_extract_model(item) {
                        out.push(m);
                        continue;
                    }
                }
                walk_for_models(item, parent_key, out);
            }
        }
        serde_json::Value::Object(map) => {
            // Heuristic: if this object itself smells like a model, try it
            if let Some(m) = try_extract_model(val) {
                out.push(m);
            }
            for (k, v) in map {
                walk_for_models(v, Some(k.as_str()), out);
            }
        }
        _ => {}
    }
}

pub(crate) fn try_extract_model(v: &serde_json::Value) -> Option<MaasModel> {
    let obj = v.as_object()?;

    // Find the canonical model id field (what the API expects in `model:` param)
    let model_name = [
        "modelName",
        "model_name",
        "model_id",
        "modelId",
        "model",
        "slug",
        "id",
    ]
    .iter()
    .find_map(|k| obj.get(*k).and_then(|x| x.as_str()))
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty() && looks_like_model_id(s))?;

    // Display name
    let display_name = ["displayName", "display_name", "name", "title", "label"]
        .iter()
        .find_map(|k| obj.get(*k).and_then(|x| x.as_str()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| derive_display_name(&model_name));

    let id_source = ["id", "slug"]
        .iter()
        .find_map(|k| obj.get(*k).and_then(|x| x.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| model_name.clone());
    let id = slugify_id(&id_source);

    let vendor = [
        "author",
        "owned_by",
        "ownedBy",
        "vendor",
        "organization",
        "org",
    ]
    .iter()
    .find_map(|k| obj.get(*k).and_then(|x| x.as_str()))
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .or_else(|| model_name.split_once('/').map(|(p, _)| p.to_string()))
    .map(|s| slugify_id(&s));

    let description = ["description", "summary"]
        .iter()
        .find_map(|k| obj.get(*k).and_then(|x| x.as_str()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let icon_url = ["icon_url", "iconUrl", "logo", "logo_url"]
        .iter()
        .find_map(|k| obj.get(*k).and_then(|x| x.as_str()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let modal = |k1: &str, k2: &str| -> Option<Vec<String>> {
        if let Some(arr) = obj
            .get(k1)
            .or_else(|| obj.get(k2))
            .and_then(|x| x.as_array())
        {
            let v: Vec<String> = arr
                .iter()
                .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect();
            return if v.is_empty() { None } else { Some(v) };
        }
        if let Some(s) = obj.get(k1).or_else(|| obj.get(k2)).and_then(|x| x.as_str()) {
            let v = parse_csv_modalities(s);
            return if v.is_empty() { None } else { Some(v) };
        }
        None
    };
    let input_modalities = modal("input_modalities", "inputModalities");
    let output_modalities = modal("output_modalities", "outputModalities");

    let context_window = [
        "context_window",
        "contextWindow",
        "context_length",
        "max_input_tokens",
    ]
    .iter()
    .find_map(|k| obj.get(*k).and_then(|x| x.as_u64()));

    Some(MaasModel {
        id,
        display_name,
        model_name,
        vendor,
        description,
        icon_url,
        input_modalities,
        output_modalities,
        context_window,
    })
}

pub(crate) fn looks_like_model_id(s: &str) -> bool {
    // Filter out garbage like "object" or "v1". Real model ids contain a digit
    // and at least one dash/slash, or are 4+ chars and contain a digit.
    let has_digit = s.chars().any(|c| c.is_ascii_digit());
    let has_sep = s.contains('-') || s.contains('/') || s.contains('.');
    s.len() >= 4 && (has_digit || has_sep) && !s.contains(' ')
}

pub(crate) fn slugify_id(s: &str) -> String {
    // Take part after last `/` (drop "anthropic/" prefix etc.), lowercase,
    // replace non-[a-z0-9-] with `-`, collapse repeats.
    let tail = s.rsplit('/').next().unwrap_or(s);
    let lower = tail.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut last_dash = false;
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

pub(crate) fn derive_display_name(model_name: &str) -> String {
    let tail = model_name.rsplit('/').next().unwrap_or(model_name);
    // Strip trailing date suffix like -20251001
    let cleaned = if let Some(idx) = tail.rfind('-') {
        let suffix = &tail[idx + 1..];
        if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
            &tail[..idx]
        } else {
            tail
        }
    } else {
        tail
    };
    cleaned
        .split('-')
        .map(|p| {
            let mut chars = p.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
