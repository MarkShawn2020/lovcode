use super::*;

// ============================================================================
// MaaS Registry Commands
// ============================================================================

pub(crate) fn get_maas_registry() -> Result<Vec<MaasProvider>, String> {
    load_maas_registry()
}

pub(crate) async fn get_maas_realtime_status() -> Result<MaasRealtimeStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Lovcode/maas-status")
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| e.to_string())?;

    let fetched_at = chrono::Utc::now().to_rfc3339();
    let claude_result = fetch_claude_realtime_status(&client).await;
    let zenmux_result = fetch_zenmux_realtime_status(&client).await;
    let (claude, claude_error) = match claude_result {
        Ok(status) => (Some(status), None),
        Err(error) => (None, Some(error)),
    };
    let (zenmux, zenmux_error) = match zenmux_result {
        Ok(status) => (Some(status), None),
        Err(error) => (None, Some(error)),
    };

    Ok(MaasRealtimeStatus {
        fetched_at,
        claude,
        claude_error,
        zenmux,
        zenmux_error,
    })
}

pub(crate) fn save_maas_registry(registry: Vec<MaasProvider>) -> Result<(), String> {
    persist_maas_registry(&registry)
}

pub(crate) fn upsert_maas_provider(provider: MaasProvider) -> Result<Vec<MaasProvider>, String> {
    let mut registry = load_maas_registry()?;
    match registry.iter().position(|p| p.key == provider.key) {
        Some(idx) => registry[idx] = provider,
        None => registry.push(provider),
    }
    persist_maas_registry(&registry)?;
    Ok(registry)
}

pub(crate) fn delete_maas_provider(key: String) -> Result<Vec<MaasProvider>, String> {
    if is_builtin_maas_key(&key) {
        return Err(format!(
            "\"{}\" is a built-in provider and cannot be deleted. Clear its token / models if you want to disable it.",
            key
        ));
    }
    let mut registry = load_maas_registry()?;
    registry.retain(|p| p.key != key);
    persist_maas_registry(&registry)?;
    Ok(registry)
}

pub(crate) async fn fetch_claude_realtime_status(
    client: &reqwest::Client,
) -> Result<ClaudeRealtimeStatus, String> {
    let summary =
        fetch_realtime_json(client, "https://status.claude.com/api/v2/summary.json").await?;
    let incidents = fetch_realtime_json(client, "https://status.claude.com/api/v2/incidents.json")
        .await
        .unwrap_or_else(|_| serde_json::json!({ "incidents": [] }));

    let page = summary.get("page").and_then(|value| value.as_object());
    let status = summary.get("status").and_then(|value| value.as_object());
    let components = summary
        .get("components")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(parse_claude_status_component)
                .collect()
        })
        .unwrap_or_default();
    let incidents = incidents
        .get("incidents")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(parse_claude_status_incident)
                .take(8)
                .collect()
        })
        .unwrap_or_default();

    Ok(ClaudeRealtimeStatus {
        page_name: page
            .and_then(|page| get_string_field(page, "name"))
            .unwrap_or_else(|| "Claude".to_string()),
        page_url: page.and_then(|page| get_string_field(page, "url")),
        indicator: status.and_then(|status| get_string_field(status, "indicator")),
        description: status.and_then(|status| get_string_field(status, "description")),
        updated_at: page.and_then(|page| get_string_field(page, "updated_at")),
        components,
        incidents,
    })
}

pub(crate) async fn fetch_zenmux_realtime_status(
    client: &reqwest::Client,
) -> Result<ZenmuxRealtimeStatus, String> {
    let anthropic_result =
        fetch_realtime_json(client, "https://zenmux.ai/api/anthropic/v1/models").await;
    let openai_result = fetch_realtime_json(client, "https://zenmux.ai/api/v1/models").await;

    let mut models = Vec::new();
    let mut errors = Vec::new();
    match anthropic_result {
        Ok(value) => models.extend(parse_zenmux_realtime_models(&value)),
        Err(error) => errors.push(error),
    }
    match openai_result {
        Ok(value) => models.extend(parse_zenmux_realtime_models(&value)),
        Err(error) => errors.push(error),
    }

    let mut seen = std::collections::HashSet::new();
    models.retain(|model| seen.insert(model.id.to_ascii_lowercase()));
    if models.is_empty() {
        let detail = if errors.is_empty() {
            "ZenMux model catalog returned no models".to_string()
        } else {
            errors.join("; ")
        };
        return Err(detail);
    }

    Ok(ZenmuxRealtimeStatus {
        fetched_at: chrono::Utc::now().to_rfc3339(),
        models,
    })
}

pub(crate) async fn fetch_realtime_json(
    client: &reqwest::Client,
    url: &str,
) -> Result<Value, String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("request {}: {}", url, e))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("read {}: {}", url, e))?;
    if !status.is_success() {
        return Err(format!("{} returned HTTP {}", url, status.as_u16()));
    }
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {}", url, e))
}

pub(crate) fn parse_claude_status_component(value: &Value) -> Option<ClaudeStatusComponent> {
    let obj = value.as_object()?;
    let id = get_string_field(obj, "id")?;
    let name = get_string_field(obj, "name")?;
    let status = get_string_field(obj, "status").unwrap_or_else(|| "unknown".to_string());
    let updated_at = get_string_field(obj, "updated_at");
    Some(ClaudeStatusComponent {
        id,
        name,
        status,
        updated_at,
    })
}

pub(crate) fn parse_claude_status_incident(value: &Value) -> Option<ClaudeStatusIncident> {
    let obj = value.as_object()?;
    let id = get_string_field(obj, "id")?;
    let name = get_string_field(obj, "name")?;
    let status = get_string_field(obj, "status").unwrap_or_else(|| "unknown".to_string());
    let affected_components = obj
        .get("components")
        .and_then(|value| value.as_array())
        .map(|components| {
            components
                .iter()
                .filter_map(|component| {
                    component
                        .as_object()
                        .and_then(|component| get_string_field(component, "name"))
                })
                .collect()
        })
        .unwrap_or_default();

    Some(ClaudeStatusIncident {
        id,
        name,
        status,
        impact: get_string_field(obj, "impact"),
        created_at: get_string_field(obj, "created_at"),
        resolved_at: get_string_field(obj, "resolved_at"),
        shortlink: get_string_field(obj, "shortlink"),
        affected_components,
    })
}

pub(crate) fn parse_zenmux_realtime_models(root: &Value) -> Vec<ZenmuxRealtimeModel> {
    let Some(items) = get_zenmux_models_array(root) else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            let id = get_string_field_any(
                obj,
                &["id", "slug", "model", "model_name", "modelName", "model_id"],
            )?;
            Some(ZenmuxRealtimeModel {
                display_name: get_string_field_any(obj, &["display_name", "displayName", "name"]),
                owned_by: get_string_field_any(obj, &["owned_by", "ownedBy", "author", "vendor"]),
                created_at: get_dateish_field_any(obj, &["created_at", "createdAt", "created"]),
                context_length: get_u64_field_any(
                    obj,
                    &[
                        "context_length",
                        "contextLength",
                        "context_window",
                        "contextWindow",
                    ],
                ),
                input_modalities: get_string_list_field_any(
                    obj,
                    &["input_modalities", "inputModalities"],
                ),
                output_modalities: get_string_list_field_any(
                    obj,
                    &["output_modalities", "outputModalities"],
                ),
                prompt_price: get_price_field_any(
                    obj,
                    &[
                        "prompt_price",
                        "promptPrice",
                        "input_price",
                        "inputPrice",
                        "input_cost_per_million_tokens",
                    ],
                ),
                completion_price: get_price_field_any(
                    obj,
                    &[
                        "completion_price",
                        "completionPrice",
                        "output_price",
                        "outputPrice",
                        "output_cost_per_million_tokens",
                    ],
                ),
                id,
            })
        })
        .collect()
}

pub(crate) fn get_zenmux_models_array(root: &Value) -> Option<&Vec<Value>> {
    if let Some(items) = root.get("data").and_then(|value| value.as_array()) {
        return Some(items);
    }
    if let Some(items) = root
        .get("data")
        .and_then(|value| value.get("models"))
        .and_then(|value| value.as_array())
    {
        return Some(items);
    }
    if let Some(items) = root.get("models").and_then(|value| value.as_array()) {
        return Some(items);
    }
    root.as_array()
}

pub(crate) fn get_string_field(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn get_string_field_any(
    map: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter().find_map(|key| get_string_field(map, key))
}

pub(crate) fn get_dateish_field_any(
    map: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        let Some(value) = map.get(*key) else {
            continue;
        };
        if let Some(text) = value
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return Some(text.to_string());
        }
        if let Some(seconds) = value.as_i64() {
            if let Some(date) = chrono::DateTime::from_timestamp(seconds, 0) {
                return Some(date.to_rfc3339());
            }
        }
    }
    None
}

pub(crate) fn get_u64_field_any(
    map: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<u64> {
    keys.iter().find_map(|key| {
        map.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
        })
    })
}

pub(crate) fn get_string_list_field_any(
    map: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Vec<String> {
    for key in keys {
        let Some(value) = map.get(*key) else {
            continue;
        };
        if let Some(items) = value.as_array() {
            let values: Vec<String> = items
                .iter()
                .filter_map(|item| item.as_str().map(str::trim))
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect();
            if !values.is_empty() {
                return values;
            }
        }
        if let Some(text) = value.as_str() {
            let values = parse_csv_modalities(text);
            if !values.is_empty() {
                return values;
            }
        }
    }
    Vec::new()
}

pub(crate) fn get_price_field_any(
    map: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        let Some(value) = map.get(*key) else {
            continue;
        };
        if let Some(price) = normalize_price_value(value) {
            return Some(price);
        }
    }
    map.get("pricings")
        .and_then(|value| value.as_array())
        .and_then(|items| {
            items.iter().find_map(|item| {
                let obj = item.as_object()?;
                keys.iter()
                    .find_map(|key| obj.get(*key).and_then(normalize_price_value))
            })
        })
        .or_else(|| {
            map.get("pricings")
                .and_then(|value| value.as_object())
                .and_then(|pricing| {
                    keys.iter()
                        .find_map(|key| pricing.get(*key).and_then(normalize_price_value))
                })
        })
}

pub(crate) fn normalize_price_value(value: &Value) -> Option<String> {
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(amount) = value.as_f64() {
        return Some(if amount == 0.0 {
            "$0".to_string()
        } else if amount.abs() < 1.0 {
            format!("${:.4}", amount)
        } else {
            format!("${:.2}", amount)
        });
    }
    if let Some(items) = value.as_array() {
        return items.iter().find_map(normalize_price_value);
    }
    if let Some(obj) = value.as_object() {
        return ["price", "amount", "unit_price", "value"]
            .iter()
            .find_map(|key| obj.get(*key).and_then(normalize_price_value));
    }
    None
}

pub(crate) fn codex_maas_provider_id(provider_key: &str) -> String {
    let mut normalized = String::new();
    for ch in provider_key.chars() {
        let ch = ch.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            normalized.push(ch);
        } else {
            normalized.push('-');
        }
    }
    let normalized = normalized.trim_matches('-');
    let suffix = if normalized.is_empty() {
        "custom"
    } else {
        normalized
    };
    format!("lovcode-{}", suffix)
}

pub(crate) fn update_codex_maas_provider(
    provider: MaasProvider,
    model: String,
) -> Result<(), String> {
    if provider.key == "anthropic-subscription" {
        return Err("Anthropic Subscription OAuth is only available for Claude Code".to_string());
    }

    let base_url = provider.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("Codex requires a provider Base URL".to_string());
    }

    let auth_token = provider.auth_token.trim().to_string();
    if auth_token.is_empty() {
        return Err("Codex requires a provider token".to_string());
    }

    let config_path = get_codex_config_path();
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = if config_path.exists() {
        fs::read_to_string(&config_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let mut doc = if content.trim().is_empty() {
        toml_edit::DocumentMut::new()
    } else {
        content
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| format!("parse Codex config.toml: {}", e))?
    };

    let provider_id = codex_maas_provider_id(&provider.key);
    doc["model_provider"] = toml_edit::value(provider_id.clone());

    let model = model.trim();
    if !model.is_empty() {
        doc["model"] = toml_edit::value(model.to_string());
    }

    if !doc.as_table().contains_key("model_providers") || !doc["model_providers"].is_table() {
        doc["model_providers"] = toml_edit::Item::Table(toml_edit::Table::new());
    }

    let mut provider_table = toml_edit::Table::new();
    provider_table["name"] = toml_edit::value(if provider.label.trim().is_empty() {
        provider.key.clone()
    } else {
        provider.label.trim().to_string()
    });
    provider_table["base_url"] = toml_edit::value(base_url);
    provider_table["wire_api"] = toml_edit::value("chat");
    provider_table["experimental_bearer_token"] = toml_edit::value(auth_token);
    provider_table["requires_openai_auth"] = toml_edit::value(false);
    doc["model_providers"][provider_id.as_str()] = toml_edit::Item::Table(provider_table);

    fs::write(&config_path, doc.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}
