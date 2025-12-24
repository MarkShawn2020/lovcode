//! Workspace data persistence
//!
//! Stores workspace configuration including projects, features, and panel states.
//! Data is persisted to ~/.lovstudio/lovcode/workspace.json

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Get the workspace data file path
fn get_workspace_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lovstudio")
        .join("lovcode")
        .join("workspace.json")
}

/// Feature status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum FeatureStatus {
    Pending,
    Running,
    Completed,
    NeedsReview,
}

impl Default for FeatureStatus {
    fn default() -> Self {
        Self::Pending
    }
}

/// Session within a panel (a terminal tab)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub id: String,
    pub pty_id: String,
    pub title: String,
    pub command: Option<String>,
}

/// Panel state (container for multiple session tabs)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelState {
    pub id: String,
    #[serde(default)]
    pub sessions: Vec<SessionState>,
    #[serde(default)]
    pub active_session_id: String,
    pub is_shared: bool,
    pub cwd: String,
}

/// Feature within a project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Feature {
    pub id: String,
    pub name: String,
    pub status: FeatureStatus,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub archived: Option<bool>,
    pub archived_note: Option<String>,
    pub git_branch: Option<String>,
    pub chat_session_id: Option<String>,
    pub panels: Vec<PanelState>,
    #[serde(default)]
    pub layout_direction: Option<String>,
    pub created_at: u64,
}

/// Project in the workspace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceProject {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub archived: Option<bool>,
    pub features: Vec<Feature>,
    #[serde(default)]
    pub shared_panels: Vec<PanelState>,
    pub active_feature_id: Option<String>,
    pub created_at: u64,
}

/// Complete workspace data
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceData {
    pub projects: Vec<WorkspaceProject>,
    pub active_project_id: Option<String>,
}

/// Load workspace data from disk
pub fn load_workspace() -> Result<WorkspaceData, String> {
    let path = get_workspace_path();

    if !path.exists() {
        return Ok(WorkspaceData::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read workspace: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse workspace: {}", e))
}

/// Save workspace data to disk
pub fn save_workspace(data: &WorkspaceData) -> Result<(), String> {
    let path = get_workspace_path();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let content =
        serde_json::to_string_pretty(data).map_err(|e| format!("Failed to serialize workspace: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write workspace: {}", e))?;

    Ok(())
}

/// Add a new project to the workspace
pub fn add_project(path: String) -> Result<WorkspaceProject, String> {
    let mut data = load_workspace()?;

    // Check if project already exists
    if data.projects.iter().any(|p| p.path == path) {
        return Err(format!("Project '{}' already exists", path));
    }

    // Extract project name from path
    let name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let project = WorkspaceProject {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path: path.clone(),
        archived: None,
        features: Vec::new(),
        shared_panels: Vec::new(),
        active_feature_id: None,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };

    data.projects.push(project.clone());

    // Set as active if it's the first project
    if data.active_project_id.is_none() {
        data.active_project_id = Some(project.id.clone());
    }

    save_workspace(&data)?;

    Ok(project)
}

/// Remove a project from the workspace
pub fn remove_project(id: &str) -> Result<(), String> {
    let mut data = load_workspace()?;

    let index = data
        .projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| format!("Project '{}' not found", id))?;

    data.projects.remove(index);

    // Update active project if needed
    if data.active_project_id.as_deref() == Some(id) {
        data.active_project_id = data.projects.first().map(|p| p.id.clone());
    }

    save_workspace(&data)?;

    Ok(())
}

/// Set the active project
pub fn set_active_project(id: &str) -> Result<(), String> {
    let mut data = load_workspace()?;

    if !data.projects.iter().any(|p| p.id == id) {
        return Err(format!("Project '{}' not found", id));
    }

    data.active_project_id = Some(id.to_string());
    save_workspace(&data)?;

    Ok(())
}

/// Create a new feature in a project
pub fn create_feature(project_id: &str, name: String) -> Result<Feature, String> {
    let mut data = load_workspace()?;

    let project = data
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let feature = Feature {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        status: FeatureStatus::Pending,
        pinned: None,
        archived: None,
        archived_note: None,
        git_branch: None,
        chat_session_id: None,
        panels: Vec::new(),
        layout_direction: None,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };

    project.features.push(feature.clone());

    // Set as active feature if it's the first
    if project.active_feature_id.is_none() {
        project.active_feature_id = Some(feature.id.clone());
    }

    save_workspace(&data)?;

    Ok(feature)
}

/// Update a feature's status
pub fn update_feature_status(project_id: &str, feature_id: &str, status: FeatureStatus) -> Result<(), String> {
    let mut data = load_workspace()?;

    let project = data
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let feature = project
        .features
        .iter_mut()
        .find(|f| f.id == feature_id)
        .ok_or_else(|| format!("Feature '{}' not found", feature_id))?;

    feature.status = status;
    save_workspace(&data)?;

    Ok(())
}

/// Delete a feature
pub fn delete_feature(project_id: &str, feature_id: &str) -> Result<(), String> {
    let mut data = load_workspace()?;

    let project = data
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let index = project
        .features
        .iter()
        .position(|f| f.id == feature_id)
        .ok_or_else(|| format!("Feature '{}' not found", feature_id))?;

    project.features.remove(index);

    // Update active feature if needed
    if project.active_feature_id.as_deref() == Some(feature_id) {
        project.active_feature_id = project.features.first().map(|f| f.id.clone());
    }

    save_workspace(&data)?;

    Ok(())
}

/// Set the active feature for a project
pub fn set_active_feature(project_id: &str, feature_id: &str) -> Result<(), String> {
    let mut data = load_workspace()?;

    let project = data
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    if !project.features.iter().any(|f| f.id == feature_id) {
        return Err(format!("Feature '{}' not found", feature_id));
    }

    project.active_feature_id = Some(feature_id.to_string());
    save_workspace(&data)?;

    Ok(())
}

/// Add a panel to a feature
pub fn add_panel_to_feature(project_id: &str, feature_id: &str, panel: PanelState) -> Result<(), String> {
    let mut data = load_workspace()?;

    let project = data
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let feature = project
        .features
        .iter_mut()
        .find(|f| f.id == feature_id)
        .ok_or_else(|| format!("Feature '{}' not found", feature_id))?;

    feature.panels.push(panel);
    save_workspace(&data)?;

    Ok(())
}

/// Remove a panel from a feature
pub fn remove_panel_from_feature(project_id: &str, feature_id: &str, panel_id: &str) -> Result<(), String> {
    let mut data = load_workspace()?;

    let project = data
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let feature = project
        .features
        .iter_mut()
        .find(|f| f.id == feature_id)
        .ok_or_else(|| format!("Feature '{}' not found", feature_id))?;

    feature.panels.retain(|p| p.id != panel_id);
    save_workspace(&data)?;

    Ok(())
}

/// Toggle panel shared state (move between feature and shared)
pub fn toggle_panel_shared(project_id: &str, panel_id: &str) -> Result<bool, String> {
    let mut data = load_workspace()?;

    let project = data
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    // Check if panel is in shared panels
    if let Some(index) = project.shared_panels.iter().position(|p| p.id == panel_id) {
        // Move from shared to active feature
        let mut panel = project.shared_panels.remove(index);
        panel.is_shared = false;

        if let Some(feature_id) = &project.active_feature_id {
            if let Some(feature) = project.features.iter_mut().find(|f| &f.id == feature_id) {
                feature.panels.push(panel);
            }
        }

        save_workspace(&data)?;
        return Ok(false); // No longer shared
    }

    // Check if panel is in any feature
    for feature in &mut project.features {
        if let Some(index) = feature.panels.iter().position(|p| p.id == panel_id) {
            // Move from feature to shared
            let mut panel = feature.panels.remove(index);
            panel.is_shared = true;
            project.shared_panels.push(panel);

            save_workspace(&data)?;
            return Ok(true); // Now shared
        }
    }

    Err(format!("Panel '{}' not found", panel_id))
}

/// Get features that need review
pub fn get_pending_reviews() -> Result<Vec<(String, String, String)>, String> {
    let data = load_workspace()?;
    let mut reviews = Vec::new();

    for project in &data.projects {
        for feature in &project.features {
            if feature.status == FeatureStatus::NeedsReview {
                reviews.push((
                    project.id.clone(),
                    feature.id.clone(),
                    format!("{}: {}", project.name, feature.name),
                ));
            }
        }
    }

    Ok(reviews)
}
