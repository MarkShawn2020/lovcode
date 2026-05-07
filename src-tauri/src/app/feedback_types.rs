use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackSubmission {
    pub(crate) category: String,
    pub(crate) message: String,
    pub(crate) contact: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) app_version: Option<String>,
    pub(crate) user_agent: Option<String>,
    pub(crate) locale: Option<String>,
    pub(crate) timezone: Option<String>,
    pub(crate) metadata: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackSubmitResult {
    pub(crate) feedback_id: String,
    pub(crate) endpoint: String,
    pub(crate) recipient_email: String,
    pub(crate) submitter_email: Option<String>,
    pub(crate) authenticated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub(crate) struct LovstudioFeedbackTicket {
    pub(crate) id: String,
    pub(crate) source: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) message: Option<String>,
    pub(crate) contact: Option<String>,
    pub(crate) app_version: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) user_agent: Option<String>,
    pub(crate) locale: Option<String>,
    pub(crate) timezone: Option<String>,
    pub(crate) recipient_email: Option<String>,
    pub(crate) email_sent: Option<bool>,
    pub(crate) email_error: Option<String>,
    pub(crate) metadata: Option<Value>,
    pub(crate) created_at: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) ticket_status: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) assigned_to: Option<String>,
    pub(crate) internal_notes: Option<String>,
    pub(crate) resolution: Option<String>,
    pub(crate) first_response_at: Option<String>,
    pub(crate) resolved_at: Option<String>,
    pub(crate) closed_at: Option<String>,
    pub(crate) last_admin_action_at: Option<String>,
    pub(crate) last_admin_action_by: Option<String>,
    pub(crate) submitter_user_id: Option<String>,
    pub(crate) submitter_email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackAdminUpdate {
    pub(crate) id: String,
    pub(crate) ticket_status: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) assigned_to: Option<String>,
    pub(crate) internal_notes: Option<String>,
    pub(crate) resolution: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackReviewDefer {
    pub(crate) id: String,
    pub(crate) comment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueCreate {
    pub(crate) id: String,
    pub(crate) repo: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueComment {
    pub(crate) id: String,
    pub(crate) body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueClose {
    pub(crate) id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueStateUpdate {
    pub(crate) id: String,
    pub(crate) state: String,
    pub(crate) state_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueSync {
    pub(crate) id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueLink {
    pub(crate) repo: String,
    pub(crate) number: u64,
    pub(crate) url: String,
    pub(crate) title: Option<String>,
    pub(crate) body: Option<String>,
    pub(crate) created_at: Option<String>,
    pub(crate) created_by: Option<String>,
    // Also refreshed from GitHub for changes made outside Lovcode.
    pub(crate) state: Option<String>,
    pub(crate) state_reason: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) comments: Option<u64>,
    pub(crate) last_commented_at: Option<String>,
    pub(crate) closed_at: Option<String>,
    pub(crate) closed_by: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueResult {
    pub(crate) feedback: LovstudioFeedbackTicket,
    pub(crate) issue: FeedbackGithubIssueLink,
    pub(crate) created: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GithubIssueUserResponse {
    pub(crate) login: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GithubIssueResponse {
    pub(crate) number: u64,
    pub(crate) html_url: String,
    pub(crate) title: Option<String>,
    pub(crate) body: Option<String>,
    pub(crate) state: Option<String>,
    pub(crate) state_reason: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) closed_at: Option<String>,
    pub(crate) closed_by: Option<GithubIssueUserResponse>,
    pub(crate) comments: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackGithubIssueActionResult {
    pub(crate) feedback: LovstudioFeedbackTicket,
    pub(crate) issue: FeedbackGithubIssueLink,
}

pub(crate) fn normalize_feedback_field(value: Option<String>) -> Option<String> {
    value
        .map(|v| {
            v.trim()
                .chars()
                .take(MAX_FEEDBACK_FIELD_CHARS)
                .collect::<String>()
        })
        .filter(|v| !v.is_empty())
}

pub(crate) fn normalize_feedback_admin_status(value: &str) -> Result<String, String> {
    match value.trim() {
        "new" | "triaged" | "in_progress" | "resolved" | "closed" => Ok(value.trim().to_string()),
        _ => Err("反馈状态无效。".to_string()),
    }
}

pub(crate) fn normalize_feedback_admin_priority(value: &str) -> Result<String, String> {
    match value.trim() {
        "low" | "normal" | "high" | "urgent" => Ok(value.trim().to_string()),
        _ => Err("反馈优先级无效。".to_string()),
    }
}

pub(crate) fn normalize_feedback_admin_text(value: String) -> String {
    value
        .trim()
        .chars()
        .take(MAX_FEEDBACK_ADMIN_FIELD_CHARS)
        .collect::<String>()
}

pub(crate) fn normalize_feedback_admin_nullable_text(value: String) -> Value {
    let normalized = normalize_feedback_admin_text(value);
    if normalized.is_empty() {
        Value::Null
    } else {
        Value::String(normalized)
    }
}

pub(crate) fn normalize_feedback_admin_nullable_uuid(
    value: String,
    label: &str,
) -> Result<Value, String> {
    let normalized = normalize_feedback_admin_text(value);
    if normalized.is_empty() {
        return Ok(Value::Null);
    }

    uuid::Uuid::parse_str(&normalized).map_err(|_| format!("{}必须是用户 UUID。", label))?;
    Ok(Value::String(normalized))
}

pub(crate) fn normalize_feedback_github_comment(value: String) -> Result<String, String> {
    let normalized = normalize_feedback_admin_text(value);
    if normalized.is_empty() {
        return Err("回复内容不能为空。".to_string());
    }
    Ok(normalized)
}

pub(crate) fn normalize_feedback_github_repo(repo: Option<String>) -> Result<String, String> {
    let repo = repo
        .or_else(|| std::env::var("LOVCODE_FEEDBACK_GITHUB_REPO").ok())
        .unwrap_or_else(|| FEEDBACK_GITHUB_DEFAULT_REPO.to_string());
    parse_github_repo(&repo)
}

pub(crate) fn feedback_github_labels() -> Vec<String> {
    std::env::var("LOVCODE_FEEDBACK_GITHUB_LABELS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn feedback_include_contact_in_github_issue() -> bool {
    std::env::var("LOVCODE_FEEDBACK_GITHUB_INCLUDE_CONTACT")
        .ok()
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

pub(crate) fn compact_issue_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn truncate_issue_text(value: &str, max_chars: usize) -> String {
    let mut text = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        text.push_str("...");
    }
    text
}

pub(crate) fn feedback_issue_category_label(category: Option<&str>) -> &'static str {
    match category.unwrap_or_default() {
        "bug" => "Issue",
        "contact" => "Integration",
        "idea" => "Suggestion",
        _ => "Feedback",
    }
}

pub(crate) fn build_feedback_github_issue_title(ticket: &LovstudioFeedbackTicket) -> String {
    let category = feedback_issue_category_label(ticket.category.as_deref());
    let summary = ticket
        .message
        .as_deref()
        .map(compact_issue_text)
        .filter(|value| !value.is_empty())
        .map(|value| truncate_issue_text(&value, 80))
        .unwrap_or_else(|| ticket.id.clone());
    format!("[Lovcode feedback] {}: {}", category, summary)
}

pub(crate) fn feedback_metadata_string_list(metadata: Option<&Value>, key: &str) -> Vec<String> {
    metadata
        .and_then(|value| value.get(key))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn push_feedback_issue_context_line(
    lines: &mut Vec<String>,
    label: &str,
    value: Option<&str>,
) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(format!("- {}: {}", label, value));
    }
}

pub(crate) fn build_feedback_github_issue_body(ticket: &LovstudioFeedbackTicket) -> String {
    let mut body = String::new();
    body.push_str("## Feedback\n\n");
    body.push_str(
        ticket
            .message
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("_No message provided._"),
    );

    let mut context = Vec::new();
    context.push(format!("- Lovcode feedback ID: {}", ticket.id));
    push_feedback_issue_context_line(&mut context, "Category", ticket.category.as_deref());
    push_feedback_issue_context_line(&mut context, "App version", ticket.app_version.as_deref());
    push_feedback_issue_context_line(&mut context, "Path", ticket.path.as_deref());
    push_feedback_issue_context_line(&mut context, "Locale", ticket.locale.as_deref());
    push_feedback_issue_context_line(&mut context, "Timezone", ticket.timezone.as_deref());
    push_feedback_issue_context_line(&mut context, "Created at", ticket.created_at.as_deref());

    let tag_labels = feedback_metadata_string_list(ticket.metadata.as_ref(), "tagLabels");
    if !tag_labels.is_empty() {
        context.push(format!("- Tags: {}", tag_labels.join(", ")));
    }

    if feedback_include_contact_in_github_issue() {
        push_feedback_issue_context_line(
            &mut context,
            "Submitter email",
            ticket.submitter_email.as_deref(),
        );
        push_feedback_issue_context_line(&mut context, "Contact", ticket.contact.as_deref());
        push_feedback_issue_context_line(
            &mut context,
            "Submitter user ID",
            ticket.submitter_user_id.as_deref(),
        );
    }

    body.push_str("\n\n## Context\n\n");
    body.push_str(&context.join("\n"));
    body.push_str("\n\n---\nImported from Lovcode feedback.");
    body
}

pub(crate) fn feedback_github_issue_link(
    ticket: &LovstudioFeedbackTicket,
) -> Option<FeedbackGithubIssueLink> {
    let value = ticket
        .metadata
        .as_ref()?
        .get(FEEDBACK_METADATA_GITHUB_ISSUE_KEY)?;
    let link = serde_json::from_value::<FeedbackGithubIssueLink>(value.clone()).ok()?;
    if link.number == 0 || link.url.trim().is_empty() {
        return None;
    }
    Some(link)
}

pub(crate) fn require_feedback_github_issue(
    ticket: &LovstudioFeedbackTicket,
) -> Result<FeedbackGithubIssueLink, String> {
    feedback_github_issue_link(ticket).ok_or_else(|| "该反馈尚未关联 GitHub Issue。".to_string())
}

pub(crate) fn normalize_github_issue_state_update(
    state: &str,
    state_reason: Option<String>,
) -> Result<(String, Option<String>), String> {
    let state = match state.trim() {
        "open" => "open".to_string(),
        "closed" => "closed".to_string(),
        _ => return Err("GitHub Issue 状态必须是 open 或 closed。".to_string()),
    };

    if state == "open" {
        return Ok((state, Some("reopened".to_string())));
    }

    let reason = state_reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("completed");
    match reason {
        "completed" | "not_planned" | "duplicate" => Ok((state, Some(reason.to_string()))),
        _ => Err("GitHub Issue 关闭原因必须是 completed、not_planned 或 duplicate。".to_string()),
    }
}

pub(crate) fn feedback_metadata_with_github_issue(
    metadata: Option<Value>,
    issue: &FeedbackGithubIssueLink,
) -> Result<Value, String> {
    let mut map = match metadata {
        Some(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    let issue_value =
        serde_json::to_value(issue).map_err(|e| format!("序列化 GitHub Issue 链接失败: {}", e))?;
    map.insert(FEEDBACK_METADATA_GITHUB_ISSUE_KEY.to_string(), issue_value);
    Ok(Value::Object(map))
}

pub(crate) fn feedback_metadata_with_review_defer(
    metadata: Option<Value>,
    deferred_at: &str,
    deferred_by: &str,
    comment: Option<&str>,
) -> Value {
    let mut map = match metadata {
        Some(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    let mut defer = serde_json::Map::new();
    defer.insert("status".to_string(), Value::String("deferred".to_string()));
    defer.insert(
        "deferredAt".to_string(),
        Value::String(deferred_at.to_string()),
    );
    defer.insert(
        "deferredBy".to_string(),
        Value::String(deferred_by.to_string()),
    );
    if let Some(comment) = comment.map(str::trim).filter(|value| !value.is_empty()) {
        defer.insert("comment".to_string(), Value::String(comment.to_string()));
    }
    map.insert(
        FEEDBACK_METADATA_REVIEW_DEFER_KEY.to_string(),
        Value::Object(defer),
    );
    Value::Object(map)
}
