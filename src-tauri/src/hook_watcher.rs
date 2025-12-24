use std::sync::LazyLock;
use std::sync::Mutex;
use std::collections::HashSet;
use tauri::{AppHandle, Emitter};

/// Tracks which features are currently being monitored for completion
static MONITORED_FEATURES: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| {
    Mutex::new(HashSet::new())
});

/// Event payload for feature completion
#[derive(Clone, serde::Serialize)]
pub struct FeatureCompleteEvent {
    pub project_id: String,
    pub feature_id: String,
    pub feature_name: String,
}

/// Start monitoring a feature for AI completion
pub fn start_monitoring(project_id: &str, feature_id: &str) {
    let key = format!("{}:{}", project_id, feature_id);
    if let Ok(mut monitored) = MONITORED_FEATURES.lock() {
        monitored.insert(key);
    }
}

/// Stop monitoring a feature
pub fn stop_monitoring(project_id: &str, feature_id: &str) {
    let key = format!("{}:{}", project_id, feature_id);
    if let Ok(mut monitored) = MONITORED_FEATURES.lock() {
        monitored.remove(&key);
    }
}

/// Check if a feature is being monitored
pub fn is_monitoring(project_id: &str, feature_id: &str) -> bool {
    let key = format!("{}:{}", project_id, feature_id);
    if let Ok(monitored) = MONITORED_FEATURES.lock() {
        monitored.contains(&key)
    } else {
        false
    }
}

/// Notify that a feature has completed AI processing
/// This should be called when we detect that the Stop hook has fired
pub fn notify_feature_complete(
    app_handle: &AppHandle,
    project_id: &str,
    feature_id: &str,
    feature_name: &str,
) {
    // Stop monitoring this feature
    stop_monitoring(project_id, feature_id);

    // Emit event to frontend
    let event = FeatureCompleteEvent {
        project_id: project_id.to_string(),
        feature_id: feature_id.to_string(),
        feature_name: feature_name.to_string(),
    };

    if let Err(e) = app_handle.emit("feature-complete", event) {
        eprintln!("Failed to emit feature-complete event: {}", e);
    }
}

/// Get list of currently monitored features
pub fn get_monitored_features() -> Vec<String> {
    if let Ok(monitored) = MONITORED_FEATURES.lock() {
        monitored.iter().cloned().collect()
    } else {
        Vec::new()
    }
}
