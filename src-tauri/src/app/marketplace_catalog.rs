use super::*;

// ============================================================================
// Marketplace Feature - Multi-Source Support
// ============================================================================

/// Plugin source configuration
#[derive(Debug, Clone)]
pub(crate) struct PluginSource {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) icon: &'static str,
    pub(crate) priority: u32,
    pub(crate) path: &'static str, // Relative to project root
}

/// Available marketplace sources (ordered by priority)
pub(crate) const PLUGIN_SOURCES: &[PluginSource] = &[
    PluginSource {
        id: "anthropic",
        name: "Anthropic Official",
        icon: "🔷",
        priority: 1,
        path: "third-parties/claude-plugins-official",
    },
    PluginSource {
        id: "lovstudio",
        name: "Lovstudio",
        icon: "💜",
        priority: 2,
        path: "marketplace/lovstudio",
    },
    PluginSource {
        id: "lovstudio-plugins",
        name: "Lovstudio Plugins",
        icon: "💜",
        priority: 3,
        path: "../lovstudio-plugins-official",
    },
    PluginSource {
        id: "community",
        name: "Community",
        icon: "🌍",
        priority: 4,
        path: "third-parties/claude-code-templates/docs/components.json",
    },
];

/// Plugin metadata from .claude-plugin/plugin.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct PluginMetadata {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) version: Option<String>,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) author: Option<PluginAuthor>,
    #[serde(default)]
    pub(crate) repository: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct PluginAuthor {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct TemplateComponent {
    pub name: String,
    pub path: String,
    pub category: String,
    #[serde(rename = "type")]
    pub component_type: String,
    pub description: Option<String>,
    pub downloads: Option<u32>,
    pub content: Option<String>,
    // Source attribution
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub source_name: Option<String>,
    #[serde(default)]
    pub source_icon: Option<String>,
    #[serde(default)]
    pub plugin_name: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct TemplatesCatalog {
    pub agents: Vec<TemplateComponent>,
    pub commands: Vec<TemplateComponent>,
    pub mcps: Vec<TemplateComponent>,
    pub hooks: Vec<TemplateComponent>,
    pub settings: Vec<TemplateComponent>,
    pub skills: Vec<TemplateComponent>,
    pub statuslines: Vec<TemplateComponent>,
    #[serde(default)]
    pub sources: Vec<SourceInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SourceInfo {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub count: usize,
}

/// Resolve source path (handles both bundled and development paths)
pub(crate) fn resolve_source_path(
    app_handle: Option<&tauri::AppHandle>,
    relative_path: &str,
) -> Option<PathBuf> {
    // In production: try bundled resources first
    if let Some(handle) = app_handle {
        if let Ok(resource_path) = handle.path().resource_dir() {
            // Tauri maps "../" to "_up_/" in the resource bundle
            let bundled_path = relative_path.replace("../", "_up_/");
            let bundled = resource_path.join("_up_").join(&bundled_path);
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }

    // In development: try from current dir and parent
    let candidates = [
        std::env::current_dir().ok(),
        std::env::current_dir()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf())),
    ];

    for candidate in candidates.into_iter().flatten() {
        let path = candidate.join(relative_path);
        if path.exists() {
            return Some(path);
        }
    }

    None
}

/// Load community catalog from JSON file (claude-code-templates)
pub(crate) fn load_community_catalog(
    app_handle: Option<&tauri::AppHandle>,
    source: &PluginSource,
) -> Vec<TemplateComponent> {
    let Some(path) = resolve_source_path(app_handle, source.path) else {
        return Vec::new();
    };

    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };

    let Ok(raw): Result<serde_json::Value, _> = serde_json::from_str(&content) else {
        return Vec::new();
    };

    let mut components = Vec::new();

    // Load each component type and add source info
    for (key, comp_type) in [
        ("agents", "agent"),
        ("commands", "command"),
        ("mcps", "mcp"),
        ("hooks", "hook"),
        ("settings", "setting"),
        ("skills", "skill"),
    ] {
        if let Some(items) = raw.get(key) {
            if let Ok(mut parsed) = serde_json::from_value::<Vec<TemplateComponent>>(items.clone())
            {
                for comp in &mut parsed {
                    comp.source_id = Some(source.id.to_string());
                    comp.source_name = Some(source.name.to_string());
                    comp.source_icon = Some(source.icon.to_string());
                    if comp.component_type.is_empty() {
                        comp.component_type = comp_type.to_string();
                    }
                }
                components.extend(parsed);
            }
        }
    }

    components
}

/// Parse SKILL.md frontmatter to extract metadata
pub(crate) fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    if !content.starts_with("---") {
        return (None, None);
    }

    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return (None, None);
    }

    let frontmatter = parts[1];
    let mut name = None;
    let mut description = None;

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("name:") {
            name = Some(val.trim().to_string());
        } else if let Some(val) = line.strip_prefix("description:") {
            description = Some(val.trim().to_string());
        }
    }

    (name, description)
}

/// Load plugins from a directory structure (claude-plugins-official style)
pub(crate) fn load_plugin_directory(
    app_handle: Option<&tauri::AppHandle>,
    source: &PluginSource,
) -> Vec<TemplateComponent> {
    let Some(base_path) = resolve_source_path(app_handle, source.path) else {
        return Vec::new();
    };

    let mut components = Vec::new();

    // Scan both plugins/ and external_plugins/ directories
    for subdir in ["plugins", "external_plugins"] {
        let dir = base_path.join(subdir);
        if !dir.exists() {
            continue;
        }

        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }

            // Read plugin metadata
            let plugin_json = plugin_dir.join(".claude-plugin/plugin.json");
            let metadata: Option<PluginMetadata> = fs::read_to_string(&plugin_json)
                .ok()
                .and_then(|c| serde_json::from_str(&c).ok());

            let plugin_name = metadata
                .as_ref()
                .map(|m| m.name.clone())
                .unwrap_or_else(|| {
                    plugin_dir
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                });

            let plugin_desc = metadata.as_ref().and_then(|m| m.description.clone());
            let author = metadata
                .as_ref()
                .and_then(|m| m.author.as_ref().map(|a| a.name.clone()));

            // Scan commands/
            let commands_dir = plugin_dir.join("commands");
            if commands_dir.exists() {
                if let Ok(cmd_entries) = fs::read_dir(&commands_dir) {
                    for cmd_entry in cmd_entries.filter_map(|e| e.ok()) {
                        let cmd_path = cmd_entry.path();
                        if cmd_path.extension().map_or(false, |e| e == "md") {
                            let name = cmd_path
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let content = fs::read_to_string(&cmd_path).ok();

                            components.push(TemplateComponent {
                                name: name.clone(),
                                path: cmd_path.to_string_lossy().to_string(),
                                category: plugin_name.clone(),
                                component_type: "command".to_string(),
                                description: plugin_desc.clone(),
                                downloads: None,
                                content,
                                source_id: Some(source.id.to_string()),
                                source_name: Some(source.name.to_string()),
                                source_icon: Some(source.icon.to_string()),
                                plugin_name: Some(plugin_name.clone()),
                                author: author.clone(),
                            });
                        }
                    }
                }
            }

            // Scan skills/
            let skills_dir = plugin_dir.join("skills");
            if skills_dir.exists() {
                if let Ok(skill_entries) = fs::read_dir(&skills_dir) {
                    for skill_entry in skill_entries.filter_map(|e| e.ok()) {
                        let skill_path = skill_entry.path();
                        if skill_path.is_dir() {
                            let skill_md = skill_path.join("SKILL.md");
                            if skill_md.exists() {
                                let name = skill_path
                                    .file_name()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string();
                                let content = fs::read_to_string(&skill_md).ok();
                                let (parsed_name, parsed_desc) = content
                                    .as_ref()
                                    .map(|c| parse_skill_frontmatter(c))
                                    .unwrap_or((None, None));

                                components.push(TemplateComponent {
                                    name: parsed_name.unwrap_or(name.clone()),
                                    path: skill_md.to_string_lossy().to_string(),
                                    category: plugin_name.clone(),
                                    component_type: "skill".to_string(),
                                    description: parsed_desc.or_else(|| plugin_desc.clone()),
                                    downloads: None,
                                    content,
                                    source_id: Some(source.id.to_string()),
                                    source_name: Some(source.name.to_string()),
                                    source_icon: Some(source.icon.to_string()),
                                    plugin_name: Some(plugin_name.clone()),
                                    author: author.clone(),
                                });
                            }
                        }
                    }
                }
            }

            // Scan agents/
            let agents_dir = plugin_dir.join("agents");
            if agents_dir.exists() {
                if let Ok(agent_entries) = fs::read_dir(&agents_dir) {
                    for agent_entry in agent_entries.filter_map(|e| e.ok()) {
                        let agent_path = agent_entry.path();
                        if agent_path.extension().map_or(false, |e| e == "md") {
                            let name = agent_path
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let content = fs::read_to_string(&agent_path).ok();

                            components.push(TemplateComponent {
                                name: name.clone(),
                                path: agent_path.to_string_lossy().to_string(),
                                category: plugin_name.clone(),
                                component_type: "agent".to_string(),
                                description: plugin_desc.clone(),
                                downloads: None,
                                content,
                                source_id: Some(source.id.to_string()),
                                source_name: Some(source.name.to_string()),
                                source_icon: Some(source.icon.to_string()),
                                plugin_name: Some(plugin_name.clone()),
                                author: author.clone(),
                            });
                        }
                    }
                }
            }

            // Check for .mcp.json
            let mcp_json = plugin_dir.join(".mcp.json");
            if mcp_json.exists() {
                let content = fs::read_to_string(&mcp_json).ok();
                components.push(TemplateComponent {
                    name: plugin_name.clone(),
                    path: mcp_json.to_string_lossy().to_string(),
                    category: plugin_name.clone(),
                    component_type: "mcp".to_string(),
                    description: plugin_desc.clone(),
                    downloads: None,
                    content,
                    source_id: Some(source.id.to_string()),
                    source_name: Some(source.name.to_string()),
                    source_icon: Some(source.icon.to_string()),
                    plugin_name: Some(plugin_name.clone()),
                    author: author.clone(),
                });
            }
        }
    }

    components
}

/// Load a single plugin (lovstudio-plugins-official style)
pub(crate) fn load_single_plugin(
    app_handle: Option<&tauri::AppHandle>,
    source: &PluginSource,
) -> Vec<TemplateComponent> {
    let Some(base_path) = resolve_source_path(app_handle, source.path) else {
        return Vec::new();
    };

    let mut components = Vec::new();

    // Read plugin metadata
    let plugin_json = base_path.join(".claude-plugin/plugin.json");
    let metadata: Option<PluginMetadata> = fs::read_to_string(&plugin_json)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok());

    let plugin_name = metadata
        .as_ref()
        .map(|m| m.name.clone())
        .unwrap_or_else(|| source.id.to_string());

    let plugin_desc = metadata.as_ref().and_then(|m| m.description.clone());
    let author = metadata
        .as_ref()
        .and_then(|m| m.author.as_ref().map(|a| a.name.clone()));

    // Scan skills/
    let skills_dir = base_path.join("skills");
    if skills_dir.exists() {
        if let Ok(skill_entries) = fs::read_dir(&skills_dir) {
            for skill_entry in skill_entries.filter_map(|e| e.ok()) {
                let skill_path = skill_entry.path();
                if skill_path.is_dir() {
                    let skill_md = skill_path.join("SKILL.md");
                    if skill_md.exists() {
                        let name = skill_path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        let content = fs::read_to_string(&skill_md).ok();
                        let (parsed_name, parsed_desc) = content
                            .as_ref()
                            .map(|c| parse_skill_frontmatter(c))
                            .unwrap_or((None, None));

                        components.push(TemplateComponent {
                            name: parsed_name
                                .unwrap_or_else(|| format!("{}:{}", plugin_name, name)),
                            path: skill_md.to_string_lossy().to_string(),
                            category: plugin_name.clone(),
                            component_type: "skill".to_string(),
                            description: parsed_desc.or_else(|| plugin_desc.clone()),
                            downloads: None,
                            content,
                            source_id: Some(source.id.to_string()),
                            source_name: Some(source.name.to_string()),
                            source_icon: Some(source.icon.to_string()),
                            plugin_name: Some(plugin_name.clone()),
                            author: author.clone(),
                        });
                    }
                }
            }
        }
    }

    // Scan commands/
    let commands_dir = base_path.join("commands");
    if commands_dir.exists() {
        if let Ok(cmd_entries) = fs::read_dir(&commands_dir) {
            for cmd_entry in cmd_entries.filter_map(|e| e.ok()) {
                let cmd_path = cmd_entry.path();
                if cmd_path.extension().map_or(false, |e| e == "md") {
                    let name = cmd_path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let content = fs::read_to_string(&cmd_path).ok();

                    components.push(TemplateComponent {
                        name: name.clone(),
                        path: cmd_path.to_string_lossy().to_string(),
                        category: plugin_name.clone(),
                        component_type: "command".to_string(),
                        description: plugin_desc.clone(),
                        downloads: None,
                        content,
                        source_id: Some(source.id.to_string()),
                        source_name: Some(source.name.to_string()),
                        source_icon: Some(source.icon.to_string()),
                        plugin_name: Some(plugin_name.clone()),
                        author: author.clone(),
                    });
                }
            }
        }
    }

    // Scan hooks/ (read hooks.json if exists)
    let hooks_json = base_path.join("hooks/hooks.json");
    if hooks_json.exists() {
        let content = fs::read_to_string(&hooks_json).ok();
        components.push(TemplateComponent {
            name: format!("{}-hooks", plugin_name),
            path: hooks_json.to_string_lossy().to_string(),
            category: plugin_name.clone(),
            component_type: "hook".to_string(),
            description: Some("Automation hooks configuration".to_string()),
            downloads: None,
            content,
            source_id: Some(source.id.to_string()),
            source_name: Some(source.name.to_string()),
            source_icon: Some(source.icon.to_string()),
            plugin_name: Some(plugin_name.clone()),
            author: author.clone(),
        });
    }

    // Scan statuslines/ (.sh files)
    let statuslines_dir = base_path.join("statuslines");
    if statuslines_dir.exists() {
        if let Ok(entries) = fs::read_dir(&statuslines_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "sh") {
                    let name = path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let content = fs::read_to_string(&path).ok();

                    // Parse description from script header comment
                    let description = content.as_ref().and_then(|c| {
                        c.lines()
                            .find(|l| l.starts_with("# Description:"))
                            .map(|l| l.trim_start_matches("# Description:").trim().to_string())
                    });

                    components.push(TemplateComponent {
                        name: name.clone(),
                        path: path.to_string_lossy().to_string(),
                        category: plugin_name.clone(),
                        component_type: "statusline".to_string(),
                        description,
                        downloads: None,
                        content,
                        source_id: Some(source.id.to_string()),
                        source_name: Some(source.name.to_string()),
                        source_icon: Some(source.icon.to_string()),
                        plugin_name: Some(plugin_name.clone()),
                        author: author.clone(),
                    });
                }
            }
        }
    }

    components
}

/// Load personal/installed statuslines from ~/.lovstudio/lovcode/statusline/
pub(crate) fn load_personal_statuslines() -> Vec<TemplateComponent> {
    let statusline_dir = get_lovstudio_dir().join("statusline");
    let mut components = Vec::new();

    if !statusline_dir.exists() {
        return components;
    }

    if let Ok(entries) = fs::read_dir(&statusline_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "sh") {
                let name = path.file_stem().unwrap_or_default().to_string_lossy();

                // Skip backup files (starting with _)
                if name.starts_with('_') {
                    continue;
                }

                let name = name.to_string();
                let content = fs::read_to_string(&path).ok();

                // Parse description from script header comment
                let description = content.as_ref().and_then(|c| {
                    c.lines()
                        .find(|l| l.starts_with("# Description:"))
                        .map(|l| l.trim_start_matches("# Description:").trim().to_string())
                });

                components.push(TemplateComponent {
                    name: name.clone(),
                    path: path.to_string_lossy().to_string(),
                    category: "personal".to_string(),
                    component_type: "statusline".to_string(),
                    description,
                    downloads: None,
                    content,
                    source_id: Some("personal".to_string()),
                    source_name: Some("Installed".to_string()),
                    source_icon: Some("📦".to_string()),
                    plugin_name: None,
                    author: None,
                });
            }
        }
    }

    components
}
