use super::*;

#[tauri::command]
pub(crate) async fn template_command(
    app_handle: tauri::AppHandle,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    match action.as_str() {
        "get_templates_catalog" => command_json(get_templates_catalog(app_handle)?),
        "install_command_template" => command_json(install_command_template(
            command_arg(&payload, "name")?,
            command_arg(&payload, "content")?,
        )?),
        "install_skill_template" => command_json(install_skill_template(
            command_arg(&payload, "name")?,
            command_arg(&payload, "content")?,
            command_optional_arg(&payload, "source_id")?,
            command_optional_arg(&payload, "source_name")?,
            command_optional_arg(&payload, "author")?,
            command_optional_arg(&payload, "downloads")?,
            command_optional_arg(&payload, "template_path")?,
        )?),
        "uninstall_skill" => command_json(uninstall_skill(command_arg(&payload, "name")?)?),
        "check_skill_installed" => {
            command_json(check_skill_installed(command_arg(&payload, "name")?))
        }
        "install_mcp_template" => command_json(install_mcp_template(
            command_arg(&payload, "name")?,
            command_arg(&payload, "config")?,
        )?),
        "uninstall_mcp_template" => {
            command_json(uninstall_mcp_template(command_arg(&payload, "name")?)?)
        }
        "check_mcp_installed" => command_json(check_mcp_installed(command_arg(&payload, "name")?)),
        "install_hook_template" => command_json(install_hook_template(
            command_arg(&payload, "name")?,
            command_arg(&payload, "config")?,
        )?),
        "install_setting_template" => {
            command_json(install_setting_template(command_arg(&payload, "config")?)?)
        }
        "update_settings_statusline" => command_json(update_settings_statusline(command_arg(
            &payload,
            "statusline",
        )?)?),
        "remove_settings_statusline" => command_json(remove_settings_statusline()?),
        "install_statusline_template" => command_json(install_statusline_template(
            command_arg(&payload, "name")?,
            command_arg(&payload, "content")?,
        )?),
        "restore_previous_statusline" => command_json(restore_previous_statusline()?),
        "has_previous_statusline" => command_json(has_previous_statusline()),
        "execute_statusbar_script" => command_json(execute_statusbar_script(
            command_arg(&payload, "script_path")?,
            command_arg(&payload, "context")?,
        )?),
        "get_statusbar_settings" => command_json(get_statusbar_settings()?),
        "save_statusbar_settings" => {
            command_json(save_statusbar_settings(command_arg(&payload, "settings")?)?)
        }
        _ => Err(format!("unknown template command action: {}", action)),
    }
}

#[tauri::command]
pub(crate) async fn file_command(action: String, payload: Value) -> Result<Value, String> {
    match action.as_str() {
        "copy_to_clipboard" => command_json(copy_to_clipboard(command_arg(&payload, "text")?)?),
        "reveal_path" => command_json(reveal_path(
            command_arg(&payload, "path")?,
            command_optional_arg(&payload, "cwd")?,
        )?),
        "open_path" => command_json(open_path(
            command_arg(&payload, "path")?,
            command_optional_arg(&payload, "cwd")?,
        )?),
        "open_in_editor" => command_json(open_in_editor(command_arg(&payload, "path")?)?),
        "get_settings_path" => command_json(get_settings_path()),
        "get_mcp_config_path" => command_json(get_mcp_config_path()),
        "get_home_dir" => command_json(get_home_dir()),
        "write_file" => command_json(write_file(
            command_arg(&payload, "path")?,
            command_arg(&payload, "content")?,
        )?),
        "write_binary_file" => command_json(write_binary_file(
            command_arg(&payload, "path")?,
            command_arg(&payload, "data")?,
        )?),
        "get_file_metadata" => command_json(get_file_metadata(command_arg(&payload, "path")?)?),
        "read_file" => command_json(read_file(command_arg(&payload, "path")?)?),
        "list_zip_entries" => command_json(list_zip_entries(
            command_arg(&payload, "path")?,
            command_optional_arg(&payload, "limit")?,
        )?),
        "list_directory" => command_json(list_directory(command_arg(&payload, "path")?)?),
        "check_paths_exist" => command_json(check_paths_exist(
            command_arg(&payload, "paths")?,
            command_optional_arg(&payload, "cwd")?,
        )),
        "resolve_path_candidates" => command_json(
            resolve_path_candidates(
                command_arg(&payload, "paths")?,
                command_optional_arg(&payload, "cwd")?,
            )
            .await?,
        ),
        "fetch_remote_image_data_url" => {
            command_json(fetch_remote_image_data_url(command_arg(&payload, "url")?).await?)
        }
        _ => Err(format!("unknown file command action: {}", action)),
    }
}

#[tauri::command]
pub(crate) fn pty_command(action: String, payload: Value) -> Result<Value, String> {
    match action.as_str() {
        "pty_create" => command_json(pty_create(
            command_arg(&payload, "id")?,
            command_arg(&payload, "cwd")?,
            command_optional_arg(&payload, "shell")?,
            command_optional_arg(&payload, "command")?,
        )?),
        "pty_write" => command_json(pty_write(
            command_arg(&payload, "id")?,
            command_arg(&payload, "data")?,
        )?),
        "pty_resize" => command_json(pty_resize(
            command_arg(&payload, "id")?,
            command_arg(&payload, "cols")?,
            command_arg(&payload, "rows")?,
        )?),
        "pty_kill" => command_json(pty_kill(command_arg(&payload, "id")?)?),
        "pty_exists" => command_json(pty_exists(command_arg(&payload, "id")?)),
        "pty_scrollback" => command_json(pty_scrollback(command_arg(&payload, "id")?)),
        "pty_purge_scrollback" => {
            pty_purge_scrollback(command_arg(&payload, "id")?);
            command_json(())
        }
        _ => Err(format!("unknown pty command action: {}", action)),
    }
}

#[tauri::command]
pub(crate) fn workspace_command(action: String, payload: Value) -> Result<Value, String> {
    match action.as_str() {
        "get_agent_workspace_file_path" => command_json(get_agent_workspace_file_path()),
        "get_agent_plain_chat_workspace_path" => {
            command_json(get_agent_plain_chat_workspace_path()?)
        }
        "get_agent_workspace_state" => command_json(get_agent_workspace_state()?),
        "save_agent_workspace_state" => {
            command_json(save_agent_workspace_state(command_arg(&payload, "state")?)?)
        }
        "get_agent_workspace_hook_config" => command_json(get_agent_workspace_hook_config()),
        "ensure_agent_workspace_hooks" => command_json(ensure_agent_workspace_hooks(
            command_optional_arg(&payload, "provider")?,
        )?),
        _ => Err(format!("unknown workspace command action: {}", action)),
    }
}

#[tauri::command]
pub(crate) async fn maas_command(action: String, payload: Value) -> Result<Value, String> {
    match action.as_str() {
        "snapshot_provider_context" => command_json(snapshot_provider_context(
            command_arg(&payload, "provider_key")?,
            command_arg(&payload, "env_keys")?,
        )?),
        "restore_provider_context" => command_json(restore_provider_context(
            command_arg(&payload, "provider_key")?,
            command_arg(&payload, "env_keys")?,
        )?),
        "snapshot_codex_maas_provider" => command_json(snapshot_codex_maas_provider(command_arg(
            &payload,
            "provider_key",
        )?)?),
        "get_maas_registry" => command_json(get_maas_registry()?),
        "get_maas_runtime_config_status" => command_json(get_maas_runtime_config_status()?),
        "get_maas_realtime_status" => command_json(get_maas_realtime_status().await?),
        "upsert_maas_provider" => {
            command_json(upsert_maas_provider(command_arg(&payload, "provider")?)?)
        }
        "delete_maas_provider" => {
            command_json(delete_maas_provider(command_arg(&payload, "key")?)?)
        }
        "update_codex_maas_provider" => command_json(update_codex_maas_provider(
            command_arg(&payload, "provider")?,
            command_arg(&payload, "model")?,
        )?),
        "fetch_and_parse_maas_models" => command_json(
            fetch_and_parse_maas_models(
                command_arg(&payload, "fetch_command")?,
                command_arg(&payload, "provider_key")?,
            )
            .await?,
        ),
        "test_anthropic_connection" => command_json(
            test_anthropic_connection(
                command_arg(&payload, "base_url")?,
                command_arg(&payload, "auth_token")?,
                command_arg(&payload, "model")?,
            )
            .await?,
        ),
        "test_claude_cli_oauth" => command_json(test_claude_cli_oauth().await?),
        _ => Err(format!("unknown MaaS command action: {}", action)),
    }
}
