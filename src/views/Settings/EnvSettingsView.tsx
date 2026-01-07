import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInvokeQuery, useQueryClient } from "../../hooks";
import {
  CheckIcon,
  Cross1Icon,
  Pencil1Icon,
  EyeOpenIcon,
  EyeClosedIcon,
  PlusCircledIcon,
  MinusCircledIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import {
  LoadingState,
  SearchInput,
  PageHeader,
  ConfigPage,
} from "../../components/config";
import type { ClaudeSettings } from "../../types";

export function EnvSettingsView() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useInvokeQuery<ClaudeSettings>(["settings"], "get_settings");

  const [search, setSearch] = useState("");
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [envEditValue, setEnvEditValue] = useState("");
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [revealedEnvKeys, setRevealedEnvKeys] = useState<Record<string, boolean>>({});
  const [editingEnvIsDisabled, setEditingEnvIsDisabled] = useState(false);

  if (isLoading) return <LoadingState message="Loading settings..." />;

  const getRawEnvFromSettings = (value: ClaudeSettings | null | undefined) => {
    const envValue =
      value?.raw && typeof value.raw === "object"
        ? (value.raw as Record<string, unknown>).env
        : null;
    if (!envValue || typeof envValue !== "object" || Array.isArray(envValue)) return {};
    return Object.fromEntries(
      Object.entries(envValue as Record<string, unknown>).map(([key, v]) => [key, String(v ?? "")])
    );
  };

  const getCustomEnvKeysFromSettings = (value: ClaudeSettings | null | undefined): string[] => {
    const keys =
      value?.raw && typeof value.raw === "object"
        ? (value.raw as Record<string, unknown>)._lovcode_custom_env_keys
        : null;
    if (!keys || !Array.isArray(keys)) return [];
    return keys.filter((k): k is string => typeof k === "string");
  };

  const getDisabledEnvFromSettings = (value: ClaudeSettings | null | undefined): Record<string, string> => {
    const disabled =
      value?.raw && typeof value.raw === "object"
        ? (value.raw as Record<string, unknown>)._lovcode_disabled_env
        : null;
    if (!disabled || typeof disabled !== "object" || Array.isArray(disabled)) return {};
    return Object.fromEntries(
      Object.entries(disabled as Record<string, unknown>).map(([key, v]) => [key, String(v ?? "")])
    );
  };

  const rawEnv = getRawEnvFromSettings(settings);
  const customEnvKeys = getCustomEnvKeysFromSettings(settings);
  const disabledEnv = getDisabledEnvFromSettings(settings);

  const allEnvEntries: Array<[string, string, boolean]> = [
    ...Object.entries(rawEnv).map(([k, v]) => [k, v, false] as [string, string, boolean]),
    ...Object.entries(disabledEnv).map(([k, v]) => [k, v, true] as [string, string, boolean]),
  ].sort((a, b) => a[0].localeCompare(b[0]));

  const filteredEnvEntries = !search
    ? allEnvEntries
    : allEnvEntries.filter(([key]) => key.toLowerCase().includes(search.toLowerCase()));

  const refreshSettings = () => {
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  const handleEnvEdit = (key: string, value: string, isDisabled = false) => {
    setEditingEnvKey(key);
    setEnvEditValue(value);
    setEditingEnvIsDisabled(isDisabled);
  };

  const handleEnvSave = async () => {
    if (!editingEnvKey) return;
    if (editingEnvIsDisabled) {
      await invoke("update_disabled_settings_env", { envKey: editingEnvKey, envValue: envEditValue });
    } else {
      await invoke("update_settings_env", { envKey: editingEnvKey, envValue: envEditValue });
    }
    await refreshSettings();
    setEditingEnvKey(null);
    setEditingEnvIsDisabled(false);
  };

  const handleEnvDelete = async (key: string) => {
    await invoke("delete_settings_env", { envKey: key });
    await refreshSettings();
    if (editingEnvKey === key) setEditingEnvKey(null);
  };

  const handleEnvDisable = async (key: string) => {
    await invoke("disable_settings_env", { envKey: key });
    await refreshSettings();
    if (editingEnvKey === key) setEditingEnvKey(null);
  };

  const handleEnvEnable = async (key: string) => {
    await invoke("enable_settings_env", { envKey: key });
    await refreshSettings();
  };

  const handleEnvCreate = async () => {
    const key = newEnvKey.trim();
    if (!key) return;
    await invoke("update_settings_env", { envKey: key, envValue: newEnvValue, isNew: true });
    await refreshSettings();
    setNewEnvKey("");
    setNewEnvValue("");
  };

  const toggleEnvReveal = (key: string) => {
    setRevealedEnvKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleApplyCorporateProxy = async () => {
    const content = JSON.stringify({ env: { HTTP_PROXY: "http://proxy.example.com:8080", HTTPS_PROXY: "http://proxy.example.com:8080" } }, null, 2);
    try {
      await invoke("install_setting_template", { config: content });
      refreshSettings();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <ConfigPage>
      <PageHeader title="Environment" subtitle="Manage env vars in ~/.claude/settings.json" />

      <div className="flex-1 flex flex-col space-y-4">
        <SearchInput placeholder="Search env keys..." value={search} onChange={setSearch} />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center p-3 rounded-lg border border-border bg-card">
          <input
            className="text-xs px-2 py-1 rounded bg-canvas border border-border text-ink flex-1"
            placeholder="ENV_KEY"
            value={newEnvKey}
            onChange={(e) => setNewEnvKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEnvCreate()}
          />
          <input
            className="text-xs px-2 py-1 rounded bg-canvas border border-border text-ink flex-1"
            placeholder="value"
            value={newEnvValue}
            onChange={(e) => setNewEnvValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEnvCreate()}
          />
          <Button size="sm" onClick={handleEnvCreate} disabled={!newEnvKey.trim()}>
            Add
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-dashed border-border bg-card-alt">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink">Corporate HTTP(S) Proxy</p>
            <p className="text-[10px] text-muted-foreground">
              Add HTTP_PROXY / HTTPS_PROXY for firewalled networks
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleApplyCorporateProxy}>
            Apply
          </Button>
        </div>

        {filteredEnvEntries.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 px-3 font-medium">Key</th>
                  <th className="py-2 px-3 font-medium">Value</th>
                  <th className="py-2 px-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEnvEntries.map(([key, value, isDisabled]) => {
                  const isRevealed = !!revealedEnvKeys[key];
                  const isCustom = customEnvKeys.includes(key);
                  return (
                    <tr
                      key={key}
                      className={`border-b border-border/60 last:border-0 ${isDisabled ? "opacity-50" : ""}`}
                    >
                      <td className="py-2 px-3">
                        <span
                          className={`text-xs px-2 py-1 rounded font-mono ${isDisabled ? "bg-muted/50 text-muted-foreground line-through" : "bg-primary/10 text-primary"}`}
                        >
                          {key}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        {editingEnvKey === key ? (
                          <input
                            autoFocus
                            className="text-xs px-2 py-1 rounded bg-canvas border border-border text-ink w-64"
                            value={envEditValue}
                            onChange={(e) => setEnvEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleEnvSave();
                              if (e.key === "Escape") setEditingEnvKey(null);
                            }}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-xs text-muted-foreground font-mono">
                              {isRevealed ? value || "(empty)" : "••••••"}
                            </span>
                            <button
                              onClick={() => toggleEnvReveal(key)}
                              className="text-muted-foreground hover:text-foreground p-0.5"
                              title={isRevealed ? "Hide" : "View"}
                            >
                              {isRevealed ? (
                                <EyeClosedIcon className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOpenIcon className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right">
                        {editingEnvKey === key ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={handleEnvSave} title="Save">
                              <CheckIcon />
                            </Button>
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setEditingEnvKey(null)} title="Cancel">
                              <Cross1Icon />
                            </Button>
                          </div>
                        ) : isDisabled ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleEnvEdit(key, value, true)} title="Edit">
                              <Pencil1Icon />
                            </Button>
                            <Button size="icon" variant="outline" className="h-7 w-7 text-green-600 border-green-200 hover:bg-green-50" onClick={() => handleEnvEnable(key)} title="Enable">
                              <PlusCircledIcon />
                            </Button>
                            <TooltipProvider delayDuration={1000}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button size="icon" variant="outline" className="h-7 w-7 text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-40 disabled:pointer-events-none" onClick={() => handleEnvDelete(key)} disabled={!isCustom}>
                                      <TrashIcon />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {!isCustom && <TooltipContent>Only custom can be deleted</TooltipContent>}
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleEnvEdit(key, value, false)} title="Edit">
                              <Pencil1Icon />
                            </Button>
                            <Button size="icon" variant="outline" className="h-7 w-7 text-amber-600 border-amber-200 hover:bg-amber-50" onClick={() => handleEnvDisable(key)} title="Disable">
                              <MinusCircledIcon />
                            </Button>
                            <TooltipProvider delayDuration={1000}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button size="icon" variant="outline" className="h-7 w-7 text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-40 disabled:pointer-events-none" onClick={() => handleEnvDelete(key)} disabled={!isCustom}>
                                      <TrashIcon />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {!isCustom && <TooltipContent>Only custom can be deleted</TooltipContent>}
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-border bg-card text-center">
            <p className="text-sm text-muted-foreground">No env variables configured.</p>
          </div>
        )}
      </div>
    </ConfigPage>
  );
}
