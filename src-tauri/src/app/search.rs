use super::*;
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};

// ============================================================================
// Search Feature
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
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

#[tauri::command]
pub(crate) fn search_chats(
    query: String,
    limit: Option<usize>,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let max_results = limit.unwrap_or(50);

    // Try to get index from global state or load from disk
    let mut guard = SEARCH_INDEX.lock().map_err(|e| e.to_string())?;

    if guard.is_none() {
        let index_dir = get_index_dir();
        if !index_dir.exists() {
            return Err("Search index not built. Please build index first.".to_string());
        }

        let index = Index::open_in_dir(&index_dir).map_err(|e| e.to_string())?;
        let schema = index.schema();
        // Register jieba tokenizer for Chinese support
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

    let search_index = guard.as_ref().unwrap();
    let reader = search_index
        .index
        .reader_builder()
        .reload_policy(ReloadPolicy::OnCommitWithDelay)
        .try_into()
        .map_err(|e: tantivy::TantivyError| e.to_string())?;

    let searcher = reader.searcher();

    let default_fields = ["content"]
        .iter()
        .filter_map(|name| search_index.schema.get_field(name).ok())
        .collect::<Vec<_>>();

    let normalized_query = normalize_scoped_search_query(&query, &search_index.schema);
    let mut query_parser = QueryParser::for_index(&search_index.index, default_fields);
    query_parser.set_conjunction_by_default();
    if let Ok(title_field) = search_index.schema.get_field("title") {
        query_parser.set_field_boost(title_field, 2.0);
    }
    if let Ok(prompt_field) = search_index.schema.get_field("prompt") {
        query_parser.set_field_boost(prompt_field, 1.4);
    }
    if let Ok(round_prompt_field) = search_index.schema.get_field("round_prompt") {
        query_parser.set_field_boost(round_prompt_field, 1.2);
    }
    let parsed_query = query_parser
        .parse_query(&normalized_query)
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

        // Filter by project_id if specified
        if let Some(ref filter_id) = project_id {
            if &doc_project_id != filter_id {
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
