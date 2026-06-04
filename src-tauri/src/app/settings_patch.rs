use super::*;

struct EditorTarget {
    id: &'static str,
    label: &'static str,
    commands: &'static [&'static str],
    macos_apps: &'static [&'static str],
    macos_app_paths: &'static [&'static str],
}

struct CodexThreadForYoda {
    cwd: String,
    title: String,
    created_at_ms: i64,
    updated_at_ms: i64,
}

struct YodaProjectTarget {
    project_id: String,
}

const DEFAULT_EDITOR_TARGET: EditorTarget = EditorTarget {
    id: "default",
    label: "a supported editor",
    commands: &["cursor", "code", "zed"],
    macos_apps: &["Cursor", "Visual Studio Code", "Zed"],
    macos_app_paths: &[],
};

const EDITOR_TARGETS: &[EditorTarget] = &[
    EditorTarget {
        id: "yoda",
        label: "Yoda",
        commands: &["yoda"],
        macos_apps: &["Yoda"],
        macos_app_paths: &[
            "/Applications/Yoda.app",
            "~/lovstudio/coding/yoda/release/mac-arm64/Yoda.app",
            "~/lovstudio/coding/yoda/release/mac/Yoda.app",
        ],
    },
    EditorTarget {
        id: "vscode",
        label: "VS Code",
        commands: &["code"],
        macos_apps: &["Visual Studio Code"],
        macos_app_paths: &["/Applications/Visual Studio Code.app"],
    },
    EditorTarget {
        id: "cursor",
        label: "Cursor",
        commands: &["cursor"],
        macos_apps: &["Cursor"],
        macos_app_paths: &["/Applications/Cursor.app"],
    },
    EditorTarget {
        id: "zed",
        label: "Zed",
        commands: &["zed"],
        macos_apps: &["Zed"],
        macos_app_paths: &["/Applications/Zed.app"],
    },
];

fn editor_target_by_id(editor_id: &str) -> Option<&'static EditorTarget> {
    EDITOR_TARGETS.iter().find(|target| target.id == editor_id)
}

pub(crate) fn open_in_editor(path: String) -> Result<(), String> {
    open_in_editor_with_target(path, None)
}

pub(crate) fn open_in_editor_with_target(
    path: String,
    editor: Option<String>,
) -> Result<(), String> {
    let target = match editor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        None | Some("default") => &DEFAULT_EDITOR_TARGET,
        Some(editor_id) => editor_target_by_id(editor_id)
            .ok_or_else(|| format!("Unsupported editor target: {}", editor_id))?,
    };

    open_with_editor_target(&path, target)
        .map_err(|message| format!("Could not open {} with {}. {}", path, target.label, message))
}

fn open_with_editor_target(path: &str, target: &EditorTarget) -> Result<(), String> {
    if target.id == "yoda" {
        return open_yoda_project_path(path).or_else(|project_error| {
            open_path_with_editor_target(path, target).map_err(|path_error| {
                format!(
                    "{} Also could not open the path with Yoda. {}",
                    project_error, path_error
                )
            })
        });
    }

    open_path_with_editor_target(path, target)
}

fn open_path_with_editor_target(path: &str, target: &EditorTarget) -> Result<(), String> {
    for command in target.commands {
        if std::process::Command::new(command)
            .arg(path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }

    if open_with_macos_editor(path, target)? {
        return Ok(());
    }

    let supported = target
        .commands
        .iter()
        .chain(target.macos_apps.iter())
        .chain(target.macos_app_paths.iter())
        .copied()
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!("Install or expose one of: {}", supported))
}

#[cfg(target_os = "macos")]
fn open_with_macos_editor(path: &str, target: &EditorTarget) -> Result<bool, String> {
    for app in target.macos_apps {
        if let Ok(status) = std::process::Command::new("open")
            .arg("-a")
            .arg(app)
            .arg(path)
            .status()
        {
            if status.success() {
                return Ok(true);
            }
        }
    }

    for app_path in target.macos_app_paths {
        let expanded_app_path = expand_home_path(app_path);
        if !expanded_app_path.exists() {
            continue;
        }
        if let Ok(status) = std::process::Command::new("open")
            .arg("-a")
            .arg(&expanded_app_path)
            .arg(path)
            .status()
        {
            if status.success() {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[cfg(not(target_os = "macos"))]
fn open_with_macos_editor(_path: &str, _target: &EditorTarget) -> Result<bool, String> {
    Ok(false)
}

fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

pub(crate) fn open_session_in_yoda(session_id: &str, transcript_path: &Path) -> Result<(), String> {
    let conversation_id = session_id.trim();
    if conversation_id.is_empty() {
        return Err("Session ID is empty.".to_string());
    }

    if let Some(thread) = read_codex_thread_for_yoda(conversation_id, transcript_path)? {
        let yoda_conversation_id =
            ensure_yoda_conversation_for_codex_thread(conversation_id, &thread)?;
        return open_yoda_conversation(&yoda_conversation_id);
    }

    if yoda_conversation_exists(conversation_id)? {
        return open_yoda_conversation(conversation_id);
    }

    Err(format!(
        "Yoda has no conversation mapped to Lovcode session {} and Codex session metadata was not found for transcript {}.",
        conversation_id,
        transcript_path.to_string_lossy()
    ))
}

fn open_yoda_project_path(path: &str) -> Result<(), String> {
    let project_path = path.trim();
    if project_path.is_empty() {
        return Err("Project path is empty.".to_string());
    }

    let conn = open_yoda_db()?;
    let conversation_id = match conn.query_row(
        "select c.id
         from conversations c
         join projects p on p.id = c.project_id
         where p.path = ?1
         order by coalesce(c.last_interacted_at, c.updated_at, c.created_at) desc
         limit 1",
        rusqlite::params![project_path],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(format!(
                "Yoda has no project conversation for path {}. Open or import this project in Yoda first.",
                project_path
            ));
        }
        Err(error) => return Err(format!("Failed to look up Yoda project: {}", error)),
    };

    open_yoda_conversation(&conversation_id)
}

fn yoda_conversation_exists(conversation_id: &str) -> Result<bool, String> {
    let conn = open_yoda_db()?;
    let exists = conn
        .query_row(
            "select exists(select 1 from conversations where id = ?1)",
            rusqlite::params![conversation_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Failed to look up Yoda conversation: {}", error))?;
    Ok(exists != 0)
}

fn ensure_yoda_conversation_for_codex_thread(
    session_id: &str,
    thread: &CodexThreadForYoda,
) -> Result<String, String> {
    let mut conn = open_yoda_db_read_write()?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Failed to configure Yoda database timeout: {}", error))?;

    let tx = conn
        .transaction()
        .map_err(|error| format!("Failed to start Yoda registration transaction: {}", error))?;
    let project = ensure_yoda_project_for_codex_thread(&tx, thread)?;
    let task_id = ensure_yoda_task_for_codex_session(&tx, session_id, thread, &project)?;
    ensure_yoda_conversation_for_codex_session_in_tx(
        &tx,
        session_id,
        thread,
        &project.project_id,
        &task_id,
    )?;
    tx.commit()
        .map_err(|error| format!("Failed to save Yoda conversation mapping: {}", error))?;

    Ok(session_id.to_string())
}

fn ensure_yoda_project_for_codex_thread(
    tx: &rusqlite::Transaction<'_>,
    thread: &CodexThreadForYoda,
) -> Result<YodaProjectTarget, String> {
    let project_path = project_path_for_yoda_registration(&thread.cwd);
    if let Some(project_id) = find_yoda_project_id_by_path(tx, &project_path)? {
        tx.execute(
            "update projects
             set archived_at = null,
                 updated_at = CURRENT_TIMESTAMP
             where id = ?1",
            rusqlite::params![project_id.as_str()],
        )
        .map_err(|error| format!("Failed to unarchive Yoda project: {}", error))?;
        return Ok(YodaProjectTarget { project_id });
    }

    let project_id = stable_prefixed_id("lovcode-codex-project-", &project_path);
    let project_name = project_name_for_path(&project_path);
    let base_ref = detect_git_base_ref(&project_path).unwrap_or_else(|| "main".to_string());

    tx.execute(
        "insert into projects (
             id,
             name,
             path,
             workspace_provider,
             base_ref,
             created_at,
             updated_at
         ) values (?1, ?2, ?3, 'local', ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        rusqlite::params![
            project_id.as_str(),
            project_name.as_str(),
            project_path.as_str(),
            base_ref.as_str(),
        ],
    )
    .map_err(|error| format!("Failed to create Yoda project mapping: {}", error))?;

    Ok(YodaProjectTarget { project_id })
}

fn find_yoda_project_id_by_path(
    tx: &rusqlite::Transaction<'_>,
    project_path: &str,
) -> Result<Option<String>, String> {
    match tx.query_row(
        "select id from projects where path = ?1 limit 1",
        rusqlite::params![project_path],
        |row| row.get::<_, String>(0),
    ) {
        Ok(project_id) => Ok(Some(project_id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to look up Yoda project path: {}", error)),
    }
}

fn ensure_yoda_task_for_codex_session(
    tx: &rusqlite::Transaction<'_>,
    session_id: &str,
    thread: &CodexThreadForYoda,
    project: &YodaProjectTarget,
) -> Result<String, String> {
    let task_id = yoda_task_id_for_session(session_id);
    let title = nonempty_title_or(&thread.title, session_id);
    let created_at = yoda_sqlite_timestamp_from_ms(thread.created_at_ms);
    let updated_at = yoda_sqlite_timestamp_from_ms(thread.updated_at_ms);
    let last_interacted_at = yoda_rfc3339_timestamp_from_ms(thread.updated_at_ms);

    tx.execute(
        "insert into tasks (
             id,
             project_id,
             name,
             status,
             source_branch,
             task_branch,
             created_at,
             updated_at,
             last_interacted_at,
             status_changed_at,
             workspace_provider,
             workspace_id,
             workspace_provider_data,
             is_user_named,
             needs_review
         ) values (?1, ?2, ?3, 'in_progress', null, null, ?4, ?5, ?6, ?4, null, null, null, 0, 0)
         on conflict(id) do update set
             project_id = excluded.project_id,
             name = excluded.name,
             archived_at = null,
             updated_at = excluded.updated_at,
             last_interacted_at = excluded.last_interacted_at",
        rusqlite::params![
            task_id.as_str(),
            project.project_id.as_str(),
            title.as_str(),
            created_at.as_str(),
            updated_at.as_str(),
            last_interacted_at.as_str(),
        ],
    )
    .map_err(|error| format!("Failed to create Yoda task mapping: {}", error))?;

    Ok(task_id)
}

fn ensure_yoda_conversation_for_codex_session_in_tx(
    tx: &rusqlite::Transaction<'_>,
    session_id: &str,
    thread: &CodexThreadForYoda,
    project_id: &str,
    task_id: &str,
) -> Result<(), String> {
    let title = nonempty_title_or(&thread.title, session_id);
    let created_at = yoda_sqlite_timestamp_from_ms(thread.created_at_ms);
    let updated_at = yoda_sqlite_timestamp_from_ms(thread.updated_at_ms);
    let last_interacted_at = yoda_rfc3339_timestamp_from_ms(thread.updated_at_ms);

    tx.execute(
        "insert into conversations (
             id,
             project_id,
             task_id,
             title,
             provider,
             config,
             created_at,
             updated_at,
             last_interacted_at,
             is_initial_conversation
         ) values (?1, ?2, ?3, ?4, 'codex', '{\"autoApprove\":false}', ?5, ?6, ?7, 1)
         on conflict(id) do update set
             project_id = excluded.project_id,
             task_id = excluded.task_id,
             title = excluded.title,
             provider = 'codex',
             config = excluded.config,
             updated_at = excluded.updated_at,
             last_interacted_at = excluded.last_interacted_at,
             is_initial_conversation = 1",
        rusqlite::params![
            session_id,
            project_id,
            task_id,
            title.as_str(),
            created_at.as_str(),
            updated_at.as_str(),
            last_interacted_at.as_str(),
        ],
    )
    .map_err(|error| format!("Failed to create Yoda conversation mapping: {}", error))?;

    Ok(())
}

fn yoda_task_id_for_session(session_id: &str) -> String {
    format!("lovcode-codex-task-{}", session_id)
}

fn nonempty_title_or(title: &str, fallback: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return format!("Codex session {}", fallback);
    }
    trimmed.to_string()
}

fn project_path_for_yoda_registration(cwd: &str) -> String {
    cwd.trim_end_matches('/').to_string()
}

fn project_name_for_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

fn detect_git_base_ref(project_path: &str) -> Option<String> {
    let head_path = Path::new(project_path).join(".git").join("HEAD");
    let head = fs::read_to_string(head_path).ok()?;
    let trimmed = head.trim();
    trimmed
        .strip_prefix("ref: refs/heads/")
        .filter(|branch| !branch.trim().is_empty())
        .map(|branch| branch.to_string())
}

fn stable_prefixed_id(prefix: &str, value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{}{:016x}", prefix, hash)
}

fn yoda_sqlite_timestamp_from_ms(timestamp_ms: i64) -> String {
    datetime_from_ms(timestamp_ms)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

fn yoda_rfc3339_timestamp_from_ms(timestamp_ms: i64) -> String {
    datetime_from_ms(timestamp_ms).to_rfc3339()
}

fn datetime_from_ms(timestamp_ms: i64) -> chrono::DateTime<chrono::Utc> {
    let seconds = timestamp_ms.div_euclid(1000);
    let nanoseconds = (timestamp_ms.rem_euclid(1000) * 1_000_000) as u32;
    chrono::DateTime::<chrono::Utc>::from_timestamp(seconds, nanoseconds)
        .unwrap_or_else(chrono::Utc::now)
}

fn read_codex_thread_for_yoda(
    session_id: &str,
    transcript_path: &Path,
) -> Result<Option<CodexThreadForYoda>, String> {
    let state_thread = read_codex_state_thread_for_yoda(session_id)?;
    let transcript_thread = read_codex_transcript_thread_for_yoda(session_id, transcript_path);

    Ok(match (state_thread, transcript_thread) {
        (Some(state), Some(transcript)) => Some(CodexThreadForYoda {
            cwd: transcript.cwd,
            title: if state.title.trim().is_empty() {
                transcript.title
            } else {
                state.title
            },
            created_at_ms: state.created_at_ms,
            updated_at_ms: state.updated_at_ms,
        }),
        (Some(state), None) => Some(state),
        (None, Some(transcript)) => Some(transcript),
        (None, None) => None,
    })
}

fn read_codex_state_thread_for_yoda(
    session_id: &str,
) -> Result<Option<CodexThreadForYoda>, String> {
    let Some(path) = codex_state_db_path() else {
        return Ok(None);
    };

    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| format!("Failed to open Codex state database: {}", error))?;

    match conn.query_row(
        "select
             cwd,
             coalesce(nullif(title, ''), nullif(first_user_message, ''), id),
             coalesce(created_at_ms, created_at * 1000),
             coalesce(updated_at_ms, updated_at * 1000)
         from threads
         where id = ?1
            or rollout_path like '%' || ?1 || '%'
         order by archived asc, coalesce(updated_at_ms, updated_at * 1000) desc
         limit 1",
        rusqlite::params![session_id],
        |row| {
            Ok(CodexThreadForYoda {
                cwd: row.get(0)?,
                title: row.get(1)?,
                created_at_ms: row.get(2)?,
                updated_at_ms: row.get(3)?,
            })
        },
    ) {
        Ok(thread) => Ok(Some(thread)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to look up Codex session: {}", error)),
    }
}

fn read_codex_transcript_thread_for_yoda(
    session_id: &str,
    transcript_path: &Path,
) -> Option<CodexThreadForYoda> {
    if !is_codex_session_path(transcript_path) {
        return None;
    }

    let head = read_codex_session_meta_lightweight(transcript_path);
    let cwd = head.cwd?.trim().trim_end_matches('/').to_string();
    if cwd.is_empty() {
        return None;
    }

    let metadata = fs::metadata(transcript_path).ok();
    let modified_at_ms = metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_ms)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let created_at_ms = head
        .created_at
        .and_then(|timestamp| i64::try_from(timestamp).ok())
        .and_then(|timestamp| timestamp.checked_mul(1000))
        .or_else(|| {
            metadata
                .as_ref()
                .and_then(|metadata| metadata.created().ok())
                .and_then(system_time_to_ms)
        })
        .unwrap_or(modified_at_ms);
    let title = head
        .title
        .or(head.last_prompt)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| session_id.to_string());

    Some(CodexThreadForYoda {
        cwd,
        title,
        created_at_ms,
        updated_at_ms: modified_at_ms,
    })
}

fn system_time_to_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn codex_state_db_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        let trimmed = codex_home.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("state_5.sqlite"));
        }
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".codex/state_5.sqlite"));
    }

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn open_yoda_db() -> Result<rusqlite::Connection, String> {
    open_yoda_db_with_flags(rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
}

fn open_yoda_db_read_write() -> Result<rusqlite::Connection, String> {
    open_yoda_db_with_flags(rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
}

fn open_yoda_db_with_flags(flags: rusqlite::OpenFlags) -> Result<rusqlite::Connection, String> {
    let Some(path) = yoda_db_path_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
    else {
        return Err(
            "Yoda database was not found. Launch Yoda once before opening from Lovcode."
                .to_string(),
        );
    };

    rusqlite::Connection::open_with_flags(path, flags)
        .map_err(|error| format!("Failed to open Yoda database: {}", error))
}

fn yoda_db_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(data_dir) = dirs::data_dir() {
        candidates.push(data_dir.join("yoda").join("yoda4.db"));
    }
    if let Some(config_dir) = dirs::config_dir() {
        candidates.push(config_dir.join("yoda").join("yoda4.db"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Library/Application Support/yoda/yoda4.db"));
        candidates.push(home.join(".config/yoda/yoda4.db"));
    }

    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|existing| existing == &candidate) {
            unique.push(candidate);
        }
    }
    unique
}

fn open_yoda_conversation(conversation_id: &str) -> Result<(), String> {
    let target =
        editor_target_by_id("yoda").ok_or_else(|| "Yoda target is not configured.".to_string())?;
    let url = format!(
        "yoda://session/{}",
        percent_encode_url_component(conversation_id)
    );
    open_yoda_url(&url, target)
}

fn open_yoda_url(url: &str, target: &EditorTarget) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if run_open_command(std::process::Command::new("open").arg(url)) {
            return Ok(());
        }

        for app in target.macos_apps {
            if run_open_command(
                std::process::Command::new("open")
                    .arg("-a")
                    .arg(app)
                    .arg(url),
            ) {
                return Ok(());
            }
        }

        for app_path in target.macos_app_paths {
            let expanded_app_path = expand_home_path(app_path);
            if !expanded_app_path.exists() {
                continue;
            }
            if run_open_command(
                std::process::Command::new("open")
                    .arg("-a")
                    .arg(&expanded_app_path)
                    .arg(url),
            ) {
                return Ok(());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if run_open_command(std::process::Command::new("cmd").args(["/C", "start", "", url])) {
            return Ok(());
        }
    }

    #[cfg(target_os = "linux")]
    {
        if run_open_command(std::process::Command::new("xdg-open").arg(url)) {
            return Ok(());
        }
    }

    Err("Could not open Yoda deep link.".to_string())
}

fn run_open_command(command: &mut std::process::Command) -> bool {
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn percent_encode_url_component(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{:02X}", byte));
        }
    }
    output
}

pub(crate) fn open_file_at_line(path: String, line: usize) -> Result<(), String> {
    // 尝试用 cursor，失败则用 code (VSCode)
    let editors = ["cursor", "code", "zed"];

    for editor in editors {
        let result = std::process::Command::new(editor)
            .arg("--goto")
            .arg(format!("{}:{}", path, line))
            .spawn();

        if result.is_ok() {
            return Ok(());
        }
    }

    // 都失败则用系统默认方式打开
    open_in_editor(path)
}

pub(crate) fn get_settings_path() -> String {
    get_claude_dir()
        .join("settings.json")
        .to_string_lossy()
        .to_string()
}

pub(crate) fn get_mcp_config_path() -> String {
    get_claude_json_path().to_string_lossy().to_string()
}

pub(crate) fn get_home_dir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

pub(crate) fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TodayCodingStats {
    pub lines_added: usize,
    pub lines_deleted: usize,
}

pub(crate) static TODAY_STATS_CACHE: LazyLock<
    Mutex<Option<(std::time::SystemTime, TodayCodingStats)>>,
> = LazyLock::new(|| Mutex::new(None));

pub(crate) const TODAY_STATS_TTL: Duration = Duration::from_secs(30);

#[tauri::command]
pub(crate) async fn get_today_coding_stats() -> Result<TodayCodingStats, String> {
    if let Ok(guard) = TODAY_STATS_CACHE.lock() {
        if let Some((fetched_at, stats)) = guard.as_ref() {
            if fetched_at
                .elapsed()
                .map(|elapsed| elapsed < TODAY_STATS_TTL)
                .unwrap_or(false)
            {
                return Ok(stats.clone());
            }
        }
    }

    let stats = tauri::async_runtime::spawn_blocking(get_today_coding_stats_blocking)
        .await
        .map_err(|e| e.to_string())??;

    if let Ok(mut guard) = TODAY_STATS_CACHE.lock() {
        *guard = Some((std::time::SystemTime::now(), stats.clone()));
    }

    Ok(stats)
}

pub(crate) fn get_today_coding_stats_blocking() -> Result<TodayCodingStats, String> {
    use std::process::Command;

    let projects_dir = get_claude_dir().join("projects");
    if !projects_dir.exists() {
        return Ok(TodayCodingStats {
            lines_added: 0,
            lines_deleted: 0,
        });
    }

    // Collect project paths by decoding ~/.claude/projects/<encoded> dir names.
    let mut project_paths: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_dir() {
                let id = p.file_name().unwrap().to_string_lossy().to_string();
                project_paths.push(decode_project_path(&id));
            }
        }
    }

    let mut total_added: usize = 0;
    let mut total_deleted: usize = 0;
    let mut git_roots: std::collections::HashSet<String> = std::collections::HashSet::new();

    for path in &project_paths {
        let path = path.as_str();
        if !PathBuf::from(path).exists() {
            continue;
        }

        let output = Command::new("git")
            .args(["-C", path, "rev-parse", "--show-toplevel"])
            .output();

        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }

        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !root.is_empty() {
            git_roots.insert(root);
        }
    }

    let mut add_numstat = |bytes: &[u8]| {
        let stdout = String::from_utf8_lossy(bytes);
        for line in stdout.lines() {
            let mut cols = line.split('\t');
            let added = cols.next().unwrap_or("");
            let deleted = cols.next().unwrap_or("");
            if added == "-" || deleted == "-" {
                continue;
            }
            total_added += added.parse::<usize>().unwrap_or(0);
            total_deleted += deleted.parse::<usize>().unwrap_or(0);
        }
    };

    for root in git_roots {
        for args in [
            vec![
                "-C",
                root.as_str(),
                "log",
                "--since=midnight",
                "--numstat",
                "--pretty=format:",
            ],
            vec!["-C", root.as_str(), "diff", "--cached", "--numstat"],
            vec!["-C", root.as_str(), "diff", "--numstat"],
        ] {
            let output = Command::new("git").args(args).output();
            if let Ok(output) = output {
                if output.status.success() {
                    add_numstat(&output.stdout);
                }
            }
        }
    }

    Ok(TodayCodingStats {
        lines_added: total_added,
        lines_deleted: total_deleted,
    })
}

pub(crate) fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub(crate) fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn update_mcp_env(
    server_name: String,
    env_key: String,
    env_value: String,
) -> Result<(), String> {
    let claude_json_path = get_claude_json_path();

    let mut claude_json: serde_json::Value = if claude_json_path.exists() {
        let content = fs::read_to_string(&claude_json_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("~/.claude.json not found".to_string());
    };

    let server = claude_json
        .get_mut("mcpServers")
        .and_then(|s| s.get_mut(&server_name))
        .ok_or_else(|| format!("MCP server '{}' not found", server_name))?;

    if !server.get("env").is_some() {
        server["env"] = serde_json::json!({});
    }
    server["env"][&env_key] = serde_json::Value::String(env_value);

    let output = serde_json::to_string_pretty(&claude_json).map_err(|e| e.to_string())?;
    fs::write(&claude_json_path, output).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum SettingsPatch {
    SetEnv {
        #[serde(rename = "envKey")]
        env_key: String,
        #[serde(rename = "envValue")]
        env_value: String,
        #[serde(rename = "isNew")]
        is_new: Option<bool>,
    },
    DeleteEnv {
        #[serde(rename = "envKey")]
        env_key: String,
    },
    DisableEnv {
        #[serde(rename = "envKey")]
        env_key: String,
    },
    EnableEnv {
        #[serde(rename = "envKey")]
        env_key: String,
    },
    SetDisabledEnv {
        #[serde(rename = "envKey")]
        env_key: String,
        #[serde(rename = "envValue")]
        env_value: String,
    },
    SetField {
        field: String,
        value: Value,
    },
    SetPermissionField {
        field: String,
        value: Value,
    },
    AddPermissionDirectory {
        path: String,
    },
    RemovePermissionDirectory {
        path: String,
    },
    TogglePlugin {
        #[serde(rename = "pluginId")]
        plugin_id: String,
        enabled: bool,
    },
}

pub(crate) fn ensure_settings_object(settings: &mut Value) {
    if !settings.is_object() {
        *settings = serde_json::json!({});
    }
}

pub(crate) fn ensure_settings_child_object(settings: &mut Value, key: &str) {
    ensure_settings_object(settings);
    if !settings
        .get(key)
        .and_then(|value| value.as_object())
        .is_some()
    {
        settings[key] = serde_json::json!({});
    }
}

pub(crate) fn remove_settings_overlay_fields(settings: &mut Value) {
    if let Some(obj) = settings.as_object_mut() {
        obj.remove("_lovcode_disabled_env");
    }
}

pub(crate) fn apply_settings_patches(patches: Vec<SettingsPatch>) -> Result<(), String> {
    let _guard = SETTINGS_WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let settings_path = get_claude_settings_path();
    let disabled_env_path = get_disabled_env_path();
    let mut settings = load_json_object_file(&settings_path)?;
    let mut disabled_env = load_disabled_env()?;

    ensure_settings_object(&mut settings);

    for patch in patches {
        match patch {
            SettingsPatch::SetEnv {
                env_key,
                env_value,
                is_new,
            } => {
                ensure_settings_child_object(&mut settings, "env");
                settings["env"][&env_key] = Value::String(env_value);

                if is_new == Some(true) {
                    let custom_keys = settings
                        .get("_lovcode_custom_env_keys")
                        .and_then(|value| value.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let key_value = Value::String(env_key);
                    if !custom_keys.contains(&key_value) {
                        let mut next_keys = custom_keys;
                        next_keys.push(key_value);
                        settings["_lovcode_custom_env_keys"] = Value::Array(next_keys);
                    }
                }
            }
            SettingsPatch::DeleteEnv { env_key } => {
                if let Some(env) = settings
                    .get_mut("env")
                    .and_then(|value| value.as_object_mut())
                {
                    env.remove(&env_key);
                }
                if let Some(custom_keys) = settings
                    .get_mut("_lovcode_custom_env_keys")
                    .and_then(|value| value.as_array_mut())
                {
                    custom_keys.retain(|value| value.as_str() != Some(&env_key));
                }
                disabled_env.remove(&env_key);
            }
            SettingsPatch::DisableEnv { env_key } => {
                let current_value = settings
                    .get("env")
                    .and_then(|env| env.get(&env_key))
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(env) = settings
                    .get_mut("env")
                    .and_then(|value| value.as_object_mut())
                {
                    env.remove(&env_key);
                }
                disabled_env.insert(env_key, Value::String(current_value));
            }
            SettingsPatch::EnableEnv { env_key } => {
                let disabled_value = disabled_env
                    .remove(&env_key)
                    .and_then(|value| value.as_str().map(str::to_string))
                    .unwrap_or_default();
                ensure_settings_child_object(&mut settings, "env");
                settings["env"][&env_key] = Value::String(disabled_value);
            }
            SettingsPatch::SetDisabledEnv { env_key, env_value } => {
                disabled_env.insert(env_key, Value::String(env_value));
            }
            SettingsPatch::SetField { field, value } => {
                ensure_settings_object(&mut settings);
                if let Some(obj) = settings.as_object_mut() {
                    obj.insert(field, value);
                }
            }
            SettingsPatch::SetPermissionField { field, value } => {
                ensure_settings_child_object(&mut settings, "permissions");
                settings["permissions"][&field] = value;
            }
            SettingsPatch::AddPermissionDirectory { path } => {
                ensure_settings_child_object(&mut settings, "permissions");
                let dirs = settings["permissions"]
                    .get("additionalDirectories")
                    .and_then(|value| value.as_array())
                    .cloned()
                    .unwrap_or_default();
                let path_value = Value::String(path);
                if !dirs.contains(&path_value) {
                    let mut next_dirs = dirs;
                    next_dirs.push(path_value);
                    settings["permissions"]["additionalDirectories"] = Value::Array(next_dirs);
                }
            }
            SettingsPatch::RemovePermissionDirectory { path } => {
                if let Some(dirs) = settings["permissions"]
                    .get_mut("additionalDirectories")
                    .and_then(|value| value.as_array_mut())
                {
                    dirs.retain(|value| value.as_str() != Some(&path));
                }
            }
            SettingsPatch::TogglePlugin { plugin_id, enabled } => {
                ensure_settings_child_object(&mut settings, "enabledPlugins");
                settings["enabledPlugins"][&plugin_id] = Value::Bool(enabled);
            }
        }
    }

    remove_settings_overlay_fields(&mut settings);
    write_json_file(&settings_path, &settings)?;
    write_json_file(&disabled_env_path, &Value::Object(disabled_env))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn patch_settings(patches: Vec<SettingsPatch>) -> Result<(), String> {
    apply_settings_patches(patches)
}

pub(crate) fn snake_to_camel(name: &str) -> String {
    let mut output = String::with_capacity(name.len());
    let mut uppercase_next = false;
    for ch in name.chars() {
        if ch == '_' {
            uppercase_next = true;
        } else if uppercase_next {
            output.push(ch.to_ascii_uppercase());
            uppercase_next = false;
        } else {
            output.push(ch);
        }
    }
    output
}

pub(crate) fn command_payload_value(payload: &Value, name: &str) -> Option<Value> {
    payload
        .get(name)
        .cloned()
        .or_else(|| payload.get(snake_to_camel(name)).cloned())
}

pub(crate) fn command_arg<T: DeserializeOwned>(payload: &Value, name: &str) -> Result<T, String> {
    let value = command_payload_value(payload, name)
        .ok_or_else(|| format!("missing command payload field '{}'", snake_to_camel(name)))?;
    serde_json::from_value(value).map_err(|e| {
        format!(
            "invalid command payload field '{}': {}",
            snake_to_camel(name),
            e
        )
    })
}

pub(crate) fn command_optional_arg<T: DeserializeOwned>(
    payload: &Value,
    name: &str,
) -> Result<Option<T>, String> {
    let Some(value) = command_payload_value(payload, name) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value).map(Some).map_err(|e| {
        format!(
            "invalid command payload field '{}': {}",
            snake_to_camel(name),
            e
        )
    })
}

pub(crate) fn command_json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}
