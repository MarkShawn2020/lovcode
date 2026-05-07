use super::*;

// ============================================================================
// Skills Feature
// ============================================================================

/// Marketplace metadata stored alongside installed components
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub(crate) struct MarketplaceMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LocalSkill {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub content: String,
    pub home_id: String,
    pub home_label: String,
    pub home_path: String,
    pub installed_at: Option<u64>,
    pub modified_at: Option<u64>,
    // Marketplace metadata (if installed from marketplace)
    #[serde(flatten)]
    pub marketplace: Option<MarketplaceMeta>,
}

pub(crate) fn frontmatter_value(
    frontmatter: &HashMap<String, String>,
    key: &str,
) -> Option<String> {
    frontmatter.get(key).and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(crate) fn merge_skill_marketplace_meta(
    marketplace: Option<MarketplaceMeta>,
    frontmatter: &HashMap<String, String>,
) -> Option<MarketplaceMeta> {
    let mut meta = marketplace.unwrap_or_default();

    if meta.vendor.is_none() {
        meta.vendor = frontmatter_value(frontmatter, "vendor")
            .or_else(|| frontmatter_value(frontmatter, "source"));
    }

    if meta.author.is_none() {
        meta.author = frontmatter_value(frontmatter, "author");
    }

    if meta.homepage.is_none() {
        meta.homepage = frontmatter_value(frontmatter, "homepage");
    }

    if meta.source_name.is_none() {
        meta.source_name = meta.vendor.clone();
    }

    if meta.source_id.is_some()
        || meta.source_name.is_some()
        || meta.vendor.is_some()
        || meta.author.is_some()
        || meta.homepage.is_some()
        || meta.downloads.is_some()
        || meta.template_path.is_some()
    {
        Some(meta)
    } else {
        None
    }
}

#[tauri::command]
pub(crate) fn list_local_skills() -> Result<Vec<LocalSkill>, String> {
    let mut skills = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    for home in get_readable_skill_homes() {
        let skills_dir = home.path.join("skills");

        for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.is_dir() {
                let skill_name = path.file_name().unwrap().to_string_lossy().to_string();
                let skill_md = path.join("SKILL.md");

                if skill_md.exists() && seen_names.insert(skill_name.clone()) {
                    let content = fs::read_to_string(&skill_md).unwrap_or_default();
                    let (frontmatter, _, _) = parse_frontmatter(&content);

                    // Load marketplace metadata if exists
                    let meta_path = path.join(".meta.json");
                    let marketplace = if meta_path.exists() {
                        fs::read_to_string(&meta_path)
                            .ok()
                            .and_then(|s| serde_json::from_str::<MarketplaceMeta>(&s).ok())
                    } else {
                        None
                    };
                    let marketplace = merge_skill_marketplace_meta(marketplace, &frontmatter);
                    let installed_at = fs::metadata(&path)
                        .ok()
                        .and_then(|metadata| {
                            metadata.created().or_else(|_| metadata.modified()).ok()
                        })
                        .and_then(system_time_to_millis);
                    let modified_at = fs::metadata(&skill_md)
                        .ok()
                        .and_then(|metadata| metadata.modified().ok())
                        .and_then(system_time_to_millis);

                    skills.push(LocalSkill {
                        name: skill_name,
                        path: skill_md.to_string_lossy().to_string(),
                        description: frontmatter.get("description").cloned(),
                        content, // Return raw content with frontmatter for frontend display
                        home_id: home.id.to_string(),
                        home_label: home.label.to_string(),
                        home_path: home.path.to_string_lossy().to_string(),
                        installed_at,
                        modified_at,
                        marketplace,
                    });
                }
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}
