use super::*;

// ============================================================================
// Agent Workspace Commands
// ============================================================================

pub(crate) fn get_agent_workspace_file_path() -> String {
    get_agent_workspace_path().to_string_lossy().to_string()
}

pub(crate) fn get_agent_plain_chat_workspace_path() -> Result<String, String> {
    let path = get_agent_plain_chat_workspace_dir();
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub(crate) fn get_agent_workspace_state() -> Result<AgentWorkspaceState, String> {
    load_agent_workspace_state()
}

pub(crate) fn save_agent_workspace_state(
    state: AgentWorkspaceState,
) -> Result<AgentWorkspaceState, String> {
    write_agent_workspace_state(state)
}

pub(crate) fn is_lovcode_claude_hook_command(command: &str) -> bool {
    let normalized = command.replace('\\', "/");
    normalized.contains("agent-hooks/lovcode-agent-hook.sh")
        || normalized.contains("agent-hooks/lovcode-agent-hook.ps1")
}

pub(crate) fn remove_stale_agent_hook_commands(entries: &mut Vec<Value>, current_command: &str) {
    entries.iter_mut().for_each(|entry| {
        let Some(hooks) = entry
            .get_mut("hooks")
            .and_then(|value| value.as_array_mut())
        else {
            return;
        };
        hooks.retain(|hook| {
            let Some(command) = hook.get("command").and_then(|value| value.as_str()) else {
                return true;
            };
            !is_lovcode_claude_hook_command(command) || command == current_command
        });
    });

    entries.retain(|entry| {
        entry
            .get("hooks")
            .and_then(|value| value.as_array())
            .map(|hooks| !hooks.is_empty())
            .unwrap_or(true)
    });
}

#[cfg(windows)]
pub(crate) fn claude_agent_hook_command(script_path: &str) -> String {
    format!(
        "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File {}",
        powershell_double_quote(script_path)
    )
}

#[cfg(not(windows))]
pub(crate) fn claude_agent_hook_command(script_path: &str) -> String {
    format!("/bin/sh {}", shell_single_quote(script_path))
}

pub(crate) fn ensure_agent_hook_event(settings: &mut Value, event_type: &str, command: &str) {
    if !settings
        .get("hooks")
        .and_then(|value| value.as_object())
        .is_some()
    {
        settings["hooks"] = serde_json::json!({});
    }
    if !settings["hooks"]
        .get(event_type)
        .and_then(|value| value.as_array())
        .is_some()
    {
        settings["hooks"][event_type] = serde_json::json!([]);
    }

    let Some(entries) = settings["hooks"][event_type].as_array_mut() else {
        return;
    };

    remove_stale_agent_hook_commands(entries, command);

    let already_installed = entries.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(|value| value.as_array())
            .map(|hooks| {
                hooks.iter().any(|hook| {
                    hook.get("type").and_then(|value| value.as_str()) == Some("command")
                        && hook.get("command").and_then(|value| value.as_str()) == Some(command)
                })
            })
            .unwrap_or(false)
    });

    if already_installed {
        return;
    }

    entries.push(serde_json::json!({
        "matcher": "",
        "hooks": [{
            "type": "command",
            "command": command
        }]
    }));
}

#[cfg(not(windows))]
pub(crate) fn write_claude_agent_hook_script(script_path: &Path) -> Result<(), String> {
    let script = r#"#!/bin/sh
INPUT=$(cat)
EVENT=$(printf '%s' "$INPUT" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if [ -z "$EVENT" ]; then
  EVENT="unknown"
fi
SESSION_ID="$LOVCODE_AGENT_SESSION_ID"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(printf '%s' "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(printf '%s' "$INPUT" | sed -n 's/.*"sessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
HOOK_FILE="$LOVCODE_AGENT_HOOK_FILE"
if [ -z "$HOOK_FILE" ] && [ -n "$SESSION_ID" ]; then
  HOOK_FILE="$HOME/.lovstudio/lovcode/agent-hooks/events/$SESSION_ID.jsonl"
fi
if [ -z "$SESSION_ID" ] || [ -z "$HOOK_FILE" ]; then
  exit 0
fi

mkdir -p "$(dirname "$HOOK_FILE")"
TS=$(date +%s)
printf '{"sessionId":"%s","event":"%s","timestamp":%s,"provider":"claude"}\n' "$SESSION_ID" "$EVENT" "$TS" >> "$HOOK_FILE"
exit 0
"#;
    fs::write(script_path, script).map_err(|e| e.to_string())
}

#[cfg(windows)]
pub(crate) fn write_claude_agent_hook_script(script_path: &Path) -> Result<(), String> {
    let script = r#"$ErrorActionPreference = "SilentlyContinue"

try {
  $InputText = [Console]::In.ReadToEnd()
  $Payload = $null
  $Event = "unknown"
  $SessionId = $env:LOVCODE_AGENT_SESSION_ID

  if (-not [string]::IsNullOrWhiteSpace($InputText)) {
    try {
      $Payload = $InputText | ConvertFrom-Json -ErrorAction Stop
      if ($Payload.hook_event_name) {
        $Event = [string]$Payload.hook_event_name
      }
      if ([string]::IsNullOrWhiteSpace($SessionId)) {
        if ($Payload.session_id) {
          $SessionId = [string]$Payload.session_id
        } elseif ($Payload.sessionId) {
          $SessionId = [string]$Payload.sessionId
        }
      }
    } catch {
      $Payload = $null
    }
  }

  $HookFile = $env:LOVCODE_AGENT_HOOK_FILE
  if ([string]::IsNullOrWhiteSpace($HookFile) -and -not [string]::IsNullOrWhiteSpace($SessionId)) {
    $UserHome = $env:USERPROFILE
    if ([string]::IsNullOrWhiteSpace($UserHome)) {
      $UserHome = [Environment]::GetFolderPath("UserProfile")
    }
    $HookFile = Join-Path $UserHome ".lovstudio\lovcode\agent-hooks\events\$SessionId.jsonl"
  }

  if ([string]::IsNullOrWhiteSpace($SessionId) -or [string]::IsNullOrWhiteSpace($HookFile)) {
    exit 0
  }

  $HookDir = Split-Path -Parent $HookFile
  if (-not [string]::IsNullOrWhiteSpace($HookDir)) {
    New-Item -ItemType Directory -Force -LiteralPath $HookDir | Out-Null
  }

  $Timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $Record = [ordered]@{
    sessionId = $SessionId
    event = $Event
    timestamp = $Timestamp
    provider = "claude"
  }
  $Line = ($Record | ConvertTo-Json -Compress) + [Environment]::NewLine
  $Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [System.IO.File]::AppendAllText($HookFile, $Line, $Utf8NoBom)
} catch {
}

exit 0
"#;
    fs::write(script_path, script).map_err(|e| e.to_string())
}

pub(crate) fn write_codex_notify_script(script_path: &Path) -> Result<(), String> {
    let script = r#"#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time


def parse_args(args):
    previous = []
    remaining = []
    index = 0
    while index < len(args):
        if args[index] == "--previous-notify-json" and index + 1 < len(args):
            try:
                parsed = json.loads(args[index + 1])
                if isinstance(parsed, list) and all(isinstance(item, str) for item in parsed):
                    previous = parsed
            except Exception:
                previous = []
            index += 2
            continue
        remaining.append(args[index])
        index += 1

    payload = remaining[-1] if remaining else ""
    if not payload:
        try:
            if not sys.stdin.isatty():
                payload = sys.stdin.read()
        except Exception:
            payload = ""
    return previous, payload


def append_lovcode_event(payload_text):
    session_id = os.environ.get("LOVCODE_AGENT_SESSION_ID")
    hook_file = os.environ.get("LOVCODE_AGENT_HOOK_FILE")

    payload_type = None
    parsed = None
    if payload_text:
        try:
            parsed = json.loads(payload_text)
            if isinstance(parsed, dict):
                payload_type = parsed.get("type")
                if not session_id:
                    session_id = (
                        parsed.get("session_id")
                        or parsed.get("sessionId")
                        or parsed.get("conversation_id")
                        or parsed.get("conversationId")
                    )
        except Exception:
            payload_type = None

    if payload_type and payload_type != "agent-turn-complete":
        return
    if not session_id:
        return
    if not hook_file:
        hook_file = os.path.join(
            os.path.expanduser("~"),
            ".lovstudio",
            "lovcode",
            "agent-hooks",
            "events",
            f"{session_id}.jsonl",
        )

    event = {
        "sessionId": session_id,
        "event": "Stop",
        "timestamp": int(time.time()),
        "provider": "codex",
    }
    if payload_type:
        event["payloadType"] = payload_type

    os.makedirs(os.path.dirname(hook_file), exist_ok=True)
    with open(hook_file, "a", encoding="utf-8") as file:
        file.write(json.dumps(event, separators=(",", ":")) + "\n")


def forward_previous(previous, payload_text):
    if not previous:
        return
    try:
        subprocess.Popen(
            [*previous, payload_text],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def main():
    previous, payload = parse_args(sys.argv[1:])
    append_lovcode_event(payload)
    forward_previous(previous, payload)


if __name__ == "__main__":
    main()
"#;
    fs::write(script_path, script).map_err(|e| e.to_string())
}

pub(crate) fn get_toml_string_array(
    doc: &toml_edit::DocumentMut,
    key: &str,
) -> Option<Vec<String>> {
    let array = doc.get(key)?.as_array()?;
    let mut values = Vec::new();
    for value in array.iter() {
        values.push(value.as_str()?.to_string());
    }
    Some(values)
}

pub(crate) fn is_lovcode_codex_notify(args: &[String], script_path: &Path) -> bool {
    let script_path_text = script_path.to_string_lossy();
    args.iter().any(|arg| arg == script_path_text.as_ref())
}

pub(crate) fn extract_previous_notify_args(args: &[String]) -> Vec<String> {
    args.windows(2)
        .find_map(|window| {
            if window[0] == "--previous-notify-json" {
                serde_json::from_str::<Vec<String>>(&window[1]).ok()
            } else {
                None
            }
        })
        .unwrap_or_default()
}

pub(crate) fn ensure_codex_notify_config(script_path: &Path) -> Result<(), String> {
    let config_path = get_codex_config_path();
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = if config_path.exists() {
        fs::read_to_string(&config_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let mut doc = if content.trim().is_empty() {
        toml_edit::DocumentMut::new()
    } else {
        content
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| format!("parse Codex config.toml: {}", e))?
    };

    let existing_notify = get_toml_string_array(&doc, "notify");
    let previous_notify = existing_notify
        .map(|args| {
            if is_lovcode_codex_notify(&args, script_path) {
                extract_previous_notify_args(&args)
            } else {
                args
            }
        })
        .unwrap_or_default();
    let previous_notify_json =
        serde_json::to_string(&previous_notify).map_err(|e| e.to_string())?;

    let mut notify = toml_edit::Array::default();
    notify.push("/usr/bin/env");
    notify.push("python3");
    notify.push(script_path.to_string_lossy().to_string());
    notify.push("--previous-notify-json");
    notify.push(previous_notify_json);
    doc["notify"] = toml_edit::value(notify);

    fs::write(&config_path, doc.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn get_agent_workspace_hook_config() -> AgentWorkspaceHookConfig {
    AgentWorkspaceHookConfig {
        events_dir: get_agent_hook_events_dir().to_string_lossy().to_string(),
        script_path: get_agent_hook_script_path().to_string_lossy().to_string(),
    }
}

pub(crate) fn ensure_agent_workspace_hooks(
    provider: Option<String>,
) -> Result<AgentWorkspaceHookConfig, String> {
    let events_dir = get_agent_hook_events_dir();
    let script_path = get_agent_hook_script_path();
    let codex_notify_script_path = get_agent_codex_notify_script_path();
    let provider = provider.unwrap_or_else(|| "all".to_string());
    let ensure_claude = provider == "all" || provider == "claude";
    let ensure_codex = provider == "all" || provider == "codex";

    fs::create_dir_all(&events_dir).map_err(|e| e.to_string())?;

    if ensure_claude {
        write_claude_agent_hook_script(&script_path)?;

        let settings_path = get_claude_dir().join("settings.json");
        if let Some(parent) = settings_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut settings: Value = if settings_path.exists() {
            let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
            serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        let script_path_text = script_path.to_string_lossy();
        let command = claude_agent_hook_command(script_path_text.as_ref());
        ensure_agent_hook_event(&mut settings, "UserPromptSubmit", &command);
        ensure_agent_hook_event(&mut settings, "Stop", &command);
        ensure_agent_hook_event(&mut settings, "StopFailure", &command);

        let output = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        fs::write(&settings_path, output).map_err(|e| e.to_string())?;
    }

    if ensure_codex {
        write_codex_notify_script(&codex_notify_script_path)?;
        ensure_codex_notify_config(&codex_notify_script_path)?;
    }

    Ok(AgentWorkspaceHookConfig {
        events_dir: events_dir.to_string_lossy().to_string(),
        script_path: script_path.to_string_lossy().to_string(),
    })
}
