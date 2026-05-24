import { useState, useEffect, useRef } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Switch } from "../../components/ui/switch";
import type { ClaudeCodeVersionInfo, ClaudeCodeInstallType } from "../../types";
import type { AgentRuntimeStatus } from "../../types/agent";
import { queryKeys, useInvokeMutation, useInvokeQuery, useQueryClient } from "../../hooks";
import { useI18n, type TranslationKey } from "../../i18n";
import { cn } from "../../lib/utils";
import { AgentCliRuntimeCard, agentRuntimeStatusKey, type AgentRuntimeSettingsSection } from "./AgentCliRuntimeCard";
import {
  getDefaultNpmInstallRegistry,
  NpmInstallSourceControl,
  type NpmInstallRegistry,
} from "./NpmInstallSourceControl";

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const INSTALL_TYPES: { value: ClaudeCodeInstallType; labelKey: TranslationKey }[] = [
  { value: "native", labelKey: "agentRuntime.installTypeNative" },
  { value: "npm", labelKey: "agentRuntime.installTypeNpm" },
];
const VERSION_LIST_LOADING_TIMEOUT_MS = 8_000;

function VersionChoice({
  active,
  disabled,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full min-w-0 items-center justify-between gap-3 rounded-md border px-2 text-left text-xs transition-colors disabled:opacity-50",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-foreground hover:bg-accent",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        {active && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

interface ClaudeCodeVersionSectionProps {
  settingsSections?: AgentRuntimeSettingsSection[];
}

export function ClaudeCodeVersionSection({ settingsSections = [] }: ClaudeCodeVersionSectionProps) {
  const { activeLanguage, t } = useI18n();
  const {
    data: versionInfo,
    error: queryError,
    isLoading: loading,
    refetch,
  } = useInvokeQuery<ClaudeCodeVersionInfo>(
    queryKeys.claudeCodeVersionInfo,
    "get_claude_code_version_info",
  );
  const {
    data: runtimeStatus,
    isLoading: runtimeStatusLoading,
    isFetching: runtimeStatusFetching,
  } = useInvokeQuery<AgentRuntimeStatus>(
    agentRuntimeStatusKey("claude"),
    "get_agent_runtime_status",
    { provider: "claude" },
  );
  const queryClient = useQueryClient();
  const installMutation = useInvokeMutation<
    string,
    { version: string; installType: ClaudeCodeInstallType; npmRegistry?: NpmInstallRegistry }
  >("install_claude_code_version", [queryKeys.claudeCodeVersionInfo]);
  const autoupdaterMutation = useInvokeMutation<void, { disabled: boolean }>(
    "set_claude_code_autoupdater",
  );
  const [installing, setInstalling] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>("latest");
  const [selectedInstallType, setSelectedInstallType] = useState<ClaudeCodeInstallType>(() =>
    activeLanguage === "zh" ? "npm" : "native",
  );
  const [selectedNpmRegistry, setSelectedNpmRegistry] = useState<NpmInstallRegistry>(() =>
    getDefaultNpmInstallRegistry(activeLanguage),
  );
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState<boolean | null>(null);
  const [versionPopoverOpen, setVersionPopoverOpen] = useState(false);
  const [versionListLoadingExpired, setVersionListLoadingExpired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const initializedFromInfoRef = useRef(false);

  useEffect(() => {
    if (!versionInfo || initializedFromInfoRef.current) return;
    if (versionInfo.current_version) {
      setSelectedVersion(versionInfo.current_version);
    }
    if (versionInfo.install_type !== "none") {
      setSelectedInstallType(versionInfo.install_type);
    }
    initializedFromInfoRef.current = true;
  }, [versionInfo]);

  useEffect(() => {
    if (!versionInfo) return;
    setAutoUpdateEnabled(!versionInfo.autoupdater_disabled);
  }, [versionInfo?.autoupdater_disabled, versionInfo]);

  useEffect(() => {
    if (!loading || versionInfo) {
      setVersionListLoadingExpired(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setVersionListLoadingExpired(true);
    }, VERSION_LIST_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loading, versionInfo]);

  const handleInstall = async (
    version: string = selectedVersion,
    installType: ClaudeCodeInstallType = selectedInstallType,
  ) => {
    setSelectedVersion(version);
    setSelectedInstallType(installType);
    setInstalling(true);
    setActionError(null);

    try {
      await installMutation.mutateAsync({
        version,
        installType,
        npmRegistry: installType === "npm" ? selectedNpmRegistry : undefined,
      });

      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: agentRuntimeStatusKey("claude") }),
      ]);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const handleSetAutoupdater = async (enabled: boolean) => {
    if (!versionInfo) return;
    const previousEnabled = autoUpdateEnabled ?? !versionInfo.autoupdater_disabled;
    setAutoUpdateEnabled(enabled);
    queryClient.setQueryData<ClaudeCodeVersionInfo>(queryKeys.claudeCodeVersionInfo, {
      ...versionInfo,
      autoupdater_disabled: !enabled,
    });
    try {
      setActionError(null);
      await autoupdaterMutation.mutateAsync({ disabled: !enabled });
    } catch (e) {
      setAutoUpdateEnabled(previousEnabled);
      queryClient.setQueryData<ClaudeCodeVersionInfo>(queryKeys.claudeCodeVersionInfo, {
        ...versionInfo,
        autoupdater_disabled: !previousEnabled,
      });
      setActionError(String(e));
    }
  };

  const externalError = queryError?.message ?? (!versionPopoverOpen ? actionError : null);

  const isNotInstalled = versionInfo?.install_type === "none";
  const availableVersions = versionInfo?.available_versions ?? [];
  const versionsStillLoading = loading && !versionInfo && !versionListLoadingExpired;
  const versionsUnavailable = !versionsStillLoading && availableVersions.length === 0;
  const resolveSelectedVersion = (version: string) =>
    version === "latest" ? availableVersions[0]?.version ?? version : version;
  const isInstalledSelection = (version: string, installType: ClaudeCodeInstallType) =>
    versionInfo?.current_version === resolveSelectedVersion(version) && versionInfo?.install_type === installType;

  const getCurrentVersionLabel = () => {
    if (installing) return t("agentRuntime.installing");
    if (versionInfo?.current_version) {
      const typeLabelKey = INSTALL_TYPES.find((type) => type.value === versionInfo.install_type)?.labelKey;
      const typeLabel = typeLabelKey ? t(typeLabelKey) : versionInfo.install_type;
      return `v${versionInfo.current_version} · ${typeLabel}`;
    }
    if (runtimeStatus?.version) return `v${runtimeStatus.version}`;
    if (loading || runtimeStatusLoading || runtimeStatusFetching) return t("agentRuntime.loadingVersions");
    return t("agentRuntime.notInstalled");
  };

  const handleInstallTypeChange = (value: string) => {
    const nextInstallType = value as ClaudeCodeInstallType;
    setSelectedInstallType(nextInstallType);
  };

  const handleVersionChange = (version: string) => {
    setSelectedVersion(version);
  };

  const hasInstallableSelection =
    selectedVersion === "latest" || availableVersions.some((version) => version.version === selectedVersion);
  const canInstallSelectedVersion =
    hasInstallableSelection && !installing && !isInstalledSelection(selectedVersion, selectedInstallType);
  const autoUpdateSection: AgentRuntimeSettingsSection[] = versionInfo && !isNotInstalled ? [
    {
      value: "auto-update",
      title: t("agentRuntime.autoUpdate"),
      children: (
        <div className="flex h-8 items-center justify-end">
          <Switch
            checked={autoUpdateEnabled ?? !versionInfo.autoupdater_disabled}
            onCheckedChange={handleSetAutoupdater}
            disabled={installing || autoupdaterMutation.isPending}
          />
        </div>
      ),
    },
  ] : [];

  const handleInstallSelectedVersion = () => {
    if (!canInstallSelectedVersion) return;
    setVersionPopoverOpen(true);
    void handleInstall(selectedVersion, selectedInstallType);
  };

  const handleVersionPopoverOpenChange = (open: boolean) => {
    setVersionPopoverOpen(open);
  };

  return (
    <AgentCliRuntimeCard
      provider="claude"
      managementTitle={t("agentRuntime.currentVersion")}
      settingsSections={[...settingsSections, ...autoUpdateSection]}
    >
      <Popover className="block w-full" open={versionPopoverOpen} onOpenChange={handleVersionPopoverOpenChange}>
        <PopoverTrigger
          className="inline-flex h-8 w-full min-w-0 items-center justify-start gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{getCurrentVersionLabel()}</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(20rem,calc(100vw-2rem))] p-2"
        >
          <div className="space-y-3">
            <div className="flex min-h-0 flex-col gap-3">
              <section className="space-y-1.5">
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  {t("agentRuntime.installMethod")}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {INSTALL_TYPES.map((type) => {
                    const active = selectedInstallType === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        disabled={installing}
                        onClick={() => handleInstallTypeChange(type.value)}
                        className={cn(
                          "flex h-8 items-center justify-between rounded-md border px-2 text-left text-xs transition-colors disabled:opacity-50",
                          active
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-background text-foreground hover:bg-accent",
                        )}
                      >
                        <span>{t(type.labelKey)}</span>
                        {active && <Check className="h-3.5 w-3.5" />}
                      </button>
                    );
                  })}
                </div>
              </section>

              {selectedInstallType === "npm" && (
                <section>
                  <NpmInstallSourceControl
                    value={selectedNpmRegistry}
                    onValueChange={setSelectedNpmRegistry}
                    disabled={installing}
                  />
                </section>
              )}

              <section className="space-y-1.5">
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  {t("agentRuntime.availableVersions")}
                </p>
                <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {versionsStillLoading && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {t("agentRuntime.loadingVersions")}
                    </p>
                  )}
                  {versionsUnavailable && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {t("agentRuntime.availableVersionsUnavailable")}
                    </p>
                  )}
                  <VersionChoice
                    active={selectedVersion === "latest"}
                    disabled={installing}
                    label={t("agentRuntime.latestNewest")}
                    onClick={() => handleVersionChange("latest")}
                  />
                  {availableVersions.map((v) => {
                    const isCurrent = v.version === (versionInfo?.current_version ?? runtimeStatus?.version);
                    return (
                      <VersionChoice
                        key={v.version}
                        active={selectedVersion === v.version}
                        disabled={installing}
                        label={isCurrent ? t("agentRuntime.versionCurrent", { version: v.version }) : v.version}
                        meta={`↓${formatDownloads(v.downloads)}`}
                        onClick={() => handleVersionChange(v.version)}
                      />
                    );
                  })}
                </div>
              </section>

              <div className="mt-auto space-y-2 border-t border-border pt-2">
                <Button
                  type="button"
                  variant={installing ? "outline" : "default"}
                  size="sm"
                  className={cn(
                    "w-full gap-1.5",
                    installing && "pointer-events-none",
                  )}
                  onClick={handleInstallSelectedVersion}
                  disabled={installing || !canInstallSelectedVersion}
                  title={
                    installing
                      ? t("agentRuntime.installing")
                      : canInstallSelectedVersion
                        ? t("common.install")
                        : t("common.installed")
                  }
                >
                  {installing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {installing
                    ? t("agentRuntime.installing")
                    : canInstallSelectedVersion
                      ? t("common.install")
                      : t("common.installed")}
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {externalError && <p className="rounded-lg bg-destructive/5 p-2 text-xs text-destructive">{externalError}</p>}
    </AgentCliRuntimeCard>
  );
}
