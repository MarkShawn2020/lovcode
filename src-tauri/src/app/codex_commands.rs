use super::*;

// ============================================================================
// Codex Commands Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct CodexCommand {
    pub name: String,
    pub path: Option<String>,
    pub description: Option<String>,
    pub is_builtin: bool,
}

pub(crate) fn get_codex_config_path() -> PathBuf {
    get_codex_dir().join("config.toml")
}

pub(crate) fn list_codex_commands() -> Result<Vec<CodexCommand>, String> {
    let mut commands = Vec::new();

    // Add built-in commands
    let builtins = [
        ("model", "Switch between models"),
        ("approvals", "Adjust approval settings"),
        ("status", "Display session status and token usage"),
        ("compact", "Summarize conversation to free tokens"),
        ("diff", "Show Git changes including untracked files"),
        ("mention", "Attach files or folders to conversation"),
        ("new", "Start a fresh conversation"),
        ("review", "Request analysis of working tree changes"),
        ("mcp", "List configured MCP tools"),
        ("init", "Generate AGENTS.md scaffold"),
        ("feedback", "Submit logs and diagnostics"),
        ("logout", "Clear local credentials"),
        ("quit", "Terminate the CLI session"),
        ("exit", "Terminate the CLI session"),
        ("skills", "Browse available skills"),
    ];

    for (name, desc) in builtins {
        commands.push(CodexCommand {
            name: format!("/{}", name),
            path: None,
            description: Some(desc.to_string()),
            is_builtin: true,
        });
    }

    // Add custom prompts from ~/.codex/prompts/
    let prompts_dir = get_codex_dir().join("prompts");
    if prompts_dir.exists() {
        for entry in fs::read_dir(&prompts_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            // Only top-level .md files (subdirectories are ignored per Codex docs)
            if path.is_file() && path.extension().map_or(false, |ext| ext == "md") {
                let content = fs::read_to_string(&path).unwrap_or_default();
                let (frontmatter, _, _) = parse_frontmatter(&content);

                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                commands.push(CodexCommand {
                    name: format!("/prompts:{}", name),
                    path: Some(path.to_string_lossy().to_string()),
                    description: frontmatter.get("description").cloned(),
                    is_builtin: false,
                });
            }
        }
    }

    commands.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(commands)
}
