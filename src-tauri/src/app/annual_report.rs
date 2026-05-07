use super::*;

// ============================================================================
// Annual Report 2025
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct FavoriteProject {
    pub id: String,
    pub path: String,
    pub session_count: usize,
    pub message_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct TopCommand {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct AnnualReport2025 {
    pub total_sessions: usize,
    pub total_messages: usize,
    pub total_commands: usize,
    pub active_days: usize,
    pub first_chat_date: Option<String>,
    pub last_chat_date: Option<String>,
    pub peak_hour: u32,
    pub peak_hour_count: usize,
    pub peak_weekday: u32,
    pub total_projects: usize,
    pub favorite_project: Option<FavoriteProject>,
    pub top_commands: Vec<TopCommand>,
    pub longest_streak: usize,
    pub daily_activity: HashMap<String, usize>,
    pub hourly_distribution: HashMap<u32, usize>,
}

#[tauri::command]
pub(crate) async fn get_annual_report_2025() -> Result<AnnualReport2025, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use chrono::{Datelike, Timelike};

        // 2025 year bounds (UTC)
        let start_2025: u64 = 1735689600000; // 2025-01-01 00:00:00 UTC in ms
        let end_2025: u64 = 1767225600000; // 2026-01-01 00:00:00 UTC in ms

        let history_path = get_claude_dir().join("history.jsonl");
        let projects_dir = get_claude_dir().join("projects");

        let mut daily_activity: HashMap<String, usize> = HashMap::new();
        let mut hourly_distribution: HashMap<u32, usize> = HashMap::new();
        let mut weekday_counts: HashMap<u32, usize> = HashMap::new();
        let mut first_date: Option<String> = None;
        let mut last_date: Option<String> = None;

        // Parse history.jsonl for 2025 data
        if history_path.exists() {
            if let Ok(content) = fs::read_to_string(&history_path) {
                for line in content.lines() {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                        if let Some(ts_ms) = parsed.get("timestamp").and_then(|v| v.as_u64()) {
                            // Filter for 2025 only
                            if ts_ms >= start_2025 && ts_ms < end_2025 {
                                let ts_secs = ts_ms / 1000;
                                if let Some(dt) =
                                    chrono::DateTime::from_timestamp(ts_secs as i64, 0)
                                {
                                    let date = dt.format("%Y-%m-%d").to_string();
                                    *daily_activity.entry(date.clone()).or_insert(0) += 1;

                                    let hour = dt.hour();
                                    *hourly_distribution.entry(hour).or_insert(0) += 1;

                                    let weekday = dt.weekday().num_days_from_sunday();
                                    *weekday_counts.entry(weekday).or_insert(0) += 1;

                                    // Track first and last dates
                                    if first_date.is_none() || date < *first_date.as_ref().unwrap()
                                    {
                                        first_date = Some(date.clone());
                                    }
                                    if last_date.is_none() || date > *last_date.as_ref().unwrap() {
                                        last_date = Some(date.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Calculate peak hour
        let (peak_hour, peak_hour_count) = hourly_distribution
            .iter()
            .max_by_key(|(_, count)| *count)
            .map(|(h, c)| (*h, *c))
            .unwrap_or((0, 0));

        // Calculate peak weekday
        let peak_weekday = weekday_counts
            .iter()
            .max_by_key(|(_, count)| *count)
            .map(|(d, _)| *d)
            .unwrap_or(0);

        // Calculate longest streak
        let mut dates: Vec<&String> = daily_activity.keys().collect();
        dates.sort();
        let mut longest_streak = 0usize;
        let mut current_streak = 1usize;
        for i in 1..dates.len() {
            if let (Ok(prev), Ok(curr)) = (
                chrono::NaiveDate::parse_from_str(dates[i - 1], "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(dates[i], "%Y-%m-%d"),
            ) {
                if curr.signed_duration_since(prev).num_days() == 1 {
                    current_streak += 1;
                } else {
                    longest_streak = longest_streak.max(current_streak);
                    current_streak = 1;
                }
            }
        }
        longest_streak = longest_streak.max(current_streak);

        // Scan projects for session/message counts in 2025
        let mut total_sessions = 0usize;
        let mut total_messages = 0usize;
        let mut project_stats: HashMap<String, (String, usize, usize)> = HashMap::new(); // id -> (path, sessions, messages)
        let mut command_counts: HashMap<String, usize> = HashMap::new(); // command -> count (fallback)
        let command_pattern = regex::Regex::new(r"<command-name>(/[^<]+)</command-name>").ok();

        if projects_dir.exists() {
            if let Ok(entries) = fs::read_dir(&projects_dir) {
                for entry in entries.flatten() {
                    let project_path = entry.path();
                    if !project_path.is_dir() {
                        continue;
                    }

                    let project_id = project_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string();

                    // Read project.json for actual path
                    let project_json_path = project_path.join("project.json");
                    let actual_path = if project_json_path.exists() {
                        fs::read_to_string(&project_json_path)
                            .ok()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                            .and_then(|v| v.get("path").and_then(|p| p.as_str()).map(String::from))
                            .unwrap_or_else(|| project_id.clone())
                    } else {
                        project_id.clone()
                    };

                    let mut proj_sessions = 0usize;
                    let mut proj_messages = 0usize;

                    // Scan session files
                    if let Ok(session_entries) = fs::read_dir(&project_path) {
                        for session_entry in session_entries.flatten() {
                            let session_path = session_entry.path();
                            if session_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                                continue;
                            }

                            // Check if session has 2025 activity by reading first line
                            if let Ok(content) = fs::read_to_string(&session_path) {
                                let mut has_2025_activity = false;
                                let mut msg_count = 0usize;

                                for line in content.lines() {
                                    if let Ok(parsed) =
                                        serde_json::from_str::<serde_json::Value>(line)
                                    {
                                        // Check timestamp if available
                                        if let Some(ts) =
                                            parsed.get("timestamp").and_then(|v| v.as_str())
                                        {
                                            if ts.starts_with("2025-") {
                                                has_2025_activity = true;
                                            }
                                        }
                                        // Count non-meta messages
                                        if parsed.get("type").and_then(|t| t.as_str())
                                            != Some("meta")
                                        {
                                            msg_count += 1;
                                        }
                                        // Extract commands from assistant messages (for fallback stats)
                                        if let Some(pattern) = &command_pattern {
                                            if let Some(text) =
                                                parsed.get("message").and_then(|m| {
                                                    m.get("content").and_then(|c| c.as_str())
                                                })
                                            {
                                                for cap in pattern.captures_iter(text) {
                                                    if let Some(cmd_match) = cap.get(1) {
                                                        let cmd = cmd_match
                                                            .as_str()
                                                            .trim_start_matches('/')
                                                            .to_string();
                                                        *command_counts.entry(cmd).or_insert(0) +=
                                                            1;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if has_2025_activity {
                                    proj_sessions += 1;
                                    proj_messages += msg_count;
                                }
                            }
                        }
                    }

                    if proj_sessions > 0 {
                        total_sessions += proj_sessions;
                        total_messages += proj_messages;
                        project_stats
                            .insert(project_id, (actual_path, proj_sessions, proj_messages));
                    }
                }
            }
        }

        // Find favorite project
        let favorite_project = project_stats
            .iter()
            .max_by_key(|(_, (_, sessions, _))| sessions)
            .map(|(id, (path, sessions, messages))| FavoriteProject {
                id: id.clone(),
                path: path.clone(),
                session_count: *sessions,
                message_count: *messages,
            });

        // Get top commands from command-stats index (aggregate weekly data) or fallback to extracted
        let mut top_commands: Vec<TopCommand> = Vec::new();
        let stats_path = get_command_stats_path();
        let mut use_fallback = true;

        if stats_path.exists() {
            if let Ok(content) = fs::read_to_string(&stats_path) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(commands) = parsed.get("commands").and_then(|v| v.as_object()) {
                        let mut aggregated: HashMap<String, usize> = HashMap::new();
                        for (cmd_name, week_data) in commands {
                            if let Some(weeks) = week_data.as_object() {
                                let total: usize = weeks
                                    .values()
                                    .filter_map(|v| v.as_u64())
                                    .map(|n| n as usize)
                                    .sum();
                                aggregated.insert(cmd_name.clone(), total);
                            }
                        }
                        if !aggregated.is_empty() {
                            let mut sorted: Vec<_> = aggregated.into_iter().collect();
                            sorted.sort_by(|a, b| b.1.cmp(&a.1));
                            top_commands = sorted
                                .into_iter()
                                .take(5)
                                .map(|(name, count)| TopCommand { name, count })
                                .collect();
                            use_fallback = false;
                        }
                    }
                }
            }
        }

        // Fallback: use command counts extracted from session files
        if use_fallback && !command_counts.is_empty() {
            let mut sorted: Vec<_> = command_counts.into_iter().collect();
            sorted.sort_by(|a, b| b.1.cmp(&a.1));
            top_commands = sorted
                .into_iter()
                .take(5)
                .map(|(name, count)| TopCommand { name, count })
                .collect();
        }

        // Count local commands
        let total_commands = list_local_commands().map(|cmds| cmds.len()).unwrap_or(0);

        Ok(AnnualReport2025 {
            total_sessions,
            total_messages,
            total_commands,
            active_days: daily_activity.len(),
            first_chat_date: first_date,
            last_chat_date: last_date,
            peak_hour,
            peak_hour_count,
            peak_weekday,
            total_projects: project_stats.len(),
            favorite_project,
            top_commands,
            longest_streak,
            daily_activity,
            hourly_distribution,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
