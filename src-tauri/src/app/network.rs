use super::*;

pub(crate) fn is_local_fresh_for_remote(path: &std::path::Path, remote_updated_at: &str) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    let Ok(local_mtime) = meta.modified() else {
        return false;
    };
    let Ok(remote_dt) = chrono::DateTime::parse_from_rfc3339(remote_updated_at) else {
        return false;
    };
    let local_secs = local_mtime
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    local_secs >= remote_dt.timestamp()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkInfo {
    pub(crate) region: String,
    pub(crate) ip: String,
    pub(crate) is_proxy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) proxy_type: Option<String>,
}

pub(crate) static NETWORK_INFO_CACHE: LazyLock<
    Mutex<Option<(std::time::SystemTime, NetworkInfo)>>,
> = LazyLock::new(|| Mutex::new(None));

pub(crate) const NETWORK_INFO_TTL: Duration = Duration::from_secs(3600);

pub(crate) fn network_info_cache_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio/lovcode/cache/network.json")
}

#[derive(Serialize, Deserialize)]
pub(crate) struct NetworkInfoCacheFile {
    pub(crate) fetched_at_unix: u64,
    pub(crate) info: NetworkInfo,
}

pub(crate) fn read_network_info_cache_file() -> Option<(std::time::SystemTime, NetworkInfo)> {
    let raw = std::fs::read(network_info_cache_path()).ok()?;
    let parsed: NetworkInfoCacheFile = serde_json::from_slice(&raw).ok()?;
    let fetched_at = std::time::UNIX_EPOCH + Duration::from_secs(parsed.fetched_at_unix);
    Some((fetched_at, parsed.info))
}

pub(crate) fn write_network_info_cache_file(fetched_at: std::time::SystemTime, info: &NetworkInfo) {
    let path = network_info_cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let unix = fetched_at
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let payload = NetworkInfoCacheFile {
        fetched_at_unix: unix,
        info: info.clone(),
    };
    if let Ok(bytes) = serde_json::to_vec(&payload) {
        let _ = std::fs::write(&path, bytes);
    }
}

#[tauri::command]
pub(crate) async fn get_network_info() -> Result<NetworkInfo, String> {
    if let Ok(mut guard) = NETWORK_INFO_CACHE.lock() {
        if guard.is_none() {
            *guard = read_network_info_cache_file();
        }
        if let Some((fetched_at, info)) = guard.as_ref() {
            if fetched_at
                .elapsed()
                .map(|e| e < NETWORK_INFO_TTL)
                .unwrap_or(false)
            {
                return Ok(info.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("client build failed: {e}"))?;

    let resp = client
        .get("https://ipinfo.io/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        if let Ok(guard) = NETWORK_INFO_CACHE.lock() {
            if let Some((_, info)) = guard.as_ref() {
                return Ok(info.clone());
            }
        }
        return Err(format!("ipinfo returned {status}"));
    }

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("parse failed: {e}"))?;

    let city = data.get("city").and_then(|v| v.as_str());
    let country = data.get("country").and_then(|v| v.as_str());
    let region = match (city, country) {
        (Some(c), Some(co)) => format!("{c}, {co}"),
        (None, Some(co)) => co.to_string(),
        _ => "Unknown".to_string(),
    };
    let ip = data
        .get("ip")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let privacy = data.get("privacy");
    let is_vpn = privacy
        .and_then(|p| p.get("vpn"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let is_proxy_flag = privacy
        .and_then(|p| p.get("proxy"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let proxy_type = if is_vpn {
        Some("VPN".to_string())
    } else if is_proxy_flag {
        Some("Proxy".to_string())
    } else {
        None
    };

    let info = NetworkInfo {
        region,
        ip,
        is_proxy: is_vpn || is_proxy_flag,
        proxy_type,
    };

    let now = std::time::SystemTime::now();
    if let Ok(mut guard) = NETWORK_INFO_CACHE.lock() {
        *guard = Some((now, info.clone()));
    }
    write_network_info_cache_file(now, &info);

    Ok(info)
}
