use super::*;

// ============================================================================
// Provider Context Commands (per-provider env persistence)
// ============================================================================

pub(crate) fn get_provider_contexts() -> Result<Value, String> {
    let contexts = load_provider_contexts()?;
    Ok(Value::Object(contexts))
}

pub(crate) fn set_provider_context_env(
    provider_key: String,
    env_key: String,
    env_value: String,
) -> Result<(), String> {
    let mut contexts = load_provider_contexts()?;
    let entry = contexts
        .entry(provider_key)
        .or_insert_with(|| serde_json::json!({ "env": {} }));
    let obj = entry.as_object_mut().ok_or("provider context not object")?;
    if !obj.get("env").and_then(|v| v.as_object()).is_some() {
        obj.insert("env".to_string(), serde_json::json!({}));
    }
    obj["env"][&env_key] = Value::String(env_value);
    save_provider_contexts(&contexts)?;
    Ok(())
}

pub(crate) fn snapshot_provider_context(
    provider_key: String,
    env_keys: Vec<String>,
) -> Result<(), String> {
    let settings_path = get_claude_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let settings: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let env = settings
        .get("env")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    let mut snapshot = serde_json::Map::new();
    for key in &env_keys {
        if let Some(v) = env.get(key).and_then(|v| v.as_str()) {
            snapshot.insert(key.clone(), Value::String(v.to_string()));
        }
    }

    let mut contexts = load_provider_contexts()?;
    let entry = contexts
        .entry(provider_key)
        .or_insert_with(|| serde_json::json!({}));
    let entry = entry.as_object_mut().ok_or("provider context not object")?;
    entry.insert("env".to_string(), Value::Object(snapshot));
    save_provider_contexts(&contexts)?;
    Ok(())
}

pub(crate) fn restore_provider_context(
    provider_key: String,
    env_keys: Vec<String>,
) -> Result<bool, String> {
    let contexts = load_provider_contexts()?;
    let Some(env) = contexts
        .get(&provider_key)
        .and_then(|value| value.get("env"))
        .and_then(|value| value.as_object())
    else {
        return Ok(false);
    };

    if !env_keys
        .iter()
        .any(|key| env.get(key).and_then(|value| value.as_str()).is_some())
    {
        return Ok(false);
    }

    let patches = env_keys
        .into_iter()
        .map(|env_key| {
            env.get(&env_key)
                .and_then(|value| value.as_str())
                .map(|env_value| SettingsPatch::SetEnv {
                    env_key: env_key.clone(),
                    env_value: env_value.to_string(),
                    is_new: None,
                })
                .unwrap_or(SettingsPatch::DeleteEnv { env_key })
        })
        .collect();

    apply_settings_patches(patches)?;
    Ok(true)
}
