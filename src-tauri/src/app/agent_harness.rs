use super::*;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

static AGENT_HARNESS_PROCESSES: LazyLock<AsyncMutex<HashMap<String, u32>>> =
    LazyLock::new(|| AsyncMutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum AgentHarnessEvent {
    Started {
        #[serde(rename = "sessionId")]
        session_id: String,
        provider: String,
        command: String,
    },
    Json {
        #[serde(rename = "sessionId")]
        session_id: String,
        stream: String,
        #[serde(rename = "eventType")]
        event_type: Option<String>,
        #[serde(rename = "itemId")]
        item_id: Option<String>,
        role: Option<String>,
        text: Option<String>,
        raw: Value,
    },
    Stdout {
        #[serde(rename = "sessionId")]
        session_id: String,
        text: String,
    },
    Stderr {
        #[serde(rename = "sessionId")]
        session_id: String,
        text: String,
    },
    Exit {
        #[serde(rename = "sessionId")]
        session_id: String,
        code: Option<i32>,
        success: bool,
    },
    Error {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: String,
    },
}

struct HarnessCommand {
    program: String,
    args: Vec<String>,
    source: &'static str,
}

impl HarnessCommand {
    fn display(&self) -> String {
        std::iter::once(self.program.as_str())
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn build_harness_command(
    session_id: &str,
    provider: &str,
    cwd: &str,
    prompt: &str,
    resume_session_id: Option<&str>,
) -> Result<HarnessCommand, String> {
    if let Some(program) = get_agent_chat_harness_path() {
        let mut args = vec![
            "--provider".to_string(),
            provider.to_string(),
            "--cwd".to_string(),
            cwd.to_string(),
            "--session-id".to_string(),
            session_id.to_string(),
        ];
        if let Some(resume_id) = resume_session_id.filter(|id| !id.trim().is_empty()) {
            args.push("--resume".to_string());
            args.push(resume_id.to_string());
        }
        args.push(prompt.to_string());
        return Ok(HarnessCommand {
            program,
            args,
            source: "custom-harness",
        });
    }

    let command_name = match provider {
        "claude" => "claude",
        "codex" => "codex",
        _ => return Err(format!("Unsupported harness provider: {}", provider)),
    };
    let (path, _, installed, runnable, _) = detect_cli_runtime(provider, command_name);
    if !installed {
        return Err(format!("{} CLI is not installed", command_name));
    }
    if !runnable {
        return Err(format!("{} CLI is not runnable", command_name));
    }

    let program = path.unwrap_or_else(|| command_name.to_string());
    let args = match provider {
        "claude" => {
            let mut args = vec![
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "-p".to_string(),
                prompt.to_string(),
                "--include-partial-messages".to_string(),
            ];
            if let Some(resume_id) = resume_session_id.filter(|id| !id.trim().is_empty()) {
                args.push("--resume".to_string());
                args.push(resume_id.to_string());
            } else {
                args.push("--session-id".to_string());
                args.push(session_id.to_string());
            }
            args
        }
        "codex" => {
            let mut args = vec![
                "exec".to_string(),
                "--json".to_string(),
                "-C".to_string(),
                cwd.to_string(),
                "--skip-git-repo-check".to_string(),
            ];
            if let Some(resume_id) = resume_session_id.filter(|id| !id.trim().is_empty()) {
                args.push("resume".to_string());
                args.push(resume_id.to_string());
            }
            args.push(prompt.to_string());
            args
        }
        _ => unreachable!(),
    };

    Ok(HarnessCommand {
        program,
        args,
        source: "direct-cli",
    })
}

fn emit_harness_event(app: &tauri::AppHandle, event: AgentHarnessEvent) {
    if let Err(error) = app.emit("agent-harness-event", event) {
        eprintln!("[DEBUG][HarnessBackend] emit failed: {}", error);
    }
}

fn harness_debug_now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn json_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key)?.as_str().map(str::to_string))
}

fn collect_content_text(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if !text.trim().is_empty() {
                out.push(text.to_string());
            }
        }
        Value::Array(items) => {
            items
                .iter()
                .for_each(|item| collect_content_text(item, out));
        }
        Value::Object(map) => {
            if matches!(
                map.get("type").and_then(Value::as_str),
                Some(
                    "text"
                        | "text_delta"
                        | "output_text"
                        | "output_text_delta"
                        | "input_text"
                        | "agent_message"
                )
            ) {
                if let Some(text) = map.get("text").and_then(Value::as_str) {
                    if !text.trim().is_empty() {
                        out.push(text.to_string());
                    }
                }
            }

            for key in [
                "content",
                "message",
                "delta",
                "result",
                "last_message",
                "item",
            ] {
                if let Some(child) = map.get(key) {
                    collect_content_text(child, out);
                }
            }
        }
        _ => {}
    }
}

fn extract_harness_text(raw: &Value) -> Option<String> {
    if let Some(text) = raw
        .get("item")
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("agent_message"))
        .and_then(|item| item.get("text").and_then(Value::as_str))
        .map(str::to_string)
    {
        if !text.trim().is_empty() {
            return Some(text);
        }
    }

    if let Some(text) = json_string(raw, &["text", "result", "last_message"]) {
        if !text.trim().is_empty() {
            return Some(text);
        }
    }

    let mut parts = Vec::new();
    for key in ["message", "content", "delta", "event", "item", "payload"] {
        if let Some(value) = raw.get(key) {
            if key == "event" && !value.is_object() && !value.is_array() {
                continue;
            }
            collect_content_text(value, &mut parts);
        }
    }
    let text = parts.join("");
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn json_event_type(raw: &Value) -> Option<String> {
    let event_type = json_string(raw, &["type", "event", "kind"]);
    if event_type.as_deref() == Some("stream_event") {
        return raw
            .get("event")
            .and_then(|event| json_string(event, &["type", "event", "kind"]))
            .or(event_type);
    }
    event_type
}

fn json_item_id(raw: &Value) -> Option<String> {
    json_string(raw, &["id", "message_id", "item_id"])
        .or_else(|| raw.get("message").and_then(|v| json_string(v, &["id"])))
        .or_else(|| raw.get("event")?.get("message").and_then(|v| json_string(v, &["id"])))
        .or_else(|| raw.get("item").and_then(|v| json_string(v, &["id"])))
        .or_else(|| raw.get("payload").and_then(|v| json_string(v, &["id"])))
}

fn json_role(raw: &Value) -> Option<String> {
    if let Some(item_type) = raw.get("item").and_then(|item| item.get("type")).and_then(Value::as_str) {
        return match item_type {
            "agent_message" => Some("assistant".to_string()),
            "command_execution" | "file_change" | "mcp_tool_call" | "web_search" | "todo_list" => {
                Some("tool".to_string())
            }
            "error" => Some("error".to_string()),
            _ => None,
        };
    }

    raw.get("role")
        .and_then(Value::as_str)
        .or_else(|| raw.get("message")?.get("role")?.as_str())
        .or_else(|| raw.get("event")?.get("message")?.get("role")?.as_str())
        .map(str::to_string)
}

fn emit_harness_line(app: &tauri::AppHandle, session_id: &str, stream: &str, line: String) {
    if line.trim().is_empty() {
        return;
    }

    if let Ok(raw) = serde_json::from_str::<Value>(&line) {
        let event_type = json_event_type(&raw);
        let item_id = json_item_id(&raw);
        let role = json_role(&raw);
        let text = extract_harness_text(&raw);
        let event_type_for_log = event_type.as_deref().unwrap_or("json");
        if matches!(
            event_type_for_log,
            "content_block_delta" | "assistant" | "result" | "message_stop" | "content_block_stop"
        ) {
            eprintln!(
                "[DEBUG][HarnessBackend] emit-json t={} session={} stream={} event_type={} text_len={} line_len={}",
                harness_debug_now_ms(),
                session_id,
                stream,
                event_type_for_log,
                text.as_ref().map(|value| value.len()).unwrap_or(0),
                line.len()
            );
        }
        emit_harness_event(
            app,
            AgentHarnessEvent::Json {
                session_id: session_id.to_string(),
                stream: stream.to_string(),
                event_type,
                item_id,
                role,
                text,
                raw,
            },
        );
        return;
    }

    let event = if stream == "stderr" {
        eprintln!(
            "[DEBUG][HarnessBackend] emit-stderr t={} session={} text_len={}",
            harness_debug_now_ms(),
            session_id,
            line.len()
        );
        AgentHarnessEvent::Stderr {
            session_id: session_id.to_string(),
            text: line,
        }
    } else {
        eprintln!(
            "[DEBUG][HarnessBackend] emit-stdout t={} session={} text_len={}",
            harness_debug_now_ms(),
            session_id,
            line.len()
        );
        AgentHarnessEvent::Stdout {
            session_id: session_id.to_string(),
            text: line,
        }
    };
    emit_harness_event(app, event);
}

async fn read_harness_lines<R>(
    app: tauri::AppHandle,
    session_id: String,
    stream: &'static str,
    reader: R,
    cancelled: Arc<AtomicBool>,
) where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        match lines.next_line().await {
            Ok(Some(line)) => emit_harness_line(&app, &session_id, stream, line),
            Ok(None) => break,
            Err(error) => {
                emit_harness_event(
                    &app,
                    AgentHarnessEvent::Error {
                        session_id: session_id.clone(),
                        message: error.to_string(),
                    },
                );
                break;
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn list_agent_harness_sessions() -> Vec<String> {
    AGENT_HARNESS_PROCESSES
        .lock()
        .await
        .keys()
        .cloned()
        .collect()
}

#[tauri::command]
pub(crate) async fn start_agent_harness_session(
    app: tauri::AppHandle,
    session_id: String,
    provider: String,
    cwd: String,
    prompt: String,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Harness prompt cannot be empty".to_string());
    }
    if !Path::new(&cwd).is_dir() {
        return Err(format!("Working directory does not exist: {}", cwd));
    }

    {
        let processes = AGENT_HARNESS_PROCESSES.lock().await;
        if processes.contains_key(&session_id) {
            return Err("Harness session is already running".to_string());
        }
    }

    let harness = build_harness_command(
        &session_id,
        &provider,
        &cwd,
        &prompt,
        resume_session_id.as_deref(),
    )?;
    let display_command = harness.display();
    eprintln!(
        "[DEBUG][HarnessBackend] start t={} session={} provider={} source={} prompt_len={} has_resume={} program={} arg_count={}",
        harness_debug_now_ms(),
        session_id,
        provider,
        harness.source,
        prompt.len(),
        resume_session_id
            .as_deref()
            .map(|id| !id.trim().is_empty())
            .unwrap_or(false),
        harness.program,
        harness.args.len()
    );

    let mut child = Command::new(&harness.program)
        .args(&harness.args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let pid = child
        .id()
        .ok_or_else(|| "Failed to read harness process id".to_string())?;
    AGENT_HARNESS_PROCESSES
        .lock()
        .await
        .insert(session_id.clone(), pid);

    emit_harness_event(
        &app,
        AgentHarnessEvent::Started {
            session_id: session_id.clone(),
            provider: provider.clone(),
            command: display_command,
        },
    );

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let cancelled = Arc::new(AtomicBool::new(false));

    if let Some(stdout) = stdout {
        tauri::async_runtime::spawn(read_harness_lines(
            app.clone(),
            session_id.clone(),
            "stdout",
            stdout,
            cancelled.clone(),
        ));
    }
    if let Some(stderr) = stderr {
        tauri::async_runtime::spawn(read_harness_lines(
            app.clone(),
            session_id.clone(),
            "stderr",
            stderr,
            cancelled.clone(),
        ));
    }

    tauri::async_runtime::spawn(async move {
        let status = child.wait().await;
        cancelled.store(true, Ordering::Relaxed);
        AGENT_HARNESS_PROCESSES.lock().await.remove(&session_id);
        match status {
            Ok(status) => {
                eprintln!(
                    "[DEBUG][HarnessBackend] exit t={} session={} code={:?} success={}",
                    harness_debug_now_ms(),
                    session_id,
                    status.code(),
                    status.success()
                );
                emit_harness_event(
                    &app,
                    AgentHarnessEvent::Exit {
                        session_id,
                        code: status.code(),
                        success: status.success(),
                    },
                );
            }
            Err(error) => {
                eprintln!(
                    "[DEBUG][HarnessBackend] wait-error t={} session={} message={}",
                    harness_debug_now_ms(),
                    session_id,
                    error
                );
                emit_harness_event(
                    &app,
                    AgentHarnessEvent::Error {
                        session_id,
                        message: error.to_string(),
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub(crate) async fn cancel_agent_harness_session(session_id: String) -> Result<(), String> {
    let pid = AGENT_HARNESS_PROCESSES.lock().await.remove(&session_id);
    let Some(pid) = pid else {
        return Ok(());
    };
    let pid_text = pid.to_string();

    #[cfg(windows)]
    let status = Command::new("taskkill")
        .arg("/PID")
        .arg(&pid_text)
        .arg("/F")
        .arg("/T")
        .status()
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(not(windows))]
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(&pid_text)
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to stop harness process {}", pid))
    }
}
