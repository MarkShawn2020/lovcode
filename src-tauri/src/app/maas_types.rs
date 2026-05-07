use super::*;

// ============================================================================
// MaaS Registry (provider + model mappings for empty-state cascading picker)
// ============================================================================

/// A model vendor (the entity that *trained* the model, e.g. "anthropic", "openai").
/// Distinct from `MaasProvider`, which is the *access platform* (e.g. zenmux,
/// modelgate) that resells models from many vendors. One MaasProvider has many
/// Vendors and many MaasModels; each MaasModel references its vendor by id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Vendor {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) icon_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaasModel {
    pub(crate) id: String,
    pub(crate) display_name: String,
    pub(crate) model_name: String,
    /// References `Vendor.id` on the parent MaasProvider's `vendors` list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) vendor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) icon_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) input_modalities: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) output_modalities: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaasProvider {
    pub(crate) key: String,
    pub(crate) label: String,
    pub(crate) base_url: String,
    /// API key / bearer token in plaintext. Stored on disk in the user's
    /// lovstudio dir (~/.lovstudio/maas_registry.json). Migrated from the
    /// legacy `authEnvKey` field on first read.
    #[serde(default, alias = "authEnvKey")]
    pub(crate) auth_token: String,
    pub(crate) models: Vec<MaasModel>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) vendors: Vec<Vendor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fetch_command: Option<String>,
    /// ISO-8601 timestamp of the most recent successful Verify call. Persisted
    /// alongside `last_verified_token_hash` so the UI can show "verified" only
    /// when the saved token still matches what was verified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_verified_at: Option<String>,
    /// Short non-reversible fingerprint of the auth_token at the moment of the
    /// last successful verification. Compared against the current token to
    /// decide whether the verified state is still valid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_verified_token_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeStatusComponent {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeStatusIncident {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) impact: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) shortlink: Option<String>,
    pub(crate) affected_components: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeRealtimeStatus {
    pub(crate) page_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) page_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) indicator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) updated_at: Option<String>,
    pub(crate) components: Vec<ClaudeStatusComponent>,
    pub(crate) incidents: Vec<ClaudeStatusIncident>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ZenmuxRealtimeModel {
    pub(crate) id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) owned_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) context_length: Option<u64>,
    pub(crate) input_modalities: Vec<String>,
    pub(crate) output_modalities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) prompt_price: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) completion_price: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ZenmuxRealtimeStatus {
    pub(crate) fetched_at: String,
    pub(crate) models: Vec<ZenmuxRealtimeModel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaasRealtimeStatus {
    pub(crate) fetched_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) claude: Option<ClaudeRealtimeStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) claude_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) zenmux: Option<ZenmuxRealtimeStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) zenmux_error: Option<String>,
}

pub(crate) fn get_maas_registry_path() -> PathBuf {
    get_lovstudio_dir().join("maas_registry.json")
}

pub(crate) fn default_maas_registry() -> Vec<MaasProvider> {
    vec![
        MaasProvider {
            key: "anthropic-subscription".into(),
            label: "Anthropic Subscription".into(),
            base_url: "".into(),
            auth_token: String::new(),
            models: vec![],
            vendors: vec![],
            fetch_command: None,
            last_verified_at: None,
            last_verified_token_hash: None,
        },
        MaasProvider {
            key: "native".into(),
            label: "Anthropic API".into(),
            base_url: "https://api.anthropic.com".into(),
            auth_token: String::new(),
            models: vec![],
            vendors: vec![],
            fetch_command: None,
            last_verified_at: None,
            last_verified_token_hash: None,
        },
        MaasProvider {
            key: "zenmux".into(),
            label: "ZenMux".into(),
            base_url: "https://zenmux.ai/api/anthropic".into(),
            auth_token: String::new(),
            models: vec![],
            vendors: vec![],
            fetch_command: Some(ZENMUX_DEFAULT_FETCH_COMMAND.into()),
            last_verified_at: None,
            last_verified_token_hash: None,
        },
        MaasProvider {
            key: "modelgate".into(),
            label: "ModelGate".into(),
            base_url: "https://mg.aid.pub/claude-proxy".into(),
            auth_token: String::new(),
            models: vec![],
            vendors: vec![],
            fetch_command: None,
            last_verified_at: None,
            last_verified_token_hash: None,
        },
        MaasProvider {
            key: "qiniu".into(),
            label: "Qiniu Cloud".into(),
            base_url: "https://api.qnaigc.com".into(),
            auth_token: String::new(),
            models: vec![],
            vendors: vec![],
            fetch_command: None,
            last_verified_at: None,
            last_verified_token_hash: None,
        },
        MaasProvider {
            key: "siliconflow".into(),
            label: "SiliconFlow".into(),
            base_url: "https://api.siliconflow.com/v1".into(),
            auth_token: String::new(),
            models: vec![],
            vendors: vec![],
            fetch_command: None,
            last_verified_at: None,
            last_verified_token_hash: None,
        },
        MaasProvider {
            key: "univibe".into(),
            label: "UniVibe".into(),
            base_url: "https://api.univibe.cc/anthropic".into(),
            auth_token: String::new(),
            models: vec![],
            vendors: vec![],
            fetch_command: None,
            last_verified_at: None,
            last_verified_token_hash: None,
        },
    ]
}

pub(crate) fn load_maas_registry() -> Result<Vec<MaasProvider>, String> {
    let path = get_maas_registry_path();
    if !path.exists() {
        return Ok(default_maas_registry());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let saved: Vec<MaasProvider> = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Reconcile against defaults so built-in order is canonical and any
    // accidentally-deleted built-in is restored. Strategy:
    //   1. For each built-in (in default order), prefer the saved copy if
    //      present (keeps user edits to token/models/fetchCommand/etc).
    //   2. Append user-created custom providers (anything in `saved` whose key
    //      is not in defaults), preserving their relative order.
    let defaults = default_maas_registry();
    let default_keys: std::collections::HashSet<String> =
        defaults.iter().map(|p| p.key.clone()).collect();
    let mut saved_by_key: std::collections::HashMap<String, MaasProvider> =
        saved.iter().cloned().map(|p| (p.key.clone(), p)).collect();

    let saved_keys_before: Vec<String> = saved.iter().map(|p| p.key.clone()).collect();

    let mut registry: Vec<MaasProvider> = defaults
        .into_iter()
        .map(|d| saved_by_key.remove(&d.key).unwrap_or(d))
        .collect();
    for p in saved {
        if !default_keys.contains(&p.key) {
            registry.push(p);
        }
    }

    let new_keys: Vec<String> = registry.iter().map(|p| p.key.clone()).collect();
    if saved_keys_before != new_keys {
        let _ = persist_maas_registry(&registry);
    }
    Ok(registry)
}

/// Keys of built-in providers that cannot be deleted by the user. Deleting
/// them would just resurrect on next load anyway (see `load_maas_registry`).
pub(crate) fn is_builtin_maas_key(key: &str) -> bool {
    matches!(
        key,
        "anthropic-subscription"
            | "native"
            | "zenmux"
            | "modelgate"
            | "qiniu"
            | "siliconflow"
            | "univibe"
    )
}

pub(crate) fn persist_maas_registry(registry: &[MaasProvider]) -> Result<(), String> {
    let path = get_maas_registry_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let output = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    fs::write(&path, output).map_err(|e| e.to_string())?;
    Ok(())
}
