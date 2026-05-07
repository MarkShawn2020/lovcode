use super::*;

// ============================================================================
// Command Usage Stats Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct CommandStats {
    pub name: String,
    pub count: usize,
}

#[tauri::command]
pub(crate) async fn get_command_stats() -> Result<HashMap<String, usize>, String> {
    // Get current cache state
    let (cached_stats, cached_scanned) = {
        let cache = COMMAND_STATS_CACHE.lock().unwrap();
        (cache.stats.clone(), cache.scanned.clone())
    };

    // Incremental update in background
    let (new_stats, new_scanned) = tauri::async_runtime::spawn_blocking(move || {
        let projects_dir = get_claude_dir().join("projects");
        let mut stats = cached_stats;
        let mut scanned = cached_scanned;

        if !projects_dir.exists() {
            return Ok::<_, String>((stats, scanned));
        }

        let command_pattern = regex::Regex::new(r"<command-name>(/[^<]+)</command-name>")
            .map_err(|e| e.to_string())?;

        for project_entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
            let project_entry = project_entry.map_err(|e| e.to_string())?;
            let project_path = project_entry.path();

            if !project_path.is_dir() {
                continue;
            }

            for session_entry in fs::read_dir(&project_path).map_err(|e| e.to_string())? {
                let session_entry = session_entry.map_err(|e| e.to_string())?;
                let session_path = session_entry.path();
                let name = session_path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();

                if !name.ends_with(".jsonl") || name.starts_with("agent-") {
                    continue;
                }

                let path_str = session_path.to_string_lossy().to_string();
                let file_size = session_path.metadata().map(|m| m.len()).unwrap_or(0);
                let prev_size = scanned.get(&path_str).copied().unwrap_or(0);

                // Skip if no new content
                if file_size <= prev_size {
                    continue;
                }

                // Read only new content (from prev_size offset)
                if let Ok(mut file) = std::fs::File::open(&session_path) {
                    use std::io::{Read, Seek, SeekFrom};
                    if file.seek(SeekFrom::Start(prev_size)).is_ok() {
                        let mut new_content = String::new();
                        if file.read_to_string(&mut new_content).is_ok() {
                            // Process line by line to filter out queue-operation entries
                            for line in new_content.lines() {
                                if line.contains("\"type\":\"queue-operation\"") {
                                    continue;
                                }
                                for cap in command_pattern.captures_iter(line) {
                                    if let Some(cmd_name) = cap.get(1) {
                                        // Remove leading "/" to match cmd.name format
                                        let name =
                                            cmd_name.as_str().trim_start_matches('/').to_string();
                                        *stats.entry(name).or_insert(0) += 1;
                                    }
                                }
                            }
                        }
                    }
                }
                scanned.insert(path_str, file_size);
            }
        }

        Ok((stats, scanned))
    })
    .await
    .map_err(|e| e.to_string())??;

    // Update cache
    {
        let mut cache = COMMAND_STATS_CACHE.lock().unwrap();
        cache.stats = new_stats.clone();
        cache.scanned = new_scanned;
    }

    Ok(new_stats)
}

/// Returns command usage counts grouped by week (from pre-built index)
/// Format: { "command_name": { "2024-W01": count, "2024-W02": count, ... } }
#[tauri::command]
pub(crate) fn get_command_weekly_stats(
    _weeks: Option<usize>,
) -> Result<HashMap<String, HashMap<String, usize>>, String> {
    // Read from pre-built index (created by build_search_index)
    let stats_path = get_command_stats_path();

    if !stats_path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&stats_path).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Extract commands map
    let commands = parsed
        .get("commands")
        .and_then(|v| v.as_object())
        .ok_or("Invalid command stats format")?;

    let mut stats: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for (cmd_name, week_data) in commands {
        if let Some(weeks) = week_data.as_object() {
            let mut week_map: HashMap<String, usize> = HashMap::new();
            for (week_key, count) in weeks {
                if let Some(n) = count.as_u64() {
                    week_map.insert(week_key.clone(), n as usize);
                }
            }
            stats.insert(cmd_name.clone(), week_map);
        }
    }

    Ok(stats)
}
