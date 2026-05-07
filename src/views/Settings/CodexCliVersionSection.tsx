import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { CodexCliVersionInfo } from "../../types";
import { queryKeys, useInvokeMutation, useInvokeQuery, useQueryClient } from "../../hooks";
import { useI18n } from "../../i18n";
import { AgentCliRuntimeCard, agentRuntimeStatusKey } from "./AgentCliRuntimeCard";
import { getInstallLogClassName, getInstallLogDisplayText } from "./installLogDisplay";

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CodexCliVersionSection() {
  const { t } = useI18n();
  const {
    data: versionInfo,
    error: queryError,
    isLoading,
    refetch,
  } = useInvokeQuery<CodexCliVersionInfo>(
    queryKeys.codexCliVersionInfo,
    "get_codex_cli_version_info",
  );
  const queryClient = useQueryClient();
  const installMutation = useInvokeMutation<string, { version: string }>(
    "install_codex_cli_version",
    [queryKeys.codexCliVersionInfo],
  );
  const [installing, setInstalling] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("latest");
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
    initializedFromInfoRef.current = true;
  }, [versionInfo]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLogs]);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const handleInstall = async (version: string = selectedVersion) => {
    setSelectedVersion(version);
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

      await installMutation.mutateAsync({ version });
      setSuccess(t("agentRuntime.codexInstallSuccess", { version }));
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

  const error = actionError ?? (queryError ? queryError.message : null);

  const getCurrentVersionLabel = () => {
    if (installing) return t("agentRuntime.installing");
    if (!versionInfo?.current_version) return t("agentRuntime.notInstalled");
    return `v${versionInfo.current_version}`;
  };

  const handleVersionChange = (version: string) => {
    setSelectedVersion(version);
    if (!versionInfo || installing) return;
    if (version !== versionInfo.current_version) {
      void handleInstall(version);
    }
  };

  return (
    <AgentCliRuntimeCard
      provider="codex"
      managementTitle={t("agentRuntime.currentVersion")}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLoading || installing}
            className="h-8 w-full min-w-0 justify-start gap-2 px-2.5 text-left"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {isLoading ? t("agentRuntime.loadingVersions") : getCurrentVersionLabel()}
            </span>
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t("agentRuntime.availableVersions")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={selectedVersion} onValueChange={handleVersionChange}>
            <DropdownMenuRadioItem value="latest" disabled={installing}>
              {t("agentRuntime.latestNewest")}
            </DropdownMenuRadioItem>
            {versionInfo?.available_versions.map((v) => {
              const current = v.version === versionInfo.current_version;
              return (
                <DropdownMenuRadioItem
                  key={v.version}
                  value={v.version}
                  disabled={installing || current}
                >
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span className="truncate">
                      {current ? t("agentRuntime.versionCurrent", { version: v.version }) : v.version}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ↓{formatDownloads(v.downloads)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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

      {error && <p className="rounded-lg bg-destructive/5 p-2 text-xs text-destructive">{error}</p>}
      {success && <p className="rounded-lg bg-primary/5 p-2 text-xs text-primary">{success}</p>}
    </AgentCliRuntimeCard>
  );
}
