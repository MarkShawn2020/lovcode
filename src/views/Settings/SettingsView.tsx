import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInvokeQuery, useQueryClient } from "../../hooks";
import {
  GearIcon,
  DotsHorizontalIcon,
  ExternalLinkIcon,
  CopyIcon,
  CodeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  LoadingState,
  EmptyState,
  PageHeader,
  ConfigPage,
} from "../../components/config";
import { MarketplaceContent } from "../Marketplace";
import { useI18n } from "@/i18n";
import type { ClaudeSettings, TemplateComponent } from "../../types";

interface SettingsViewProps {
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

type PermissionMode = "bypassPermissions" | "allowEdits" | "normal";
type ModelType = "opus" | "sonnet" | "haiku";
type AttributionMode = "none" | "footer" | "coauthor";

interface HookItem {
  type: string;
  command?: string;
  timeout?: number;
  disabled?: boolean;
}

interface HookMatcher {
  matcher: string;
  hooks: HookItem[];
}

const PERMISSION_MODES: { value: PermissionMode }[] = [
  { value: "bypassPermissions" },
  { value: "allowEdits" },
  { value: "normal" },
];

const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

const ATTRIBUTION_OPTIONS: { value: AttributionMode }[] = [
  { value: "coauthor" },
  { value: "footer" },
  { value: "none" },
];

const CLEANUP_OPTIONS = [
  { value: 0 },
  { value: 7 },
  { value: 14 },
  { value: 30 },
  { value: 90 },
];

export function SettingsView({ onMarketplaceSelect }: SettingsViewProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { data: settings, isLoading } = useInvokeQuery<ClaudeSettings>(["settings"], "get_settings");
  const { data: settingsPath = "" } = useInvokeQuery<string>(["settingsPath"], "get_settings_path");
  // Load disabled hooks from lovcode storage (must be before early return)
  const { data: disabledHooksData } = useInvokeQuery<Record<string, Array<{ matcher: string; hook: HookItem; key: string }>>>(
    ["disabledHooks"],
    "get_disabled_hooks"
  );

  const [showRawJson, setShowRawJson] = useState(false);
  const [expandedHookEvents, setExpandedHookEvents] = useState<Set<string>>(new Set());

  if (isLoading) return <LoadingState message={t("settings.loadingSettings")} />;

  const raw = (settings?.raw as Record<string, unknown>) || {};
  const model = (raw.model as ModelType) || "sonnet";
  const alwaysThinkingEnabled = raw.alwaysThinkingEnabled === true;
  const spinnerTipsEnabled = raw.spinnerTipsEnabled !== false; // default true
  const cleanupPeriodDays = (raw.cleanupPeriodDays as number) ?? 0;
  const attribution = (raw.attribution as AttributionMode) || "coauthor";
  const permissions = (raw.permissions as Record<string, unknown>) || {};
  const defaultMode = (permissions.defaultMode as PermissionMode) || "normal";
  const additionalDirectories = (permissions.additionalDirectories as string[]) || [];
  const enabledPlugins = (raw.enabledPlugins as Record<string, boolean>) || {};
  const hooks = (raw.hooks as Record<string, HookMatcher[]>) || {};
  const disableAllHooks = raw.disableAllHooks === true;
  const disabledHooks = disabledHooksData || {};
  const permissionModeText = (value: PermissionMode) => {
    if (value === "bypassPermissions") return { label: t("settings.bypass"), desc: t("settings.bypassDescription") };
    if (value === "allowEdits") return { label: t("settings.allowEdits"), desc: t("settings.allowEditsDescription") };
    return { label: t("settings.normal"), desc: t("settings.normalDescription") };
  };
  const attributionText = (value: AttributionMode) => {
    if (value === "coauthor") return { label: t("settings.coauthor"), desc: t("settings.coauthorDescription") };
    if (value === "footer") return { label: t("settings.footer"), desc: t("settings.footerDescription") };
    return { label: t("common.none"), desc: t("settings.noAttributionDescription") };
  };
  const cleanupLabel = (value: number) => value === 0 ? t("settings.never") : t("settings.days", { count: value });

  const refreshSettings = () => {
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({ queryKey: ["disabledHooks"] });
  };

  const updateField = async (field: string, value: unknown) => {
    await invoke("update_settings_field", { field, value });
    refreshSettings();
  };

  const updatePermissionField = async (field: string, value: unknown) => {
    await invoke("update_settings_permission_field", { field, value });
    refreshSettings();
  };

  const addDirectory = async (path: string) => {
    await invoke("add_permission_directory", { path });
    refreshSettings();
  };

  const removeDirectory = async (path: string) => {
    await invoke("remove_permission_directory", { path });
    refreshSettings();
  };

  const togglePlugin = async (pluginId: string, enabled: boolean) => {
    await invoke("toggle_plugin", { pluginId, enabled });
    refreshSettings();
  };

  const toggleHookItem = async (eventType: string, matcherIndex: number, hookIndex: number, disabled: boolean) => {
    await invoke("toggle_hook_item", { eventType, matcherIndex, hookIndex, disabled });
    refreshSettings();
  };

  const deleteHookItem = async (eventType: string, matcherIndex: number, hookIndex: number) => {
    if (!confirm(t("settings.deleteHookConfirm"))) return;
    await invoke("delete_hook_item", { eventType, matcherIndex, hookIndex });
    refreshSettings();
  };

  const deleteDisabledHook = async (eventType: string, index: number) => {
    if (!confirm(t("settings.deleteDisabledHookConfirm"))) return;
    await invoke("delete_disabled_hook", { eventType, index });
    refreshSettings();
  };

  const toggleHookEvent = (eventType: string) => {
    setExpandedHookEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) {
        next.delete(eventType);
      } else {
        next.add(eventType);
      }
      return next;
    });
  };

  const headerAction = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <DotsHorizontalIcon className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => invoke("open_in_editor", { path: settingsPath })}>
          <ExternalLinkIcon className="w-4 h-4 mr-2" />
          {t("common.openInEditor")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(settingsPath)}>
          <CopyIcon className="w-4 h-4 mr-2" />
          {t("common.copyPath")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowRawJson(true)}>
          <CodeIcon className="w-4 h-4 mr-2" />
          {t("settings.viewRawJson")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ConfigPage>
      <PageHeader title={t("common.settings")} subtitle="~/.claude/settings.json" action={headerAction} />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">{t("common.configuration")}</TabsTrigger>
          <TabsTrigger value="marketplace">{t("common.marketplace")}</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-6">
          {!settings?.raw ? (
            <EmptyState icon={GearIcon} message={t("settings.noSettingsFound")} hint={t("settings.createSettingsJson")} />
          ) : (
            <>
              {/* General Section */}
              <section className="bg-card rounded-xl border border-border p-4">
                <h3 className="text-sm font-medium text-ink mb-4">{t("settings.general")}</h3>
                <div className="space-y-4">
                  {/* Model */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-ink">{t("settings.defaultModel")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.defaultModelDescription")}</p>
                    </div>
                    <Select value={model} onValueChange={(v) => updateField("model", v)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Always Thinking */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-ink">{t("settings.extendedThinking")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.extendedThinkingDescription")}</p>
                    </div>
                    <Switch
                      checked={alwaysThinkingEnabled}
                      onCheckedChange={(checked) => updateField("alwaysThinkingEnabled", checked)}
                    />
                  </div>

                  {/* Spinner Tips */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-ink">{t("settings.spinnerTips")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.spinnerTipsDescription")}</p>
                    </div>
                    <Switch
                      checked={spinnerTipsEnabled}
                      onCheckedChange={(checked) => updateField("spinnerTipsEnabled", checked)}
                    />
                  </div>

                  {/* Attribution */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-ink">{t("settings.commitAttribution")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.commitAttributionDescription")}</p>
                    </div>
                    <Select value={attribution} onValueChange={(v) => updateField("attribution", v)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ATTRIBUTION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{attributionText(opt.value).label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Cleanup Period */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-ink">{t("settings.chatHistoryRetention")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.chatHistoryRetentionDescription")}</p>
                    </div>
                    <Select
                      value={String(cleanupPeriodDays)}
                      onValueChange={(v) => updateField("cleanupPeriodDays", Number(v))}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CLEANUP_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={String(opt.value)}>{cleanupLabel(opt.value)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              {/* Permissions Section */}
              <section className="bg-card rounded-xl border border-border p-4">
                <h3 className="text-sm font-medium text-ink mb-4">{t("settings.permissions")}</h3>
                <div className="space-y-4">
                  {/* Default Mode */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-ink">{t("settings.permissionMode")}</p>
                      <p className="text-xs text-muted-foreground">{t("settings.permissionModeDescription")}</p>
                    </div>
                    <Select value={defaultMode} onValueChange={(v) => updatePermissionField("defaultMode", v)}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSION_MODES.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{permissionModeText(opt.value).label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Additional Directories */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm text-ink">{t("settings.additionalDirectories")}</p>
                        <p className="text-xs text-muted-foreground">{t("settings.additionalDirectoriesDescription")}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const path = prompt(t("settings.enterDirectoryPath"));
                          if (path?.trim()) addDirectory(path.trim());
                        }}
                      >
                        {t("common.add")}
                      </Button>
                    </div>
                    {additionalDirectories.length > 0 ? (
                      <div className="space-y-1">
                        {additionalDirectories.map((dir) => (
                          <div
                            key={dir}
                            className="flex items-center justify-between px-3 py-2 bg-card-alt rounded-lg text-xs"
                          >
                            <span className="font-mono text-muted-foreground">{dir}</span>
                            <button
                              onClick={() => removeDirectory(dir)}
                              className="text-muted-foreground hover:text-red-500"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">{t("settings.noAdditionalDirectories")}</p>
                    )}
                  </div>
                </div>
              </section>

              {/* Plugins Section */}
              {Object.keys(enabledPlugins).length > 0 && (
                <section className="bg-card rounded-xl border border-border p-4">
                  <h3 className="text-sm font-medium text-ink mb-4">{t("settings.plugins")}</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {Object.entries(enabledPlugins)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([pluginId, enabled]) => {
                        const [name, source] = pluginId.split("@");
                        return (
                          <div
                            key={pluginId}
                            className="flex items-center justify-between px-3 py-2 bg-card-alt rounded-lg"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-ink truncate">{name}</p>
                              <p className="text-xs text-muted-foreground truncate">{source}</p>
                            </div>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => togglePlugin(pluginId, checked)}
                            />
                          </div>
                        );
                      })}
                  </div>
                </section>
              )}

              {/* Hooks Section */}
              {(Object.keys(hooks).length > 0 || Object.keys(disabledHooks).length > 0) && (
                <section className="bg-card rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-ink">{t("common.hooks")}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("settings.disableAll")}</span>
                      <Switch
                        checked={disableAllHooks}
                        onCheckedChange={(checked) => updateField("disableAllHooks", checked)}
                      />
                    </div>
                  </div>
                  <div className={`space-y-2 ${disableAllHooks ? "opacity-50 pointer-events-none" : ""}`}>
                    {/* Get all event types from both active and disabled hooks */}
                    {[...new Set([...Object.keys(hooks), ...Object.keys(disabledHooks)])].map((eventType) => {
                      const isExpanded = expandedHookEvents.has(eventType);
                      const matchers = hooks[eventType] || [];
                      const disabledForEvent = disabledHooks[eventType] || [];
                      const activeCount = matchers.reduce((acc, m) => acc + m.hooks.length, 0);
                      const totalCount = activeCount + disabledForEvent.length;

                      return (
                        <div key={eventType} className="bg-card-alt rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleHookEvent(eventType)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-card-alt/80"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronDownIcon className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
                              )}
                              <span className="text-sm text-ink font-medium">{eventType}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {disabledForEvent.length > 0 ? `${activeCount}/${totalCount}` : totalCount}
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2">
                              {/* Active hooks */}
                              {matchers.map((matcher, matcherIndex) => (
                                <div key={matcherIndex} className="space-y-1">
                                  {matcher.matcher && (
                                    <p className="text-xs text-muted-foreground pl-6">
                                      matcher: <code className="bg-card px-1 rounded">{matcher.matcher}</code>
                                    </p>
                                  )}
                                  {matcher.hooks.map((hook, hookIndex) => (
                                    <div
                                      key={hookIndex}
                                      className="flex items-center justify-between pl-6 pr-2 py-1.5 bg-card rounded group"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-mono text-ink truncate">
                                          {hook.command || hook.type}
                                        </p>
                                        {hook.timeout && (
                                          <p className="text-xs text-muted-foreground">
                                            timeout: {hook.timeout}s
                                          </p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => deleteHookItem(eventType, matcherIndex, hookIndex)}
                                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity"
                                        >
                                          <TrashIcon className="w-3.5 h-3.5" />
                                        </button>
                                        <Switch
                                          checked={true}
                                          onCheckedChange={() =>
                                            toggleHookItem(eventType, matcherIndex, hookIndex, true)
                                          }
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ))}

                              {/* Disabled hooks */}
                              {disabledForEvent.length > 0 && (
                                <div className="space-y-1 pt-2 border-t border-border/50">
                                  <p className="text-xs text-muted-foreground pl-6 italic">{t("settings.disabled")}</p>
                                  {disabledForEvent.map((item, disabledIndex) => (
                                    <div
                                      key={`disabled-${disabledIndex}`}
                                      className="flex items-center justify-between pl-6 pr-2 py-1.5 bg-card rounded opacity-50 group"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-mono text-ink truncate">
                                          {item.hook.command || item.hook.type}
                                        </p>
                                        {item.hook.timeout && (
                                          <p className="text-xs text-muted-foreground">
                                            timeout: {item.hook.timeout}s
                                          </p>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => deleteDisabledHook(eventType, disabledIndex)}
                                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity"
                                        >
                                          <TrashIcon className="w-3.5 h-3.5" />
                                        </button>
                                        <Switch
                                          checked={false}
                                          onCheckedChange={() =>
                                            toggleHookItem(eventType, 0, disabledIndex, false)
                                          }
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="settings" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>

      {/* Raw JSON Dialog */}
      <Dialog open={showRawJson} onOpenChange={setShowRawJson}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>settings.json</DialogTitle>
          </DialogHeader>
          <pre className="bg-card-alt rounded-lg p-4 text-xs font-mono text-ink overflow-auto max-h-96">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </ConfigPage>
  );
}
