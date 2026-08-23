use super::*;
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};

// ============================================================================
// Search Feature
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct SearchResult {
    pub uuid: String,
    pub content: String,
    pub role: String,
    pub line_number: usize,
    pub project_id: String,
    pub project_path: String,
    pub session_id: String,
    pub session_summary: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub last_prompt: Option<String>,
    pub round_index: usize,
    pub round_prompt: Option<String>,
    pub round_timestamp: Option<String>,
    pub timestamp: String,
    pub score: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchIndexBuildStatus {
    pub state: String,
    /// "full" for a whole-corpus build (progress is meaningful) or
    /// "incremental" for a delta pass triggered by a changed session file
    /// (totals cover only that delta, so the UI shows activity, not percent).
    pub mode: String,
    pub search_available: bool,
    pub total_sessions: usize,
    pub processed_sessions: usize,
    pub total_messages: usize,
    pub processed_messages: usize,
    pub indexed_messages: usize,
    pub total_bytes: u64,
    pub processed_bytes: u64,
    pub skipped_sessions: usize,
    pub index_size_bytes: u64,
    pub current_session_id: Option<String>,
    pub current_title: Option<String>,
    pub current_project_path: Option<String>,
    pub started_at: Option<u64>,
    pub updated_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchIndexWatchTarget {
    pub source: String,
    pub root_path: String,
    pub files: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IncrementalSearchIndexSyncStatus {
    pub enabled: bool,
    pub monitoring: bool,
    pub targets: Vec<SearchIndexWatchTarget>,
    pub last_change_at: Option<u64>,
    pub last_sync_requested_at: Option<u64>,
}

impl Default for SearchIndexBuildStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            mode: "full".to_string(),
            search_available: false,
            total_sessions: 0,
            processed_sessions: 0,
            total_messages: 0,
            processed_messages: 0,
            indexed_messages: 0,
            total_bytes: 0,
            processed_bytes: 0,
            skipped_sessions: 0,
            index_size_bytes: 0,
            current_session_id: None,
            current_title: None,
            current_project_path: None,
            started_at: None,
            updated_at: None,
            completed_at: None,
            error: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
struct SearchIndexManifestEntry {
    path: String,
    source_kind: String,
    session_id: String,
    size: u64,
    mtime: u64,
    indexed_size: u64,
    line_count: usize,
    message_count: usize,
    round_index: usize,
    round_prompt: String,
    round_timestamp: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchIndexManifest {
    version: u32,
    indexed_at: u64,
    entries: Vec<SearchIndexManifestEntry>,
}

#[derive(Clone)]
struct ClaudeSearchSource {
    project_id: String,
    display_path: String,
    path: PathBuf,
    session_id: String,
    size: u64,
    mtime: u64,
}

#[derive(Clone)]
struct CodexSearchSource {
    path: PathBuf,
    session_id: String,
    size: u64,
    mtime: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SearchIndexSourceKind {
    Claude,
    Codex,
}

impl SearchIndexSourceKind {
    fn as_str(self) -> &'static str {
        match self {
            SearchIndexSourceKind::Claude => "claude",
            SearchIndexSourceKind::Codex => "codex",
        }
    }
}

#[derive(Clone)]
enum SearchIndexWorkMode {
    Reindex,
    AppendClaude {
        offset: u64,
        base_line_count: usize,
        base_message_count: usize,
        base_round_index: usize,
        base_round_prompt: String,
        base_round_timestamp: String,
    },
    AppendCodex {
        offset: u64,
        base_line_count: usize,
        base_message_count: usize,
        base_round_index: usize,
        base_round_prompt: String,
        base_round_timestamp: String,
    },
}

impl SearchIndexWorkMode {
    fn should_delete_existing_docs(&self) -> bool {
        matches!(self, SearchIndexWorkMode::Reindex)
    }
}

static SEARCH_INDEX_BUILD_STATUS: LazyLock<Mutex<SearchIndexBuildStatus>> =
    LazyLock::new(|| Mutex::new(SearchIndexBuildStatus::default()));
static SEARCH_INDEX_STATUS_DISK_SIGNATURE: LazyLock<Mutex<Option<SearchIndexDiskSignature>>> =
    LazyLock::new(|| Mutex::new(None));
const SEARCH_INDEX_BUILD_IDLE: u8 = 0;
const SEARCH_INDEX_BUILD_RUNNING: u8 = 1;
const SEARCH_INDEX_BUILD_PENDING: u8 = 2;
static SEARCH_INDEX_BUILD_STATE: std::sync::atomic::AtomicU8 =
    std::sync::atomic::AtomicU8::new(SEARCH_INDEX_BUILD_IDLE);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncrementalSearchIndexSyncSettings {
    #[serde(default = "incremental_search_index_sync_default_enabled")]
    enabled: bool,
}

impl Default for IncrementalSearchIndexSyncSettings {
    fn default() -> Self {
        Self { enabled: true }
    }
}

const fn incremental_search_index_sync_default_enabled() -> bool {
    true
}

#[derive(Clone, Debug)]
struct IncrementalSearchIndexSyncRuntime {
    enabled: bool,
    last_change_at: Option<u64>,
    last_sync_requested_at: Option<u64>,
}

impl From<IncrementalSearchIndexSyncSettings> for IncrementalSearchIndexSyncRuntime {
    fn from(settings: IncrementalSearchIndexSyncSettings) -> Self {
        Self {
            enabled: settings.enabled,
            last_change_at: None,
            last_sync_requested_at: None,
        }
    }
}

static INCREMENTAL_SEARCH_INDEX_SYNC_RUNTIME: LazyLock<Mutex<IncrementalSearchIndexSyncRuntime>> =
    LazyLock::new(|| Mutex::new(load_incremental_search_index_sync_settings().into()));

// Bump the manifest when indexed Turn semantics change. The next startup will
// rebuild once so atomic content blocks, tool roles, and block identities are
// backfilled.
const SEARCH_INDEX_MANIFEST_VERSION: u32 = 8;
const SEARCH_INDEX_EVENT: &str = "search-index:build";
const REQUIRED_SEARCH_INDEX_FIELDS: &[&str] = &[
    "title",
    "summary",
    "last_prompt",
    "prompt",
    "user",
    "assistant",
    "project_id",
    "source_path",
    "line_number",
    "round_index",
    "round_prompt",
    "round_timestamp",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SearchIndexPathSignature {
    len: u64,
    modified_nanos: u128,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SearchIndexDiskSignature {
    manifest: Option<SearchIndexPathSignature>,
    index_meta: Option<SearchIndexPathSignature>,
}

struct SearchIndexBuildRunningGuard {
    active: bool,
}

impl SearchIndexBuildRunningGuard {
    fn finish_pass(&mut self) -> bool {
        let should_continue = complete_search_index_build_pass(&SEARCH_INDEX_BUILD_STATE);
        if !should_continue {
            self.active = false;
        }
        should_continue
    }
}

impl Drop for SearchIndexBuildRunningGuard {
    fn drop(&mut self) {
        if self.active {
            SEARCH_INDEX_BUILD_STATE.store(
                SEARCH_INDEX_BUILD_IDLE,
                std::sync::atomic::Ordering::Release,
            );
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn search_index_manifest_path() -> PathBuf {
    get_index_dir()
        .parent()
        .map(|parent| parent.join("search-index-manifest.json"))
        .unwrap_or_else(|| PathBuf::from("search-index-manifest.json"))
}

fn incremental_search_index_sync_settings_path() -> PathBuf {
    get_index_dir()
        .parent()
        .map(|parent| parent.join("incremental-search-index-sync-settings.json"))
        .unwrap_or_else(|| PathBuf::from("incremental-search-index-sync-settings.json"))
}

fn load_incremental_search_index_sync_settings() -> IncrementalSearchIndexSyncSettings {
    fs::read_to_string(incremental_search_index_sync_settings_path())
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn save_incremental_search_index_sync_settings(
    settings: &IncrementalSearchIndexSyncSettings,
) -> Result<(), String> {
    let path = incremental_search_index_sync_settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let value = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, value).map_err(|error| error.to_string())
}

fn search_index_path_signature(path: &Path) -> Option<SearchIndexPathSignature> {
    let metadata = fs::metadata(path).ok()?;
    let modified_nanos = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(SearchIndexPathSignature {
        len: metadata.len(),
        modified_nanos,
    })
}

fn search_index_disk_signature() -> SearchIndexDiskSignature {
    SearchIndexDiskSignature {
        manifest: search_index_path_signature(&search_index_manifest_path()),
        index_meta: search_index_path_signature(&get_index_dir().join("meta.json")),
    }
}

fn emit_search_index_status(app: Option<&tauri::AppHandle>, mut status: SearchIndexBuildStatus) {
    if status.total_messages > 0 {
        // Docs written by the running pass are not searchable until it
        // commits, so hold the reported figure at the corpus we published.
        status.indexed_messages = status.indexed_messages.min(status.total_messages);
    }
    if status.total_sessions > 0 {
        status.processed_sessions = status.processed_sessions.min(status.total_sessions);
    }
    if status.total_bytes > 0 {
        status.processed_bytes = status.processed_bytes.min(status.total_bytes);
    }

    // Only a full rebuild writes to the staging directory. An incremental
    // pass appends to the live index, so reporting the staging size would
    // blink the panel down to 0 B and back for every synced session.
    if status.state == "building" && status.mode == "full" {
        status.index_size_bytes = search_index_build_dir_size();
    } else if status.index_size_bytes == 0 {
        status.index_size_bytes = search_index_dir_size();
    }

    if let Ok(mut guard) = SEARCH_INDEX_BUILD_STATUS.lock() {
        *guard = status.clone();
    }
    if let Some(app) = app {
        let _ = app.emit(SEARCH_INDEX_EVENT, status);
    }
}

fn current_search_index_status() -> SearchIndexBuildStatus {
    let build_running = SEARCH_INDEX_BUILD_STATE.load(std::sync::atomic::Ordering::Acquire)
        != SEARCH_INDEX_BUILD_IDLE;
    if build_running {
        return SEARCH_INDEX_BUILD_STATUS
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
    }

    // Serialise the cold disk hydration and retain its cheap metadata
    // fingerprint. Multiple windows can ask for status at startup, but only
    // the first request should deserialize the manifest, open Tantivy, and
    // walk the index directory.
    let Ok(mut cached_signature) = SEARCH_INDEX_STATUS_DISK_SIGNATURE.lock() else {
        return SEARCH_INDEX_BUILD_STATUS
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
    };
    let disk_signature = search_index_disk_signature();
    if cached_signature.as_ref() == Some(&disk_signature) {
        return SEARCH_INDEX_BUILD_STATUS
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
    }

    let mut status = SEARCH_INDEX_BUILD_STATUS
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let current_manifest = load_search_index_manifest();
    let search_available = search_index_is_available();
    let index_ready = search_available && current_manifest.is_some();
    status.search_available = search_available;
    let mut changed = false;

    if !build_running && index_ready && (status.state == "idle" || status.state == "building") {
        let (total_sessions, total_messages, total_bytes) = current_manifest
            .as_ref()
            .map(|manifest| manifest_totals(&manifest.entries))
            .unwrap_or((
                status.total_sessions,
                status.total_messages,
                status.total_bytes,
            ));
        status.state = "ready".to_string();
        status.search_available = true;
        status.total_sessions = total_sessions;
        status.processed_sessions = total_sessions;
        status.total_messages = total_messages;
        status.processed_messages = total_messages;
        status.indexed_messages = total_messages;
        status.total_bytes = total_bytes;
        status.processed_bytes = total_bytes;
        status.index_size_bytes = search_index_dir_size();
        status.current_session_id = None;
        status.current_title = None;
        status.current_project_path = None;
        status.error = None;
        if status.completed_at.is_none() {
            status.completed_at = Some(now_secs());
        }
        status.updated_at = status.completed_at;
        changed = true;
    } else if !build_running && status.state == "building" && !index_ready {
        status.state = "idle".to_string();
        status.current_session_id = None;
        status.current_title = None;
        status.current_project_path = None;
        changed = true;
    } else if status.state == "ready" && !index_ready {
        status.state = "idle".to_string();
        changed = true;
    }

    if changed {
        if let Ok(mut guard) = SEARCH_INDEX_BUILD_STATUS.lock() {
            *guard = status.clone();
        }
    }
    *cached_signature = Some(disk_signature);

    status
}

fn manifest_totals(entries: &[SearchIndexManifestEntry]) -> (usize, usize, u64) {
    (
        entries.len(),
        entries.iter().map(|entry| entry.message_count).sum(),
        entries.iter().map(|entry| entry.indexed_size).sum(),
    )
}

fn dir_size_bytes(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };

    entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let metadata = entry.metadata().ok()?;
            if metadata.is_dir() {
                Some(dir_size_bytes(&entry.path()))
            } else {
                Some(metadata.len())
            }
        })
        .sum()
}

fn search_index_dir_size() -> u64 {
    dir_size_bytes(&get_index_dir())
}

fn search_index_build_dir_size() -> u64 {
    get_index_dir()
        .parent()
        .map(|parent| dir_size_bytes(&parent.join("search-index-building")))
        .unwrap_or(0)
}

fn mark_search_index_build_requested(state: &std::sync::atomic::AtomicU8) -> bool {
    let previous = state
        .fetch_update(
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
            |current| {
                Some(match current {
                    SEARCH_INDEX_BUILD_IDLE => SEARCH_INDEX_BUILD_RUNNING,
                    SEARCH_INDEX_BUILD_RUNNING | SEARCH_INDEX_BUILD_PENDING => {
                        SEARCH_INDEX_BUILD_PENDING
                    }
                    _ => unreachable!("invalid search index build state"),
                })
            },
        )
        .expect("search index build state update always returns a value");
    previous == SEARCH_INDEX_BUILD_IDLE
}

fn complete_search_index_build_pass(state: &std::sync::atomic::AtomicU8) -> bool {
    let previous = state
        .fetch_update(
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
            |current| {
                Some(match current {
                    SEARCH_INDEX_BUILD_PENDING => SEARCH_INDEX_BUILD_RUNNING,
                    SEARCH_INDEX_BUILD_RUNNING => SEARCH_INDEX_BUILD_IDLE,
                    SEARCH_INDEX_BUILD_IDLE => SEARCH_INDEX_BUILD_IDLE,
                    _ => unreachable!("invalid search index build state"),
                })
            },
        )
        .expect("search index build state update always returns a value");
    previous == SEARCH_INDEX_BUILD_PENDING
}

fn try_mark_search_index_build_running() -> Option<SearchIndexBuildRunningGuard> {
    mark_search_index_build_requested(&SEARCH_INDEX_BUILD_STATE)
        .then_some(SearchIndexBuildRunningGuard { active: true })
}

fn collect_claude_search_sources(projects_dir: &Path) -> Result<Vec<ClaudeSearchSource>, String> {
    let mut sources = Vec::new();
    if !projects_dir.exists() {
        return Ok(sources);
    }

    for project_entry in fs::read_dir(projects_dir).map_err(|e| e.to_string())? {
        let project_entry = project_entry.map_err(|e| e.to_string())?;
        let project_path_buf = project_entry.path();
        if !project_path_buf.is_dir() {
            continue;
        }

        let project_id = project_path_buf
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let display_path = decode_project_path(&project_id);

        for entry in fs::read_dir(&project_path_buf).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if !name.ends_with(".jsonl") || name.starts_with("agent-") {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            sources.push(ClaudeSearchSource {
                project_id: project_id.clone(),
                display_path: display_path.clone(),
                path,
                session_id: name.trim_end_matches(".jsonl").to_string(),
                size: metadata.len(),
                mtime,
            });
        }
    }

    Ok(sources)
}

fn collect_codex_search_sources() -> Vec<CodexSearchSource> {
    collect_codex_session_paths()
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let session_id = codex_session_id_from_path(&path).unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });
            Some(CodexSearchSource {
                path,
                session_id,
                size: metadata.len(),
                mtime,
            })
        })
        .collect()
}

fn current_search_index_watch_targets() -> Result<Vec<SearchIndexWatchTarget>, String> {
    let claude_root = get_claude_dir().join("projects");
    let mut claude_files = collect_claude_search_sources(&claude_root)?
        .into_iter()
        .map(|source| source_path_key(&source.path))
        .collect::<Vec<_>>();
    claude_files.sort();

    let codex_root = get_codex_dir();
    let mut codex_files = collect_codex_search_sources()
        .into_iter()
        .map(|source| source_path_key(&source.path))
        .collect::<Vec<_>>();
    codex_files.sort();

    Ok(vec![
        SearchIndexWatchTarget {
            source: "Claude Code".to_string(),
            root_path: source_path_key(&claude_root),
            files: claude_files,
        },
        SearchIndexWatchTarget {
            source: "Codex".to_string(),
            root_path: source_path_key(&codex_root),
            files: codex_files,
        },
    ])
}

fn current_incremental_search_index_sync_status() -> Result<IncrementalSearchIndexSyncStatus, String>
{
    let targets = current_search_index_watch_targets()?;
    let runtime = INCREMENTAL_SEARCH_INDEX_SYNC_RUNTIME
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    let monitoring = runtime.enabled
        && targets
            .iter()
            .any(|target| Path::new(&target.root_path).exists());

    Ok(IncrementalSearchIndexSyncStatus {
        enabled: runtime.enabled,
        monitoring,
        targets,
        last_change_at: runtime.last_change_at,
        last_sync_requested_at: runtime.last_sync_requested_at,
    })
}

fn incremental_search_index_sync_enabled() -> bool {
    INCREMENTAL_SEARCH_INDEX_SYNC_RUNTIME
        .lock()
        .map(|runtime| runtime.enabled)
        .unwrap_or(true)
}

fn is_incremental_search_index_source_path(path: &Path) -> bool {
    if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
        return false;
    }

    let is_claude_session = path.starts_with(get_claude_dir().join("projects"))
        && !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("agent-"));
    let is_codex_session = path.starts_with(get_codex_sessions_dir())
        || path.starts_with(get_codex_archived_sessions_dir());

    is_claude_session || is_codex_session
}

#[cfg(test)]
mod incremental_search_index_sync_tests {
    use super::*;

    #[test]
    fn defaults_to_enabled_for_new_installations() {
        assert!(IncrementalSearchIndexSyncSettings::default().enabled);
    }

    #[test]
    fn limits_auto_sync_to_indexable_session_sources() {
        let claude_session = get_claude_dir()
            .join("projects")
            .join("project")
            .join("session.jsonl");
        let claude_agent = get_claude_dir()
            .join("projects")
            .join("project")
            .join("agent-session.jsonl");
        let codex_session = get_codex_sessions_dir().join("2026").join("session.jsonl");
        let codex_config = get_codex_dir().join("config.jsonl");

        assert!(is_incremental_search_index_source_path(&claude_session));
        assert!(is_incremental_search_index_source_path(&codex_session));
        assert!(!is_incremental_search_index_source_path(&claude_agent));
        assert!(!is_incremental_search_index_source_path(&codex_config));
    }
}

pub(crate) fn notify_incremental_search_index_source_changes(
    app_handle: tauri::AppHandle,
    changed_paths: &[PathBuf],
) {
    if !changed_paths
        .iter()
        .any(|path| is_incremental_search_index_source_path(path))
        || !incremental_search_index_sync_enabled()
    {
        return;
    }

    if let Ok(mut runtime) = INCREMENTAL_SEARCH_INDEX_SYNC_RUNTIME.lock() {
        let now = now_secs();
        runtime.last_change_at = Some(now);
        runtime.last_sync_requested_at = Some(now);
    }

    let _ = request_search_index_build(app_handle, false);
}

fn source_path_key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn previous_entry_matches_source(
    entry: &SearchIndexManifestEntry,
    source_kind: SearchIndexSourceKind,
    session_id: &str,
    size: u64,
    mtime: u64,
) -> bool {
    entry.source_kind == source_kind.as_str()
        && entry.session_id == session_id
        && entry.size == size
        && entry.mtime == mtime
        && entry.indexed_size == size
}

fn claude_append_work_mode(
    previous: &SearchIndexManifestEntry,
    source: &ClaudeSearchSource,
) -> Option<SearchIndexWorkMode> {
    if previous.source_kind != SearchIndexSourceKind::Claude.as_str()
        || previous.session_id != source.session_id
        || source.size <= previous.indexed_size
    {
        return None;
    }

    Some(SearchIndexWorkMode::AppendClaude {
        offset: previous.indexed_size,
        base_line_count: previous.line_count,
        base_message_count: previous.message_count,
        base_round_index: previous.round_index,
        base_round_prompt: previous.round_prompt.clone(),
        base_round_timestamp: previous.round_timestamp.clone(),
    })
}

fn codex_append_work_mode(
    previous: &SearchIndexManifestEntry,
    source: &CodexSearchSource,
) -> Option<SearchIndexWorkMode> {
    if previous.source_kind != SearchIndexSourceKind::Codex.as_str()
        || previous.session_id != source.session_id
        || source.size <= previous.indexed_size
    {
        return None;
    }

    Some(SearchIndexWorkMode::AppendCodex {
        offset: previous.indexed_size,
        base_line_count: previous.line_count,
        base_message_count: previous.message_count,
        base_round_index: previous.round_index,
        base_round_prompt: previous.round_prompt.clone(),
        base_round_timestamp: previous.round_timestamp.clone(),
    })
}

fn read_file_suffix(path: &Path, offset: u64) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    Ok(content)
}

fn load_search_index_manifest() -> Option<SearchIndexManifest> {
    let bytes = fs::read(search_index_manifest_path()).ok()?;
    let manifest = serde_json::from_slice::<SearchIndexManifest>(&bytes).ok()?;
    (manifest.version == SEARCH_INDEX_MANIFEST_VERSION).then_some(manifest)
}

fn save_search_index_manifest(entries: Vec<SearchIndexManifestEntry>) -> Result<(), String> {
    let path = search_index_manifest_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let manifest = SearchIndexManifest {
        version: SEARCH_INDEX_MANIFEST_VERSION,
        indexed_at: now_secs(),
        entries,
    };
    let bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

fn search_index_schema_is_current(schema: &Schema) -> bool {
    REQUIRED_SEARCH_INDEX_FIELDS
        .iter()
        .all(|field| schema.get_field(field).is_ok())
}

fn search_index_on_disk_is_current() -> bool {
    if !search_index_is_available() || load_search_index_manifest().is_none() {
        return false;
    }

    true
}

fn search_index_is_available() -> bool {
    if !get_index_dir().exists() {
        return false;
    }

    Index::open_in_dir(get_index_dir())
        .map(|index| search_index_schema_is_current(&index.schema()))
        .unwrap_or(false)
}

fn ensure_search_index_loaded() -> Result<(), String> {
    let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;
    if let Some(search_index) = guard.as_ref() {
        if search_index_schema_is_current(&search_index.schema) {
            return Ok(());
        }
        *guard = None;
        return Err("Search index schema is outdated. Rebuild required.".to_string());
    }
    let index_dir = get_index_dir();
    if !index_dir.exists() {
        return Ok(());
    }
    let index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
    let schema = index.schema();
    if !search_index_schema_is_current(&schema) {
        return Err("Search index schema is outdated. Rebuild required.".to_string());
    }
    register_jieba_tokenizer(&index);
    *guard = Some(SearchIndex { index, schema });
    Ok(())
}

fn update_search_index_progress(
    app: Option<&tauri::AppHandle>,
    status: &mut SearchIndexBuildStatus,
    current_session_id: Option<String>,
    current_title: Option<String>,
    current_project_path: Option<String>,
) {
    status.processed_sessions += 1;
    status.current_session_id = current_session_id;
    status.current_title = current_title;
    status.current_project_path = current_project_path;
    status.updated_at = Some(now_secs());
    emit_search_index_status(app, status.clone());
}

fn update_search_index_message_progress(
    app: Option<&tauri::AppHandle>,
    status: &mut SearchIndexBuildStatus,
    current_session_id: Option<String>,
    current_title: Option<String>,
    current_project_path: Option<String>,
    force_emit: bool,
    last_progress_emit_at: &mut std::time::Instant,
) {
    status.processed_messages += 1;
    status.indexed_messages += 1;
    status.current_session_id = current_session_id;
    status.current_title = current_title;
    status.current_project_path = current_project_path;
    status.updated_at = Some(now_secs());

    if force_emit
        || status.processed_messages % 100 == 0
        || last_progress_emit_at.elapsed() >= Duration::from_millis(750)
    {
        *last_progress_emit_at = std::time::Instant::now();
        emit_search_index_status(app, status.clone());
    }
}

#[tauri::command]
pub(crate) async fn get_search_index_status() -> Result<SearchIndexBuildStatus, String> {
    tauri::async_runtime::spawn_blocking(current_search_index_status)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn get_incremental_search_index_sync_status(
) -> Result<IncrementalSearchIndexSyncStatus, String> {
    tauri::async_runtime::spawn_blocking(current_incremental_search_index_sync_status)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn set_incremental_search_index_sync_enabled(
    enabled: bool,
) -> Result<IncrementalSearchIndexSyncStatus, String> {
    save_incremental_search_index_sync_settings(&IncrementalSearchIndexSyncSettings { enabled })?;
    let mut runtime = INCREMENTAL_SEARCH_INDEX_SYNC_RUNTIME
        .lock()
        .map_err(|error| error.to_string())?;
    runtime.enabled = enabled;
    drop(runtime);
    current_incremental_search_index_sync_status()
}

/// Headless entry points for the JSON CLI.
///
/// The desktop build drives indexing through Tauri commands that need an
/// `AppHandle` to emit progress. Agent Skills and scripts have no window, so
/// they get the same single-writer pipeline without event emission: status is
/// read from the manifest on disk, and a build runs to completion in-process.
pub(crate) fn cli_search_index_status() -> SearchIndexBuildStatus {
    current_search_index_status()
}

pub(crate) fn cli_build_search_index(force: bool) -> Result<SearchIndexBuildStatus, String> {
    run_search_index_build(None, force)?;
    Ok(current_search_index_status())
}

#[tauri::command]
pub(crate) fn start_search_index_build(
    app_handle: tauri::AppHandle,
    force: Option<bool>,
) -> Result<SearchIndexBuildStatus, String> {
    request_search_index_build(app_handle, force.unwrap_or(false))
}

fn request_search_index_build(
    app_handle: tauri::AppHandle,
    force: bool,
) -> Result<SearchIndexBuildStatus, String> {
    let Some(mut running_guard) = try_mark_search_index_build_running() else {
        return Ok(current_search_index_status());
    };

    let app_for_task = app_handle.clone();
    let mut force = force;
    tauri::async_runtime::spawn(async move {
        loop {
            let app_for_blocking = app_for_task.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                run_search_index_build(Some(app_for_blocking), force)
            })
            .await
            .map_err(|e| e.to_string())
            .and_then(|inner| inner);

            if let Err(error) = result {
                let mut status = current_search_index_status();
                status.state = "error".to_string();
                status.error = Some(error);
                status.completed_at = Some(now_secs());
                status.updated_at = status.completed_at;
                emit_search_index_status(Some(&app_for_task), status);
            }

            if !running_guard.finish_pass() {
                break;
            }
            force = false;
        }
    });

    Ok(current_search_index_status())
}

fn run_search_index_build(app: Option<tauri::AppHandle>, force: bool) -> Result<usize, String> {
    let _build_guard = SEARCH_INDEX_BUILD_LOCK.lock().map_err(|e| e.to_string())?;
    let index_dir = get_index_dir();
    let index_parent = index_dir
        .parent()
        .ok_or_else(|| "Search index path has no parent".to_string())?;
    let build_dir = index_parent.join("search-index-building");

    let projects_dir = get_claude_dir().join("projects");
    let claude_sources = collect_claude_search_sources(&projects_dir)?;
    let codex_sources = collect_codex_search_sources();
    let previous_manifest = load_search_index_manifest();
    let full_rebuild = force || previous_manifest.is_none() || !search_index_on_disk_is_current();
    // An incremental pass only touches the changed sessions, but the panel it
    // feeds reports how much is searchable overall. Seed every counter from the
    // corpus we already published so they hold steady instead of restarting.
    let (baseline_sessions, baseline_messages, baseline_bytes) = if full_rebuild {
        (0, 0, 0)
    } else {
        previous_manifest
            .as_ref()
            .map(|manifest| manifest_totals(&manifest.entries))
            .unwrap_or((0, 0, 0))
    };
    let started_at = now_secs();
    let discovered_sessions = claude_sources.len() + codex_sources.len();
    let discovered_bytes = claude_sources
        .iter()
        .map(|source| source.size)
        .chain(codex_sources.iter().map(|source| source.size))
        .sum();
    let mut status = SearchIndexBuildStatus {
        state: "building".to_string(),
        mode: if full_rebuild { "full" } else { "incremental" }.to_string(),
        search_available: search_index_is_available(),
        total_sessions: if full_rebuild {
            discovered_sessions
        } else {
            baseline_sessions
        },
        processed_sessions: if full_rebuild { 0 } else { baseline_sessions },
        total_messages: baseline_messages,
        processed_messages: 0,
        indexed_messages: baseline_messages,
        total_bytes: if full_rebuild {
            discovered_bytes
        } else {
            baseline_bytes
        },
        processed_bytes: if full_rebuild { 0 } else { baseline_bytes },
        skipped_sessions: 0,
        index_size_bytes: 0,
        current_session_id: None,
        current_title: Some("Preparing search index".to_string()),
        current_project_path: None,
        started_at: Some(started_at),
        updated_at: Some(started_at),
        completed_at: None,
        error: None,
    };
    emit_search_index_status(app.as_ref(), status.clone());

    let previous_by_path: HashMap<String, SearchIndexManifestEntry> = previous_manifest
        .as_ref()
        .map(|manifest| {
            manifest
                .entries
                .iter()
                .map(|entry| (entry.path.clone(), entry.clone()))
                .collect()
        })
        .unwrap_or_default();

    let mut current_paths = HashSet::with_capacity(discovered_sessions);
    let mut final_manifest_entries: Vec<SearchIndexManifestEntry> =
        Vec::with_capacity(discovered_sessions);
    let mut claude_work_by_path: HashMap<String, SearchIndexWorkMode> = HashMap::new();
    let mut codex_work_by_path: HashMap<String, SearchIndexWorkMode> = HashMap::new();
    let mut work_bytes = 0u64;

    for source in claude_sources.iter() {
        let path = source_path_key(&source.path);
        current_paths.insert(path.clone());
        let previous = previous_by_path.get(&path);

        if !full_rebuild
            && previous
                .map(|entry| {
                    previous_entry_matches_source(
                        entry,
                        SearchIndexSourceKind::Claude,
                        &source.session_id,
                        source.size,
                        source.mtime,
                    )
                })
                .unwrap_or(false)
        {
            if let Some(entry) = previous {
                final_manifest_entries.push(entry.clone());
            }
            continue;
        }

        let mode = if !full_rebuild {
            previous
                .and_then(|entry| claude_append_work_mode(entry, source))
                .unwrap_or(SearchIndexWorkMode::Reindex)
        } else {
            SearchIndexWorkMode::Reindex
        };
        work_bytes += match &mode {
            SearchIndexWorkMode::Reindex => source.size,
            SearchIndexWorkMode::AppendClaude { offset, .. }
            | SearchIndexWorkMode::AppendCodex { offset, .. } => {
                source.size.saturating_sub(*offset)
            }
        };
        claude_work_by_path.insert(path, mode);
    }

    for source in codex_sources.iter() {
        let path = source_path_key(&source.path);
        current_paths.insert(path.clone());
        let previous = previous_by_path.get(&path);

        if !full_rebuild
            && previous
                .map(|entry| {
                    previous_entry_matches_source(
                        entry,
                        SearchIndexSourceKind::Codex,
                        &source.session_id,
                        source.size,
                        source.mtime,
                    )
                })
                .unwrap_or(false)
        {
            if let Some(entry) = previous {
                final_manifest_entries.push(entry.clone());
            }
            continue;
        }

        let mode = if !full_rebuild {
            previous
                .and_then(|entry| codex_append_work_mode(entry, source))
                .unwrap_or(SearchIndexWorkMode::Reindex)
        } else {
            SearchIndexWorkMode::Reindex
        };
        work_bytes += match &mode {
            SearchIndexWorkMode::Reindex => source.size,
            SearchIndexWorkMode::AppendClaude { offset, .. }
            | SearchIndexWorkMode::AppendCodex { offset, .. } => {
                source.size.saturating_sub(*offset)
            }
        };
        codex_work_by_path.insert(path, mode);
    }

    let deleted_entries: Vec<SearchIndexManifestEntry> = if full_rebuild {
        Vec::new()
    } else {
        previous_by_path
            .values()
            .filter(|entry| !current_paths.contains(&entry.path))
            .cloned()
            .collect()
    };
    let changed_sessions =
        claude_work_by_path.len() + codex_work_by_path.len() + deleted_entries.len();
    if full_rebuild {
        status.total_sessions = changed_sessions;
        status.total_messages = 0;
        status.total_bytes = work_bytes;
    } else {
        // An incremental pass indexes a handful of changed sessions, so its own
        // ratios are meaningless and would restart on every pass. Keep counters
        // pinned to the published corpus — `emit_search_index_status` clamps the
        // in-flight increments to these totals — and let the pass show up purely
        // as activity. The numbers then step once, when the pass commits.
        status.total_sessions = baseline_sessions;
        status.processed_sessions = baseline_sessions;
        status.total_messages = baseline_messages;
        status.total_bytes = baseline_bytes;
        status.processed_bytes = baseline_bytes;
    }
    status.current_title = None;
    status.updated_at = Some(now_secs());

    if build_dir.exists() {
        fs::remove_dir_all(&build_dir).map_err(|e| e.to_string())?;
    }

    if !full_rebuild && changed_sessions == 0 {
        ensure_search_index_loaded()?;
        final_manifest_entries.sort();
        let (corpus_sessions, corpus_messages, corpus_bytes) =
            manifest_totals(&final_manifest_entries);
        status.state = "ready".to_string();
        status.total_sessions = corpus_sessions;
        status.processed_sessions = corpus_sessions;
        status.total_messages = corpus_messages;
        status.processed_messages = corpus_messages;
        status.indexed_messages = corpus_messages;
        status.total_bytes = corpus_bytes;
        status.processed_bytes = corpus_bytes;
        status.skipped_sessions = 0;
        status.current_session_id = None;
        status.current_title = None;
        status.current_project_path = None;
        status.index_size_bytes = search_index_dir_size();
        status.completed_at = Some(now_secs());
        status.updated_at = status.completed_at;
        emit_search_index_status(app.as_ref(), status);
        return Ok(0);
    }

    emit_search_index_status(app.as_ref(), status.clone());

    let (index, schema) = if full_rebuild {
        fs::create_dir_all(&build_dir).map_err(|e| e.to_string())?;
        let schema = create_schema();
        let index = Index::create_in_dir(&build_dir, schema.clone()).map_err(|e| e.to_string())?;
        (index, schema)
    } else {
        let index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
        let schema = index.schema();
        if !search_index_schema_is_current(&schema) {
            return Err("Search index schema is outdated. Rebuild required.".to_string());
        }
        (index, schema)
    };

    // Register jieba tokenizer for Chinese support
    register_jieba_tokenizer(&index);

    let mut index_writer: IndexWriter = index
        .writer(50_000_000) // 50MB heap
        .map_err(|e| e.to_string())?;
    if !full_rebuild {
        // Incremental session updates should publish quickly. Tantivy's
        // default policy can start four expensive merge workers for every
        // append, and those workers may outlive the writer while a trailing
        // pass is queued. Keep the update append-only; the next explicit full
        // rebuild can compact the accumulated segments off the hot path.
        index_writer.set_merge_policy(Box::new(tantivy::indexer::NoMergePolicy));
    }

    let uuid_field = schema.get_field("uuid").unwrap();
    let content_field = schema.get_field("content").unwrap();
    let title_field = schema.get_field("title").unwrap();
    let summary_field = schema.get_field("summary").unwrap();
    let last_prompt_field = schema.get_field("last_prompt").unwrap();
    let prompt_field = schema.get_field("prompt").unwrap();
    let user_field = schema.get_field("user").unwrap();
    let assistant_field = schema.get_field("assistant").unwrap();
    let project_field = schema.get_field("project").unwrap();
    let role_field = schema.get_field("role").unwrap();
    let project_id_field = schema.get_field("project_id").unwrap();
    let project_path_field = schema.get_field("project_path").unwrap();
    let session_id_field = schema.get_field("session_id").unwrap();
    let source_path_field = schema.get_field("source_path").unwrap();
    let session_summary_field = schema.get_field("session_summary").unwrap();
    let timestamp_field = schema.get_field("timestamp").unwrap();
    let line_number_field = schema.get_field("line_number").unwrap();
    let round_index_field = schema.get_field("round_index").unwrap();
    let round_prompt_field = schema.get_field("round_prompt").unwrap();
    let round_timestamp_field = schema.get_field("round_timestamp").unwrap();
    let mut last_progress_emit_at = std::time::Instant::now();

    if !full_rebuild {
        for entry in deleted_entries.iter() {
            index_writer.delete_term(Term::from_field_text(source_path_field, &entry.path));
            status.processed_sessions += 1;
            status.current_session_id = Some(entry.session_id.clone());
            status.current_title = None;
            status.current_project_path = Some(entry.path.clone());
            status.updated_at = Some(now_secs());
            emit_search_index_status(app.as_ref(), status.clone());
        }
        for (path, mode) in claude_work_by_path.iter() {
            if mode.should_delete_existing_docs() {
                index_writer.delete_term(Term::from_field_text(source_path_field, path));
            }
        }
        for (path, mode) in codex_work_by_path.iter() {
            if mode.should_delete_existing_docs() {
                index_writer.delete_term(Term::from_field_text(source_path_field, path));
            }
        }
    }

    for (source, source_path, work_mode) in claude_sources.iter().filter_map(|source| {
        let source_path = source_path_key(&source.path);
        claude_work_by_path
            .get(&source_path)
            .cloned()
            .map(|work_mode| (source, source_path, work_mode))
    }) {
        let session_head = read_session_head(&source.path, 0);
        let session_title = session_head.title.unwrap_or_default();
        let session_last_prompt = session_head.last_prompt.unwrap_or_default();
        let (
            file_content,
            base_line_count,
            mut session_message_count,
            mut round_index,
            mut round_prompt,
            mut round_timestamp,
            session_work_bytes,
        ) = match &work_mode {
            SearchIndexWorkMode::Reindex => (
                fs::read_to_string(&source.path).unwrap_or_default(),
                0usize,
                0usize,
                0usize,
                String::new(),
                String::new(),
                source.size,
            ),
            SearchIndexWorkMode::AppendClaude {
                offset,
                base_line_count,
                base_message_count,
                base_round_index,
                base_round_prompt,
                base_round_timestamp,
            } => (
                read_file_suffix(&source.path, *offset)?,
                *base_line_count,
                *base_message_count,
                *base_round_index,
                base_round_prompt.clone(),
                base_round_timestamp.clone(),
                source.size.saturating_sub(*offset),
            ),
            SearchIndexWorkMode::AppendCodex { .. } => {
                return Err("Codex append mode was assigned to a Claude source".to_string())
            }
        };
        let session_start_bytes = status.processed_bytes;
        let mut session_bytes_seen = 0u64;
        let mut line_count = base_line_count;

        let mut session_summary: Option<String> = session_head.summary;

        if session_summary.is_none() {
            for line in file_content.lines() {
                if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                    if parsed.line_type.as_deref() == Some("summary") {
                        session_summary = parsed.summary;
                        break;
                    }
                }
            }
        }

        for (line_idx, line) in file_content.lines().enumerate() {
            line_count = base_line_count + line_idx + 1;
            session_bytes_seen =
                (session_bytes_seen + line.len() as u64 + 1).min(session_work_bytes);
            if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                let line_type = parsed.line_type.as_deref();

                let is_msg_line = matches!(
                    line_type,
                    Some("user") | Some("assistant") | Some("message")
                );
                if is_msg_line {
                    if let Some(msg) = &parsed.message {
                        let role = msg.role.clone().unwrap_or_default();
                        if role == "user" || role == "assistant" {
                            let is_meta = parsed.is_meta.unwrap_or(false);
                            let timestamp = parsed.timestamp.clone().unwrap_or_default();
                            let base_uuid = parsed.uuid.clone().unwrap_or_default();
                            let mut run_started_in_record = false;
                            for unit in search_message_units(&base_uuid, &msg.content) {
                                let text_content = unit.content;
                                let is_tool = unit.is_tool;
                                let is_user_prompt =
                                    is_user_prompt_content(&role, is_tool, &text_content);
                                let display_role =
                                    search_display_role(&role, is_tool, &text_content);
                                if !is_meta
                                    && is_user_prompt
                                    && !run_started_in_record
                                    && !text_content.is_empty()
                                {
                                    run_started_in_record = true;
                                    round_index += 1;
                                    round_prompt = text_content.clone();
                                    round_timestamp = timestamp.clone();
                                }

                                if !is_meta
                                    && !text_content.is_empty()
                                    && !(role == "assistant"
                                        && is_no_response_placeholder(&text_content))
                                {
                                    let prompt_text = if is_user_prompt {
                                        text_content.clone()
                                    } else {
                                        String::new()
                                    };
                                    let assistant_text = if display_role == "assistant" {
                                        text_content.clone()
                                    } else {
                                        String::new()
                                    };
                                    let summary_text = session_summary.clone().unwrap_or_default();

                                    index_writer
                                        .add_document(doc!(
                                            uuid_field => unit.uuid,
                                            content_field => text_content.clone(),
                                            title_field => session_title.clone(),
                                            summary_field => summary_text.clone(),
                                            last_prompt_field => session_last_prompt.clone(),
                                            prompt_field => prompt_text.clone(),
                                            user_field => prompt_text,
                                            assistant_field => assistant_text,
                                            project_field => source.display_path.clone(),
                                            role_field => display_role,
                                            project_id_field => source.project_id.clone(),
                                            project_path_field => source.display_path.clone(),
                                            session_id_field => source.session_id.clone(),
                                            source_path_field => source_path.clone(),
                                            session_summary_field => summary_text,
                                            timestamp_field => timestamp.clone(),
                                            line_number_field => line_count as u64,
                                            round_index_field => round_index as u64,
                                            round_prompt_field => round_prompt.clone(),
                                            round_timestamp_field => round_timestamp.clone(),
                                        ))
                                        .map_err(|e| e.to_string())?;

                                    session_message_count += 1;
                                    status.processed_bytes =
                                        session_start_bytes + session_bytes_seen;
                                    update_search_index_message_progress(
                                        app.as_ref(),
                                        &mut status,
                                        Some(source.session_id.clone()),
                                        Some(session_title.clone()),
                                        Some(source.display_path.clone()),
                                        false,
                                        &mut last_progress_emit_at,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        status.processed_bytes = session_start_bytes + session_work_bytes;
        final_manifest_entries.push(SearchIndexManifestEntry {
            path: source_path.clone(),
            source_kind: SearchIndexSourceKind::Claude.as_str().to_string(),
            session_id: source.session_id.clone(),
            size: source.size,
            mtime: source.mtime,
            indexed_size: source.size,
            line_count,
            message_count: session_message_count,
            round_index,
            round_prompt,
            round_timestamp,
        });
        update_search_index_progress(
            app.as_ref(),
            &mut status,
            Some(source.session_id.clone()),
            Some(session_title),
            Some(source.display_path.clone()),
        );
    }

    for (source, source_path, work_mode) in codex_sources.iter().filter_map(|source| {
        let source_path = source_path_key(&source.path);
        codex_work_by_path
            .get(&source_path)
            .cloned()
            .map(|work_mode| (source, source_path, work_mode))
    }) {
        let codex_path = &source.path;
        let session_start_bytes = status.processed_bytes;
        let session_work_bytes = match &work_mode {
            SearchIndexWorkMode::Reindex => source.size,
            SearchIndexWorkMode::AppendCodex { offset, .. } => source.size.saturating_sub(*offset),
            SearchIndexWorkMode::AppendClaude { .. } => {
                return Err("Claude append mode was assigned to a Codex source".to_string())
            }
        };
        let session = match &work_mode {
            SearchIndexWorkMode::AppendCodex { .. } => build_codex_session_lightweight(codex_path),
            SearchIndexWorkMode::Reindex => build_codex_session(codex_path),
            SearchIndexWorkMode::AppendClaude { .. } => None,
        };
        let Some(session) = session else {
            status.skipped_sessions += 1;
            status.processed_bytes = session_start_bytes + session_work_bytes;
            update_search_index_progress(
                app.as_ref(),
                &mut status,
                Some(source.session_id.clone()),
                None,
                None,
            );
            continue;
        };
        let (
            messages,
            mut round_index,
            mut round_prompt,
            mut round_timestamp,
            mut session_message_count,
            mut line_count,
        ) = match &work_mode {
            SearchIndexWorkMode::Reindex => (
                parse_codex_rollout_messages(codex_path)?,
                0usize,
                String::new(),
                String::new(),
                0usize,
                0usize,
            ),
            SearchIndexWorkMode::AppendCodex {
                offset,
                base_line_count,
                base_message_count,
                base_round_index,
                base_round_prompt,
                base_round_timestamp,
            } => (
                parse_codex_rollout_messages_from_offset(codex_path, *offset, *base_line_count)?,
                *base_round_index,
                base_round_prompt.clone(),
                base_round_timestamp.clone(),
                *base_message_count,
                *base_line_count,
            ),
            SearchIndexWorkMode::AppendClaude { .. } => {
                return Err("Claude append mode was assigned to a Codex source".to_string())
            }
        };
        let base_message_count = session_message_count;
        let is_codex_append = matches!(&work_mode, SearchIndexWorkMode::AppendCodex { .. });
        let project_path = session.project_path.clone().unwrap_or_default();
        let session_title = session.title.clone().unwrap_or_default();
        let session_last_prompt = if is_codex_append && !round_prompt.is_empty() {
            round_prompt.clone()
        } else {
            session.last_prompt.clone().unwrap_or_default()
        };
        let session_summary = session
            .title
            .clone()
            .or_else(|| Some(session_last_prompt.clone()).filter(|value| !value.is_empty()))
            .unwrap_or_default();
        let parsed_message_total = messages.len().max(1) as u64;

        let mut last_prompt_line = None;
        for message in messages {
            if message.is_meta || message.content.trim().is_empty() {
                continue;
            }
            let is_user_prompt =
                is_user_prompt_content(&message.role, message.is_tool, &message.content);
            let display_role =
                search_display_role(&message.role, message.is_tool, &message.content);
            if is_user_prompt && !message.is_meta && last_prompt_line != Some(message.line_number) {
                last_prompt_line = Some(message.line_number);
                round_index += 1;
                round_prompt = message.content.clone();
                round_timestamp = message.timestamp.clone();
            }
            let prompt_text = if is_user_prompt {
                message.content.clone()
            } else {
                String::new()
            };
            let assistant_text = if display_role == "assistant" {
                message.content.clone()
            } else {
                String::new()
            };
            session_message_count += 1;
            line_count = line_count.max(message.line_number);
            let new_message_count = session_message_count.saturating_sub(base_message_count) as u64;
            let document_last_prompt = if is_codex_append && !round_prompt.is_empty() {
                round_prompt.clone()
            } else {
                session_last_prompt.clone()
            };

            index_writer
                .add_document(doc!(
                    uuid_field => message.uuid,
                    content_field => message.content,
                    title_field => session_title.clone(),
                    summary_field => session_summary.clone(),
                    last_prompt_field => document_last_prompt,
                    prompt_field => prompt_text.clone(),
                    user_field => prompt_text,
                    assistant_field => assistant_text,
                    project_field => project_path.clone(),
                    role_field => display_role,
                    project_id_field => session.project_id.clone(),
                    project_path_field => project_path.clone(),
                    session_id_field => session.id.clone(),
                    source_path_field => source_path.clone(),
                    session_summary_field => session_summary.clone(),
                    timestamp_field => message.timestamp,
                    line_number_field => message.line_number as u64,
                    round_index_field => round_index as u64,
                    round_prompt_field => round_prompt.clone(),
                    round_timestamp_field => round_timestamp.clone(),
                ))
                .map_err(|e| e.to_string())?;

            status.processed_bytes = session_start_bytes
                + ((new_message_count * session_work_bytes) / parsed_message_total)
                    .min(session_work_bytes);
            update_search_index_message_progress(
                app.as_ref(),
                &mut status,
                Some(source.session_id.clone()),
                session.title.clone(),
                session.project_path.clone(),
                false,
                &mut last_progress_emit_at,
            );
        }
        status.processed_bytes = session_start_bytes + session_work_bytes;
        final_manifest_entries.push(SearchIndexManifestEntry {
            path: source_path.clone(),
            source_kind: SearchIndexSourceKind::Codex.as_str().to_string(),
            session_id: source.session_id.clone(),
            size: source.size,
            mtime: source.mtime,
            indexed_size: source.size,
            line_count,
            message_count: session_message_count,
            round_index,
            round_prompt,
            round_timestamp,
        });
        update_search_index_progress(
            app.as_ref(),
            &mut status,
            Some(source.session_id.clone()),
            session.title.clone(),
            session.project_path.clone(),
        );
    }

    index_writer.commit().map_err(|e| e.to_string())?;
    // End the writer before swapping the in-memory reader and before a
    // coalesced trailing pass can start. This releases Tantivy's directory
    // lock and stops its worker pools at the narrowest possible boundary.
    drop(index_writer);
    let indexed_count = status.indexed_messages;

    let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;
    let final_index = if full_rebuild {
        if index_dir.exists() {
            fs::remove_dir_all(&index_dir).map_err(|e| e.to_string())?;
        }
        fs::rename(&build_dir, &index_dir).map_err(|e| e.to_string())?;
        Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?
    } else {
        Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?
    };
    register_jieba_tokenizer(&final_index);
    let final_schema = final_index.schema();

    // Store search index in global state
    *guard = Some(SearchIndex {
        index: final_index,
        schema: final_schema,
    });

    final_manifest_entries.sort();
    let (corpus_sessions, corpus_messages, corpus_bytes) = manifest_totals(&final_manifest_entries);
    save_search_index_manifest(final_manifest_entries)?;

    status.state = "ready".to_string();
    status.search_available = true;
    status.total_sessions = corpus_sessions;
    status.processed_sessions = corpus_sessions;
    status.total_messages = corpus_messages;
    status.processed_messages = corpus_messages;
    status.indexed_messages = corpus_messages;
    status.total_bytes = corpus_bytes;
    status.processed_bytes = corpus_bytes;
    status.index_size_bytes = search_index_dir_size();
    status.current_session_id = None;
    status.current_title = None;
    status.current_project_path = None;
    status.completed_at = Some(now_secs());
    status.updated_at = status.completed_at;
    emit_search_index_status(app.as_ref(), status);

    Ok(indexed_count)
}

fn tokenize_search_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for ch in query.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }

        if ch == '\\' {
            current.push(ch);
            escaped = true;
            continue;
        }

        if matches!(ch, '"' | '\'') {
            current.push(ch);
            quote = match quote {
                Some(open) if open == ch => None,
                None => Some(ch),
                other => other,
            };
            continue;
        }

        if quote.is_none() && matches!(ch, '(' | ')') {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            tokens.push(ch.to_string());
            continue;
        }

        if ch.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn split_search_qualifier(token: &str) -> Option<(&str, &str)> {
    let colon = token.find(':')?;
    if colon == 0 || colon + 1 >= token.len() {
        return None;
    }

    let field = &token[..colon];
    if !field
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }

    Some((field, &token[colon + 1..]))
}

fn normalize_scope_name(scope: &str) -> String {
    scope
        .chars()
        .filter(|ch| *ch != '_' && *ch != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

fn canonical_search_field_name(scope: &str) -> Option<&'static str> {
    Some(match normalize_scope_name(scope).as_str() {
        "content" | "body" | "message" | "messages" | "text" | "turn" => "content",
        "title" | "name" => "title",
        "summary" => "summary",
        "lastprompt" | "latestprompt" => "last_prompt",
        "run" | "runprompt" | "round" | "roundprompt" => "round_prompt",
        "prompt" | "prompts" | "user" | "userprompt" | "userprompts" | "question" => "prompt",
        "ai" | "assistant" | "answer" | "response" | "reply" => "assistant",
        "project" | "projectpath" | "path" | "cwd" | "directory" => "project",
        "id" | "session" | "sessionid" => "session_id",
        "uuid" => "uuid",
        "role" => "role",
        _ => return None,
    })
}

fn canonical_search_field(scope: &str, schema: &Schema) -> Option<&'static str> {
    let field = canonical_search_field_name(scope)?;
    schema.get_field(field).ok().map(|_| field)
}

fn push_unique_scope(scopes: &mut Vec<&'static str>, scope: &'static str) {
    if !scopes.contains(&scope) {
        scopes.push(scope);
    }
}

fn normalize_query_operator(token: &str) -> Option<&'static str> {
    match token {
        "AND" | "&&" => Some("AND"),
        "OR" | "|" | "||" => Some("OR"),
        "NOT" => Some("NOT"),
        _ => None,
    }
}

fn split_occur_prefix(token: &str) -> (&str, &str) {
    match token.as_bytes().first().copied() {
        Some(b'+') | Some(b'-') if token.len() > 1 => (&token[..1], &token[1..]),
        _ => ("", token),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LiteralSearchTermKind {
    Flexible,
    Phrase,
    Identifier,
}

#[derive(Clone, Debug)]
struct LiteralSearchTerm {
    field: Option<&'static str>,
    text: String,
    kind: LiteralSearchTermKind,
}

#[derive(Clone, Debug)]
enum LiteralSearchExpression {
    Term(LiteralSearchTerm),
    And(Vec<LiteralSearchExpression>),
    Or(Vec<LiteralSearchExpression>),
    Not(Box<LiteralSearchExpression>),
}

#[derive(Clone, Debug)]
struct LiteralSearchQuery {
    expression: Option<LiteralSearchExpression>,
    default_fields: Vec<&'static str>,
}

fn combine_literal_expression(
    conjunction: bool,
    children: Vec<Option<LiteralSearchExpression>>,
) -> Option<LiteralSearchExpression> {
    let mut compact = children.into_iter().flatten().collect::<Vec<_>>();
    match compact.len() {
        0 => None,
        1 => compact.pop(),
        _ if conjunction => Some(LiteralSearchExpression::And(compact)),
        _ => Some(LiteralSearchExpression::Or(compact)),
    }
}

fn negate_literal_expression(
    expression: Option<LiteralSearchExpression>,
) -> Option<LiteralSearchExpression> {
    match expression {
        Some(LiteralSearchExpression::Not(child)) => Some(*child),
        Some(child) => Some(LiteralSearchExpression::Not(Box::new(child))),
        None => None,
    }
}

fn strip_literal_search_value(value: &str) -> Option<(String, bool)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let bytes = trimmed.as_bytes();
    let quoted = bytes.len() >= 2
        && matches!(bytes[0], b'"' | b'\'')
        && bytes.last().copied() == Some(bytes[0]);
    let text = if quoted {
        trimmed[1..trimmed.len() - 1].trim()
    } else {
        trimmed
    };
    (!text.is_empty()).then(|| (text.to_string(), quoted))
}

fn literal_search_term_kind(text: &str, quoted: bool) -> LiteralSearchTermKind {
    if text.contains('_') || text.contains('-') {
        LiteralSearchTermKind::Identifier
    } else if quoted {
        LiteralSearchTermKind::Phrase
    } else {
        LiteralSearchTermKind::Flexible
    }
}

fn parse_literal_search_term(
    token: &str,
    group_field: Option<&'static str>,
) -> Option<LiteralSearchExpression> {
    let (occur, value) = split_occur_prefix(token);
    let mut field = group_field;
    let mut raw_value = value;

    if let Some((candidate_field, candidate_value)) = split_search_qualifier(value) {
        if normalize_scope_name(candidate_field) == "in" {
            return None;
        }
        if let Some(canonical) = canonical_search_field_name(candidate_field) {
            field = Some(canonical);
            raw_value = candidate_value;
        }
    }

    if normalize_query_operator(raw_value).is_some() {
        return None;
    }

    let (text, quoted) = strip_literal_search_value(raw_value)?;
    let expression = LiteralSearchExpression::Term(LiteralSearchTerm {
        field,
        kind: literal_search_term_kind(&text, quoted),
        text,
    });

    if occur == "-" {
        negate_literal_expression(Some(expression))
    } else {
        Some(expression)
    }
}

fn literal_scoped_group_token(token: &str) -> Option<(&'static str, bool)> {
    let (occur, value) = split_occur_prefix(token);
    let field = value.strip_suffix(':')?;
    canonical_search_field_name(field).map(|field| (field, occur == "-"))
}

struct LiteralSearchExpressionParser {
    tokens: Vec<String>,
    index: usize,
}

impl LiteralSearchExpressionParser {
    fn new(tokens: Vec<String>) -> Self {
        Self { tokens, index: 0 }
    }

    fn parse(&mut self) -> Option<LiteralSearchExpression> {
        self.parse_or(None)
    }

    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.index).map(String::as_str)
    }

    fn advance(&mut self) -> Option<String> {
        let token = self.tokens.get(self.index)?.clone();
        self.index += 1;
        Some(token)
    }

    fn match_operator(&mut self, operator: &str) -> bool {
        if self.peek().and_then(normalize_query_operator) != Some(operator) {
            return false;
        }
        self.index += 1;
        true
    }

    fn parse_or(&mut self, group_field: Option<&'static str>) -> Option<LiteralSearchExpression> {
        let mut children = vec![self.parse_and(group_field)];
        while self.match_operator("OR") {
            children.push(self.parse_and(group_field));
        }
        combine_literal_expression(false, children)
    }

    fn parse_and(&mut self, group_field: Option<&'static str>) -> Option<LiteralSearchExpression> {
        let mut children = Vec::new();
        while let Some(token) = self.peek() {
            if token == ")" || normalize_query_operator(token) == Some("OR") {
                break;
            }
            if self.match_operator("AND") {
                continue;
            }
            children.push(self.parse_unary(group_field));
        }
        combine_literal_expression(true, children)
    }

    fn parse_unary(
        &mut self,
        group_field: Option<&'static str>,
    ) -> Option<LiteralSearchExpression> {
        if self.match_operator("NOT") {
            return negate_literal_expression(self.parse_unary(group_field));
        }
        if self.peek() == Some("-") {
            self.index += 1;
            return negate_literal_expression(self.parse_unary(group_field));
        }
        if self.peek() == Some("+") {
            self.index += 1;
            return self.parse_unary(group_field);
        }
        self.parse_primary(group_field)
    }

    fn parse_primary(
        &mut self,
        group_field: Option<&'static str>,
    ) -> Option<LiteralSearchExpression> {
        let token = self.peek()?.to_string();

        if let Some((field, negated)) = literal_scoped_group_token(&token) {
            if self.tokens.get(self.index + 1).map(String::as_str) == Some("(") {
                self.index += 2;
                let expression = self.parse_or(Some(field));
                if self.peek() == Some(")") {
                    self.index += 1;
                }
                return if negated {
                    negate_literal_expression(expression)
                } else {
                    expression
                };
            }
        }

        if token == "(" {
            self.index += 1;
            let expression = self.parse_or(group_field);
            if self.peek() == Some(")") {
                self.index += 1;
            }
            return expression;
        }
        if token == ")" {
            return None;
        }

        parse_literal_search_term(&self.advance()?, group_field)
    }
}

fn is_default_scope_directive(token: &str) -> bool {
    split_search_qualifier(token).is_some_and(|(field, _)| normalize_scope_name(field) == "in")
}

fn parse_literal_search_query(query: &str) -> LiteralSearchQuery {
    let tokens = tokenize_search_query(query);
    let mut default_fields = Vec::new();

    for token in &tokens {
        let Some((field, value)) = split_search_qualifier(token) else {
            continue;
        };
        if normalize_scope_name(field) != "in" {
            continue;
        }
        for scope in value.split(',') {
            if let Some(field) = canonical_search_field_name(scope.trim()) {
                push_unique_scope(&mut default_fields, field);
            }
        }
    }

    let expression_tokens = tokens
        .into_iter()
        .filter(|token| !is_default_scope_directive(token))
        .collect::<Vec<_>>();
    let expression = LiteralSearchExpressionParser::new(expression_tokens).parse();
    LiteralSearchQuery {
        expression,
        default_fields,
    }
}

fn literal_expression_has_constraints(expression: &LiteralSearchExpression) -> bool {
    match expression {
        LiteralSearchExpression::Term(term) => term.kind != LiteralSearchTermKind::Flexible,
        LiteralSearchExpression::Not(child) => literal_expression_has_constraints(child),
        LiteralSearchExpression::And(children) | LiteralSearchExpression::Or(children) => {
            children.iter().any(literal_expression_has_constraints)
        }
    }
}

fn collect_positive_literal_terms(
    expression: &LiteralSearchExpression,
    positive: bool,
    terms: &mut Vec<String>,
) {
    match expression {
        LiteralSearchExpression::Term(term) if positive => terms.push(term.text.clone()),
        LiteralSearchExpression::Term(_) => {}
        LiteralSearchExpression::Not(child) => {
            collect_positive_literal_terms(child, !positive, terms)
        }
        LiteralSearchExpression::And(children) | LiteralSearchExpression::Or(children) => {
            for child in children {
                collect_positive_literal_terms(child, positive, terms);
            }
        }
    }
}

pub(crate) fn search_display_terms(query: &str) -> Vec<String> {
    let parsed = parse_literal_search_query(query);
    let mut candidates = Vec::new();
    if let Some(expression) = parsed.expression.as_ref() {
        collect_positive_literal_terms(expression, true, &mut candidates);
    }

    let mut seen = HashSet::new();
    let mut terms = candidates
        .into_iter()
        .filter(|term| seen.insert(term.to_lowercase()))
        .collect::<Vec<_>>();
    terms.sort_by_key(|term| std::cmp::Reverse(term.chars().count()));
    terms.truncate(12);
    terms
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LiteralMatchState {
    Match,
    Miss,
}

fn invert_literal_match_state(state: LiteralMatchState) -> LiteralMatchState {
    match state {
        LiteralMatchState::Match => LiteralMatchState::Miss,
        LiteralMatchState::Miss => LiteralMatchState::Match,
    }
}

fn contains_complete_identifier(value: &str, identifier: &str) -> bool {
    let value = value.to_lowercase();
    let identifier = identifier.to_lowercase();
    value.match_indices(&identifier).any(|(start, matched)| {
        let before = value[..start].chars().next_back();
        let after = value[start + matched.len()..].chars().next();
        let is_identifier_char =
            |character: char| character.is_alphanumeric() || matches!(character, '_' | '-');
        before.is_none_or(|character| !is_identifier_char(character))
            && after.is_none_or(|character| !is_identifier_char(character))
    })
}

fn contains_literal_phrase(value: &str, phrase: &str) -> bool {
    let normalized_value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized_phrase = phrase.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized_value
        .to_lowercase()
        .contains(&normalized_phrase.to_lowercase())
}

fn contains_flexible_search_term(value: &str, term: &str) -> bool {
    let value = value.to_lowercase();
    let term = term.to_lowercase();
    if term.is_empty() {
        return false;
    }

    value.match_indices(&term).any(|(start, matched)| {
        if !term.chars().all(char::is_alphanumeric) {
            return true;
        }
        let before = value[..start].chars().next_back();
        let after = value[start + matched.len()..].chars().next();
        before.is_none_or(|character| !character.is_alphanumeric())
            && after.is_none_or(|character| !character.is_alphanumeric())
    })
}

fn literal_value_matches(value: &str, term: &LiteralSearchTerm) -> bool {
    match term.kind {
        LiteralSearchTermKind::Identifier => contains_complete_identifier(value, &term.text),
        LiteralSearchTermKind::Phrase => contains_literal_phrase(value, &term.text),
        LiteralSearchTermKind::Flexible => contains_flexible_search_term(value, &term.text),
    }
}

fn literal_field_matches(result: &SearchResult, field: &str, term: &LiteralSearchTerm) -> bool {
    match field {
        "content" => literal_value_matches(&result.content, term),
        "title" => result
            .title
            .as_deref()
            .is_some_and(|value| literal_value_matches(value, term)),
        "summary" => result
            .summary
            .as_deref()
            .into_iter()
            .chain(result.session_summary.as_deref())
            .any(|value| literal_value_matches(value, term)),
        "last_prompt" => result
            .last_prompt
            .as_deref()
            .is_some_and(|value| literal_value_matches(value, term)),
        "round_prompt" => result
            .round_prompt
            .as_deref()
            .is_some_and(|value| literal_value_matches(value, term)),
        "prompt" | "user" => {
            result.role.eq_ignore_ascii_case("user") && literal_value_matches(&result.content, term)
        }
        "assistant" => {
            result.role.eq_ignore_ascii_case("assistant")
                && literal_value_matches(&result.content, term)
        }
        "project" => {
            literal_value_matches(&result.project_path, term)
                || literal_value_matches(&result.project_id, term)
        }
        "session_id" => literal_value_matches(&result.session_id, term),
        "uuid" => literal_value_matches(&result.uuid, term),
        "role" => literal_value_matches(&result.role, term),
        _ => false,
    }
}

fn evaluate_literal_search_expression(
    result: &SearchResult,
    expression: &LiteralSearchExpression,
    default_fields: &[&'static str],
) -> LiteralMatchState {
    match expression {
        LiteralSearchExpression::Term(term) => {
            let fields = term.field.map(|field| vec![field]).unwrap_or_else(|| {
                if default_fields.is_empty() {
                    vec!["content"]
                } else {
                    default_fields.to_vec()
                }
            });
            if fields
                .iter()
                .any(|field| literal_field_matches(result, field, term))
            {
                LiteralMatchState::Match
            } else {
                LiteralMatchState::Miss
            }
        }
        LiteralSearchExpression::Not(child) => invert_literal_match_state(
            evaluate_literal_search_expression(result, child, default_fields),
        ),
        LiteralSearchExpression::And(children) => {
            let states = children
                .iter()
                .map(|child| evaluate_literal_search_expression(result, child, default_fields))
                .collect::<Vec<_>>();
            if states.contains(&LiteralMatchState::Miss) {
                LiteralMatchState::Miss
            } else {
                LiteralMatchState::Match
            }
        }
        LiteralSearchExpression::Or(children) => {
            let states = children
                .iter()
                .map(|child| evaluate_literal_search_expression(result, child, default_fields))
                .collect::<Vec<_>>();
            if states.contains(&LiteralMatchState::Match) {
                LiteralMatchState::Match
            } else {
                LiteralMatchState::Miss
            }
        }
    }
}

fn search_result_satisfies_literal_query(
    result: &SearchResult,
    query: &LiteralSearchQuery,
) -> bool {
    query.expression.as_ref().is_none_or(|expression| {
        evaluate_literal_search_expression(result, expression, &query.default_fields)
            != LiteralMatchState::Miss
    })
}

fn scoped_group_token(token: &str, schema: &Schema) -> Option<(String, &'static str)> {
    let (occur, value) = split_occur_prefix(token);
    let field = value.strip_suffix(':')?;
    canonical_search_field(field, schema).map(|scope| (occur.to_string(), scope))
}

fn peel_grouping(token: &str) -> (String, &str, String) {
    let mut start = 0;
    let mut end = token.len();
    let mut prefix = String::new();
    let mut suffix = String::new();

    while start < end && token[start..end].starts_with('(') {
        prefix.push('(');
        start += 1;
    }

    while start < end && token[start..end].ends_with(')') {
        suffix.push(')');
        end -= 1;
    }

    (prefix, &token[start..end], suffix)
}

fn expand_token_for_scopes(token: &str, scopes: &[&'static str]) -> String {
    let (prefix, core, suffix) = peel_grouping(token);
    if core.is_empty() {
        return token.to_string();
    }

    if let Some(operator) = normalize_query_operator(core) {
        return format!("{prefix}{operator}{suffix}");
    }

    if scopes.is_empty() {
        return token.to_string();
    }

    if matches!(core, "+" | "-") {
        return token.to_string();
    }

    let (occur, value) = split_occur_prefix(core);

    if scopes.len() == 1 {
        return format!("{prefix}{occur}{}:{value}{suffix}", scopes[0]);
    }

    let clauses = scopes
        .iter()
        .map(|scope| format!("{scope}:{value}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!("{prefix}{occur}({clauses}){suffix}")
}

fn normalize_search_token(
    token: &str,
    default_scopes: &[&'static str],
    schema: &Schema,
) -> Option<String> {
    let (prefix, core, suffix) = peel_grouping(token);
    if core.is_empty() {
        return Some(token.to_string());
    }

    if matches!(core, "+" | "-") {
        return Some(token.to_string());
    }

    let (occur, value) = split_occur_prefix(core);

    if let Some((field, value)) = split_search_qualifier(value) {
        if normalize_scope_name(field) == "in" {
            return None;
        }
        if let Some(canonical) = canonical_search_field(field, schema) {
            return Some(format!("{prefix}{occur}{canonical}:{value}{suffix}"));
        }
    }

    Some(expand_token_for_scopes(token, default_scopes))
}

fn normalize_search_tokens(
    tokens: &[String],
    index: &mut usize,
    default_scopes: &[&'static str],
    schema: &Schema,
) -> Vec<String> {
    let mut normalized = Vec::new();

    while *index < tokens.len() {
        let token = &tokens[*index];
        if token == ")" {
            *index += 1;
            break;
        }

        if let Some((occur, scope)) = scoped_group_token(token, schema) {
            if tokens.get(*index + 1).map(String::as_str) == Some("(") {
                *index += 2;
                let group_scopes = [scope];
                let inner = normalize_search_tokens(tokens, index, &group_scopes, schema);
                normalized.push(format!("{occur}({})", inner.join(" ")));
                continue;
            }
        }

        if token == "(" {
            *index += 1;
            let inner = normalize_search_tokens(tokens, index, default_scopes, schema);
            normalized.push(format!("({})", inner.join(" ")));
            continue;
        }

        if let Some(value) = normalize_search_token(token, default_scopes, schema) {
            normalized.push(value);
        }
        *index += 1;
    }

    normalized
}

fn normalize_scoped_search_query(query: &str, schema: &Schema) -> String {
    let tokens = tokenize_search_query(query);
    let mut default_scopes = Vec::new();

    for token in &tokens {
        let Some((field, value)) = split_search_qualifier(token) else {
            continue;
        };
        if normalize_scope_name(field) != "in" {
            continue;
        }

        for scope in value.split(',') {
            if let Some(canonical) = canonical_search_field(scope.trim(), schema) {
                push_unique_scope(&mut default_scopes, canonical);
            }
        }
    }

    let mut index = 0;
    let normalized =
        normalize_search_tokens(&tokens, &mut index, &default_scopes, schema).join(" ");

    if normalized.trim().is_empty() {
        query.trim().to_string()
    } else {
        normalized
    }
}

fn loaded_search_index_guard() -> Result<std::sync::MutexGuard<'static, Option<SearchIndex>>, String>
{
    let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;

    if guard.is_none() {
        let index_dir = get_index_dir();
        if !index_dir.exists() {
            return Err("Search index not built. Please build index first.".to_string());
        }

        let index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
        let schema = index.schema();
        register_jieba_tokenizer(&index);
        *guard = Some(SearchIndex { index, schema });
    }

    if guard
        .as_ref()
        .map(|search_index| !search_index_schema_is_current(&search_index.schema))
        .unwrap_or(false)
    {
        *guard = None;
        return Err("Search index schema is outdated. Rebuild required.".to_string());
    }

    Ok(guard)
}

fn configure_search_query_parser(
    search_index: &SearchIndex,
    default_field_names: &[&str],
) -> QueryParser {
    let default_fields = default_field_names
        .iter()
        .filter_map(|name| search_index.schema.get_field(name).ok())
        .collect::<Vec<_>>();

    let mut query_parser = QueryParser::for_index(&search_index.index, default_fields);
    query_parser.set_conjunction_by_default();

    for (field_name, boost) in [
        ("title", 3.0),
        ("summary", 2.4),
        ("last_prompt", 2.2),
        ("prompt", 1.8),
        ("round_prompt", 1.6),
        ("project", 1.3),
        ("assistant", 0.9),
    ] {
        if let Ok(field) = search_index.schema.get_field(field_name) {
            query_parser.set_field_boost(field, boost);
        }
    }

    query_parser
}

fn search_index_documents(
    search_index: &SearchIndex,
    query_text: &str,
    default_field_names: &[&str],
    max_results: usize,
    project_id: Option<&str>,
) -> Result<Vec<SearchResult>, String> {
    let reader = search_index
        .index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
        .map_err(|e: tantivy::TantivyError| e.to_string())?;

    let searcher = reader.searcher();
    let query_parser = configure_search_query_parser(search_index, default_field_names);
    let parsed_query = query_parser
        .parse_query(query_text)
        .map_err(|e| e.to_string())?;
    let scoped_query: Box<dyn tantivy::query::Query> = if let Some(project_id) = project_id {
        let project_id_field = search_index
            .schema
            .get_field("project_id")
            .map_err(|e| e.to_string())?;
        let project_query = tantivy::query::ConstScoreQuery::new(
            Box::new(tantivy::query::TermQuery::new(
                Term::from_field_text(project_id_field, project_id),
                schema::IndexRecordOption::Basic,
            )),
            0.0,
        );
        Box::new(tantivy::query::BooleanQuery::new(vec![
            (tantivy::query::Occur::Must, parsed_query),
            (tantivy::query::Occur::Must, Box::new(project_query)),
        ]))
    } else {
        parsed_query
    };

    let top_docs = searcher
        .search(&scoped_query, &TopDocs::with_limit(max_results))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    for (score, doc_address) in top_docs {
        let retrieved_doc: tantivy::TantivyDocument =
            searcher.doc(doc_address).map_err(|e| e.to_string())?;

        let get_text = |field_name: &str| -> String {
            search_index
                .schema
                .get_field(field_name)
                .ok()
                .and_then(|field| retrieved_doc.get_first(field))
                .and_then(|v| TantivyValue::as_str(&v))
                .unwrap_or("")
                .to_string()
        };
        let get_u64 = |field_name: &str| -> u64 {
            search_index
                .schema
                .get_field(field_name)
                .ok()
                .and_then(|field| retrieved_doc.get_first(field))
                .and_then(|v| TantivyValue::as_u64(&v))
                .unwrap_or(0)
        };

        let doc_project_id = get_text("project_id");

        let summary = get_text("session_summary");
        let title = get_text("title");
        let scoped_summary = get_text("summary");
        let last_prompt = get_text("last_prompt");
        let round_prompt = get_text("round_prompt");
        let round_timestamp = get_text("round_timestamp");

        results.push(SearchResult {
            uuid: get_text("uuid"),
            content: get_text("content"),
            role: get_text("role"),
            line_number: get_u64("line_number") as usize,
            project_id: doc_project_id,
            project_path: get_text("project_path"),
            session_id: get_text("session_id"),
            session_summary: if summary.is_empty() {
                None
            } else {
                Some(summary)
            },
            title: if title.is_empty() { None } else { Some(title) },
            summary: if scoped_summary.is_empty() {
                None
            } else {
                Some(scoped_summary)
            },
            last_prompt: if last_prompt.is_empty() {
                None
            } else {
                Some(last_prompt)
            },
            round_index: get_u64("round_index") as usize,
            round_prompt: if round_prompt.is_empty() {
                None
            } else {
                Some(round_prompt)
            },
            round_timestamp: if round_timestamp.is_empty() {
                None
            } else {
                Some(round_timestamp)
            },
            timestamp: get_text("timestamp"),
            score,
        });
    }

    Ok(results)
}

#[cfg(test)]
mod search_index_documents_tests {
    use super::*;

    #[test]
    fn search_index_build_requests_coalesce_into_one_trailing_pass() {
        let state = std::sync::atomic::AtomicU8::new(SEARCH_INDEX_BUILD_IDLE);

        assert!(mark_search_index_build_requested(&state));
        assert_eq!(
            state.load(std::sync::atomic::Ordering::Acquire),
            SEARCH_INDEX_BUILD_RUNNING
        );

        assert!(!mark_search_index_build_requested(&state));
        assert!(!mark_search_index_build_requested(&state));
        assert_eq!(
            state.load(std::sync::atomic::Ordering::Acquire),
            SEARCH_INDEX_BUILD_PENDING
        );

        assert!(complete_search_index_build_pass(&state));
        assert_eq!(
            state.load(std::sync::atomic::Ordering::Acquire),
            SEARCH_INDEX_BUILD_RUNNING
        );
        assert!(!complete_search_index_build_pass(&state));
        assert_eq!(
            state.load(std::sync::atomic::Ordering::Acquire),
            SEARCH_INDEX_BUILD_IDLE
        );

        assert!(mark_search_index_build_requested(&state));
    }

    #[test]
    fn codex_source_growth_uses_append_mode_and_truncation_reindexes() {
        let previous = SearchIndexManifestEntry {
            path: "/tmp/codex-rollout.jsonl".to_string(),
            source_kind: SearchIndexSourceKind::Codex.as_str().to_string(),
            session_id: "session-1".to_string(),
            size: 100,
            mtime: 10,
            indexed_size: 100,
            line_count: 12,
            message_count: 7,
            round_index: 3,
            round_prompt: "latest prompt".to_string(),
            round_timestamp: "2026-08-10T00:00:00Z".to_string(),
        };
        let grown = CodexSearchSource {
            path: PathBuf::from(&previous.path),
            session_id: previous.session_id.clone(),
            size: 160,
            mtime: 11,
        };

        let mode = codex_append_work_mode(&previous, &grown).expect("append mode");
        match mode {
            SearchIndexWorkMode::AppendCodex {
                offset,
                base_line_count,
                base_message_count,
                base_round_index,
                base_round_prompt,
                base_round_timestamp,
            } => {
                assert_eq!(offset, 100);
                assert_eq!(base_line_count, 12);
                assert_eq!(base_message_count, 7);
                assert_eq!(base_round_index, 3);
                assert_eq!(base_round_prompt, "latest prompt");
                assert_eq!(base_round_timestamp, "2026-08-10T00:00:00Z");
            }
            SearchIndexWorkMode::Reindex | SearchIndexWorkMode::AppendClaude { .. } => {
                panic!("expected Codex append mode")
            }
        }

        let truncated = CodexSearchSource { size: 90, ..grown };
        assert!(codex_append_work_mode(&previous, &truncated).is_none());
    }

    fn add_search_document(
        writer: &mut IndexWriter,
        schema: &Schema,
        uuid: &str,
        content: &str,
        project_id: &str,
    ) {
        writer
            .add_document(doc!(
                schema.get_field("uuid").unwrap() => uuid,
                schema.get_field("content").unwrap() => content,
                schema.get_field("project_id").unwrap() => project_id,
            ))
            .unwrap();
    }

    fn literal_result(content: &str) -> SearchResult {
        SearchResult {
            uuid: "message".to_string(),
            content: content.to_string(),
            role: "assistant".to_string(),
            line_number: 1,
            project_id: "project".to_string(),
            project_path: "/tmp/project".to_string(),
            session_id: "session".to_string(),
            session_summary: None,
            title: None,
            summary: None,
            last_prompt: None,
            round_index: 1,
            round_prompt: None,
            round_timestamp: None,
            timestamp: "2026-08-23T00:00:00Z".to_string(),
            score: 1.0,
        }
    }

    fn satisfies(content: &str, query: &str) -> bool {
        search_result_satisfies_literal_query(
            &literal_result(content),
            &parse_literal_search_query(query),
        )
    }

    #[test]
    fn query_parser_uses_space_as_and_and_preserves_or_and_phrases() {
        let schema = create_schema();
        let index = Index::create_in_ram(schema.clone());
        register_jieba_tokenizer(&index);
        let mut writer = index.writer(15_000_000).unwrap();

        for (uuid, content) in [
            ("both", "alpha gap beta"),
            ("alpha-only", "alpha"),
            ("beta-only", "beta"),
            ("phrase", "alpha beta"),
            ("reverse", "beta alpha"),
        ] {
            add_search_document(&mut writer, &schema, uuid, content, "project");
        }
        writer.commit().unwrap();

        let search_index = SearchIndex { index, schema };
        let ids = |query: &str| {
            search_index_documents(&search_index, query, &["content"], 10, None)
                .unwrap()
                .into_iter()
                .map(|result| result.uuid)
                .collect::<HashSet<_>>()
        };

        assert_eq!(
            ids("alpha beta"),
            HashSet::from([
                "both".to_string(),
                "phrase".to_string(),
                "reverse".to_string(),
            ])
        );
        assert_eq!(ids("alpha OR beta").len(), 5);
        assert_eq!(ids("\"alpha beta\""), HashSet::from(["phrase".to_string()]));
    }

    #[test]
    fn literal_filter_requires_complete_identifiers_and_boolean_combinations() {
        assert!(satisfies(
            "WECHAT_APP_SECRET is configured",
            "WECHAT_APP_SECRET"
        ));
        assert!(!satisfies(
            "wechat AppSecret SECRET_KEY",
            "WECHAT_APP_SECRET"
        ));
        assert!(!satisfies(
            "MY_WECHAT_APP_SECRET_VALUE",
            "WECHAT_APP_SECRET"
        ));
        assert!(satisfies("ego-browser command", "ego-browser"));
        assert!(!satisfies("lov-publish-wechat-article", "wechat-article"));

        assert!(satisfies(
            "WECHAT_APP_SECRET and APP_TOKEN",
            "WECHAT_APP_SECRET APP_TOKEN"
        ));
        assert!(!satisfies(
            "WECHAT_APP_SECRET only",
            "WECHAT_APP_SECRET APP_TOKEN"
        ));
        assert!(satisfies(
            "APP_TOKEN only",
            "WECHAT_APP_SECRET OR APP_TOKEN"
        ));
        assert!(satisfies(
            "ordinary fallback only",
            "WECHAT_APP_SECRET OR fallback"
        ));
        assert!(!satisfies(
            "wechat AppSecret SECRET_KEY",
            "WECHAT_APP_SECRET OR fallback"
        ));
        assert!(satisfies(
            "WECHAT_APP_SECRET is current",
            "WECHAT_APP_SECRET -legacy"
        ));
        assert!(!satisfies(
            "WECHAT_APP_SECRET replaces legacy config",
            "WECHAT_APP_SECRET -legacy"
        ));
        assert!(satisfies("the app\nsecret is present", "\"app secret\""));
    }

    #[test]
    fn display_terms_preserve_phrases_and_skip_exclusions() {
        assert_eq!(
            search_display_terms("wechat AND \"app secret\" OR token -legacy NOT hidden"),
            vec![
                "app secret".to_string(),
                "wechat".to_string(),
                "token".to_string(),
            ]
        );
        assert_eq!(
            search_display_terms("WECHAT_APP_SECRET"),
            vec!["WECHAT_APP_SECRET".to_string()]
        );
    }

    #[test]
    fn project_filter_is_applied_before_top_docs_limit() {
        let schema = create_schema();
        let index = Index::create_in_ram(schema.clone());
        register_jieba_tokenizer(&index);
        let mut writer = index.writer(15_000_000).unwrap();

        add_search_document(
            &mut writer,
            &schema,
            "other-project-hit",
            "needle needle needle needle needle needle",
            "other-project",
        );
        add_search_document(
            &mut writer,
            &schema,
            "target-project-hit",
            "needle",
            "target-project",
        );
        writer.commit().unwrap();

        let search_index = SearchIndex { index, schema };
        let global_results =
            search_index_documents(&search_index, "needle", &["content"], 1, None).unwrap();
        assert_eq!(global_results[0].project_id, "other-project");

        let scoped_results = search_index_documents(
            &search_index,
            "needle",
            &["content"],
            1,
            Some("target-project"),
        )
        .unwrap();
        assert_eq!(scoped_results.len(), 1);
        assert_eq!(scoped_results[0].uuid, "target-project-hit");
        assert_eq!(scoped_results[0].project_id, "target-project");
    }
}

#[tauri::command]
pub(crate) fn search_chats(
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let max_results = limit.unwrap_or(50);
    let guard = loaded_search_index_guard()?;
    let search_index = guard.as_ref().unwrap();
    let literal_query = parse_literal_search_query(&query);
    let has_literal_constraints = literal_query
        .expression
        .as_ref()
        .is_some_and(literal_expression_has_constraints);
    let normalized_query = normalize_scoped_search_query(&query, &search_index.schema);
    let candidate_limit = if has_literal_constraints {
        max_results.saturating_mul(8).clamp(max_results, 2_000)
    } else {
        max_results
    };
    let mut results = search_index_documents(
        search_index,
        &normalized_query,
        &["content"],
        candidate_limit,
        project_id.as_deref(),
    )?;
    if has_literal_constraints {
        results.retain(|result| search_result_satisfies_literal_query(result, &literal_query));
        results.truncate(max_results);
    }
    Ok(results)
}

#[derive(Clone, Debug)]
struct EmbeddingSearchConfig {
    base_url: String,
    api_key: String,
    model: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SemanticSearchStoreKind {
    Sqlite,
}

impl SemanticSearchStoreKind {
    fn as_str(self) -> &'static str {
        "sqlite"
    }
}

#[derive(Clone)]
struct EmbeddingSearchCandidate {
    source_path: String,
    source_kind: String,
    source_size: u64,
    source_mtime: u64,
    text: String,
    result: SearchResult,
}

#[derive(Clone, Serialize, Deserialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
struct EmbeddingSearchSourceManifestEntry {
    path: String,
    source_kind: String,
    session_id: String,
    size: u64,
    mtime: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddingSearchEntry {
    source_path: String,
    source_kind: String,
    source_size: u64,
    source_mtime: u64,
    text: String,
    result: SearchResult,
    vector: Vec<f32>,
}

#[derive(Clone)]
struct EmbeddingSearchIndex {
    entries: Vec<EmbeddingSearchEntry>,
}

#[derive(Deserialize)]
struct EmbeddingApiResponse {
    data: Vec<EmbeddingApiDatum>,
}

#[derive(Deserialize)]
struct EmbeddingApiDatum {
    embedding: Vec<f32>,
    index: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticSearchStatus {
    pub(crate) enabled: bool,
    pub(crate) configured: bool,
    pub(crate) ready: bool,
    pub(crate) model: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) store: String,
    pub(crate) entries: usize,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticSearchInitializationPreview {
    pub(crate) source_sessions: usize,
    pub(crate) sampled_sessions: usize,
    pub(crate) source_bytes: u64,
    pub(crate) candidate_chunks: usize,
    pub(crate) candidate_chars: usize,
    pub(crate) embedding_batches: usize,
}

const EMBEDDING_SEARCH_INDEX_VERSION: u32 = 4;
const DEFAULT_EMBEDDING_SEARCH_STORE_KIND: SemanticSearchStoreKind =
    SemanticSearchStoreKind::Sqlite;
const EMBEDDING_SEARCH_BATCH_SIZE: usize = 32;
const EMBEDDING_SEARCH_MAX_TEXT_CHARS: usize = 2400;
const EMBEDDING_SEARCH_MAX_CHUNKS_PER_SESSION: usize = 160;
const SEMANTIC_PREVIEW_SAMPLE_SIZE: usize = 48;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticSearchSettings {
    enabled: bool,
}

fn semantic_search_settings_path() -> PathBuf {
    get_index_dir()
        .parent()
        .map(|parent| parent.join("semantic-search-settings.json"))
        .unwrap_or_else(|| PathBuf::from("semantic-search-settings.json"))
}

fn load_semantic_search_settings() -> SemanticSearchSettings {
    fs::read_to_string(semantic_search_settings_path())
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn save_semantic_search_settings(settings: &SemanticSearchSettings) -> Result<(), String> {
    let path = semantic_search_settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let value = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, value).map_err(|error| error.to_string())
}

fn embedding_search_store_path() -> PathBuf {
    get_index_dir()
        .parent()
        .map(|parent| parent.join("semantic-search.sqlite"))
        .unwrap_or_else(|| PathBuf::from("semantic-search.sqlite"))
}

fn settings_env_value(settings: &Value, key: &str) -> Option<String> {
    settings
        .get("env")
        .and_then(|env| env.get(key))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn embedding_setting_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let settings = load_json_object_file(&get_claude_settings_path()).ok()?;
            settings_env_value(&settings, key)
        })
}

fn load_embedding_search_config() -> Result<EmbeddingSearchConfig, String> {
    let base_url = embedding_setting_value("LOVCODE_EMBEDDING_BASE_URL")
        .or_else(|| embedding_setting_value("OPENAI_BASE_URL"))
        .or_else(|| {
            embedding_setting_value("OPENAI_API_KEY")
                .map(|_| "https://api.openai.com/v1".to_string())
        });
    let model = embedding_setting_value("LOVCODE_EMBEDDING_MODEL")
        .unwrap_or_else(|| "text-embedding-3-small".to_string());
    let api_key = embedding_setting_value("LOVCODE_EMBEDDING_API_KEY")
        .or_else(|| embedding_setting_value("OPENAI_API_KEY"))
        .unwrap_or_default();
    let Some(base_url) = base_url else {
        return Err(
            "Embedding search is not configured. Set LOVCODE_EMBEDDING_BASE_URL, LOVCODE_EMBEDDING_MODEL, and optionally LOVCODE_EMBEDDING_API_KEY (or use OPENAI_API_KEY)."
                .to_string(),
        );
    };

    Ok(EmbeddingSearchConfig {
        base_url,
        api_key,
        model,
    })
}

fn embedding_api_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/embeddings") {
        trimmed.to_string()
    } else {
        format!("{}/embeddings", trimmed)
    }
}

struct SemanticRagStoreStatus {
    ready: bool,
    entries: usize,
    error: Option<String>,
}

enum SemanticRagStoreAdapter {
    Sqlite(SqliteSemanticRagStore),
}

struct SqliteSemanticRagStore {
    path: PathBuf,
}

impl SqliteSemanticRagStore {
    fn new() -> Self {
        Self {
            path: embedding_search_store_path(),
        }
    }

    fn connect(&self) -> Result<rusqlite::Connection, String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = rusqlite::Connection::open(&self.path)
            .map_err(|e| format!("open semantic search store: {}", e))?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sources (
                path TEXT PRIMARY KEY,
                source_kind TEXT NOT NULL,
                session_id TEXT NOT NULL,
                size INTEGER NOT NULL,
                mtime INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_path TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                source_size INTEGER NOT NULL,
                source_mtime INTEGER NOT NULL,
                session_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                text TEXT NOT NULL,
                result_json TEXT NOT NULL,
                vector BLOB NOT NULL
            );

            CREATE INDEX IF NOT EXISTS entries_session_idx ON entries(session_id);
            CREATE INDEX IF NOT EXISTS entries_project_idx ON entries(project_id);
            "#,
        )
        .map_err(|e| format!("initialize semantic search store: {}", e))?;
        Ok(conn)
    }
}

impl SemanticRagStoreAdapter {
    fn new(_config: &EmbeddingSearchConfig) -> Self {
        Self::Sqlite(SqliteSemanticRagStore::new())
    }

    fn kind(&self) -> SemanticSearchStoreKind {
        SemanticSearchStoreKind::Sqlite
    }

    async fn load_current(
        &self,
        config: &EmbeddingSearchConfig,
        sources: &[EmbeddingSearchSourceManifestEntry],
    ) -> Result<Option<EmbeddingSearchIndex>, String> {
        match self {
            Self::Sqlite(store) => store.load_current(config, sources),
        }
    }

    async fn replace(
        &self,
        config: &EmbeddingSearchConfig,
        dimensions: usize,
        sources: Vec<EmbeddingSearchSourceManifestEntry>,
        entries: Vec<EmbeddingSearchEntry>,
    ) -> Result<EmbeddingSearchIndex, String> {
        match self {
            Self::Sqlite(store) => store.replace(config, dimensions, sources, entries),
        }
    }

    async fn status(&self, config: &EmbeddingSearchConfig) -> SemanticRagStoreStatus {
        match self {
            Self::Sqlite(store) => store.status(config),
        }
    }

    async fn search(
        &self,
        index: &EmbeddingSearchIndex,
        query_vector: &[f32],
        limit: usize,
        project_id: Option<&str>,
    ) -> Result<Vec<SearchResult>, String> {
        match self {
            Self::Sqlite(_) => Ok(rank_embedding_sessions(
                &index.entries,
                query_vector,
                limit,
                project_id,
            )),
        }
    }
}

impl SqliteSemanticRagStore {
    fn load_current(
        &self,
        config: &EmbeddingSearchConfig,
        sources: &[EmbeddingSearchSourceManifestEntry],
    ) -> Result<Option<EmbeddingSearchIndex>, String> {
        let conn = self.connect()?;
        let metadata = load_semantic_store_metadata(&conn)?;
        if !semantic_store_metadata_matches(&metadata, config) {
            return Ok(None);
        }

        let stored_sources = load_semantic_store_sources(&conn)?;
        if stored_sources != sources {
            return Ok(None);
        }

        let dimensions = metadata_usize(&metadata, "dimensions").unwrap_or(0);
        let entries = load_semantic_store_entries(&conn, dimensions)?;
        if entries.is_empty() || dimensions == 0 {
            return Ok(None);
        }

        Ok(Some(EmbeddingSearchIndex { entries }))
    }

    fn replace(
        &self,
        config: &EmbeddingSearchConfig,
        dimensions: usize,
        sources: Vec<EmbeddingSearchSourceManifestEntry>,
        entries: Vec<EmbeddingSearchEntry>,
    ) -> Result<EmbeddingSearchIndex, String> {
        let mut conn = self.connect()?;
        let indexed_at = now_secs();
        let tx = conn
            .transaction()
            .map_err(|e| format!("begin semantic store transaction: {}", e))?;

        tx.execute_batch(
            r#"
            DELETE FROM metadata;
            DELETE FROM sources;
            DELETE FROM entries;
            "#,
        )
        .map_err(|e| format!("clear semantic search store: {}", e))?;

        {
            let mut stmt = tx
                .prepare("INSERT INTO metadata (key, value) VALUES (?1, ?2)")
                .map_err(|e| format!("prepare semantic metadata insert: {}", e))?;
            for (key, value) in [
                ("version", EMBEDDING_SEARCH_INDEX_VERSION.to_string()),
                (
                    "store_kind",
                    SemanticSearchStoreKind::Sqlite.as_str().to_string(),
                ),
                ("base_url", config.base_url.clone()),
                ("model", config.model.clone()),
                ("dimensions", dimensions.to_string()),
                ("indexed_at", indexed_at.to_string()),
            ] {
                stmt.execute(rusqlite::params![key, value])
                    .map_err(|e| format!("write semantic metadata: {}", e))?;
            }
        }

        {
            let mut stmt = tx
                .prepare(
                    r#"
                    INSERT INTO sources (path, source_kind, session_id, size, mtime)
                    VALUES (?1, ?2, ?3, ?4, ?5)
                    "#,
                )
                .map_err(|e| format!("prepare semantic source insert: {}", e))?;
            for source in &sources {
                stmt.execute(rusqlite::params![
                    source.path.as_str(),
                    source.source_kind.as_str(),
                    source.session_id.as_str(),
                    u64_to_sql_i64(source.size),
                    u64_to_sql_i64(source.mtime),
                ])
                .map_err(|e| format!("write semantic source: {}", e))?;
            }
        }

        {
            let mut stmt = tx
                .prepare(
                    r#"
                    INSERT INTO entries (
                        source_path,
                        source_kind,
                        source_size,
                        source_mtime,
                        session_id,
                        project_id,
                        timestamp,
                        text,
                        result_json,
                        vector
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                    "#,
                )
                .map_err(|e| format!("prepare semantic entry insert: {}", e))?;
            for entry in &entries {
                let result_json = serde_json::to_string(&entry.result)
                    .map_err(|e| format!("serialize semantic entry result: {}", e))?;
                stmt.execute(rusqlite::params![
                    entry.source_path.as_str(),
                    entry.source_kind.as_str(),
                    u64_to_sql_i64(entry.source_size),
                    u64_to_sql_i64(entry.source_mtime),
                    entry.result.session_id.as_str(),
                    entry.result.project_id.as_str(),
                    entry.result.timestamp.as_str(),
                    entry.text.as_str(),
                    result_json,
                    encode_embedding_vector(&entry.vector),
                ])
                .map_err(|e| format!("write semantic entry: {}", e))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("commit semantic search store: {}", e))?;

        Ok(EmbeddingSearchIndex { entries })
    }

    fn status(&self, config: &EmbeddingSearchConfig) -> SemanticRagStoreStatus {
        if !self.path.exists() {
            return SemanticRagStoreStatus {
                ready: false,
                entries: 0,
                error: None,
            };
        }

        let conn = match self.connect() {
            Ok(conn) => conn,
            Err(error) => {
                return SemanticRagStoreStatus {
                    ready: false,
                    entries: 0,
                    error: Some(error),
                };
            }
        };
        let metadata = match load_semantic_store_metadata(&conn) {
            Ok(metadata) => metadata,
            Err(error) => {
                return SemanticRagStoreStatus {
                    ready: false,
                    entries: 0,
                    error: Some(error),
                };
            }
        };
        let entries = semantic_store_entry_count(&conn).unwrap_or(0);
        SemanticRagStoreStatus {
            ready: entries > 0 && semantic_store_metadata_matches(&metadata, config),
            entries,
            error: None,
        }
    }
}

fn u64_to_sql_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn metadata_usize(metadata: &HashMap<String, String>, key: &str) -> Option<usize> {
    metadata.get(key)?.parse::<usize>().ok()
}

fn load_semantic_store_metadata(
    conn: &rusqlite::Connection,
) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM metadata")
        .map_err(|e| format!("prepare semantic metadata query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("query semantic metadata: {}", e))?;
    let mut metadata = HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|e| format!("read semantic metadata: {}", e))?;
        metadata.insert(key, value);
    }
    Ok(metadata)
}

fn semantic_store_metadata_matches(
    metadata: &HashMap<String, String>,
    config: &EmbeddingSearchConfig,
) -> bool {
    metadata
        .get("version")
        .and_then(|value| value.parse::<u32>().ok())
        == Some(EMBEDDING_SEARCH_INDEX_VERSION)
        && metadata.get("store_kind").map(String::as_str)
            == Some(DEFAULT_EMBEDDING_SEARCH_STORE_KIND.as_str())
        && metadata.get("base_url").map(String::as_str) == Some(config.base_url.as_str())
        && metadata.get("model").map(String::as_str) == Some(config.model.as_str())
        && metadata_usize(metadata, "dimensions").unwrap_or(0) > 0
}

fn load_semantic_store_sources(
    conn: &rusqlite::Connection,
) -> Result<Vec<EmbeddingSearchSourceManifestEntry>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT path, source_kind, session_id, size, mtime
            FROM sources
            ORDER BY path, source_kind, session_id, size, mtime
            "#,
        )
        .map_err(|e| format!("prepare semantic source query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(EmbeddingSearchSourceManifestEntry {
                path: row.get(0)?,
                source_kind: row.get(1)?,
                session_id: row.get(2)?,
                size: row.get::<_, i64>(3)?.max(0) as u64,
                mtime: row.get::<_, i64>(4)?.max(0) as u64,
            })
        })
        .map_err(|e| format!("query semantic sources: {}", e))?;
    let mut sources = Vec::new();
    for row in rows {
        sources.push(row.map_err(|e| format!("read semantic source: {}", e))?);
    }
    Ok(sources)
}

fn semantic_store_entry_count(conn: &rusqlite::Connection) -> Result<usize, String> {
    conn.query_row("SELECT COUNT(*) FROM entries", [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|count| count.max(0) as usize)
    .map_err(|e| format!("count semantic entries: {}", e))
}

fn encode_embedding_vector(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * std::mem::size_of::<f32>());
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_embedding_vector(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() % std::mem::size_of::<f32>() != 0 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(std::mem::size_of::<f32>())
            .map(|chunk| {
                let bytes: [u8; 4] = chunk.try_into().ok()?;
                Some(f32::from_le_bytes(bytes))
            })
            .collect::<Option<Vec<_>>>()?,
    )
}

fn load_semantic_store_entries(
    conn: &rusqlite::Connection,
    dimensions: usize,
) -> Result<Vec<EmbeddingSearchEntry>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                source_path,
                source_kind,
                source_size,
                source_mtime,
                text,
                result_json,
                vector
            FROM entries
            "#,
        )
        .map_err(|e| format!("prepare semantic entry query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Vec<u8>>(6)?,
            ))
        })
        .map_err(|e| format!("query semantic entries: {}", e))?;

    let mut entries = Vec::new();
    for row in rows {
        let (source_path, source_kind, source_size, source_mtime, text, result_json, vector_bytes) =
            row.map_err(|e| format!("read semantic entry: {}", e))?;
        let Some(vector) = decode_embedding_vector(&vector_bytes) else {
            return Ok(Vec::new());
        };
        if vector.len() != dimensions {
            return Ok(Vec::new());
        }
        let Ok(result) = serde_json::from_str::<SearchResult>(&result_json) else {
            return Ok(Vec::new());
        };
        entries.push(EmbeddingSearchEntry {
            source_path,
            source_kind,
            source_size: source_size.max(0) as u64,
            source_mtime: source_mtime.max(0) as u64,
            text,
            result,
            vector,
        });
    }
    Ok(entries)
}

fn collect_embedding_search_sources() -> Result<
    (
        Vec<ClaudeSearchSource>,
        Vec<CodexSearchSource>,
        Vec<EmbeddingSearchSourceManifestEntry>,
    ),
    String,
> {
    let claude_sources = collect_claude_search_sources(&get_claude_dir().join("projects"))?;
    let codex_sources = collect_codex_search_sources();
    let mut sources = Vec::with_capacity(claude_sources.len() + codex_sources.len());

    for source in &claude_sources {
        sources.push(EmbeddingSearchSourceManifestEntry {
            path: source_path_key(&source.path),
            source_kind: SearchIndexSourceKind::Claude.as_str().to_string(),
            session_id: source.session_id.clone(),
            size: source.size,
            mtime: source.mtime,
        });
    }

    for source in &codex_sources {
        sources.push(EmbeddingSearchSourceManifestEntry {
            path: source_path_key(&source.path),
            source_kind: SearchIndexSourceKind::Codex.as_str().to_string(),
            session_id: source.session_id.clone(),
            size: source.size,
            mtime: source.mtime,
        });
    }

    sources.sort();
    Ok((claude_sources, codex_sources, sources))
}

fn truncate_embedding_text(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= EMBEDDING_SEARCH_MAX_TEXT_CHARS {
        return normalized;
    }
    normalized
        .chars()
        .take(EMBEDDING_SEARCH_MAX_TEXT_CHARS)
        .collect()
}

fn join_embedding_fields(fields: &[(&str, String)]) -> String {
    truncate_embedding_text(
        &fields
            .iter()
            .filter(|(_, value)| !value.trim().is_empty())
            .map(|(label, value)| format!("{}: {}", label, value.trim()))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn push_embedding_candidate(
    candidates: &mut Vec<EmbeddingSearchCandidate>,
    seen_texts: &mut HashSet<String>,
    candidate: EmbeddingSearchCandidate,
) {
    let key = format!(
        "{}:{}:{}",
        candidate.result.session_id,
        candidate.result.round_index,
        compact_embedding_text_key(&candidate.text)
    );
    if candidate.text.trim().is_empty() || !seen_texts.insert(key) {
        return;
    }
    candidates.push(candidate);
}

fn compact_embedding_text_key(value: &str) -> String {
    let normalized = value.to_lowercase();
    let mut hash = 0u64;
    for byte in normalized.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as u64);
    }
    format!("{}:{:x}", normalized.len(), hash)
}

fn collect_claude_embedding_candidates(
    source: &ClaudeSearchSource,
) -> Vec<EmbeddingSearchCandidate> {
    let source_path = source_path_key(&source.path);
    let session_head = read_session_head(&source.path, 20);
    let session_title = session_head.title.unwrap_or_default();
    let session_last_prompt = session_head.last_prompt.unwrap_or_default();
    let file_content = fs::read_to_string(&source.path).unwrap_or_default();
    let mut session_summary = session_head.summary;
    let mut round_index = 0usize;
    let mut round_prompt = String::new();
    let mut round_timestamp = String::new();
    let mut candidates = Vec::new();
    let mut seen_texts = HashSet::new();

    if session_summary.is_none() {
        for line in file_content.lines() {
            if let Ok(parsed) = serde_json::from_str::<RawLine>(line) {
                if parsed.line_type.as_deref() == Some("summary") {
                    session_summary = parsed.summary;
                    break;
                }
            }
        }
    }

    let summary_text = session_summary.clone().unwrap_or_default();
    let session_text = join_embedding_fields(&[
        ("title", session_title.clone()),
        ("summary", summary_text.clone()),
        ("last prompt", session_last_prompt.clone()),
        ("project", source.display_path.clone()),
    ]);
    if !session_text.is_empty() {
        push_embedding_candidate(
            &mut candidates,
            &mut seen_texts,
            EmbeddingSearchCandidate {
                source_path: source_path.clone(),
                source_kind: SearchIndexSourceKind::Claude.as_str().to_string(),
                source_size: source.size,
                source_mtime: source.mtime,
                text: session_text.clone(),
                result: SearchResult {
                    uuid: format!("semantic:{}:session", source.session_id),
                    content: session_text,
                    role: "session".to_string(),
                    line_number: 0,
                    project_id: source.project_id.clone(),
                    project_path: source.display_path.clone(),
                    session_id: source.session_id.clone(),
                    session_summary: session_summary.clone(),
                    title: if session_title.is_empty() {
                        None
                    } else {
                        Some(session_title.clone())
                    },
                    summary: session_summary.clone(),
                    last_prompt: if session_last_prompt.is_empty() {
                        None
                    } else {
                        Some(session_last_prompt.clone())
                    },
                    round_index: 0,
                    round_prompt: None,
                    round_timestamp: None,
                    timestamp: String::new(),
                    score: 0.0,
                },
            },
        );
    }

    for (line_idx, line) in file_content.lines().enumerate() {
        if candidates.len() >= EMBEDDING_SEARCH_MAX_CHUNKS_PER_SESSION {
            break;
        }
        let Ok(parsed) = serde_json::from_str::<RawLine>(line) else {
            continue;
        };
        let line_type = parsed.line_type.as_deref();
        let is_msg_line = matches!(
            line_type,
            Some("user") | Some("assistant") | Some("message")
        );
        if !is_msg_line {
            continue;
        }

        let Some(msg) = &parsed.message else {
            continue;
        };
        let role = msg.role.clone().unwrap_or_default();
        if role != "user" && role != "assistant" {
            continue;
        }

        let is_meta = parsed.is_meta.unwrap_or(false);
        let timestamp = parsed.timestamp.clone().unwrap_or_default();
        let base_uuid = parsed.uuid.clone().unwrap_or_default();
        let mut run_started_in_record = false;
        for unit in search_message_units(&base_uuid, &msg.content) {
            let text_content = unit.content;
            let is_user_prompt = is_user_prompt_content(&role, unit.is_tool, &text_content);
            let display_role = search_display_role(&role, unit.is_tool, &text_content);

            if !is_meta && is_user_prompt && !run_started_in_record && !text_content.is_empty() {
                run_started_in_record = true;
                round_index += 1;
                round_prompt = text_content.clone();
                round_timestamp = timestamp.clone();
            }

            if is_meta
                || text_content.trim().is_empty()
                || (role == "assistant" && is_no_response_placeholder(&text_content))
            {
                continue;
            }

            let chunk_text = join_embedding_fields(&[
                ("title", session_title.clone()),
                ("summary", summary_text.clone()),
                ("last prompt", session_last_prompt.clone()),
                ("project", source.display_path.clone()),
                ("run prompt", round_prompt.clone()),
                (display_role.as_str(), text_content.clone()),
            ]);
            push_embedding_candidate(
                &mut candidates,
                &mut seen_texts,
                EmbeddingSearchCandidate {
                    source_path: source_path.clone(),
                    source_kind: SearchIndexSourceKind::Claude.as_str().to_string(),
                    source_size: source.size,
                    source_mtime: source.mtime,
                    text: chunk_text,
                    result: SearchResult {
                        uuid: unit.uuid,
                        content: text_content,
                        role: display_role,
                        line_number: line_idx + 1,
                        project_id: source.project_id.clone(),
                        project_path: source.display_path.clone(),
                        session_id: source.session_id.clone(),
                        session_summary: session_summary.clone(),
                        title: if session_title.is_empty() {
                            None
                        } else {
                            Some(session_title.clone())
                        },
                        summary: session_summary.clone(),
                        last_prompt: if session_last_prompt.is_empty() {
                            None
                        } else {
                            Some(session_last_prompt.clone())
                        },
                        round_index,
                        round_prompt: if round_prompt.is_empty() {
                            None
                        } else {
                            Some(round_prompt.clone())
                        },
                        round_timestamp: if round_timestamp.is_empty() {
                            None
                        } else {
                            Some(round_timestamp.clone())
                        },
                        timestamp: timestamp.clone(),
                        score: 0.0,
                    },
                },
            );
        }
    }

    candidates
}

fn collect_codex_embedding_candidates(source: &CodexSearchSource) -> Vec<EmbeddingSearchCandidate> {
    let source_path = source_path_key(&source.path);
    let Some(session) = build_codex_session(&source.path) else {
        return Vec::new();
    };
    let messages = parse_codex_rollout_messages(&source.path).unwrap_or_default();
    let project_path = session.project_path.clone().unwrap_or_default();
    let session_title = session.title.clone().unwrap_or_default();
    let session_summary = session
        .title
        .clone()
        .or_else(|| session.last_prompt.clone())
        .unwrap_or_default();
    let session_last_prompt = session.last_prompt.clone().unwrap_or_default();
    let mut candidates = Vec::new();
    let mut seen_texts = HashSet::new();
    let mut round_index = 0usize;
    let mut round_prompt = String::new();
    let mut round_timestamp = String::new();

    let session_text = join_embedding_fields(&[
        ("title", session_title.clone()),
        ("summary", session_summary.clone()),
        ("last prompt", session_last_prompt.clone()),
        ("project", project_path.clone()),
    ]);
    if !session_text.is_empty() {
        push_embedding_candidate(
            &mut candidates,
            &mut seen_texts,
            EmbeddingSearchCandidate {
                source_path: source_path.clone(),
                source_kind: SearchIndexSourceKind::Codex.as_str().to_string(),
                source_size: source.size,
                source_mtime: source.mtime,
                text: session_text.clone(),
                result: SearchResult {
                    uuid: format!("semantic:{}:session", session.id),
                    content: session_text,
                    role: "session".to_string(),
                    line_number: 0,
                    project_id: session.project_id.clone(),
                    project_path: project_path.clone(),
                    session_id: session.id.clone(),
                    session_summary: Some(session_summary.clone()).filter(|s| !s.is_empty()),
                    title: session.title.clone(),
                    summary: Some(session_summary.clone()).filter(|s| !s.is_empty()),
                    last_prompt: session.last_prompt.clone(),
                    round_index: 0,
                    round_prompt: None,
                    round_timestamp: None,
                    timestamp: String::new(),
                    score: 0.0,
                },
            },
        );
    }

    let mut last_prompt_line = None;
    for message in messages {
        if candidates.len() >= EMBEDDING_SEARCH_MAX_CHUNKS_PER_SESSION {
            break;
        }
        if message.is_meta || message.content.trim().is_empty() {
            continue;
        }
        let is_user_prompt =
            is_user_prompt_content(&message.role, message.is_tool, &message.content);
        let display_role = search_display_role(&message.role, message.is_tool, &message.content);
        if is_user_prompt && last_prompt_line != Some(message.line_number) {
            last_prompt_line = Some(message.line_number);
            round_index += 1;
            round_prompt = message.content.clone();
            round_timestamp = message.timestamp.clone();
        }

        let chunk_text = join_embedding_fields(&[
            ("title", session_title.clone()),
            ("summary", session_summary.clone()),
            ("last prompt", session_last_prompt.clone()),
            ("project", project_path.clone()),
            ("round prompt", round_prompt.clone()),
            (display_role.as_str(), message.content.clone()),
        ]);
        push_embedding_candidate(
            &mut candidates,
            &mut seen_texts,
            EmbeddingSearchCandidate {
                source_path: source_path.clone(),
                source_kind: SearchIndexSourceKind::Codex.as_str().to_string(),
                source_size: source.size,
                source_mtime: source.mtime,
                text: chunk_text,
                result: SearchResult {
                    uuid: message.uuid,
                    content: message.content,
                    role: display_role,
                    line_number: message.line_number,
                    project_id: session.project_id.clone(),
                    project_path: project_path.clone(),
                    session_id: session.id.clone(),
                    session_summary: Some(session_summary.clone()).filter(|s| !s.is_empty()),
                    title: session.title.clone(),
                    summary: Some(session_summary.clone()).filter(|s| !s.is_empty()),
                    last_prompt: session.last_prompt.clone(),
                    round_index,
                    round_prompt: Some(round_prompt.clone()).filter(|s| !s.is_empty()),
                    round_timestamp: Some(round_timestamp.clone()).filter(|s| !s.is_empty()),
                    timestamp: message.timestamp,
                    score: 0.0,
                },
            },
        );
    }

    candidates
}

fn normalize_embedding_vector(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>()
        .sqrt() as f32;
    if norm > 0.0 {
        for value in vector.iter_mut() {
            *value /= norm;
        }
    }
    vector
}

async fn embed_text_batch(
    client: &reqwest::Client,
    config: &EmbeddingSearchConfig,
    batch: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    let mut request = client
        .post(embedding_api_url(&config.base_url))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({
            "model": config.model,
            "input": batch,
        }));

    if !config.api_key.is_empty() {
        request = request.bearer_auth(&config.api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("embedding request failed: {}", e))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("read embedding response failed: {}", e))?;
    if !status.is_success() {
        return Err(format!(
            "embedding request returned HTTP {}: {}",
            status, text
        ));
    }

    let parsed: EmbeddingApiResponse =
        serde_json::from_str(&text).map_err(|e| format!("parse embedding response: {}", e))?;
    let mut ordered = vec![None; batch.len()];
    for (fallback_index, datum) in parsed.data.into_iter().enumerate() {
        let index = datum.index.unwrap_or(fallback_index);
        if index < ordered.len() {
            ordered[index] = Some(normalize_embedding_vector(datum.embedding));
        }
    }
    ordered
        .into_iter()
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| "embedding response count did not match request".to_string())
}

async fn embed_texts(
    config: &EmbeddingSearchConfig,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .user_agent("Ataru/semantic-search")
        .build()
        .map_err(|e| e.to_string())?;
    let mut vectors = Vec::with_capacity(texts.len());

    for batch in texts.chunks(EMBEDDING_SEARCH_BATCH_SIZE) {
        let embedded = embed_text_batch(&client, config, batch).await?;
        vectors.extend(embedded);
    }

    Ok(vectors)
}

async fn build_embedding_search_index(
    config: &EmbeddingSearchConfig,
    claude_sources: &[ClaudeSearchSource],
    codex_sources: &[CodexSearchSource],
    sources: Vec<EmbeddingSearchSourceManifestEntry>,
    store: &SemanticRagStoreAdapter,
) -> Result<EmbeddingSearchIndex, String> {
    let mut candidates = Vec::new();
    for source in claude_sources {
        candidates.extend(collect_claude_embedding_candidates(source));
    }
    for source in codex_sources {
        candidates.extend(collect_codex_embedding_candidates(source));
    }

    if candidates.is_empty() {
        return Err("No sessions available for embedding search.".to_string());
    }

    let texts = candidates
        .iter()
        .map(|candidate| candidate.text.clone())
        .collect::<Vec<_>>();
    let vectors = embed_texts(config, &texts).await?;
    let dimensions = vectors.first().map(|vector| vector.len()).unwrap_or(0);
    if dimensions == 0 {
        return Err("Embedding provider returned empty vectors.".to_string());
    }

    let entries = candidates
        .into_iter()
        .zip(vectors)
        .map(|(candidate, vector)| EmbeddingSearchEntry {
            source_path: candidate.source_path,
            source_kind: candidate.source_kind,
            source_size: candidate.source_size,
            source_mtime: candidate.source_mtime,
            text: candidate.text,
            result: candidate.result,
            vector,
        })
        .collect::<Vec<_>>();

    store.replace(config, dimensions, sources, entries).await
}

async fn ensure_embedding_search_index(
    config: &EmbeddingSearchConfig,
) -> Result<(SemanticRagStoreAdapter, EmbeddingSearchIndex), String> {
    let (claude_sources, codex_sources, sources) = collect_embedding_search_sources()?;
    let store = SemanticRagStoreAdapter::new(config);
    if let Some(index) = store.load_current(config, &sources).await? {
        return Ok((store, index));
    }

    let index =
        build_embedding_search_index(config, &claude_sources, &codex_sources, sources, &store)
            .await?;
    Ok((store, index))
}

fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(left, right)| left * right)
        .sum()
}

fn rank_embedding_sessions(
    entries: &[EmbeddingSearchEntry],
    query_vector: &[f32],
    limit: usize,
    project_id: Option<&str>,
) -> Vec<SearchResult> {
    let mut by_session: HashMap<String, SearchResult> = HashMap::new();

    for entry in entries {
        // The session metadata entry helps build the embedding context, but
        // it is not a Turn and cannot be shown as trustworthy hit evidence.
        // Every semantic result must point back to an actual message body.
        if entry.result.line_number == 0 || entry.result.content.trim().is_empty() {
            continue;
        }
        if entry.vector.len() != query_vector.len() {
            continue;
        }
        if let Some(project_id) = project_id {
            if entry.result.project_id != project_id {
                continue;
            }
        }

        let score = dot_product(&entry.vector, query_vector);
        let session_id = entry.result.session_id.clone();
        let replace = by_session
            .get(&session_id)
            .map(|existing| score > existing.score)
            .unwrap_or(true);
        if replace {
            let mut result = entry.result.clone();
            result.score = score;
            by_session.insert(session_id, result);
        }
    }

    let mut results = by_session.into_values().collect::<Vec<_>>();
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.timestamp.cmp(&a.timestamp))
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    results.truncate(limit);
    results
}

#[cfg(test)]
mod semantic_search_tests {
    use super::*;

    fn semantic_entry(line_number: usize, content: &str, vector: Vec<f32>) -> EmbeddingSearchEntry {
        EmbeddingSearchEntry {
            source_path: "/tmp/session.jsonl".to_string(),
            source_kind: "codex".to_string(),
            source_size: 1,
            source_mtime: 1,
            text: content.to_string(),
            result: SearchResult {
                uuid: format!("message-{line_number}"),
                content: content.to_string(),
                role: if line_number == 0 {
                    "session".to_string()
                } else {
                    "assistant".to_string()
                },
                line_number,
                project_id: "project".to_string(),
                project_path: "/tmp/project".to_string(),
                session_id: "session".to_string(),
                session_summary: Some("Yoda".to_string()),
                title: Some("Yoda".to_string()),
                summary: Some("Yoda".to_string()),
                last_prompt: Some("find the browser tool".to_string()),
                round_index: if line_number == 0 { 0 } else { 1 },
                round_prompt: Some("find the browser tool".to_string()),
                round_timestamp: None,
                timestamp: "2026-08-11T13:55:00Z".to_string(),
                score: 0.0,
            },
            vector,
        }
    }

    #[test]
    fn semantic_recall_returns_message_evidence_instead_of_session_metadata() {
        let entries = vec![
            semantic_entry(0, "title: Yoda", vec![1.0, 0.0]),
            semantic_entry(12, "actual browser message", vec![0.8, 0.0]),
        ];

        let results = rank_embedding_sessions(&entries, &[1.0, 0.0], 10, None);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_number, 12);
        assert_eq!(results[0].content, "actual browser message");
    }
}

#[tauri::command]
pub(crate) async fn get_semantic_search_status() -> Result<SemanticSearchStatus, String> {
    let enabled = load_semantic_search_settings().enabled;
    if !enabled {
        return Ok(SemanticSearchStatus {
            enabled: false,
            configured: false,
            ready: false,
            model: None,
            base_url: None,
            store: DEFAULT_EMBEDDING_SEARCH_STORE_KIND.as_str().to_string(),
            entries: 0,
            error: None,
        });
    }

    let config = match load_embedding_search_config() {
        Ok(config) => config,
        Err(error) => {
            return Ok(SemanticSearchStatus {
                enabled,
                configured: false,
                ready: false,
                model: None,
                base_url: None,
                store: DEFAULT_EMBEDDING_SEARCH_STORE_KIND.as_str().to_string(),
                entries: 0,
                error: Some(error),
            });
        }
    };

    let store = SemanticRagStoreAdapter::new(&config);
    let store_status = store.status(&config).await;

    Ok(SemanticSearchStatus {
        enabled,
        configured: true,
        ready: store_status.ready,
        model: Some(config.model),
        base_url: Some(config.base_url),
        store: store.kind().as_str().to_string(),
        entries: store_status.entries,
        error: store_status.error,
    })
}

#[tauri::command]
pub(crate) async fn set_semantic_search_enabled(
    enabled: bool,
) -> Result<SemanticSearchStatus, String> {
    save_semantic_search_settings(&SemanticSearchSettings { enabled })?;
    get_semantic_search_status().await
}

#[tauri::command]
pub(crate) async fn preview_semantic_search_initialization(
) -> Result<SemanticSearchInitializationPreview, String> {
    tauri::async_runtime::spawn_blocking(semantic_search_initialization_preview)
        .await
        .map_err(|error| format!("ATARU_SEMANTIC_PREVIEW: Local preflight task failed. {error}"))?
}

pub(crate) fn semantic_search_initialization_preview(
) -> Result<SemanticSearchInitializationPreview, String> {
    let (claude_sources, codex_sources, source_manifest) = collect_embedding_search_sources()?;
    let source_sessions = source_manifest.len();
    let claude_sample_size = claude_sources.len().min(SEMANTIC_PREVIEW_SAMPLE_SIZE / 2);
    let codex_sample_size = codex_sources
        .len()
        .min(SEMANTIC_PREVIEW_SAMPLE_SIZE.saturating_sub(claude_sample_size));
    let sampled_sessions = claude_sample_size + codex_sample_size;
    let mut sampled_chunks = 0usize;
    let mut sampled_chars = 0usize;

    for source in claude_sources.iter().take(claude_sample_size) {
        let candidates = collect_claude_embedding_candidates(source);
        sampled_chunks += candidates.len();
        sampled_chars += candidates
            .iter()
            .map(|candidate| candidate.text.chars().count())
            .sum::<usize>();
    }
    for source in codex_sources.iter().take(codex_sample_size) {
        let candidates = collect_codex_embedding_candidates(source);
        sampled_chunks += candidates.len();
        sampled_chars += candidates
            .iter()
            .map(|candidate| candidate.text.chars().count())
            .sum::<usize>();
    }
    let scale = if sampled_sessions == 0 {
        0.0
    } else {
        source_sessions as f64 / sampled_sessions as f64
    };
    let candidate_chunks = (sampled_chunks as f64 * scale).ceil() as usize;
    let candidate_chars = (sampled_chars as f64 * scale).ceil() as usize;

    Ok(SemanticSearchInitializationPreview {
        source_sessions,
        sampled_sessions,
        source_bytes: source_manifest.iter().map(|source| source.size).sum(),
        candidate_chunks,
        candidate_chars,
        embedding_batches: candidate_chunks.div_ceil(EMBEDDING_SEARCH_BATCH_SIZE),
    })
}

#[tauri::command]
pub(crate) async fn initialize_semantic_search() -> Result<SemanticSearchStatus, String> {
    if !load_semantic_search_settings().enabled {
        return Err("ATARU_SEMANTIC_DISABLED: Enable semantic recall in Advanced settings before initialization.".to_string());
    }
    let config = load_embedding_search_config()?;
    let _ = ensure_embedding_search_index(&config).await?;
    get_semantic_search_status().await
}

#[tauri::command]
pub(crate) async fn semantic_search_chats(
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    if !load_semantic_search_settings().enabled {
        return Err("ATARU_SEMANTIC_DISABLED: Enable semantic recall in Advanced settings before searching.".to_string());
    }
    let config = load_embedding_search_config()?;
    let (store, index) = ensure_embedding_search_index(&config).await?;
    let query_vectors = embed_texts(&config, &[query]).await?;
    let Some(query_vector) = query_vectors.first() else {
        return Err("Embedding provider returned no query vector.".to_string());
    };
    store
        .search(
            &index,
            query_vector,
            limit.unwrap_or(60).clamp(1, 200),
            project_id.as_deref(),
        )
        .await
}

pub(crate) fn summarize_tool_input(name: &str, input: &serde_json::Value) -> String {
    let obj = match input.as_object() {
        Some(o) => o,
        None => return String::new(),
    };
    let first_string = |keys: &[&str]| -> String {
        for key in keys {
            if let Some(v) = obj.get(*key).and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    return v.to_string();
                }
            }
        }
        String::new()
    };

    match name {
        "Read" | "Write" => obj
            .get("file_path")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("path").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        "Edit" | "MultiEdit" => {
            let path = obj
                .get("file_path")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("path").and_then(|v| v.as_str()))
                .unwrap_or("");
            let old = obj.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
            if old.is_empty() {
                path.to_string()
            } else {
                format!(
                    "{} ({}...)",
                    path,
                    &old.chars().take(40).collect::<String>()
                )
            }
        }
        "Bash" | "exec_command" => obj
            .get("command")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("cmd").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        "Grep" => obj
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Glob" => obj
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Task" => first_string(&["description", "subject", "prompt"]),
        "WebFetch" => obj
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "WebSearch" => obj
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "ToolSearch" => first_string(&["query"]),
        "Skill" => {
            let skill = first_string(&["skill", "name"]);
            let args = first_string(&["args", "prompt", "description"]);
            if skill.is_empty() {
                args
            } else if args.is_empty() {
                skill
            } else {
                format!("{} {}", skill, args)
            }
        }
        "Agent" => first_string(&["description", "subagent_type", "prompt"]),
        "TaskCreate" => first_string(&["subject", "activeForm", "description"]),
        "TaskUpdate" => {
            let id = first_string(&["taskId", "id"]);
            let status = first_string(&["status"]);
            match (id.is_empty(), status.is_empty()) {
                (false, false) => format!("{} -> {}", id, status),
                (false, true) => id,
                (true, false) => status,
                (true, true) => String::new(),
            }
        }
        "TaskList" => "tasks".to_string(),
        "TaskStop" => first_string(&["taskId", "id", "reason"]),
        "TodoWrite" | "TaskRead" => first_string(&["description", "subject", "prompt"]),
        "AskUserQuestion" => first_string(&["question", "header", "description"]),
        _ => {
            // Try common field names
            for key in &[
                "skill",
                "name",
                "subject",
                "title",
                "file_path",
                "path",
                "command",
                "query",
                "pattern",
                "url",
                "description",
                "prompt",
                "args",
            ] {
                if let Some(v) = obj.get(*key).and_then(|v| v.as_str()) {
                    return v.to_string();
                }
            }
            String::new()
        }
    }
}

pub(crate) fn truncate_chars(text: String, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text;
    }
    let mut out = text.chars().take(max_chars).collect::<String>();
    out.push_str("\n... truncated ...");
    out
}

pub(crate) fn json_preview(value: &serde_json::Value, max_chars: usize) -> String {
    let text = match value {
        serde_json::Value::String(s) => s.clone(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    };
    truncate_chars(text, max_chars)
}

pub(crate) fn tool_action_text(name: &str) -> &str {
    match name {
        "Read" => "Read",
        "Write" => "Wrote",
        "Edit" | "MultiEdit" => "Edited",
        "Bash" | "exec_command" => "Ran",
        "Grep" | "Glob" | "WebSearch" => "Searched",
        "WebFetch" => "Fetched",
        "ToolSearch" => "Searched tools",
        "Skill" => "Used skill",
        "Agent" => "Started agent",
        "TaskCreate" => "Created task",
        "TaskUpdate" => "Updated task",
        "TaskList" => "Listed tasks",
        "TaskStop" => "Stopped task",
        "TodoWrite" | "Task" | "TaskRead" => "Updated tasks",
        "AskUserQuestion" => "Asked user",
        "EnterPlanMode" => "Entered plan mode",
        "ExitPlanMode" => "Exited plan mode",
        "ScheduleWakeup" => "Scheduled wakeup",
        "Monitor" => "Started monitor",
        _ => name,
    }
}

pub(crate) fn content_blocks_to_text(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            ContentBlock::ToolUse { name, summary, .. } => {
                let action = tool_action_text(name);
                let trimmed = summary.trim();
                if trimmed.is_empty() {
                    Some(action.to_string())
                } else {
                    Some(format!("{} {}", action, trimmed))
                }
            }
            ContentBlock::ToolResult { content, .. } => {
                let trimmed = content.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            ContentBlock::Thinking { thinking } => {
                let trimmed = thinking.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn summarize_tool_result_item(value: &serde_json::Value) -> Option<String> {
    let obj = value.as_object()?;
    match obj.get("type").and_then(|v| v.as_str()) {
        Some("text") | Some("input_text") | Some("output_text") => obj
            .get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        Some("tool_reference") => obj
            .get("tool_name")
            .and_then(|v| v.as_str())
            .map(|name| format!("tool_reference: {}", name)),
        Some("image") => Some("[image result]".to_string()),
        Some(other) => Some(format!("{}: {}", other, json_preview(value, 800))),
        None => Some(json_preview(value, 800)),
    }
}

pub(crate) fn tool_result_raw_preview(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(_) => None,
        serde_json::Value::Array(arr) => {
            let lines = arr
                .iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    match obj.get("type").and_then(|v| v.as_str()) {
                        Some("text") | Some("input_text") | Some("output_text") => None,
                        Some("image") => Some("[image result: base64 omitted]".to_string()),
                        _ => summarize_tool_result_item(item),
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            if lines.trim().is_empty() {
                None
            } else {
                Some(lines)
            }
        }
        serde_json::Value::Object(_) => Some(json_preview(value, 6000)),
        _ => None,
    }
}

pub(crate) fn extract_tool_result_images(
    value: &serde_json::Value,
) -> Option<Vec<ToolResultImage>> {
    let serde_json::Value::Array(arr) = value else {
        return None;
    };

    let images = arr
        .iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            if obj.get("type").and_then(|v| v.as_str()) != Some("image") {
                return None;
            }

            let source = obj.get("source")?.as_object()?;
            if source.get("type").and_then(|v| v.as_str()) != Some("base64") {
                return None;
            }

            let data = source.get("data").and_then(|v| v.as_str())?.to_string();
            if data.is_empty() {
                return None;
            }

            let media_type = source
                .get("media_type")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("media_type").and_then(|v| v.as_str()))
                .filter(|s| s.starts_with("image/"))
                .unwrap_or("image/png")
                .to_string();
            let original_size = source
                .get("originalSize")
                .and_then(|v| v.as_u64())
                .or_else(|| source.get("original_size").and_then(|v| v.as_u64()))
                .or_else(|| obj.get("originalSize").and_then(|v| v.as_u64()))
                .or_else(|| obj.get("original_size").and_then(|v| v.as_u64()));

            Some(ToolResultImage {
                media_type,
                data,
                original_size,
            })
        })
        .collect::<Vec<_>>();

    if images.is_empty() {
        None
    } else {
        Some(images)
    }
}

pub(crate) fn extract_tool_result_content(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(summarize_tool_result_item)
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(_) => json_preview(value, 1200),
        _ => String::new(),
    }
}

pub(crate) fn normalize_search_evidence(value: &str) -> String {
    const MARKERS: [&str; 2] = ["input_text:", "output_text:"];
    let mut texts = Vec::new();
    if MARKERS.iter().any(|marker| value.contains(marker)) {
        let mut marker_offsets = Vec::new();
        for marker in MARKERS {
            marker_offsets.extend(
                value
                    .match_indices(marker)
                    .map(|(offset, _)| (offset, marker)),
            );
        }
        marker_offsets.sort_by_key(|(offset, _)| *offset);
        for (index, (offset, marker)) in marker_offsets.iter().enumerate() {
            let start = offset + marker.len();
            let end = marker_offsets
                .get(index + 1)
                .map(|(next_offset, _)| *next_offset)
                .unwrap_or(value.len());
            if let Some(text) = protocol_text_segment(&value[start..end]) {
                if !text.trim().is_empty() {
                    texts.push(text.trim().to_string());
                }
            }
        }
    }

    let decoded = if texts.is_empty() {
        value.trim().to_string()
    } else {
        texts.join("\n")
    };
    let trimmed = decoded.trim();
    if let Some(after_header) = trimmed.strip_prefix("Script completed") {
        if let Some(output_offset) = after_header.find("Output:") {
            let output = after_header[output_offset + "Output:".len()..].trim();
            if !output.is_empty() {
                return output.to_string();
            }
        }
    }
    trimmed.to_string()
}

fn protocol_text_segment(segment: &str) -> Option<String> {
    let source = segment.trim();
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(source) {
        return parsed
            .get("text")
            .and_then(|text| text.as_str())
            .map(String::from);
    }

    let text_key = source.find("\"text\"")?;
    let after_key = &source[text_key + "\"text\"".len()..];
    let colon = after_key.find(':')?;
    let after_colon = after_key[colon + 1..].trim_start();
    let raw = after_colon.strip_prefix('"')?;
    let mut escaped = false;
    let mut closing_quote = None;
    for (offset, character) in raw.char_indices() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            closing_quote = Some(offset);
            break;
        }
    }

    let raw_text = closing_quote
        .map(|offset| &raw[..offset])
        .unwrap_or(raw)
        .split("\n... truncated ...")
        .next()
        .unwrap_or("")
        .trim_end_matches('\\');
    let quoted = format!("\"{raw_text}\"");
    serde_json::from_str::<String>(&quoted).ok().or_else(|| {
        Some(
            raw_text
                .replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t")
                .replace("\\\"", "\"")
                .replace("\\\\", "\\"),
        )
    })
}

pub(crate) fn extract_content_blocks(
    value: &Option<serde_json::Value>,
) -> Option<Vec<ContentBlock>> {
    let arr = match value {
        Some(serde_json::Value::Array(arr)) => arr,
        Some(serde_json::Value::String(s)) => {
            return Some(vec![ContentBlock::Text { text: s.clone() }]);
        }
        _ => return None,
    };

    let blocks: Vec<ContentBlock> = arr
        .iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            let block_type = obj.get("type").and_then(|v| v.as_str())?;
            match block_type {
                "text" | "input_text" | "output_text" => {
                    let text = obj.get("text").and_then(|v| v.as_str())?.to_string();
                    if text.is_empty() {
                        None
                    } else {
                        Some(ContentBlock::Text { text })
                    }
                }
                "tool_use" => {
                    let id = obj
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = obj
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input = obj.get("input").cloned().unwrap_or(serde_json::Value::Null);
                    let summary = summarize_tool_input(&name, &input);
                    let input = if input.is_null() {
                        None
                    } else {
                        Some(json_preview(&input, 6000))
                    };
                    Some(ContentBlock::ToolUse {
                        id,
                        name,
                        summary,
                        input,
                    })
                }
                "tool_result" => {
                    let tool_use_id = obj
                        .get("tool_use_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let content = obj
                        .get("content")
                        .map(|v| extract_tool_result_content(v))
                        .unwrap_or_default();
                    let images = obj.get("content").and_then(extract_tool_result_images);
                    let raw = obj.get("content").and_then(tool_result_raw_preview);
                    let raw = raw.filter(|s| {
                        let trimmed = s.trim();
                        !trimmed.is_empty() && trimmed != content.trim()
                    });
                    Some(ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                        images,
                        raw,
                    })
                }
                "thinking" => {
                    let thinking = obj
                        .get("thinking")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if thinking.is_empty() {
                        None
                    } else {
                        Some(ContentBlock::Thinking { thinking })
                    }
                }
                _ => None,
            }
        })
        .collect();

    if blocks.is_empty() {
        None
    } else {
        Some(blocks)
    }
}

pub(crate) fn extract_content_with_meta(value: &Option<serde_json::Value>) -> (String, bool) {
    match value {
        Some(serde_json::Value::String(s)) => (s.clone(), false),
        Some(serde_json::Value::Array(arr)) => {
            // Check if array contains tool_use or tool_result
            let has_tool = arr.iter().any(|item| {
                if let Some(obj) = item.as_object() {
                    let t = obj.get("type").and_then(|v| v.as_str());
                    return t == Some("tool_use") || t == Some("tool_result");
                }
                false
            });

            let text = arr
                .iter()
                .filter_map(|item| {
                    if let Some(obj) = item.as_object() {
                        if matches!(
                            obj.get("type").and_then(|v| v.as_str()),
                            Some("text") | Some("input_text") | Some("output_text")
                        ) {
                            return obj.get("text").and_then(|v| v.as_str()).map(String::from);
                        }
                    }
                    None
                })
                .collect::<Vec<_>>()
                .join("\n");

            (text, has_tool)
        }
        _ => (String::new(), false),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SearchMessageUnit {
    uuid: String,
    content: String,
    is_tool: bool,
}

/// Split one provider transcript record into the smallest searchable units.
/// A Claude content array may contain ordinary text, tool calls, tool results,
/// and thinking in one JSONL line; keeping those blocks together makes a Turn
/// look like a whole response again. Each block therefore receives its own
/// stable index identity while retaining the source line for context lookup.
fn search_message_units(
    base_uuid: &str,
    value: &Option<serde_json::Value>,
) -> Vec<SearchMessageUnit> {
    let Some(blocks) = extract_content_blocks(value) else {
        let (content, is_tool) = extract_content_with_meta(value);
        return if content.trim().is_empty() {
            Vec::new()
        } else {
            vec![SearchMessageUnit {
                uuid: base_uuid.to_string(),
                content,
                is_tool,
            }]
        };
    };

    let multiple = blocks.len() > 1;
    let units = blocks
        .into_iter()
        .enumerate()
        .filter_map(|(index, block)| {
            let content = content_blocks_to_text(std::slice::from_ref(&block));
            let is_tool = matches!(
                block,
                ContentBlock::ToolUse { .. } | ContentBlock::ToolResult { .. }
            );
            if content.trim().is_empty() {
                return None;
            }
            let uuid = if multiple {
                format!("{base_uuid}:block:{index}")
            } else {
                base_uuid.to_string()
            };
            Some(SearchMessageUnit {
                uuid,
                content,
                is_tool,
            })
        })
        .collect::<Vec<_>>();

    if units.is_empty() {
        let (content, is_tool) = extract_content_with_meta(value);
        if content.trim().is_empty() {
            Vec::new()
        } else {
            vec![SearchMessageUnit {
                uuid: base_uuid.to_string(),
                content,
                is_tool,
            }]
        }
    } else {
        units
    }
}

pub(crate) fn search_display_role(role: &str, is_tool: bool, text: &str) -> String {
    if is_tool {
        "tool".to_string()
    } else if is_ai_authored_user_content(role, is_tool, text) {
        "assistant".to_string()
    } else {
        role.to_string()
    }
}

#[cfg(test)]
mod search_message_units_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn splits_mixed_content_blocks_into_atomic_turns() {
        let value = Some(json!([
            {"type": "text", "text": "先查看项目"},
            {"type": "tool_use", "id": "tool-1", "name": "Read", "input": {"file_path": "src/main.ts"}},
            {"type": "tool_result", "tool_use_id": "tool-1", "content": "文件内容"}
        ]));

        let units = search_message_units("message-1", &value);

        assert_eq!(units.len(), 3);
        assert_eq!(units[0].uuid, "message-1:block:0");
        assert_eq!(units[0].content, "先查看项目");
        assert!(!units[0].is_tool);
        assert_eq!(units[1].uuid, "message-1:block:1");
        assert!(units[1].is_tool);
        assert_eq!(units[2].uuid, "message-1:block:2");
        assert!(units[2].is_tool);
    }

    #[test]
    fn keeps_single_text_block_identity_compatible() {
        let value = Some(json!([{"type": "text", "text": "一条消息"}]));

        let units = search_message_units("message-1", &value);

        assert_eq!(
            units,
            vec![SearchMessageUnit {
                uuid: "message-1".to_string(),
                content: "一条消息".to_string(),
                is_tool: false,
            }]
        );
    }

    #[test]
    fn codex_text_output_arrays_keep_readable_text_instead_of_protocol_envelopes() {
        let output = json!([
            {"type": "input_text", "text": "Script completed\nWall time 0.8 seconds\nOutput:\n"},
            {"type": "input_text", "text": "ego-browser\nUsage: ego-browser help [topic]"}
        ]);

        assert_eq!(
            normalize_search_evidence(&codex_output_text(&output)),
            "ego-browser\nUsage: ego-browser help [topic]"
        );
    }
}
