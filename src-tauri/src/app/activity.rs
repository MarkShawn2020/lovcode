use super::*;

// ============================================================================
// Daily Message Stats for Activity Heatmap
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ActivityStats {
    /// Map of date (YYYY-MM-DD) to count
    pub daily: HashMap<String, usize>,
    /// Map of hour (0-23) to count
    pub hourly: HashMap<u32, usize>,
    /// Map of "date:hour" (YYYY-MM-DD:HH) to count for detailed heatmap
    pub detailed: HashMap<String, usize>,
}

#[tauri::command]
pub(crate) async fn get_activity_stats() -> Result<ActivityStats, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let history_path = get_claude_dir().join("history.jsonl");
        let mut daily: HashMap<String, usize> = HashMap::new();
        let mut hourly: HashMap<u32, usize> = HashMap::new();
        let mut detailed: HashMap<String, usize> = HashMap::new();

        if !history_path.exists() {
            return Ok(ActivityStats {
                daily,
                hourly,
                detailed,
            });
        }

        if let Ok(content) = fs::read_to_string(&history_path) {
            for line in content.lines() {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(ts_ms) = parsed.get("timestamp").and_then(|v| v.as_u64()) {
                        let ts_secs = ts_ms / 1000;
                        if let Some(dt) = chrono::DateTime::from_timestamp(ts_secs as i64, 0) {
                            // Daily count
                            let date = dt.format("%Y-%m-%d").to_string();
                            *daily.entry(date.clone()).or_insert(0) += 1;

                            // Hourly count (0-23)
                            let hour = dt.format("%H").to_string().parse::<u32>().unwrap_or(0);
                            *hourly.entry(hour).or_insert(0) += 1;

                            // Detailed: date + hour
                            let date_hour = format!("{}:{:02}", date, hour);
                            *detailed.entry(date_hour).or_insert(0) += 1;
                        }
                    }
                }
            }
        }

        Ok(ActivityStats {
            daily,
            hourly,
            detailed,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
