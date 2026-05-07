use super::*;

#[tauri::command]
pub(crate) async fn list_lovstudio_feedback(
    status: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<LovstudioFeedbackTicket>, String> {
    use reqwest::header::{ACCEPT, USER_AGENT};

    let session = require_lovstudio_admin_session().await?;
    let limit = limit.unwrap_or(50).clamp(1, MAX_FEEDBACK_ADMIN_LIST_LIMIT);
    let mut query = vec![
        ("select".to_string(), "*".to_string()),
        ("order".to_string(), "created_at.desc".to_string()),
        ("limit".to_string(), limit.to_string()),
    ];

    if let Some(status) = status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "all")
    {
        query.push((
            "ticket_status".to_string(),
            format!("eq.{}", normalize_feedback_admin_status(status)?),
        ));
    }

    let client = build_lovstudio_rest_http_client()?;
    let response = client
        .get(lovstudio_feedback_rest_url())
        .query(&query)
        .header(USER_AGENT, "Lovcode Feedback Admin")
        .header(ACCEPT, "application/json")
        .header("apikey", LOVSTUDIO_SUPABASE_ANON_KEY)
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(|e| format_reqwest_error("读取反馈列表失败", e))?;

    parse_lovstudio_rest_response::<Vec<LovstudioFeedbackTicket>>(response, "反馈列表").await
}

pub(crate) async fn update_lovstudio_feedback(
    payload: FeedbackAdminUpdate,
) -> Result<LovstudioFeedbackTicket, String> {
    let feedback_id = payload.id.trim();
    uuid::Uuid::parse_str(feedback_id).map_err(|_| "反馈 ID 无效。".to_string())?;

    let session = require_lovstudio_admin_session().await?;
    let mut body = serde_json::Map::new();

    if let Some(status) = payload.ticket_status {
        let status = normalize_feedback_admin_status(&status)?;
        if status == "resolved" {
            body.insert(
                "resolved_at".to_string(),
                Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }
        if status == "closed" {
            body.insert(
                "closed_at".to_string(),
                Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }
        body.insert("ticket_status".to_string(), Value::String(status));
    }

    if let Some(priority) = payload.priority {
        body.insert(
            "priority".to_string(),
            Value::String(normalize_feedback_admin_priority(&priority)?),
        );
    }

    if let Some(assigned_to) = payload.assigned_to {
        body.insert(
            "assigned_to".to_string(),
            normalize_feedback_admin_nullable_uuid(assigned_to, "负责人")?,
        );
    }

    if let Some(internal_notes) = payload.internal_notes {
        body.insert(
            "internal_notes".to_string(),
            Value::String(normalize_feedback_admin_text(internal_notes)),
        );
    }

    if let Some(resolution) = payload.resolution {
        body.insert(
            "resolution".to_string(),
            normalize_feedback_admin_nullable_text(resolution),
        );
    }

    if body.is_empty() {
        return Err("没有可更新的反馈字段。".to_string());
    }

    body.insert(
        "last_admin_action_at".to_string(),
        Value::String(chrono::Utc::now().to_rfc3339()),
    );
    body.insert(
        "last_admin_action_by".to_string(),
        Value::String(session.user.id.clone()),
    );

    let body_value = Value::Object(body);
    let query = [
        ("id".to_string(), format!("eq.{}", feedback_id)),
        ("select".to_string(), "*".to_string()),
    ];
    let client = build_lovstudio_rest_http_client()?;
    let response = match send_lovstudio_feedback_patch(&client, &session, &query, &body_value).await
    {
        Ok(response) => response,
        Err(first_err) => {
            tokio::time::sleep(Duration::from_millis(250)).await;
            send_lovstudio_feedback_patch(&client, &session, &query, &body_value)
                .await
                .map_err(|second_err| {
                    format!(
                        "{}; {}",
                        format_reqwest_error("更新反馈失败", first_err),
                        format_reqwest_error("重试仍失败", second_err)
                    )
                })?
        }
    };

    let mut rows =
        parse_lovstudio_rest_response::<Vec<LovstudioFeedbackTicket>>(response, "反馈更新").await?;
    rows.pop()
        .ok_or_else(|| "反馈更新成功，但接口未返回记录。".to_string())
}

#[tauri::command]
pub(crate) async fn defer_lovstudio_feedback_review(
    payload: FeedbackReviewDefer,
) -> Result<LovstudioFeedbackTicket, String> {
    let feedback_id = payload.id.trim();
    uuid::Uuid::parse_str(feedback_id).map_err(|_| "反馈 ID 无效。".to_string())?;

    let session = require_lovstudio_admin_session().await?;
    let client = build_lovstudio_rest_http_client()?;
    let ticket = get_lovstudio_feedback_ticket_by_id(&client, &session, feedback_id).await?;
    let now = chrono::Utc::now().to_rfc3339();
    let comment = payload
        .comment
        .map(normalize_feedback_admin_text)
        .filter(|value| !value.is_empty());
    let metadata = feedback_metadata_with_review_defer(
        ticket.metadata,
        &now,
        &session.user.id,
        comment.as_deref(),
    );
    let body = serde_json::json!({
        "metadata": metadata,
        "last_admin_action_at": now,
        "last_admin_action_by": session.user.id.clone(),
    });
    let query = [
        ("id".to_string(), format!("eq.{}", feedback_id)),
        ("select".to_string(), "*".to_string()),
    ];
    let response = match send_lovstudio_feedback_patch(&client, &session, &query, &body).await {
        Ok(response) => response,
        Err(first_err) => {
            tokio::time::sleep(Duration::from_millis(250)).await;
            send_lovstudio_feedback_patch(&client, &session, &query, &body)
                .await
                .map_err(|second_err| {
                    format!(
                        "{}; {}",
                        format_reqwest_error("稍后处理反馈失败", first_err),
                        format_reqwest_error("重试仍失败", second_err)
                    )
                })?
        }
    };

    let mut rows =
        parse_lovstudio_rest_response::<Vec<LovstudioFeedbackTicket>>(response, "反馈更新").await?;
    rows.pop()
        .ok_or_else(|| "反馈已标记稍后处理，但接口未返回记录。".to_string())
}

#[tauri::command]
pub(crate) async fn create_lovstudio_feedback_github_issue(
    payload: FeedbackGithubIssueCreate,
) -> Result<FeedbackGithubIssueResult, String> {
    let feedback_id = payload.id.trim();
    uuid::Uuid::parse_str(feedback_id).map_err(|_| "反馈 ID 无效。".to_string())?;

    let repo = normalize_feedback_github_repo(payload.repo)?;
    let session = require_lovstudio_admin_session().await?;
    let client = build_lovstudio_rest_http_client()?;
    let ticket = get_lovstudio_feedback_ticket_by_id(&client, &session, feedback_id).await?;

    if let Some(issue) = feedback_github_issue_link(&ticket) {
        return Ok(FeedbackGithubIssueResult {
            feedback: ticket,
            issue,
            created: false,
        });
    }

    let mut issue = create_github_issue_from_feedback(&client, &repo, &ticket).await?;
    issue.created_by = Some(session.user.id.clone());
    let feedback = patch_lovstudio_feedback_github_issue(&client, &session, ticket, &issue).await?;

    Ok(FeedbackGithubIssueResult {
        feedback,
        issue,
        created: true,
    })
}

#[tauri::command]
pub(crate) async fn sync_lovstudio_feedback_github_issue(
    payload: FeedbackGithubIssueSync,
) -> Result<FeedbackGithubIssueActionResult, String> {
    let feedback_id = payload.id.trim();
    uuid::Uuid::parse_str(feedback_id).map_err(|_| "反馈 ID 无效。".to_string())?;

    let session = require_lovstudio_admin_session().await?;
    let client = build_lovstudio_rest_http_client()?;
    let ticket = get_lovstudio_feedback_ticket_by_id(&client, &session, feedback_id).await?;
    let issue = require_feedback_github_issue(&ticket)?;
    let issue = fetch_github_issue_state(&client, &issue).await?;
    let feedback = patch_lovstudio_feedback_github_issue(&client, &session, ticket, &issue).await?;

    Ok(FeedbackGithubIssueActionResult { feedback, issue })
}

#[tauri::command]
pub(crate) async fn update_lovstudio_feedback_github_issue_state(
    payload: FeedbackGithubIssueStateUpdate,
) -> Result<FeedbackGithubIssueActionResult, String> {
    let feedback_id = payload.id.trim();
    uuid::Uuid::parse_str(feedback_id).map_err(|_| "反馈 ID 无效。".to_string())?;
    let (state, state_reason) =
        normalize_github_issue_state_update(&payload.state, payload.state_reason)?;

    let session = require_lovstudio_admin_session().await?;
    let client = build_lovstudio_rest_http_client()?;
    let ticket = get_lovstudio_feedback_ticket_by_id(&client, &session, feedback_id).await?;
    let issue = require_feedback_github_issue(&ticket)?;
    let issue = update_github_issue_state(&client, &issue, &state, state_reason.as_deref()).await?;
    let feedback = patch_lovstudio_feedback_github_issue(&client, &session, ticket, &issue).await?;

    Ok(FeedbackGithubIssueActionResult { feedback, issue })
}

#[tauri::command]
pub(crate) async fn comment_lovstudio_feedback_github_issue(
    payload: FeedbackGithubIssueComment,
) -> Result<FeedbackGithubIssueActionResult, String> {
    let feedback_id = payload.id.trim();
    uuid::Uuid::parse_str(feedback_id).map_err(|_| "反馈 ID 无效。".to_string())?;
    let comment = normalize_feedback_github_comment(payload.body)?;

    let session = require_lovstudio_admin_session().await?;
    let client = build_lovstudio_rest_http_client()?;
    let ticket = get_lovstudio_feedback_ticket_by_id(&client, &session, feedback_id).await?;
    let mut issue = require_feedback_github_issue(&ticket)?;

    comment_github_issue(&client, &issue, &comment).await?;
    let now = chrono::Utc::now().to_rfc3339();
    issue.updated_at = Some(now.clone());
    issue.comments = Some(issue.comments.unwrap_or(0).saturating_add(1));
    issue.last_commented_at = Some(now);
    if issue.state.is_none() {
        issue.state = Some("open".to_string());
        issue.state_reason = None;
    }
    let feedback = patch_lovstudio_feedback_github_issue(&client, &session, ticket, &issue).await?;

    Ok(FeedbackGithubIssueActionResult { feedback, issue })
}

pub(crate) async fn close_lovstudio_feedback_github_issue(
    payload: FeedbackGithubIssueClose,
) -> Result<FeedbackGithubIssueActionResult, String> {
    let feedback_id = payload.id.trim();
    uuid::Uuid::parse_str(feedback_id).map_err(|_| "反馈 ID 无效。".to_string())?;

    let session = require_lovstudio_admin_session().await?;
    let client = build_lovstudio_rest_http_client()?;
    let ticket = get_lovstudio_feedback_ticket_by_id(&client, &session, feedback_id).await?;
    let issue = require_feedback_github_issue(&ticket)?;
    let issue = update_github_issue_state(&client, &issue, "closed", Some("completed")).await?;
    let feedback = patch_lovstudio_feedback_github_issue(&client, &session, ticket, &issue).await?;

    Ok(FeedbackGithubIssueActionResult { feedback, issue })
}

#[tauri::command]
pub(crate) async fn submit_feedback(
    payload: FeedbackSubmission,
) -> Result<FeedbackSubmitResult, String> {
    use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};

    let message = payload.message.trim().to_string();
    let message_len = message.chars().count();
    if message_len < 4 {
        return Err("反馈内容太短，请至少输入 4 个字符。".to_string());
    }
    if message_len > MAX_FEEDBACK_MESSAGE_CHARS {
        return Err(format!(
            "反馈内容过长，请控制在 {} 个字符以内。",
            MAX_FEEDBACK_MESSAGE_CHARS
        ));
    }

    let category = match payload.category.trim() {
        "bug" | "idea" | "contact" => payload.category.trim().to_string(),
        _ => "idea".to_string(),
    };
    let feedback_id = uuid::Uuid::new_v4().to_string();
    let auth_session = ensure_lovstudio_auth_session(true).await?;
    let submitter_email = auth_session
        .as_ref()
        .map(|session| session.user.email.clone());

    let body = serde_json::json!({
        "id": feedback_id,
        "source": "lovcode-desktop",
        "category": category,
        "message": message,
        "contact": normalize_feedback_field(payload.contact),
        "path": normalize_feedback_field(payload.path),
        "appVersion": normalize_feedback_field(payload.app_version),
        "userAgent": normalize_feedback_field(payload.user_agent),
        "locale": normalize_feedback_field(payload.locale),
        "timezone": normalize_feedback_field(payload.timezone),
        "recipientEmail": FEEDBACK_RECIPIENT_EMAIL,
        "submitterEmail": submitter_email,
        "metadata": payload.metadata.unwrap_or(Value::Null),
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| format!("创建反馈请求失败: {}", e))?;

    let mut request = client
        .post(FEEDBACK_ENDPOINT)
        .header(USER_AGENT, "Lovcode Feedback")
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json");

    if let Some(session) = auth_session.as_ref() {
        request = request.bearer_auth(&session.access_token);
    }

    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("反馈提交网络失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail: String = response_text.chars().take(300).collect();
        let suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(": {}", detail)
        };
        return Err(format!("反馈接口返回 HTTP {}{}", status.as_u16(), suffix));
    }

    let response_value = serde_json::from_str::<Value>(&response_text).ok();
    let returned_id = response_value
        .as_ref()
        .and_then(|value| {
            value
                .get("feedbackId")
                .or_else(|| value.get("id"))
                .and_then(|id| id.as_str())
                .map(str::to_string)
        })
        .unwrap_or(feedback_id);
    let returned_submitter_email = response_value
        .as_ref()
        .and_then(|value| value.get("submitterEmail"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let authenticated = response_value
        .as_ref()
        .and_then(|value| value.get("authenticated"))
        .and_then(|value| value.as_bool())
        .unwrap_or_else(|| auth_session.is_some());

    Ok(FeedbackSubmitResult {
        feedback_id: returned_id,
        endpoint: FEEDBACK_ENDPOINT.to_string(),
        recipient_email: FEEDBACK_RECIPIENT_EMAIL.to_string(),
        submitter_email: returned_submitter_email,
        authenticated,
    })
}

/// Run a shell command in specified directory using login shell (async, non-blocking)
pub(crate) async fn exec_shell_command(command: String, cwd: String) -> Result<String, String> {
    use tokio::process::Command;

    #[cfg(windows)]
    let output = {
        // On Windows, use PowerShell with -WorkingDirectory
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!("Set-Location '{}'; {}", cwd, command),
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to run command: {}", e))?
    };

    #[cfg(not(windows))]
    let output = {
        // Use user's default shell with login mode to get proper environment (API keys, etc.)
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Command::new(&shell)
            .args(["-ilc", &format!("cd '{}' && {}", cwd, command)])
            .output()
            .await
            .map_err(|e| format!("Failed to run command: {}", e))?
    };

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}
