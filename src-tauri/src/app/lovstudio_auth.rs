use super::*;

pub(crate) const LOVSTUDIO_AUTH_START_ENDPOINT: &str =
    "https://lovstudio.ai/api/lovcode/auth/start";
pub(crate) const LOVSTUDIO_AUTH_POLL_ENDPOINT: &str = "https://lovstudio.ai/api/lovcode/auth/poll";
pub(crate) const LOVSTUDIO_AUTH_REFRESH_ENDPOINT: &str =
    "https://lovstudio.ai/api/lovcode/auth/refresh";
pub(crate) const LOVSTUDIO_AUTH_REFRESH_GRACE_SECONDS: i64 = 120;
pub(crate) const LOVSTUDIO_SUPABASE_REST_URL: &str =
    "https://nouchjcfeoobplxkwasg.supabase.co/rest/v1";
pub(crate) const LOVSTUDIO_SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vdWNoamNmZW9vYnBseGt3YXNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNjI1OTMsImV4cCI6MjA4MTczODU5M30.P3A_AoAjp0EXIafeBBeqp972h_lO7oXjbKgu0OdMsjA";
pub(crate) const LOVSTUDIO_FEEDBACK_TABLE: &str = "lovcode_feedback";
pub(crate) const FEEDBACK_ENDPOINT: &str = "https://lovstudio.ai/api/lovcode/feedback";
pub(crate) const FEEDBACK_RECIPIENT_EMAIL: &str = "mark@lovstudio.ai";
pub(crate) const FEEDBACK_GITHUB_DEFAULT_REPO: &str = "lovstudio/lovcode";
pub(crate) const FEEDBACK_METADATA_GITHUB_ISSUE_KEY: &str = "githubIssue";
pub(crate) const FEEDBACK_METADATA_REVIEW_DEFER_KEY: &str = "reviewDefer";
pub(crate) const MAX_FEEDBACK_MESSAGE_CHARS: usize = 5000;
pub(crate) const MAX_FEEDBACK_FIELD_CHARS: usize = 300;
pub(crate) const MAX_FEEDBACK_ADMIN_FIELD_CHARS: usize = 5000;
pub(crate) const MAX_FEEDBACK_ADMIN_LIST_LIMIT: u32 = 100;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LovstudioAuthUser {
    pub(crate) id: String,
    pub(crate) email: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LovstudioAuthSession {
    pub(crate) access_token: String,
    pub(crate) refresh_token: String,
    pub(crate) expires_at: i64,
    pub(crate) user: LovstudioAuthUser,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LovstudioAuthState {
    pub(crate) expires_at: i64,
    pub(crate) user: LovstudioAuthUser,
    pub(crate) is_admin: bool,
}

impl LovstudioAuthState {
    fn from_session(session: &LovstudioAuthSession, is_admin: bool) -> Self {
        Self {
            expires_at: session.expires_at,
            user: session.user.clone(),
            is_admin,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LovstudioLoginStartResult {
    pub(crate) device_code: String,
    pub(crate) user_code: String,
    pub(crate) verification_uri: String,
    pub(crate) verification_uri_complete: String,
    pub(crate) expires_in: i64,
    pub(crate) interval: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LovstudioLoginPollResult {
    pub(crate) status: String,
    pub(crate) session: Option<LovstudioAuthState>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LovstudioAuthTokenResponse {
    pub(crate) status: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) detail: Option<String>,
    pub(crate) access_token: Option<String>,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_in: Option<i64>,
    pub(crate) expires_at: Option<i64>,
    pub(crate) user: Option<LovstudioAuthUser>,
}

pub(crate) fn get_lovstudio_auth_path() -> PathBuf {
    get_lovstudio_dir().join("lovstudio-auth.json")
}

pub(crate) fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) fn load_lovstudio_auth_session() -> Result<Option<LovstudioAuthSession>, String> {
    let path = get_lovstudio_auth_path();
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(None);
    }

    let session: LovstudioAuthSession = serde_json::from_str(&content)
        .map_err(|e| format!("读取 Lovstudio 登录状态失败: {}", e))?;

    if session.access_token.trim().is_empty()
        || session.refresh_token.trim().is_empty()
        || session.user.id.trim().is_empty()
        || session.user.email.trim().is_empty()
    {
        return Ok(None);
    }

    Ok(Some(session))
}

pub(crate) fn save_lovstudio_auth_session(session: &LovstudioAuthSession) -> Result<(), String> {
    let path = get_lovstudio_auth_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let output = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    fs::write(&path, output).map_err(|e| e.to_string())
}

pub(crate) fn clear_lovstudio_auth_session() -> Result<(), String> {
    let path = get_lovstudio_auth_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn build_lovstudio_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| format!("创建 Lovstudio 请求失败: {}", e))
}

pub(crate) fn build_lovstudio_rest_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .http1_only()
        .build()
        .map_err(|e| format!("创建 Lovstudio 管理请求失败: {}", e))
}

pub(crate) fn format_reqwest_error(context: &str, err: reqwest::Error) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = err.source();
    while let Some(item) = source {
        parts.push(item.to_string());
        source = item.source();
    }

    format!("{}: {}", context, parts.join(" -> "))
}

pub(crate) fn lovstudio_session_from_token_response(
    payload: LovstudioAuthTokenResponse,
) -> Result<LovstudioAuthSession, String> {
    let access_token = payload
        .access_token
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Lovstudio 登录响应缺少 access token。".to_string())?;
    let refresh_token = payload
        .refresh_token
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Lovstudio 登录响应缺少 refresh token。".to_string())?;
    let user = payload
        .user
        .filter(|value| !value.id.trim().is_empty() && !value.email.trim().is_empty())
        .ok_or_else(|| "Lovstudio 登录响应缺少账号信息。".to_string())?;
    let expires_at = payload
        .expires_at
        .unwrap_or_else(|| now_unix_seconds() + payload.expires_in.unwrap_or(3600));

    Ok(LovstudioAuthSession {
        access_token,
        refresh_token,
        expires_at,
        user,
    })
}

pub(crate) async fn refresh_lovstudio_auth_session(
    session: &LovstudioAuthSession,
) -> Result<LovstudioAuthSession, String> {
    use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};

    let client = build_lovstudio_http_client()?;
    let response = client
        .post(LOVSTUDIO_AUTH_REFRESH_ENDPOINT)
        .header(USER_AGENT, "Lovcode Auth")
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({ "refreshToken": session.refresh_token }))
        .send()
        .await
        .map_err(|e| format!("刷新 Lovstudio 登录失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "刷新 Lovstudio 登录失败，HTTP {}: {}",
            status.as_u16(),
            response_text.chars().take(200).collect::<String>()
        ));
    }

    let payload: LovstudioAuthTokenResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("解析 Lovstudio 登录刷新响应失败: {}", e))?;
    lovstudio_session_from_token_response(payload)
}

pub(crate) async fn ensure_lovstudio_auth_session(
    strict: bool,
) -> Result<Option<LovstudioAuthSession>, String> {
    let Some(session) = load_lovstudio_auth_session()? else {
        return Ok(None);
    };

    if session.expires_at > now_unix_seconds() + LOVSTUDIO_AUTH_REFRESH_GRACE_SECONDS {
        return Ok(Some(session));
    }

    match refresh_lovstudio_auth_session(&session).await {
        Ok(refreshed) => {
            save_lovstudio_auth_session(&refreshed)?;
            Ok(Some(refreshed))
        }
        Err(err) => {
            let _ = clear_lovstudio_auth_session();
            if strict {
                Err(format!(
                    "Lovstudio 登录已过期，请重新登录后再提交反馈。{}",
                    err
                ))
            } else {
                Ok(None)
            }
        }
    }
}

pub(crate) async fn check_lovstudio_admin_status(session: &LovstudioAuthSession) -> bool {
    use reqwest::header::{ACCEPT, USER_AGENT};

    let Ok(client) = build_lovstudio_http_client() else {
        return false;
    };

    let url = format!(
        "{}/user_roles?select=role&user_id=eq.{}&role=eq.admin&limit=1",
        LOVSTUDIO_SUPABASE_REST_URL, session.user.id
    );

    let Ok(response) = client
        .get(url)
        .header(USER_AGENT, "Lovcode Auth")
        .header(ACCEPT, "application/json")
        .header("apikey", LOVSTUDIO_SUPABASE_ANON_KEY)
        .bearer_auth(&session.access_token)
        .send()
        .await
    else {
        return false;
    };

    if !response.status().is_success() {
        return false;
    }

    response
        .json::<Vec<Value>>()
        .await
        .map(|rows| {
            rows.iter()
                .any(|row| row.get("role").and_then(Value::as_str) == Some("admin"))
        })
        .unwrap_or(false)
}

#[tauri::command]
pub(crate) async fn get_lovstudio_auth_state() -> Result<Option<LovstudioAuthState>, String> {
    let Some(session) = ensure_lovstudio_auth_session(false).await? else {
        return Ok(None);
    };

    let is_admin = check_lovstudio_admin_status(&session).await;
    Ok(Some(LovstudioAuthState::from_session(&session, is_admin)))
}

#[tauri::command]
pub(crate) async fn start_lovstudio_login(
    app_version: Option<String>,
) -> Result<LovstudioLoginStartResult, String> {
    use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};

    let version = app_version
        .map(|value| value.trim().chars().take(40).collect::<String>())
        .filter(|value| !value.is_empty());
    let client_name = version
        .map(|value| format!("Lovcode {}", value))
        .unwrap_or_else(|| "Lovcode".to_string());
    let client = build_lovstudio_http_client()?;
    let response = client
        .post(LOVSTUDIO_AUTH_START_ENDPOINT)
        .header(USER_AGENT, "Lovcode Auth")
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "clientName": client_name,
            "scope": "lovcode",
        }))
        .send()
        .await
        .map_err(|e| format!("发起 Lovstudio 登录失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Lovstudio 登录接口返回 HTTP {}: {}",
            status.as_u16(),
            response_text.chars().take(200).collect::<String>()
        ));
    }

    serde_json::from_str::<LovstudioLoginStartResult>(&response_text)
        .map_err(|e| format!("解析 Lovstudio 登录响应失败: {}", e))
}

#[tauri::command]
pub(crate) async fn poll_lovstudio_login(
    device_code: String,
) -> Result<LovstudioLoginPollResult, String> {
    use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};

    let normalized_device_code = device_code.trim().to_string();
    if normalized_device_code.is_empty() {
        return Err("Lovstudio 登录 code 为空。".to_string());
    }

    let client = build_lovstudio_http_client()?;
    let response = client
        .post(LOVSTUDIO_AUTH_POLL_ENDPOINT)
        .header(USER_AGENT, "Lovcode Auth")
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({ "deviceCode": normalized_device_code }))
        .send()
        .await
        .map_err(|e| format!("检查 Lovstudio 登录状态失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Lovstudio 登录轮询返回 HTTP {}: {}",
            status.as_u16(),
            response_text.chars().take(200).collect::<String>()
        ));
    }

    let payload: LovstudioAuthTokenResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("解析 Lovstudio 登录轮询响应失败: {}", e))?;

    if payload.status.as_deref() == Some("pending")
        || payload.error.as_deref() == Some("authorization_pending")
    {
        return Ok(LovstudioLoginPollResult {
            status: "pending".to_string(),
            session: None,
        });
    }

    if let Some(error) = payload.error.as_deref() {
        let detail = payload
            .detail
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|value| format!(": {}", value))
            .unwrap_or_default();
        return Err(format!("Lovstudio 登录失败: {}{}", error, detail));
    }

    let session = lovstudio_session_from_token_response(payload)?;
    save_lovstudio_auth_session(&session)?;
    let is_admin = check_lovstudio_admin_status(&session).await;

    Ok(LovstudioLoginPollResult {
        status: "authenticated".to_string(),
        session: Some(LovstudioAuthState::from_session(&session, is_admin)),
    })
}

#[tauri::command]
pub(crate) fn logout_lovstudio() -> Result<(), String> {
    clear_lovstudio_auth_session()
}
