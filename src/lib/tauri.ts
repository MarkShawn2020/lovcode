import {
  Channel,
  convertFileSrc,
  invoke as tauriInvoke,
  isTauri,
  type InvokeArgs,
  type InvokeOptions,
} from "@tauri-apps/api/core";

export { Channel, convertFileSrc, isTauri };

type CommandRoute = {
  command: string;
  action: string;
};

const COMMAND_ROUTES: Record<string, CommandRoute> = {
  check_mcp_installed: { command: "template_command", action: "check_mcp_installed" },
  check_skill_installed: { command: "template_command", action: "check_skill_installed" },
  execute_statusbar_script: { command: "template_command", action: "execute_statusbar_script" },
  get_statusbar_settings: { command: "template_command", action: "get_statusbar_settings" },
  get_templates_catalog: { command: "template_command", action: "get_templates_catalog" },
  has_previous_statusline: { command: "template_command", action: "has_previous_statusline" },
  install_command_template: { command: "template_command", action: "install_command_template" },
  install_hook_template: { command: "template_command", action: "install_hook_template" },
  install_mcp_template: { command: "template_command", action: "install_mcp_template" },
  install_setting_template: { command: "template_command", action: "install_setting_template" },
  install_skill_template: { command: "template_command", action: "install_skill_template" },
  install_statusline_template: { command: "template_command", action: "install_statusline_template" },
  remove_settings_statusline: { command: "template_command", action: "remove_settings_statusline" },
  restore_previous_statusline: { command: "template_command", action: "restore_previous_statusline" },
  save_statusbar_settings: { command: "template_command", action: "save_statusbar_settings" },
  uninstall_mcp_template: { command: "template_command", action: "uninstall_mcp_template" },
  uninstall_skill: { command: "template_command", action: "uninstall_skill" },
  update_settings_statusline: { command: "template_command", action: "update_settings_statusline" },

  check_paths_exist: { command: "file_command", action: "check_paths_exist" },
  copy_to_clipboard: { command: "file_command", action: "copy_to_clipboard" },
  fetch_remote_image_data_url: { command: "file_command", action: "fetch_remote_image_data_url" },
  get_file_metadata: { command: "file_command", action: "get_file_metadata" },
  get_home_dir: { command: "file_command", action: "get_home_dir" },
  get_mcp_config_path: { command: "file_command", action: "get_mcp_config_path" },
  get_settings_path: { command: "file_command", action: "get_settings_path" },
  list_directory: { command: "file_command", action: "list_directory" },
  list_zip_entries: { command: "file_command", action: "list_zip_entries" },
  open_in_editor: { command: "file_command", action: "open_in_editor" },
  open_path: { command: "file_command", action: "open_path" },
  read_file: { command: "file_command", action: "read_file" },
  resolve_path_candidates: { command: "file_command", action: "resolve_path_candidates" },
  reveal_path: { command: "file_command", action: "reveal_path" },
  write_binary_file: { command: "file_command", action: "write_binary_file" },
  write_file: { command: "file_command", action: "write_file" },

  pty_create: { command: "pty_command", action: "pty_create" },
  pty_exists: { command: "pty_command", action: "pty_exists" },
  pty_kill: { command: "pty_command", action: "pty_kill" },
  pty_purge_scrollback: { command: "pty_command", action: "pty_purge_scrollback" },
  pty_resize: { command: "pty_command", action: "pty_resize" },
  pty_scrollback: { command: "pty_command", action: "pty_scrollback" },
  pty_write: { command: "pty_command", action: "pty_write" },

  ensure_agent_workspace_hooks: { command: "workspace_command", action: "ensure_agent_workspace_hooks" },
  get_agent_plain_chat_workspace_path: { command: "workspace_command", action: "get_agent_plain_chat_workspace_path" },
  get_agent_workspace_file_path: { command: "workspace_command", action: "get_agent_workspace_file_path" },
  get_agent_workspace_hook_config: { command: "workspace_command", action: "get_agent_workspace_hook_config" },
  get_agent_workspace_state: { command: "workspace_command", action: "get_agent_workspace_state" },
  save_agent_workspace_state: { command: "workspace_command", action: "save_agent_workspace_state" },

  delete_maas_provider: { command: "maas_command", action: "delete_maas_provider" },
  fetch_and_parse_maas_models: { command: "maas_command", action: "fetch_and_parse_maas_models" },
  get_maas_realtime_status: { command: "maas_command", action: "get_maas_realtime_status" },
  get_maas_registry: { command: "maas_command", action: "get_maas_registry" },
  snapshot_provider_context: { command: "maas_command", action: "snapshot_provider_context" },
  test_anthropic_connection: { command: "maas_command", action: "test_anthropic_connection" },
  test_claude_cli_oauth: { command: "maas_command", action: "test_claude_cli_oauth" },
  update_codex_maas_provider: { command: "maas_command", action: "update_codex_maas_provider" },
  upsert_maas_provider: { command: "maas_command", action: "upsert_maas_provider" },
};

export function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const route = COMMAND_ROUTES[cmd];
  if (!route) {
    return tauriInvoke<T>(cmd, args, options);
  }

  return tauriInvoke<T>(
    route.command,
    {
      action: route.action,
      payload: args ?? {},
    },
    options,
  );
}
