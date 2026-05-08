import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Progress } from "../../components/ui/progress";
import { Switch } from "../../components/ui/switch";
import type { CodexCliInstallType, CodexCliVersionInfo } from "../../types";
import type { AgentRuntimeStatus } from "../../types/agent";
import { queryKeys, useInvokeMutation, useInvokeQuery, useQueryClient } from "../../hooks";
import { useI18n, type TranslationKey } from "../../i18n";
import { cn } from "../../lib/utils";
import { AgentCliRuntimeCard, agentRuntimeStatusKey } from "./AgentCliRuntimeCard";
import { getInstallLogClassName, getInstallLogDisplayText } from "./installLogDisplay";
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

const INSTALL_TYPES: { value: CodexCliInstallType; labelKey: TranslationKey }[] = [
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

export function CodexCliVersionSection() {
  const { activeLanguage, t } = useI18n();
  const {
    data: versionInfo,
    error: queryError,
    isLoading,
    refetch,
  } = useInvokeQuery<CodexCliVersionInfo>(
    queryKeys.codexCliVersionInfo,
    "get_codex_cli_version_info",
  );
  const {
    data: runtimeStatus,
    isLoading: runtimeStatusLoading,
    isFetching: runtimeStatusFetching,
  } = useInvokeQuery<AgentRuntimeStatus>(
    agentRuntimeStatusKey("codex"),
    "get_agent_runtime_status",
    { provider: "codex" },
  );
  const queryClient = useQueryClient();
  const installMutation = useInvokeMutation<
    string,
    { version: string; installType: CodexCliInstallType; npmRegistry?: NpmInstallRegistry }
  >("install_codex_cli_version", [queryKeys.codexCliVersionInfo]);
  const autoupdaterMutation = useInvokeMutation<void, { disabled: boolean }>(
    "set_codex_cli_autoupdater",
  );
  const [installing, setInstalling] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("latest");
  const [selectedInstallType, setSelectedInstallType] = useState<CodexCliInstallType>(() =>
    activeLanguage === "zh" ? "npm" : "native",
  );
  const [selectedNpmRegistry, setSelectedNpmRegistry] = useState<NpmInstallRegistry>(() =>
    getDefaultNpmInstallRegistry(activeLanguage),
  );
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState<boolean | null>(null);
  const [versionPopoverOpen, setVersionPopoverOpen] = useState(false);
  const [versionListLoadingExpired, setVersionListLoadingExpired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const installGenRef = useRef(0);
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
    if (!isLoading || versionInfo) {
      setVersionListLoadingExpired(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setVersionListLoadingExpired(true);
    }, VERSION_LIST_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading, versionInfo]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLogs]);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const getInstallTypeLabel = (installType: CodexCliInstallType) => {
    const typeLabelKey = INSTALL_TYPES.find((type) => type.value === installType)?.labelKey;
    return typeLabelKey ? t(typeLabelKey) : installType;
  };

  const handleInstall = async (
    version: string = selectedVersion,
    installType: CodexCliInstallType = selectedInstallType,
  ) => {
    setSelectedVersion(version);
    setSelectedInstallType(installType);
    unlistenRef.current?.();
    unlistenRef.current = null;

    const currentGen = ++installGenRef.current;
    setInstalling(true);
    setActionError(null);
    setSuccess(null);
    setInstallLogs([]);
    setDownloadProgress(null);

    try {
      unlistenRef.current = await listen<string>("codex-install-progress", (event) => {
        if (installGenRef.current !== currentGen) return;
        const payload = event.payload;
        const progressMatch = payload.match(/(\d+(?:\.\d+)?)\s*%/);
        if (progressMatch) {
          setDownloadProgress(parseFloat(progressMatch[1]));
          return;
        }
        if (payload.includes("Done") || payload.includes("added ") || payload.includes("changed ")) {
          setDownloadProgress(null);
        }
        setInstallLogs((prev) => [...prev, payload]);
      });

      await installMutation.mutateAsync({
        version,
        installType,
        npmRegistry: installType === "npm" ? selectedNpmRegistry : undefined,
      });
      setSuccess(t("agentRuntime.codexInstallSuccess", { version, type: getInstallTypeLabel(installType) }));
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: agentRuntimeStatusKey("codex") }),
      ]);
    } catch (e) {
      setActionError(String(e));
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setInstalling(false);
    }
  };

  const handleSetAutoupdater = async (enabled: boolean) => {
    if (!versionInfo) return;
    const previousEnabled = autoUpdateEnabled ?? !versionInfo.autoupdater_disabled;
    setAutoUpdateEnabled(enabled);
    queryClient.setQueryData<CodexCliVersionInfo>(queryKeys.codexCliVersionInfo, {
      ...versionInfo,
      autoupdater_disabled: !enabled,
    });
    try {
      setActionError(null);
      await autoupdaterMutation.mutateAsync({ disabled: !enabled });
    } catch (e) {
      setAutoUpdateEnabled(previousEnabled);
      queryClient.setQueryData<CodexCliVersionInfo>(queryKeys.codexCliVersionInfo, {
        ...versionInfo,
        autoupdater_disabled: !previousEnabled,
      });
      setActionError(String(e));
    }
  };

  const externalError = queryError?.message ?? (!versionPopoverOpen ? actionError : null);

  const isNotInstalled = versionInfo?.install_type === "none";
  const availableVersions = versionInfo?.available_versions ?? [];
  const versionsStillLoading = isLoading && !versionInfo && !versionListLoadingExpired;
  const versionsUnavailable = !versionsStillLoading && availableVersions.length === 0;
  const resolveSelectedVersion = (version: string) =>
    version === "latest" ? availableVersions[0]?.version ?? version : version;
  const isInstalledSelection = (version: string, installType: CodexCliInstallType) =>
    versionInfo?.current_version === resolveSelectedVersion(version) && versionInfo?.install_type === installType;

  const getCurrentVersionLabel = () => {
    if (installing) return t("agentRuntime.installing");
    if (versionInfo?.current_version) {
      const installType = versionInfo.install_type === "none" ? selectedInstallType : versionInfo.install_type;
      return `v${versionInfo.current_version} · ${getInstallTypeLabel(installType)}`;
    }
    if (runtimeStatus?.version) return `v${runtimeStatus.version}`;
    if (isLoading || runtimeStatusLoading || runtimeStatusFetching) return t("agentRuntime.loadingVersions");
    return t("agentRuntime.notInstalled");
  };

  const handleInstallTypeChange = (value: string) => {
    const nextInstallType = value as CodexCliInstallType;
    setSelectedInstallType(nextInstallType);
  };

  const handleVersionChange = (version: string) => {
    setSelectedVersion(version);
  };

  const hasInstallableSelection =
    selectedVersion === "latest" || availableVersions.some((version) => version.version === selectedVersion);
  const canInstallSelectedVersion =
    hasInstallableSelection && !installing && !isInstalledSelection(selectedVersion, selectedInstallType);

  const handleInstallSelectedVersion = () => {
    if (!canInstallSelectedVersion) return;
    setVersionPopoverOpen(true);
    void handleInstall(selectedVersion, selectedInstallType);
  };

  return (
    <AgentCliRuntimeCard
      provider="codex"
      managementTitle={t("agentRuntime.currentVersion")}
      settingsSections={versionInfo && !isNotInstalled ? [
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
      ] : undefined}
    >
      <Popover className="block w-full" open={versionPopoverOpen} onOpenChange={setVersionPopoverOpen}>
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

      {downloadProgress !== null && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{t("agentRuntime.downloading")}</span>
            <span>{downloadProgress.toFixed(1)}%</span>
          </div>
          <Progress value={downloadProgress} className="h-2" />
        </div>
      )}

      {installLogs.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-lg bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
          {installLogs.map((log, i) => (
            <div
              key={i}
              className={getInstallLogClassName(log, t("agentRuntime.cancelledByUserLog"))}
            >
              {getInstallLogDisplayText(log)}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {externalError && <p className="rounded-lg bg-destructive/5 p-2 text-xs text-destructive">{externalError}</p>}
      {success && <p className="rounded-lg bg-primary/5 p-2 text-xs text-primary">{success}</p>}
    </AgentCliRuntimeCard>
  );
}
