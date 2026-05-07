import { invoke } from "@/lib/tauri";

export type SettingsPatch =
  | { type: "setEnv"; envKey: string; envValue: string; isNew?: boolean }
  | { type: "deleteEnv"; envKey: string }
  | { type: "disableEnv"; envKey: string }
  | { type: "enableEnv"; envKey: string }
  | { type: "setDisabledEnv"; envKey: string; envValue: string }
  | { type: "setField"; field: string; value: unknown }
  | { type: "setPermissionField"; field: string; value: unknown }
  | { type: "addPermissionDirectory"; path: string }
  | { type: "removePermissionDirectory"; path: string }
  | { type: "togglePlugin"; pluginId: string; enabled: boolean };

export function patchSettings(patches: SettingsPatch | SettingsPatch[]) {
  return invoke<void>("patch_settings", {
    patches: Array.isArray(patches) ? patches : [patches],
  });
}

export function setSettingsEnv(envKey: string, envValue: string, isNew?: boolean) {
  return patchSettings({ type: "setEnv", envKey, envValue, isNew });
}

export function deleteSettingsEnv(envKey: string) {
  return patchSettings({ type: "deleteEnv", envKey });
}

export function disableSettingsEnv(envKey: string) {
  return patchSettings({ type: "disableEnv", envKey });
}

export function enableSettingsEnv(envKey: string) {
  return patchSettings({ type: "enableEnv", envKey });
}

export function setDisabledSettingsEnv(envKey: string, envValue: string) {
  return patchSettings({ type: "setDisabledEnv", envKey, envValue });
}

export function setSettingsField(field: string, value: unknown) {
  return patchSettings({ type: "setField", field, value });
}

export function setSettingsPermissionField(field: string, value: unknown) {
  return patchSettings({ type: "setPermissionField", field, value });
}

export function addPermissionDirectory(path: string) {
  return patchSettings({ type: "addPermissionDirectory", path });
}

export function removePermissionDirectory(path: string) {
  return patchSettings({ type: "removePermissionDirectory", path });
}

export function setPluginEnabled(pluginId: string, enabled: boolean) {
  return patchSettings({ type: "togglePlugin", pluginId, enabled });
}
