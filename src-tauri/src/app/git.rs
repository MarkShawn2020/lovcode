use super::*;

// ============================================================================
// Git Commands
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub timestamp: i64,
    pub author: String,
    pub feat_name: Option<String>, // Parsed from message: feat(xxx): ...
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct CommitNote {
    pub feat_id: String,
    pub feat_name: Option<String>,
    #[serde(default)]
    pub override_assoc: bool,
}

/// Parse feat name from conventional commit message
/// e.g., "feat(auth-login): add login" -> Some("auth-login")
pub(crate) fn parse_feat_from_message(message: &str) -> Option<String> {
    // Match patterns like: type(scope): message
    let re = regex::Regex::new(r"^\w+\(([a-z0-9-]+)\):").ok()?;
    re.captures(message)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

/// Get git log for a project
pub(crate) fn git_log(
    project_path: String,
    limit: Option<usize>,
) -> Result<Vec<CommitInfo>, String> {
    use std::process::Command;

    let limit = limit.unwrap_or(100);
    let output = Command::new("git")
        .args([
            "-C",
            &project_path,
            "log",
            &format!("-{}", limit),
            "--format=%H|%h|%s|%at|%an",
        ])
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git log failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<CommitInfo> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            let message = parts.get(2).unwrap_or(&"").to_string();
            let feat_name = parse_feat_from_message(&message);

            CommitInfo {
                hash: parts.first().unwrap_or(&"").to_string(),
                short_hash: parts.get(1).unwrap_or(&"").to_string(),
                message,
                timestamp: parts.get(3).unwrap_or(&"0").parse().unwrap_or(0),
                author: parts.get(4).unwrap_or(&"").to_string(),
                feat_name,
            }
        })
        .collect();

    Ok(commits)
}

/// Get git note for a commit
pub(crate) fn git_get_note(
    project_path: String,
    commit_hash: String,
) -> Result<Option<CommitNote>, String> {
    use std::process::Command;

    let output = Command::new("git")
        .args([
            "-C",
            &project_path,
            "notes",
            "--ref=lovcode",
            "show",
            &commit_hash,
        ])
        .output()
        .map_err(|e| format!("Failed to run git notes: {}", e))?;

    if !output.status.success() {
        // Note doesn't exist
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let note: CommitNote =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse note: {}", e))?;

    Ok(Some(note))
}

/// Set git note for a commit
pub(crate) fn git_set_note(
    project_path: String,
    commit_hash: String,
    note: CommitNote,
) -> Result<(), String> {
    use std::process::Command;

    let note_json =
        serde_json::to_string(&note).map_err(|e| format!("Failed to serialize note: {}", e))?;

    // Try to add note first, if it exists, use --force to overwrite
    let output = Command::new("git")
        .args([
            "-C",
            &project_path,
            "notes",
            "--ref=lovcode",
            "add",
            "-f",
            "-m",
            &note_json,
            &commit_hash,
        ])
        .output()
        .map_err(|e| format!("Failed to run git notes add: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git notes add failed: {}", stderr));
    }

    Ok(())
}

/// Revert a commit
pub(crate) fn git_revert(project_path: String, commit_hash: String) -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["-C", &project_path, "revert", "--no-edit", &commit_hash])
        .output()
        .map_err(|e| format!("Failed to run git revert: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git revert failed: {}", stderr));
    }

    // Get the new commit hash
    let new_commit = Command::new("git")
        .args(["-C", &project_path, "rev-parse", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get new commit: {}", e))?;

    let new_hash = String::from_utf8_lossy(&new_commit.stdout)
        .trim()
        .to_string();
    Ok(new_hash)
}

/// Check if there are uncommitted changes
pub(crate) fn git_has_changes(project_path: String) -> Result<bool, String> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["-C", &project_path, "status", "--porcelain"])
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(!stdout.trim().is_empty())
}

/// Auto commit with feat name
pub(crate) fn git_auto_commit(
    project_path: String,
    feat_name: String,
    feat_id: String,
    message: String,
) -> Result<Option<String>, String> {
    use std::process::Command;

    // Check if there are changes
    let has_changes = git_has_changes(project_path.clone())?;
    if !has_changes {
        return Ok(None); // No changes, skip
    }

    // Stage all changes
    let add_output = Command::new("git")
        .args(["-C", &project_path, "add", "-A"])
        .output()
        .map_err(|e| format!("Failed to run git add: {}", e))?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {}", stderr));
    }

    // Create commit
    let commit_message = format!("feat({}): {}", feat_name, message);
    let commit_output = Command::new("git")
        .args(["-C", &project_path, "commit", "-m", &commit_message])
        .output()
        .map_err(|e| format!("Failed to run git commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        return Err(format!("git commit failed: {}", stderr));
    }

    // Get commit hash
    let hash_output = Command::new("git")
        .args(["-C", &project_path, "rev-parse", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get commit hash: {}", e))?;

    let hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();

    // Add note with feat association
    let note = CommitNote {
        feat_id,
        feat_name: Some(feat_name),
        override_assoc: false,
    };
    git_set_note(project_path, hash.clone(), note)?;

    Ok(Some(hash))
}

/// Generate changelog from commits
pub(crate) fn git_generate_changelog(
    project_path: String,
    feat_names: Vec<String>,
    from_date: Option<i64>,
) -> Result<String, String> {
    let commits = git_log(project_path.clone(), Some(500))?;

    // Filter commits by feat names and date
    let filtered: Vec<&CommitInfo> = commits
        .iter()
        .filter(|c| {
            let feat_match = c
                .feat_name
                .as_ref()
                .map(|f| feat_names.contains(f))
                .unwrap_or(false);
            let date_match = from_date.map(|d| c.timestamp >= d).unwrap_or(true);
            feat_match && date_match
        })
        .collect();

    // Group by feat
    let mut grouped: HashMap<String, Vec<&CommitInfo>> = HashMap::new();
    for commit in filtered {
        if let Some(feat) = &commit.feat_name {
            grouped.entry(feat.clone()).or_default().push(commit);
        }
    }

    // Generate markdown
    let mut md = String::from("# Changelog\n\n");

    for feat_name in &feat_names {
        if let Some(commits) = grouped.get(feat_name) {
            md.push_str(&format!("## {}\n\n", feat_name));
            for c in commits {
                let date = chrono::DateTime::from_timestamp(c.timestamp, 0)
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_default();
                md.push_str(&format!("- {} ({}) - {}\n", c.message, c.short_hash, date));
            }
            md.push('\n');
        }
    }

    Ok(md)
}
