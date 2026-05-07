use super::*;

pub(crate) async fn require_lovstudio_admin_session() -> Result<LovstudioAuthSession, String> {
    let Some(session) = ensure_lovstudio_auth_session(true).await? else {
        return Err("请先登录 Lovstudio 后再管理反馈。".to_string());
    };

    if !check_lovstudio_admin_status(&session).await {
        return Err("仅管理员可管理已提交反馈。".to_string());
    }

    Ok(session)
}

pub(crate) fn lovstudio_feedback_rest_url() -> String {
    format!(
        "{}/{}",
        LOVSTUDIO_SUPABASE_REST_URL, LOVSTUDIO_FEEDBACK_TABLE
    )
}

pub(crate) async fn parse_lovstudio_rest_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, String> {
    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail: String = response_text.chars().take(300).collect();
        let suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(": {}", detail)
        };
        return Err(format!(
            "{}返回 HTTP {}{}",
            context,
            status.as_u16(),
            suffix
        ));
    }

    serde_json::from_str::<T>(&response_text).map_err(|e| format!("解析{}响应失败: {}", context, e))
}

pub(crate) async fn send_lovstudio_feedback_patch(
    client: &reqwest::Client,
    session: &LovstudioAuthSession,
    query: &[(String, String)],
    body: &Value,
) -> Result<reqwest::Response, reqwest::Error> {
    use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};

    client
        .patch(lovstudio_feedback_rest_url())
        .query(query)
        .header(USER_AGENT, "Lovcode Feedback Admin")
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .header("apikey", LOVSTUDIO_SUPABASE_ANON_KEY)
        .header("Prefer", "return=representation")
        .bearer_auth(&session.access_token)
        .json(body)
        .send()
        .await
}

pub(crate) async fn get_lovstudio_feedback_ticket_by_id(
    client: &reqwest::Client,
    session: &LovstudioAuthSession,
    feedback_id: &str,
) -> Result<LovstudioFeedbackTicket, String> {
    use reqwest::header::{ACCEPT, USER_AGENT};

    let query = [
        ("select".to_string(), "*".to_string()),
        ("id".to_string(), format!("eq.{}", feedback_id)),
        ("limit".to_string(), "1".to_string()),
    ];
    let response = client
        .get(lovstudio_feedback_rest_url())
        .query(&query)
        .header(USER_AGENT, "Lovcode Feedback Admin")
        .header(ACCEPT, "application/json")
        .header("apikey", LOVSTUDIO_SUPABASE_ANON_KEY)
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(|e| format_reqwest_error("读取反馈失败", e))?;

    let mut rows =
        parse_lovstudio_rest_response::<Vec<LovstudioFeedbackTicket>>(response, "反馈详情").await?;
    rows.pop().ok_or_else(|| "未找到该反馈。".to_string())
}

pub(crate) async fn create_github_issue_from_feedback(
    client: &reqwest::Client,
    repo: &str,
    ticket: &LovstudioFeedbackTicket,
) -> Result<FeedbackGithubIssueLink, String> {
    let token = github_token_for_write("创建 GitHub Issue").await?;
    let mut body = serde_json::Map::new();
    body.insert(
        "title".to_string(),
        Value::String(build_feedback_github_issue_title(ticket)),
    );
    body.insert(
        "body".to_string(),
        Value::String(build_feedback_github_issue_body(ticket)),
    );

    let labels = feedback_github_labels();
    if !labels.is_empty() {
        body.insert(
            "labels".to_string(),
            Value::Array(labels.into_iter().map(Value::String).collect()),
        );
    }

    let response = client
        .post(format!("https://api.github.com/repos/{}/issues", repo))
        .header(
            reqwest::header::USER_AGENT,
            format!("lovcode/{}", env!("CARGO_PKG_VERSION")),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .json(&Value::Object(body))
        .send()
        .await
        .map_err(|e| format_reqwest_error("创建 GitHub Issue 失败", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = response_text.chars().take(500).collect::<String>();
        return Err(format!(
            "创建 GitHub Issue 返回 HTTP {}{}",
            status.as_u16(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {}", detail)
            }
        ));
    }

    let issue = serde_json::from_str::<GithubIssueResponse>(&response_text)
        .map_err(|e| format!("解析 GitHub Issue 响应失败: {}", e))?;
    Ok(FeedbackGithubIssueLink {
        repo: repo.to_string(),
        number: issue.number,
        url: issue.html_url,
        title: issue.title,
        body: issue.body,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
        created_by: None,
        state: issue.state.or_else(|| Some("open".to_string())),
        state_reason: issue.state_reason,
        updated_at: issue.updated_at,
        comments: issue.comments,
        last_commented_at: None,
        closed_at: issue.closed_at,
        closed_by: issue.closed_by.and_then(|user| user.login),
    })
}

pub(crate) fn update_github_issue_link_from_response(
    existing: &FeedbackGithubIssueLink,
    remote: GithubIssueResponse,
) -> FeedbackGithubIssueLink {
    let state = remote.state.or_else(|| existing.state.clone());
    let is_closed = state.as_deref() == Some("closed");
    FeedbackGithubIssueLink {
        repo: existing.repo.clone(),
        number: remote.number,
        url: if remote.html_url.trim().is_empty() {
            existing.url.clone()
        } else {
            remote.html_url
        },
        created_at: existing.created_at.clone(),
        created_by: existing.created_by.clone(),
        title: remote.title.or_else(|| existing.title.clone()),
        body: remote.body.or_else(|| existing.body.clone()),
        state: state.clone(),
        state_reason: if state.as_deref() == Some("open") {
            None
        } else {
            remote
                .state_reason
                .or_else(|| existing.state_reason.clone())
        },
        updated_at: remote.updated_at.or_else(|| existing.updated_at.clone()),
        comments: remote.comments.or(existing.comments),
        last_commented_at: existing.last_commented_at.clone(),
        closed_at: if is_closed {
            remote.closed_at.or_else(|| existing.closed_at.clone())
        } else {
            None
        },
        closed_by: if is_closed {
            remote
                .closed_by
                .and_then(|user| user.login)
                .or_else(|| existing.closed_by.clone())
        } else {
            None
        },
    }
}

pub(crate) async fn fetch_github_issue_state(
    client: &reqwest::Client,
    issue: &FeedbackGithubIssueLink,
) -> Result<FeedbackGithubIssueLink, String> {
    let token = if let Some(token) = github_token() {
        Some(token)
    } else {
        github_cli_token().await
    };
    let mut request = client
        .get(format!(
            "https://api.github.com/repos/{}/issues/{}",
            issue.repo, issue.number
        ))
        .header(
            reqwest::header::USER_AGENT,
            format!("lovcode/{}", env!("CARGO_PKG_VERSION")),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = token.as_ref() {
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format_reqwest_error("同步 GitHub Issue 状态失败", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        if token.is_none()
            && matches!(
                status,
                reqwest::StatusCode::UNAUTHORIZED
                    | reqwest::StatusCode::FORBIDDEN
                    | reqwest::StatusCode::NOT_FOUND
            )
        {
            return Err(
                "无法读取 GitHub Issue。若仓库是私有的，请设置 GITHUB_TOKEN/GH_TOKEN，或先运行 `gh auth login`。"
                    .to_string(),
            );
        }
        let detail = response_text.chars().take(500).collect::<String>();
        return Err(format!(
            "同步 GitHub Issue 状态返回 HTTP {}{}",
            status.as_u16(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {}", detail)
            }
        ));
    }

    let remote = serde_json::from_str::<GithubIssueResponse>(&response_text)
        .map_err(|e| format!("解析 GitHub Issue 响应失败: {}", e))?;
    Ok(update_github_issue_link_from_response(issue, remote))
}

pub(crate) async fn comment_github_issue(
    client: &reqwest::Client,
    issue: &FeedbackGithubIssueLink,
    body: &str,
) -> Result<(), String> {
    let token = github_token_for_write("回复 GitHub Issue").await?;
    let response = client
        .post(format!(
            "https://api.github.com/repos/{}/issues/{}/comments",
            issue.repo, issue.number
        ))
        .header(
            reqwest::header::USER_AGENT,
            format!("lovcode/{}", env!("CARGO_PKG_VERSION")),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .json(&serde_json::json!({ "body": body }))
        .send()
        .await
        .map_err(|e| format_reqwest_error("回复 GitHub Issue 失败", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = response_text.chars().take(500).collect::<String>();
        return Err(format!(
            "回复 GitHub Issue 返回 HTTP {}{}",
            status.as_u16(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {}", detail)
            }
        ));
    }

    Ok(())
}

pub(crate) async fn update_github_issue_state(
    client: &reqwest::Client,
    issue: &FeedbackGithubIssueLink,
    state: &str,
    state_reason: Option<&str>,
) -> Result<FeedbackGithubIssueLink, String> {
    let token = github_token_for_write("管理 GitHub Issue 状态").await?;
    let mut body = serde_json::Map::new();
    body.insert("state".to_string(), Value::String(state.to_string()));
    if let Some(reason) = state_reason {
        body.insert(
            "state_reason".to_string(),
            Value::String(reason.to_string()),
        );
    }

    let response = client
        .patch(format!(
            "https://api.github.com/repos/{}/issues/{}",
            issue.repo, issue.number
        ))
        .header(
            reqwest::header::USER_AGENT,
            format!("lovcode/{}", env!("CARGO_PKG_VERSION")),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .bearer_auth(token)
        .json(&Value::Object(body))
        .send()
        .await
        .map_err(|e| format_reqwest_error("管理 GitHub Issue 状态失败", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = response_text.chars().take(500).collect::<String>();
        return Err(format!(
            "管理 GitHub Issue 状态返回 HTTP {}{}",
            status.as_u16(),
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {}", detail)
            }
        ));
    }

    let remote = serde_json::from_str::<GithubIssueResponse>(&response_text)
        .map_err(|e| format!("解析 GitHub Issue 响应失败: {}", e))?;
    Ok(update_github_issue_link_from_response(issue, remote))
}

pub(crate) async fn patch_lovstudio_feedback_github_issue(
    client: &reqwest::Client,
    session: &LovstudioAuthSession,
    ticket: LovstudioFeedbackTicket,
    issue: &FeedbackGithubIssueLink,
) -> Result<LovstudioFeedbackTicket, String> {
    let feedback_id = ticket.id.clone();
    let metadata = feedback_metadata_with_github_issue(ticket.metadata, issue)?;
    let body = serde_json::json!({
        "metadata": metadata,
        "last_admin_action_at": chrono::Utc::now().to_rfc3339(),
        "last_admin_action_by": session.user.id.clone(),
    });
    let query = [
        ("id".to_string(), format!("eq.{}", feedback_id)),
        ("select".to_string(), "*".to_string()),
    ];
    let response = match send_lovstudio_feedback_patch(client, session, &query, &body).await {
        Ok(response) => response,
        Err(first_err) => {
            tokio::time::sleep(Duration::from_millis(250)).await;
            send_lovstudio_feedback_patch(client, session, &query, &body)
                .await
                .map_err(|second_err| {
                    format!(
                        "{}; {}",
                        format_reqwest_error("保存 GitHub Issue 链接失败", first_err),
                        format_reqwest_error("重试仍失败", second_err)
                    )
                })?
        }
    };

    let mut rows =
        parse_lovstudio_rest_response::<Vec<LovstudioFeedbackTicket>>(response, "反馈更新").await?;
    rows.pop()
        .ok_or_else(|| "GitHub Issue 已创建，但反馈接口未返回记录。".to_string())
}
