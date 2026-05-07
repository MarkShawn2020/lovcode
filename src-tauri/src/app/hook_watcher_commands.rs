use super::*;

// ============================================================================
// Hook Watcher Commands
// ============================================================================

pub(crate) fn hook_start_monitoring(project_id: String, feature_id: String) {
    hook_watcher::start_monitoring(&project_id, &feature_id);
}

pub(crate) fn hook_stop_monitoring(project_id: String, feature_id: String) {
    hook_watcher::stop_monitoring(&project_id, &feature_id);
}

pub(crate) fn hook_is_monitoring(project_id: String, feature_id: String) -> bool {
    hook_watcher::is_monitoring(&project_id, &feature_id)
}

pub(crate) fn hook_get_monitored() -> Vec<String> {
    hook_watcher::get_monitored_features()
}

pub(crate) fn hook_notify_complete(
    app_handle: tauri::AppHandle,
    project_id: String,
    feature_id: String,
    feature_name: String,
) {
    hook_watcher::notify_feature_complete(&app_handle, &project_id, &feature_id, &feature_name);
}
