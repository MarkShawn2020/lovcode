use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub path: String,
    pub session_count: usize,
    pub last_active: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub summary: Option<String>,
    pub message_count: usize,
    pub last_modified: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub uuid: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize)]
struct RawLine {
    #[serde(rename = "type")]
    line_type: Option<String>,
    summary: Option<String>,
    uuid: Option<String>,
    message: Option<RawMessage>,
    timestamp: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
    role: Option<String>,
    content: Option<serde_json::Value>,
}

// ============================================================================
// Commands & Settings Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalCommand {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub allowed_tools: Option<String>,
    pub argument_hint: Option<String>,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    pub description: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeSettings {
    pub raw: Value,
    pub permissions: Option<Value>,
    pub hooks: Option<Value>,
    pub mcp_servers: Vec<McpServer>,
}

fn get_claude_dir() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude")
}

/// Decode project ID to actual filesystem path.
/// Claude Code encodes: `/` -> `-`, and special chars (`.`, `@`, `-`) -> `-`
/// So `/.` `/@` `/-` all become `--`
fn decode_project_path(id: &str) -> String {
    // Try different interpretations of `--`: could be `/-`, `/.`, or `/@`
    let candidates = [
        id.replace("--", "\x00").replace("-", "/").replace("\x00", "-"),   // -- means -
        id.replace("--", "\x00").replace("-", "/").replace("\x00", "/."),  // -- means .
        id.replace("--", "\x00").replace("-", "/").replace("\x00", "/@"),  // -- means @
    ];

    for candidate in &candidates {
        if PathBuf::from(candidate).exists() {
            return candidate.clone();
        }
    }

    // Try: `-` in project name wasn't escaped (old projects)
    // e.g., -Users-mark-projects-lovpen-obsidian -> /Users/mark/projects/lovpen-obsidian
    let standard = &candidates[0];
    if let Some(projects_idx) = standard.find("/projects/") {
        let (prefix, rest) = standard.split_at(projects_idx + "/projects/".len());
        if let Some(slash_idx) = rest.find('/') {
            let candidate = format!("{}{}-{}", prefix, &rest[..slash_idx], &rest[slash_idx + 1..]);
            if PathBuf::from(&candidate).exists() {
                return candidate;
            }
        }
    }

    // Fallback
    candidates[0].clone()
}

#[tauri::command]
fn list_projects() -> Result<Vec<Project>, String> {
    let projects_dir = get_claude_dir().join("projects");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();

    for entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            let id = path.file_name().unwrap().to_string_lossy().to_string();
            let display_path = decode_project_path(&id);

            let mut session_count = 0;
            let mut last_active: u64 = 0;

            if let Ok(entries) = fs::read_dir(&path) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                        session_count += 1;
                        if let Ok(meta) = entry.metadata() {
                            if let Ok(modified) = meta.modified() {
                                if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                                    last_active = last_active.max(duration.as_secs());
                                }
                            }
                        }
                    }
                }
            }

            projects.push(Project {
                id: id.clone(),
                path: display_path,
                session_count,
                last_active,
            });
        }
    }

    projects.sort_by(|a, b| b.last_active.cmp(&a.last_active));
    Ok(projects)
}

#[tauri::command]
fn list_sessions(project_id: String) -> Result<Vec<Session>, String> {
    let project_dir = get_claude_dir().join("projects").join(&project_id);

    if !project_dir.exists() {
        return Err("Project not found".to_string());
    }

    let mut sessions = Vec::new();

    for entry in fs::read_dir(&project_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();

        if name.ends_with(".jsonl") && !name.starts_with("agent-") {
            let session_id = name.trim_end_matches(".jsonl").to_string();
            let content = fs::read_to_string(&path).unwrap_or_default();

            let mut summary = None;
            let mut message_count = 0;

            for line in content.lines() {
                if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                    if parsed.line_type.as_deref() == Some("summary") {
                        summary = parsed.summary;
                    }
                    if parsed.line_type.as_deref() == Some("user") ||
                       parsed.line_type.as_deref() == Some("assistant") {
                        message_count += 1;
                    }
                }
            }

            let metadata = fs::metadata(&path).ok();
            let last_modified = metadata
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            sessions.push(Session {
                id: session_id,
                project_id: project_id.clone(),
                summary,
                message_count,
                last_modified,
            });
        }
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

#[tauri::command]
fn get_session_messages(project_id: String, session_id: String) -> Result<Vec<Message>, String> {
    let session_path = get_claude_dir()
        .join("projects")
        .join(&project_id)
        .join(format!("{}.jsonl", session_id));

    if !session_path.exists() {
        return Err("Session not found".to_string());
    }

    let content = fs::read_to_string(&session_path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();

    for line in content.lines() {
        if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
            let line_type = parsed.line_type.as_deref();
            if line_type == Some("user") || line_type == Some("assistant") {
                if let Some(msg) = &parsed.message {
                    let role = msg.role.clone().unwrap_or_default();
                    let content = extract_content(&msg.content);

                    if !content.is_empty() {
                        messages.push(Message {
                            uuid: parsed.uuid.unwrap_or_default(),
                            role,
                            content,
                            timestamp: parsed.timestamp.unwrap_or_default(),
                        });
                    }
                }
            }
        }
    }

    Ok(messages)
}

fn extract_content(value: &Option<serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => {
            arr.iter()
                .filter_map(|item| {
                    if let Some(obj) = item.as_object() {
                        if obj.get("type").and_then(|v| v.as_str()) == Some("text") {
                            return obj.get("text").and_then(|v| v.as_str()).map(String::from);
                        }
                    }
                    None
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => String::new(),
    }
}

// ============================================================================
// Commands Feature
// ============================================================================

#[tauri::command]
fn list_local_commands() -> Result<Vec<LocalCommand>, String> {
    let commands_dir = get_claude_dir().join("commands");

    if !commands_dir.exists() {
        return Ok(vec![]);
    }

    let mut commands = Vec::new();
    collect_commands(&commands_dir, &commands_dir, &mut commands)?;

    commands.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(commands)
}

fn collect_commands(base_dir: &PathBuf, current_dir: &PathBuf, commands: &mut Vec<LocalCommand>) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            collect_commands(base_dir, &path, commands)?;
        } else if path.extension().map_or(false, |e| e == "md") {
            let relative = path.strip_prefix(base_dir).unwrap_or(&path);
            let name = relative.to_string_lossy()
                .trim_end_matches(".md")
                .replace("\\", "/")
                .to_string();

            let content = fs::read_to_string(&path).unwrap_or_default();
            let (frontmatter, body) = parse_frontmatter(&content);

            commands.push(LocalCommand {
                name: format!("/{}", name),
                path: path.to_string_lossy().to_string(),
                description: frontmatter.get("description").cloned(),
                allowed_tools: frontmatter.get("allowed-tools").cloned(),
                argument_hint: frontmatter.get("argument-hint").cloned(),
                content: body,
            });
        }
    }
    Ok(())
}

fn parse_frontmatter(content: &str) -> (HashMap<String, String>, String) {
    let mut frontmatter = HashMap::new();
    let mut body = content.to_string();

    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---") {
            let fm_content = &content[3..end_idx + 3];
            body = content[end_idx + 6..].trim_start().to_string();

            for line in fm_content.lines() {
                if let Some(colon_idx) = line.find(':') {
                    let key = line[..colon_idx].trim().to_string();
                    let value = line[colon_idx + 1..].trim().to_string();
                    frontmatter.insert(key, value);
                }
            }
        }
    }

    (frontmatter, body)
}

// ============================================================================
// Agents Feature (commands with 'model' field = agents)
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalAgent {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub model: Option<String>,
    pub tools: Option<String>,
    pub content: String,
}

#[tauri::command]
fn list_local_agents() -> Result<Vec<LocalAgent>, String> {
    let commands_dir = get_claude_dir().join("commands");

    if !commands_dir.exists() {
        return Ok(vec![]);
    }

    let mut agents = Vec::new();
    collect_agents(&commands_dir, &commands_dir, &mut agents)?;

    agents.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(agents)
}

fn collect_agents(base_dir: &PathBuf, current_dir: &PathBuf, agents: &mut Vec<LocalAgent>) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            collect_agents(base_dir, &path, agents)?;
        } else if path.extension().map_or(false, |e| e == "md") {
            let content = fs::read_to_string(&path).unwrap_or_default();
            let (frontmatter, body) = parse_frontmatter(&content);

            // Only include if it has a 'model' field (agents have model, commands don't)
            if frontmatter.contains_key("model") {
                let relative = path.strip_prefix(base_dir).unwrap_or(&path);
                let name = relative.to_string_lossy()
                    .trim_end_matches(".md")
                    .replace("\\", "/")
                    .to_string();

                agents.push(LocalAgent {
                    name,
                    path: path.to_string_lossy().to_string(),
                    description: frontmatter.get("description").cloned(),
                    model: frontmatter.get("model").cloned(),
                    tools: frontmatter.get("tools").cloned(),
                    content: body,
                });
            }
        }
    }
    Ok(())
}

// ============================================================================
// Skills Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalSkill {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub content: String,
}

#[tauri::command]
fn list_local_skills() -> Result<Vec<LocalSkill>, String> {
    let skills_dir = get_claude_dir().join("skills");

    if !skills_dir.exists() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();

    for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            let skill_name = path.file_name().unwrap().to_string_lossy().to_string();
            let skill_md = path.join("SKILL.md");

            if skill_md.exists() {
                let content = fs::read_to_string(&skill_md).unwrap_or_default();
                let (frontmatter, body) = parse_frontmatter(&content);

                skills.push(LocalSkill {
                    name: skill_name,
                    path: skill_md.to_string_lossy().to_string(),
                    description: frontmatter.get("description").cloned(),
                    content: body,
                });
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

// ============================================================================
// Marketplace Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateComponent {
    pub name: String,
    pub path: String,
    pub category: String,
    #[serde(rename = "type")]
    pub component_type: String,
    pub description: Option<String>,
    pub downloads: Option<u32>,
    pub content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TemplatesCatalog {
    pub agents: Vec<TemplateComponent>,
    pub commands: Vec<TemplateComponent>,
    pub mcps: Vec<TemplateComponent>,
    pub hooks: Vec<TemplateComponent>,
    pub settings: Vec<TemplateComponent>,
    pub skills: Vec<TemplateComponent>,
}

fn get_templates_path() -> PathBuf {
    let relative_path = "third-parties/claude-code-templates/docs/components.json";

    // Try multiple possible locations
    let candidates = [
        // From project root (when running pnpm tauri dev from root)
        std::env::current_dir().ok(),
        // From src-tauri/ (go up one level)
        std::env::current_dir().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())),
    ];

    for candidate in candidates.into_iter().flatten() {
        let path = candidate.join(relative_path);
        if path.exists() {
            return path;
        }
    }

    // Fallback: return the most likely path for error message
    std::env::current_dir()
        .unwrap_or_default()
        .join(relative_path)
}

#[tauri::command]
fn get_templates_catalog() -> Result<TemplatesCatalog, String> {
    let path = get_templates_path();

    if !path.exists() {
        return Err(format!("Templates catalog not found at {:?}", path));
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let raw: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Parse each component type, defaulting to empty arrays
    let agents: Vec<TemplateComponent> = raw.get("agents")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let commands: Vec<TemplateComponent> = raw.get("commands")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let mcps: Vec<TemplateComponent> = raw.get("mcps")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let hooks: Vec<TemplateComponent> = raw.get("hooks")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let settings: Vec<TemplateComponent> = raw.get("settings")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let skills: Vec<TemplateComponent> = raw.get("skills")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    Ok(TemplatesCatalog {
        agents,
        commands,
        mcps,
        hooks,
        settings,
        skills,
    })
}

#[tauri::command]
fn install_command_template(name: String, content: String) -> Result<String, String> {
    let commands_dir = get_claude_dir().join("commands");
    fs::create_dir_all(&commands_dir).map_err(|e| e.to_string())?;

    let file_path = commands_dir.join(format!("{}.md", name));
    fs::write(&file_path, content).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn install_mcp_template(name: String, config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    // Parse the MCP config
    let mcp_config: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;

    // Read existing settings or create new
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure mcpServers exists
    if !settings.get("mcpServers").is_some() {
        settings["mcpServers"] = serde_json::json!({});
    }

    // Add the MCP server
    settings["mcpServers"][&name] = mcp_config;

    // Write back
    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Installed MCP: {}", name))
}

#[tauri::command]
fn install_hook_template(name: String, config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    // Parse the hook config (should be an object with event type as key)
    let hook_config: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure hooks exists
    if !settings.get("hooks").is_some() {
        settings["hooks"] = serde_json::json!({});
    }

    // Merge hook config - hooks are typically structured as {"PreToolUse": [...], "PostToolUse": [...]}
    if let Some(hook_obj) = hook_config.as_object() {
        for (event_type, handlers) in hook_obj {
            if let Some(handlers_arr) = handlers.as_array() {
                // Get existing handlers for this event type
                let existing = settings["hooks"].get(event_type)
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                // Merge (append new handlers)
                let mut merged: Vec<serde_json::Value> = existing;
                merged.extend(handlers_arr.clone());
                settings["hooks"][event_type] = serde_json::Value::Array(merged);
            }
        }
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok(format!("Installed hook: {}", name))
}

#[tauri::command]
fn install_setting_template(config: String) -> Result<String, String> {
    let settings_path = get_claude_dir().join("settings.json");

    // Parse the setting config
    let new_settings: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Deep merge the new settings
    if let (Some(existing_obj), Some(new_obj)) = (settings.as_object_mut(), new_settings.as_object()) {
        for (key, value) in new_obj {
            existing_obj.insert(key.clone(), value.clone());
        }
    }

    let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, output).map_err(|e| e.to_string())?;

    Ok("Settings updated".to_string())
}

// ============================================================================
// Context Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct ContextFile {
    pub name: String,
    pub path: String,
    pub scope: String, // "global" or "project"
    pub content: String,
    pub last_modified: u64,
}

#[tauri::command]
fn get_context_files() -> Result<Vec<ContextFile>, String> {
    let mut files = Vec::new();

    // Global CLAUDE.md
    let global_path = get_claude_dir().join("CLAUDE.md");
    if global_path.exists() {
        if let Ok(content) = fs::read_to_string(&global_path) {
            let last_modified = fs::metadata(&global_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: "CLAUDE.md".to_string(),
                path: global_path.to_string_lossy().to_string(),
                scope: "global".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check each project directory for CLAUDE.md
    let projects_dir = get_claude_dir().join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let project_path = entry.path();
                if project_path.is_dir() {
                    let project_id = project_path.file_name().unwrap().to_string_lossy().to_string();
                    let display_path = decode_project_path(&project_id);

                    // Convert project_id back to real path and check for CLAUDE.md
                    let real_project_path = PathBuf::from(&display_path);
                    let claude_md_path = real_project_path.join("CLAUDE.md");

                    if claude_md_path.exists() {
                        if let Ok(content) = fs::read_to_string(&claude_md_path) {
                            let last_modified = fs::metadata(&claude_md_path)
                                .ok()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);

                            files.push(ContextFile {
                                name: format!("{}/CLAUDE.md", display_path),
                                path: claude_md_path.to_string_lossy().to_string(),
                                scope: "project".to_string(),
                                content,
                                last_modified,
                            });
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(files)
}

#[tauri::command]
fn get_project_context(project_path: String) -> Result<Vec<ContextFile>, String> {
    let mut files = Vec::new();
    let project_dir = PathBuf::from(&project_path);

    // Check for CLAUDE.md in project root
    let claude_md = project_dir.join("CLAUDE.md");
    if claude_md.exists() {
        if let Ok(content) = fs::read_to_string(&claude_md) {
            let last_modified = fs::metadata(&claude_md)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: "CLAUDE.md".to_string(),
                path: claude_md.to_string_lossy().to_string(),
                scope: "project".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check for .claude/CLAUDE.md in project
    let dot_claude_md = project_dir.join(".claude").join("CLAUDE.md");
    if dot_claude_md.exists() {
        if let Ok(content) = fs::read_to_string(&dot_claude_md) {
            let last_modified = fs::metadata(&dot_claude_md)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            files.push(ContextFile {
                name: ".claude/CLAUDE.md".to_string(),
                path: dot_claude_md.to_string_lossy().to_string(),
                scope: "project".to_string(),
                content,
                last_modified,
            });
        }
    }

    // Check for project-local commands in .claude/commands/
    let commands_dir = project_dir.join(".claude").join("commands");
    if commands_dir.exists() && commands_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&commands_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "md") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        let name = path.file_name().unwrap().to_string_lossy().to_string();
                        let last_modified = fs::metadata(&path)
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);

                        files.push(ContextFile {
                            name: format!(".claude/commands/{}", name),
                            path: path.to_string_lossy().to_string(),
                            scope: "command".to_string(),
                            content,
                            last_modified,
                        });
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(files)
}

// ============================================================================
// Settings Feature
// ============================================================================

#[tauri::command]
fn get_settings() -> Result<ClaudeSettings, String> {
    let settings_path = get_claude_dir().join("settings.json");

    if !settings_path.exists() {
        return Ok(ClaudeSettings {
            raw: Value::Null,
            permissions: None,
            hooks: None,
            mcp_servers: vec![],
        });
    }

    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let raw: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let permissions = raw.get("permissions").cloned();
    let hooks = raw.get("hooks").cloned();

    // Extract MCP servers from settings
    let mut mcp_servers = Vec::new();
    if let Some(mcp_obj) = raw.get("mcpServers").and_then(|v| v.as_object()) {
        for (name, config) in mcp_obj {
            if let Some(obj) = config.as_object() {
                // Handle nested mcpServers format (from some installers)
                let actual_config = if let Some(nested) = obj.get("mcpServers").and_then(|v| v.as_object()) {
                    nested.values().next().and_then(|v| v.as_object())
                } else {
                    Some(obj)
                };

                if let Some(cfg) = actual_config {
                    let description = cfg.get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let command = cfg.get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let args: Vec<String> = cfg.get("args")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let env: HashMap<String, String> = cfg.get("env")
                        .and_then(|v| v.as_object())
                        .map(|m| m.iter().filter_map(|(k, v)| {
                            v.as_str().map(|s| (k.clone(), s.to_string()))
                        }).collect())
                        .unwrap_or_default();

                    mcp_servers.push(McpServer {
                        name: name.clone(),
                        description,
                        command,
                        args,
                        env,
                    });
                }
            }
        }
    }

    Ok(ClaudeSettings {
        raw,
        permissions,
        hooks,
        mcp_servers,
    })
}

#[tauri::command]
fn open_in_editor(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_settings_path() -> String {
    get_claude_dir().join("settings.json").to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            list_sessions,
            get_session_messages,
            list_local_commands,
            list_local_agents,
            list_local_skills,
            get_context_files,
            get_project_context,
            get_settings,
            get_templates_catalog,
            install_command_template,
            install_mcp_template,
            install_hook_template,
            install_setting_template,
            open_in_editor,
            get_settings_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
