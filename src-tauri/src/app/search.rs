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

impl Default for SearchIndexBuildStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
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
}

impl SearchIndexWorkMode {
    fn should_delete_existing_docs(&self) -> bool {
        matches!(self, SearchIndexWorkMode::Reindex)
    }
}

static SEARCH_INDEX_BUILD_STATUS: LazyLock<Mutex<SearchIndexBuildStatus>> =
    LazyLock::new(|| Mutex::new(SearchIndexBuildStatus::default()));
static SEARCH_INDEX_BUILD_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

const SEARCH_INDEX_MANIFEST_VERSION: u32 = 5;
const SEARCH_INDEX_EVENT: &str = "search-index:build";
const REQUIRED_SEARCH_INDEX_FIELDS: &[&str] = &[
    "title",
    "summary",
    "last_prompt",
    "prompt",
    "user",
    "assistant",
    "source_path",
    "line_number",
    "round_index",
    "round_prompt",
    "round_timestamp",
];

struct SearchIndexBuildRunningGuard;

impl Drop for SearchIndexBuildRunningGuard {
    fn drop(&mut self) {
        SEARCH_INDEX_BUILD_RUNNING.store(false, std::sync::atomic::Ordering::Release);
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

fn emit_search_index_status(app: Option<&tauri::AppHandle>, mut status: SearchIndexBuildStatus) {
    if status.total_messages > 0 {
        status.processed_messages = status.processed_messages.min(status.total_messages);
        status.indexed_messages = status.indexed_messages.min(status.total_messages);
    }
    if status.total_sessions > 0 {
        status.processed_sessions = status.processed_sessions.min(status.total_sessions);
    }
    if status.total_bytes > 0 {
        status.processed_bytes = status.processed_bytes.min(status.total_bytes);
    }

    if status.state == "building" {
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
    let mut status = SEARCH_INDEX_BUILD_STATUS
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let current_manifest = load_search_index_manifest();
    let index_ready = get_index_dir().exists()
        && current_manifest.is_some()
        && Index::open_in_dir(get_index_dir())
            .map(|index| search_index_schema_is_current(&index.schema()))
            .unwrap_or(false);
    let build_running = SEARCH_INDEX_BUILD_RUNNING.load(std::sync::atomic::Ordering::Acquire);
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

fn try_mark_search_index_build_running() -> Option<SearchIndexBuildRunningGuard> {
    if SEARCH_INDEX_BUILD_RUNNING.swap(true, std::sync::atomic::Ordering::AcqRel) {
        None
    } else {
        Some(SearchIndexBuildRunningGuard)
    }
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
    if !get_index_dir().exists() || load_search_index_manifest().is_none() {
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
) {
    status.processed_messages += 1;
    status.indexed_messages += 1;
    status.current_session_id = current_session_id;
    status.current_title = current_title;
    status.current_project_path = current_project_path;
    status.updated_at = Some(now_secs());

    if force_emit || status.processed_messages % 100 == 0 {
        emit_search_index_status(app, status.clone());
    }
}

#[tauri::command]
pub(crate) async fn build_search_index() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _running_guard = try_mark_search_index_build_running()
            .ok_or_else(|| "Search index is already building".to_string())?;
        run_search_index_build(None, true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn get_search_index_status() -> Result<SearchIndexBuildStatus, String> {
    Ok(current_search_index_status())
}

#[tauri::command]
pub(crate) fn start_search_index_build(
    app_handle: tauri::AppHandle,
    force: Option<bool>,
) -> Result<SearchIndexBuildStatus, String> {
    if SEARCH_INDEX_BUILD_RUNNING.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return Ok(current_search_index_status());
    }

    let app_for_task = app_handle.clone();
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn(async move {
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

        SEARCH_INDEX_BUILD_RUNNING.store(false, std::sync::atomic::Ordering::Release);
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
    let started_at = now_secs();
    let discovered_sessions = claude_sources.len() + codex_sources.len();
    let discovered_bytes = claude_sources
        .iter()
        .map(|source| source.size)
        .chain(codex_sources.iter().map(|source| source.size))
        .sum();
    let mut status = SearchIndexBuildStatus {
        state: "building".to_string(),
        total_sessions: discovered_sessions,
        processed_sessions: 0,
        total_messages: 0,
        processed_messages: 0,
        indexed_messages: 0,
        total_bytes: discovered_bytes,
        processed_bytes: 0,
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
    let full_rebuild = force || previous_manifest.is_none() || !search_index_on_disk_is_current();

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
            SearchIndexWorkMode::AppendClaude { offset, .. } => source.size.saturating_sub(*offset),
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

        work_bytes += source.size;
        codex_work_by_path.insert(path, SearchIndexWorkMode::Reindex);
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
    status.total_sessions = changed_sessions;
    status.total_messages = 0;
    status.total_bytes = work_bytes;
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
        for path in codex_work_by_path.keys() {
            index_writer.delete_term(Term::from_field_text(source_path_field, path));
        }
    }

    // === Command stats collection ===
    let mut command_stats: Option<HashMap<String, HashMap<String, usize>>> =
        full_rebuild.then(HashMap::new);
    let command_pattern =
        regex::Regex::new(r"<command-name>(/[^<]+)</command-name>").map_err(|e| e.to_string())?;

    // Build alias -> canonical name mapping
    let mut alias_map: HashMap<String, String> = HashMap::new();
    let commands_dir = get_claude_dir().join("commands");

    fn scan_commands_for_aliases(
        dir: &std::path::Path,
        alias_map: &mut HashMap<String, String>,
        base_dir: &std::path::Path,
    ) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    scan_commands_for_aliases(&path, alias_map, base_dir);
                } else if path.extension().map_or(false, |e| e == "md") {
                    let rel_path = path.strip_prefix(base_dir).unwrap_or(&path);
                    let canonical = rel_path
                        .with_extension("")
                        .to_string_lossy()
                        .replace('/', ":")
                        .replace('\\', ":");

                    if let Ok(content) = fs::read_to_string(&path) {
                        if content.starts_with("---") {
                            if let Some(end) = content[3..].find("---") {
                                let fm = &content[3..3 + end];
                                for line in fm.lines() {
                                    if line.starts_with("aliases:") {
                                        let aliases_str =
                                            line.trim_start_matches("aliases:").trim();
                                        for alias in aliases_str.split(',') {
                                            let alias = alias
                                                .trim()
                                                .trim_matches('"')
                                                .trim_matches('\'')
                                                .trim_start_matches('/')
                                                .to_string();
                                            if !alias.is_empty() {
                                                alias_map.insert(alias, canonical.clone());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if command_stats.is_some() && commands_dir.exists() {
        scan_commands_for_aliases(&commands_dir, &mut alias_map, &commands_dir);
    }
    // === End command stats setup ===

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
                            let (text_content, is_tool) = extract_content_with_meta(&msg.content);
                            let is_meta = parsed.is_meta.unwrap_or(false);
                            let is_user_prompt =
                                is_user_prompt_content(&role, is_tool, &text_content);
                            let display_role =
                                if is_ai_authored_user_content(&role, is_tool, &text_content) {
                                    "assistant".to_string()
                                } else {
                                    role.clone()
                                };
                            if !is_meta && is_user_prompt && !text_content.is_empty() {
                                round_index += 1;
                                round_prompt = text_content.clone();
                                round_timestamp = parsed.timestamp.clone().unwrap_or_default();
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

                                index_writer.add_document(doc!(
                                        uuid_field => parsed.uuid.clone().unwrap_or_default(),
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
                                        timestamp_field => parsed.timestamp.clone().unwrap_or_default(),
                                        line_number_field => line_count as u64,
                                        round_index_field => round_index as u64,
                                        round_prompt_field => round_prompt.clone(),
                                        round_timestamp_field => round_timestamp.clone(),
                                    )).map_err(|e| e.to_string())?;

                                session_message_count += 1;
                                status.processed_bytes = session_start_bytes + session_bytes_seen;
                                update_search_index_message_progress(
                                    app.as_ref(),
                                    &mut status,
                                    Some(source.session_id.clone()),
                                    Some(session_title.clone()),
                                    Some(source.display_path.clone()),
                                    false,
                                );
                            }
                        }
                    }
                }

                if command_stats.is_some()
                    && line.contains("<command-name>")
                    && !line.contains("\"type\":\"queue-operation\"")
                {
                    if let Some(ts_str) = &parsed.timestamp {
                        if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                            let week_key = ts.format("%Y-W%V").to_string();
                            for cap in command_pattern.captures_iter(line) {
                                if let Some(cmd_match) = cap.get(1) {
                                    let raw_name =
                                        cmd_match.as_str().trim_start_matches('/').to_string();
                                    let name =
                                        alias_map.get(&raw_name).cloned().unwrap_or(raw_name);
                                    if let Some(command_stats) = command_stats.as_mut() {
                                        command_stats
                                            .entry(name)
                                            .or_default()
                                            .entry(week_key.clone())
                                            .and_modify(|c| *c += 1)
                                            .or_insert(1);
                                    }
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

    for (source, source_path) in codex_sources.iter().filter_map(|source| {
        let source_path = source_path_key(&source.path);
        codex_work_by_path
            .contains_key(&source_path)
            .then_some((source, source_path))
    }) {
        let codex_path = &source.path;
        let session_start_bytes = status.processed_bytes;
        let Some(session) = build_codex_session(&codex_path) else {
            status.skipped_sessions += 1;
            status.processed_bytes = session_start_bytes + source.size;
            update_search_index_progress(
                app.as_ref(),
                &mut status,
                Some(source.session_id.clone()),
                None,
                None,
            );
            continue;
        };
        let messages = match parse_codex_rollout_messages(&codex_path) {
            Ok(messages) => messages,
            Err(_) => {
                status.skipped_sessions += 1;
                status.processed_bytes = session_start_bytes + source.size;
                update_search_index_progress(
                    app.as_ref(),
                    &mut status,
                    Some(source.session_id.clone()),
                    session.title.clone(),
                    session.project_path.clone(),
                );
                continue;
            }
        };
        let project_path = session.project_path.clone().unwrap_or_default();
        let session_title = session.title.clone().unwrap_or_default();
        let session_last_prompt = session.last_prompt.clone().unwrap_or_default();
        let session_summary = session
            .title
            .clone()
            .or_else(|| session.last_prompt.clone())
            .unwrap_or_default();

        let mut round_index = 0usize;
        let mut round_prompt = String::new();
        let mut round_timestamp = String::new();
        let mut session_message_count = 0usize;
        let mut line_count = 0usize;
        let parsed_message_total = messages.len().max(1) as u64;

        for message in messages {
            if message.is_meta || message.content.trim().is_empty() {
                continue;
            }
            let is_user_prompt =
                is_user_prompt_content(&message.role, message.is_tool, &message.content);
            let display_role =
                if is_ai_authored_user_content(&message.role, message.is_tool, &message.content) {
                    "assistant".to_string()
                } else {
                    message.role.clone()
                };
            if is_user_prompt && !message.is_meta {
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

            index_writer
                .add_document(doc!(
                    uuid_field => message.uuid,
                    content_field => message.content,
                    title_field => session_title.clone(),
                    summary_field => session_summary.clone(),
                    last_prompt_field => session_last_prompt.clone(),
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
                + ((session_message_count as u64 * source.size) / parsed_message_total)
                    .min(source.size);
            update_search_index_message_progress(
                app.as_ref(),
                &mut status,
                Some(source.session_id.clone()),
                session.title.clone(),
                session.project_path.clone(),
                false,
            );
        }
        status.processed_bytes = session_start_bytes + source.size;
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

    // Write full command stats only during full rebuilds. Incremental search
    // updates should not block on a full historical stats scan.
    if let Some(command_stats) = command_stats {
        let stats_path = get_command_stats_path();
        if let Some(parent) = stats_path.parent() {
            fs::create_dir_all(parent).ok();
        }
        let stats_json = serde_json::json!({
            "updated_at": chrono::Utc::now().timestamp(),
            "commands": command_stats,
        });
        fs::write(
            &stats_path,
            serde_json::to_string_pretty(&stats_json).unwrap_or_default(),
        )
        .ok();
    }

    final_manifest_entries.sort();
    let (corpus_sessions, corpus_messages, corpus_bytes) = manifest_totals(&final_manifest_entries);
    save_search_index_manifest(final_manifest_entries)?;

    status.state = "ready".to_string();
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

fn canonical_search_field(scope: &str, schema: &Schema) -> Option<&'static str> {
    let field = match normalize_scope_name(scope).as_str() {
        "content" | "body" | "message" | "messages" | "text" => "content",
        "title" | "name" => "title",
        "summary" => "summary",
        "lastprompt" | "latestprompt" => "last_prompt",
        "round" | "roundprompt" | "turn" | "turnprompt" => "round_prompt",
        "prompt" | "prompts" | "user" | "userprompt" | "userprompts" | "question" => "prompt",
        "ai" | "assistant" | "answer" | "response" | "reply" => "assistant",
        "project" | "projectpath" | "path" | "cwd" | "directory" => "project",
        "id" | "session" | "sessionid" => "session_id",
        "uuid" => "uuid",
        "role" => "role",
        _ => return None,
    };

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

    let top_docs = searcher
        .search(&parsed_query, &TopDocs::with_limit(max_results))
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
        if let Some(filter_id) = project_id {
            if doc_project_id != filter_id {
                continue;
            }
        }

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

#[tauri::command]
pub(crate) fn search_chats(
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let max_results = limit.unwrap_or(50);
    let guard = loaded_search_index_guard()?;
    let search_index = guard.as_ref().unwrap();
    let normalized_query = normalize_scoped_search_query(&query, &search_index.schema);
    search_index_documents(
        search_index,
        &normalized_query,
        &["content"],
        max_results,
        project_id.as_deref(),
    )
}

#[derive(Clone, Debug)]
struct EmbeddingSearchConfig {
    base_url: String,
    api_key: String,
    model: String,
    store: SemanticSearchStoreKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SemanticSearchStoreKind {
    Sqlite,
    LanceDb,
}

impl SemanticSearchStoreKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Sqlite => "sqlite",
            Self::LanceDb => "lancedb",
        }
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
    pub(crate) configured: bool,
    pub(crate) ready: bool,
    pub(crate) model: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) store: String,
    pub(crate) entries: usize,
    pub(crate) error: Option<String>,
}

const EMBEDDING_SEARCH_INDEX_VERSION: u32 = 2;
const DEFAULT_EMBEDDING_SEARCH_STORE_KIND: SemanticSearchStoreKind =
    SemanticSearchStoreKind::LanceDb;
const LANCEDB_SEMANTIC_ENTRIES_TABLE: &str = "semantic_entries";
const LANCEDB_SEMANTIC_SOURCES_TABLE: &str = "semantic_sources";
const LANCEDB_SEMANTIC_METADATA_TABLE: &str = "semantic_metadata";
const EMBEDDING_SEARCH_BATCH_SIZE: usize = 32;
const EMBEDDING_SEARCH_MAX_TEXT_CHARS: usize = 2400;
const EMBEDDING_SEARCH_MAX_CHUNKS_PER_SESSION: usize = 160;

fn embedding_search_store_path() -> PathBuf {
    get_index_dir()
        .parent()
        .map(|parent| parent.join("semantic-search.sqlite"))
        .unwrap_or_else(|| PathBuf::from("semantic-search.sqlite"))
}

fn lancedb_embedding_search_store_path() -> PathBuf {
    get_index_dir()
        .parent()
        .map(|parent| parent.join("semantic-search.lancedb"))
        .unwrap_or_else(|| PathBuf::from("semantic-search.lancedb"))
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
    let store = embedding_setting_value("LOVCODE_SEMANTIC_STORE")
        .or_else(|| embedding_setting_value("LOVCODE_RAG_STORE"))
        .map(|value| match value.to_ascii_lowercase().as_str() {
            "sqlite" => Ok(SemanticSearchStoreKind::Sqlite),
            "lance" | "lancedb" => Ok(SemanticSearchStoreKind::LanceDb),
            other => Err(format!(
                "Unsupported semantic search store '{}'. Use 'lancedb' or 'sqlite'.",
                other
            )),
        })
        .transpose()?
        .unwrap_or(DEFAULT_EMBEDDING_SEARCH_STORE_KIND);

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
        store,
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
    LanceDb(LanceDbSemanticRagStore),
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

struct LanceDbSemanticRagStore {
    path: PathBuf,
}

impl LanceDbSemanticRagStore {
    fn new() -> Self {
        Self {
            path: lancedb_embedding_search_store_path(),
        }
    }

    fn uri(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    async fn connect(&self) -> Result<lancedb::Connection, String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        lancedb::connect(&self.uri())
            .execute()
            .await
            .map_err(|e| format!("open LanceDB semantic search store: {}", e))
    }

    async fn load_current(
        &self,
        config: &EmbeddingSearchConfig,
        sources: &[EmbeddingSearchSourceManifestEntry],
    ) -> Result<Option<EmbeddingSearchIndex>, String> {
        if !self.path.exists() {
            return Ok(None);
        }
        let db = self.connect().await?;
        let metadata = match load_lancedb_metadata(&db).await {
            Ok(metadata) => metadata,
            Err(_) => return Ok(None),
        };
        if !semantic_store_metadata_matches(&metadata, config) {
            return Ok(None);
        }

        let stored_sources = match load_lancedb_sources(&db).await {
            Ok(sources) => sources,
            Err(_) => return Ok(None),
        };
        if stored_sources != sources {
            return Ok(None);
        }

        let entries = lancedb_entry_count(&db).await.unwrap_or(0);
        if entries == 0 {
            return Ok(None);
        }

        Ok(Some(EmbeddingSearchIndex {
            entries: Vec::new(),
        }))
    }

    async fn replace(
        &self,
        config: &EmbeddingSearchConfig,
        dimensions: usize,
        sources: Vec<EmbeddingSearchSourceManifestEntry>,
        entries: Vec<EmbeddingSearchEntry>,
    ) -> Result<EmbeddingSearchIndex, String> {
        let db = self.connect().await?;
        let indexed_at = now_secs();
        let metadata = vec![
            (
                "version".to_string(),
                EMBEDDING_SEARCH_INDEX_VERSION.to_string(),
            ),
            (
                "store_kind".to_string(),
                SemanticSearchStoreKind::LanceDb.as_str().to_string(),
            ),
            ("base_url".to_string(), config.base_url.clone()),
            ("model".to_string(), config.model.clone()),
            ("dimensions".to_string(), dimensions.to_string()),
            ("indexed_at".to_string(), indexed_at.to_string()),
        ];

        db.create_table(
            LANCEDB_SEMANTIC_METADATA_TABLE,
            lancedb_metadata_batch(&metadata)?,
        )
        .mode(lancedb::database::CreateTableMode::Overwrite)
        .execute()
        .await
        .map_err(|e| format!("write LanceDB semantic metadata: {}", e))?;

        db.create_table(
            LANCEDB_SEMANTIC_SOURCES_TABLE,
            lancedb_sources_batch(&sources)?,
        )
        .mode(lancedb::database::CreateTableMode::Overwrite)
        .execute()
        .await
        .map_err(|e| format!("write LanceDB semantic sources: {}", e))?;

        db.create_table(
            LANCEDB_SEMANTIC_ENTRIES_TABLE,
            lancedb_entries_batch(&entries, dimensions)?,
        )
        .mode(lancedb::database::CreateTableMode::Overwrite)
        .execute()
        .await
        .map_err(|e| format!("write LanceDB semantic entries: {}", e))?;

        Ok(EmbeddingSearchIndex {
            entries: Vec::new(),
        })
    }

    async fn status(&self, config: &EmbeddingSearchConfig) -> SemanticRagStoreStatus {
        if !self.path.exists() {
            return SemanticRagStoreStatus {
                ready: false,
                entries: 0,
                error: None,
            };
        }

        let db = match self.connect().await {
            Ok(db) => db,
            Err(error) => {
                return SemanticRagStoreStatus {
                    ready: false,
                    entries: 0,
                    error: Some(error),
                };
            }
        };
        let metadata = match load_lancedb_metadata(&db).await {
            Ok(metadata) => metadata,
            Err(_) => {
                return SemanticRagStoreStatus {
                    ready: false,
                    entries: 0,
                    error: None,
                };
            }
        };
        let entries = lancedb_entry_count(&db).await.unwrap_or(0);
        SemanticRagStoreStatus {
            ready: entries > 0 && semantic_store_metadata_matches(&metadata, config),
            entries,
            error: None,
        }
    }

    async fn search(
        &self,
        query_vector: &[f32],
        limit: usize,
        project_id: Option<&str>,
    ) -> Result<Vec<SearchResult>, String> {
        use futures::TryStreamExt;
        use lancedb::query::{ExecutableQuery, QueryBase};

        let db = self.connect().await?;
        let table = db
            .open_table(LANCEDB_SEMANTIC_ENTRIES_TABLE)
            .execute()
            .await
            .map_err(|e| format!("open LanceDB semantic entries: {}", e))?;
        let mut query = table
            .query()
            .nearest_to(query_vector)
            .map_err(|e| format!("prepare LanceDB vector search: {}", e))?
            .distance_type(lancedb::DistanceType::Cosine)
            .limit(limit);
        if let Some(project_id) = project_id {
            query = query.only_if(format!(
                "project_id = {}",
                lancedb_sql_string_literal(project_id)
            ));
        }
        let batches = query
            .execute()
            .await
            .map_err(|e| format!("execute LanceDB vector search: {}", e))?
            .try_collect::<Vec<_>>()
            .await
            .map_err(|e| format!("collect LanceDB vector search: {}", e))?;
        parse_lancedb_search_results(&batches)
    }
}

impl SemanticRagStoreAdapter {
    fn new(config: &EmbeddingSearchConfig) -> Self {
        match config.store {
            SemanticSearchStoreKind::Sqlite => Self::Sqlite(SqliteSemanticRagStore::new()),
            SemanticSearchStoreKind::LanceDb => Self::LanceDb(LanceDbSemanticRagStore::new()),
        }
    }

    fn kind(&self) -> SemanticSearchStoreKind {
        match self {
            Self::Sqlite(_) => SemanticSearchStoreKind::Sqlite,
            Self::LanceDb(_) => SemanticSearchStoreKind::LanceDb,
        }
    }

    async fn load_current(
        &self,
        config: &EmbeddingSearchConfig,
        sources: &[EmbeddingSearchSourceManifestEntry],
    ) -> Result<Option<EmbeddingSearchIndex>, String> {
        match self {
            Self::Sqlite(store) => store.load_current(config, sources),
            Self::LanceDb(store) => store.load_current(config, sources).await,
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
            Self::LanceDb(store) => store.replace(config, dimensions, sources, entries).await,
        }
    }

    async fn status(&self, config: &EmbeddingSearchConfig) -> SemanticRagStoreStatus {
        match self {
            Self::Sqlite(store) => store.status(config),
            Self::LanceDb(store) => store.status(config).await,
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
            Self::LanceDb(store) => store.search(query_vector, limit, project_id).await,
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
        && metadata.get("store_kind").map(String::as_str) == Some(config.store.as_str())
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

fn lancedb_metadata_batch(
    metadata: &[(String, String)],
) -> Result<arrow_array::RecordBatch, String> {
    let schema = std::sync::Arc::new(arrow_schema::Schema::new(vec![
        arrow_schema::Field::new("key", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("value", arrow_schema::DataType::Utf8, false),
    ]));
    let keys = metadata
        .iter()
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    let values = metadata
        .iter()
        .map(|(_, value)| value.clone())
        .collect::<Vec<_>>();
    arrow_array::RecordBatch::try_new(
        schema,
        vec![
            std::sync::Arc::new(arrow_array::StringArray::from(keys)),
            std::sync::Arc::new(arrow_array::StringArray::from(values)),
        ],
    )
    .map_err(|e| format!("build LanceDB semantic metadata batch: {}", e))
}

fn lancedb_sources_batch(
    sources: &[EmbeddingSearchSourceManifestEntry],
) -> Result<arrow_array::RecordBatch, String> {
    let schema = std::sync::Arc::new(arrow_schema::Schema::new(vec![
        arrow_schema::Field::new("path", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("source_kind", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("session_id", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("size", arrow_schema::DataType::Int64, false),
        arrow_schema::Field::new("mtime", arrow_schema::DataType::Int64, false),
    ]));
    arrow_array::RecordBatch::try_new(
        schema,
        vec![
            std::sync::Arc::new(arrow_array::StringArray::from(
                sources
                    .iter()
                    .map(|source| source.path.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(
                sources
                    .iter()
                    .map(|source| source.source_kind.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(
                sources
                    .iter()
                    .map(|source| source.session_id.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::Int64Array::from(
                sources
                    .iter()
                    .map(|source| u64_to_sql_i64(source.size))
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::Int64Array::from(
                sources
                    .iter()
                    .map(|source| u64_to_sql_i64(source.mtime))
                    .collect::<Vec<_>>(),
            )),
        ],
    )
    .map_err(|e| format!("build LanceDB semantic sources batch: {}", e))
}

fn lancedb_entries_batch(
    entries: &[EmbeddingSearchEntry],
    dimensions: usize,
) -> Result<arrow_array::RecordBatch, String> {
    let dimensions_i32 = i32::try_from(dimensions)
        .map_err(|_| "Embedding dimensions are too large for LanceDB.".to_string())?;
    let schema = std::sync::Arc::new(arrow_schema::Schema::new(vec![
        arrow_schema::Field::new("source_path", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("source_kind", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("source_size", arrow_schema::DataType::Int64, false),
        arrow_schema::Field::new("source_mtime", arrow_schema::DataType::Int64, false),
        arrow_schema::Field::new("session_id", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("project_id", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("timestamp", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("text", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new("result_json", arrow_schema::DataType::Utf8, false),
        arrow_schema::Field::new(
            "vector",
            arrow_schema::DataType::FixedSizeList(
                std::sync::Arc::new(arrow_schema::Field::new(
                    "item",
                    arrow_schema::DataType::Float32,
                    true,
                )),
                dimensions_i32,
            ),
            false,
        ),
    ]));
    let vectors = arrow_array::FixedSizeListArray::from_iter_primitive::<
        arrow_array::types::Float32Type,
        _,
        _,
    >(
        entries
            .iter()
            .map(|entry| Some(entry.vector.iter().copied().map(Some).collect::<Vec<_>>())),
        dimensions_i32,
    );
    let result_json = entries
        .iter()
        .map(|entry| serde_json::to_string(&entry.result))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("serialize LanceDB semantic entry result: {}", e))?;

    arrow_array::RecordBatch::try_new(
        schema,
        vec![
            std::sync::Arc::new(arrow_array::StringArray::from(
                entries
                    .iter()
                    .map(|entry| entry.source_path.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(
                entries
                    .iter()
                    .map(|entry| entry.source_kind.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::Int64Array::from(
                entries
                    .iter()
                    .map(|entry| u64_to_sql_i64(entry.source_size))
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::Int64Array::from(
                entries
                    .iter()
                    .map(|entry| u64_to_sql_i64(entry.source_mtime))
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(
                entries
                    .iter()
                    .map(|entry| entry.result.session_id.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(
                entries
                    .iter()
                    .map(|entry| entry.result.project_id.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(
                entries
                    .iter()
                    .map(|entry| entry.result.timestamp.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(
                entries
                    .iter()
                    .map(|entry| entry.text.clone())
                    .collect::<Vec<_>>(),
            )),
            std::sync::Arc::new(arrow_array::StringArray::from(result_json)),
            std::sync::Arc::new(vectors),
        ],
    )
    .map_err(|e| format!("build LanceDB semantic entries batch: {}", e))
}

async fn lancedb_scan_table(
    db: &lancedb::Connection,
    table_name: &str,
) -> Result<Vec<arrow_array::RecordBatch>, String> {
    use futures::TryStreamExt;
    use lancedb::query::ExecutableQuery;

    let table = db
        .open_table(table_name)
        .execute()
        .await
        .map_err(|e| format!("open LanceDB table '{}': {}", table_name, e))?;
    table
        .query()
        .execute()
        .await
        .map_err(|e| format!("scan LanceDB table '{}': {}", table_name, e))?
        .try_collect::<Vec<_>>()
        .await
        .map_err(|e| format!("collect LanceDB table '{}': {}", table_name, e))
}

fn lancedb_string_column<'a>(
    batch: &'a arrow_array::RecordBatch,
    name: &str,
) -> Result<&'a arrow_array::StringArray, String> {
    let index = batch
        .schema()
        .index_of(name)
        .map_err(|e| format!("missing LanceDB column '{}': {}", name, e))?;
    batch
        .column(index)
        .as_any()
        .downcast_ref::<arrow_array::StringArray>()
        .ok_or_else(|| format!("LanceDB column '{}' is not a string", name))
}

fn lancedb_i64_column<'a>(
    batch: &'a arrow_array::RecordBatch,
    name: &str,
) -> Result<&'a arrow_array::Int64Array, String> {
    let index = batch
        .schema()
        .index_of(name)
        .map_err(|e| format!("missing LanceDB column '{}': {}", name, e))?;
    batch
        .column(index)
        .as_any()
        .downcast_ref::<arrow_array::Int64Array>()
        .ok_or_else(|| format!("LanceDB column '{}' is not an int64", name))
}

async fn load_lancedb_metadata(
    db: &lancedb::Connection,
) -> Result<HashMap<String, String>, String> {
    use arrow_array::Array;

    let batches = lancedb_scan_table(db, LANCEDB_SEMANTIC_METADATA_TABLE).await?;
    let mut metadata = HashMap::new();
    for batch in batches {
        let keys = lancedb_string_column(&batch, "key")?;
        let values = lancedb_string_column(&batch, "value")?;
        for row in 0..batch.num_rows() {
            if keys.is_null(row) || values.is_null(row) {
                continue;
            }
            metadata.insert(keys.value(row).to_string(), values.value(row).to_string());
        }
    }
    Ok(metadata)
}

async fn load_lancedb_sources(
    db: &lancedb::Connection,
) -> Result<Vec<EmbeddingSearchSourceManifestEntry>, String> {
    use arrow_array::Array;

    let batches = lancedb_scan_table(db, LANCEDB_SEMANTIC_SOURCES_TABLE).await?;
    let mut sources = Vec::new();
    for batch in batches {
        let paths = lancedb_string_column(&batch, "path")?;
        let source_kinds = lancedb_string_column(&batch, "source_kind")?;
        let session_ids = lancedb_string_column(&batch, "session_id")?;
        let sizes = lancedb_i64_column(&batch, "size")?;
        let mtimes = lancedb_i64_column(&batch, "mtime")?;
        for row in 0..batch.num_rows() {
            if paths.is_null(row) || source_kinds.is_null(row) || session_ids.is_null(row) {
                continue;
            }
            sources.push(EmbeddingSearchSourceManifestEntry {
                path: paths.value(row).to_string(),
                source_kind: source_kinds.value(row).to_string(),
                session_id: session_ids.value(row).to_string(),
                size: sizes.value(row).max(0) as u64,
                mtime: mtimes.value(row).max(0) as u64,
            });
        }
    }
    sources.sort();
    Ok(sources)
}

async fn lancedb_entry_count(db: &lancedb::Connection) -> Result<usize, String> {
    let batches = lancedb_scan_table(db, LANCEDB_SEMANTIC_ENTRIES_TABLE).await?;
    Ok(batches.iter().map(|batch| batch.num_rows()).sum())
}

fn lancedb_sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn lancedb_distance_score(batch: &arrow_array::RecordBatch, row: usize) -> Option<f32> {
    use arrow_array::Array;

    let index = batch
        .schema()
        .index_of("_distance")
        .or_else(|_| batch.schema().index_of("_score"))
        .ok()?;
    let column = batch.column(index);
    if column.is_null(row) {
        return None;
    }
    if let Some(values) = column.as_any().downcast_ref::<arrow_array::Float32Array>() {
        return Some(1.0 - values.value(row));
    }
    if let Some(values) = column.as_any().downcast_ref::<arrow_array::Float64Array>() {
        return Some((1.0 - values.value(row)) as f32);
    }
    None
}

fn parse_lancedb_search_results(
    batches: &[arrow_array::RecordBatch],
) -> Result<Vec<SearchResult>, String> {
    use arrow_array::Array;

    let mut results = Vec::new();
    for batch in batches {
        let result_json = lancedb_string_column(batch, "result_json")?;
        for row in 0..batch.num_rows() {
            if result_json.is_null(row) {
                continue;
            }
            let mut result = serde_json::from_str::<SearchResult>(result_json.value(row))
                .map_err(|e| format!("parse LanceDB semantic result: {}", e))?;
            if let Some(score) = lancedb_distance_score(batch, row) {
                result.score = score;
            }
            results.push(result);
        }
    }
    Ok(results)
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

        let (text_content, is_tool) = extract_content_with_meta(&msg.content);
        let is_meta = parsed.is_meta.unwrap_or(false);
        let is_user_prompt = is_user_prompt_content(&role, is_tool, &text_content);
        let display_role = if is_ai_authored_user_content(&role, is_tool, &text_content) {
            "assistant".to_string()
        } else {
            role.clone()
        };

        if !is_meta && is_user_prompt && !text_content.is_empty() {
            round_index += 1;
            round_prompt = text_content.clone();
            round_timestamp = parsed.timestamp.clone().unwrap_or_default();
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
            ("round prompt", round_prompt.clone()),
            (display_role.as_str(), text_content.clone()),
        ]);
        let timestamp = parsed.timestamp.clone().unwrap_or_default();
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
                    uuid: parsed.uuid.clone().unwrap_or_default(),
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
                    timestamp,
                    score: 0.0,
                },
            },
        );
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

    for message in messages {
        if candidates.len() >= EMBEDDING_SEARCH_MAX_CHUNKS_PER_SESSION {
            break;
        }
        if message.is_meta || message.content.trim().is_empty() {
            continue;
        }
        let is_user_prompt =
            is_user_prompt_content(&message.role, message.is_tool, &message.content);
        let display_role =
            if is_ai_authored_user_content(&message.role, message.is_tool, &message.content) {
                "assistant".to_string()
            } else {
                message.role.clone()
            };
        if is_user_prompt {
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
        .user_agent("Lovcode/semantic-search")
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

#[tauri::command]
pub(crate) async fn get_semantic_search_status() -> Result<SemanticSearchStatus, String> {
    let config = match load_embedding_search_config() {
        Ok(config) => config,
        Err(error) => {
            return Ok(SemanticSearchStatus {
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
pub(crate) async fn semantic_search_chats(
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
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
        Some("text") => obj
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
                        Some("text") => None,
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
