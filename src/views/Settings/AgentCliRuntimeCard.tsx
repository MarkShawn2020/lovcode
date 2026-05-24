import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useInvokeMutation, useInvokeQuery } from "../../hooks";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import type { AgentProvider, AgentRuntimeStatus } from "../../types/agent";

type CliProvider = Extract<AgentProvider, "claude" | "codex">;
const RECENT_RUNTIME_PATHS_STORAGE_KEY = "lovcode:agent-runtime:recent-paths";
const MAX_RECENT_RUNTIME_PATHS = 6;

interface AgentCliRuntimeCardProps {
  provider: CliProvider;
  managementTitle?: string;
  settingsSections?: AgentRuntimeSettingsSection[];
  children?: ReactNode;
}

export interface AgentRuntimeSettingsSection {
  value: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export const agentRuntimeStatusKey = (provider: CliProvider) => ["agentRuntimeStatus", provider] as const;

export function AgentCliRuntimeCard({
  provider,
  managementTitle,
  settingsSections,
  children,
}: AgentCliRuntimeCardProps) {
  const { t } = useI18n();
  const {
    data: status,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useInvokeQuery<AgentRuntimeStatus>(
    agentRuntimeStatusKey(provider),
    "get_agent_runtime_status",
    { provider },
  );
  const runtimePathMutation = useInvokeMutation<
    AgentRuntimeStatus,
    { provider: CliProvider; path: string | null }
  >("set_agent_runtime_path_override", [agentRuntimeStatusKey(provider)]);
  const [recentPaths, setRecentPaths] = useState<string[]>(() => readRecentRuntimePaths(provider));
  const [pathActionError, setPathActionError] = useState<string | null>(null);

  const missing = status?.installed === false;
  const command = status?.command ?? provider;
  const checking = isLoading || isFetching;
  const pathLabel = checking
    ? t("agentRuntime.checkingEllipsis")
    : status?.path ?? (missing ? t("agentRuntime.notFoundInPath", { command }) : t("common.unknown"));
  const hasManualPath = status?.path_source === "manual";
  const savingPath = runtimePathMutation.isPending;
  const pathOptions = uniqueRuntimePaths([status?.path, ...recentPaths]);

  useEffect(() => {
    setRecentPaths(readRecentRuntimePaths(provider));
  }, [provider]);

  const savePathOverride = async (nextPath: string | null) => {
    const normalizedPath = nextPath?.trim() || null;
    setPathActionError(null);
    try {
      await runtimePathMutation.mutateAsync({
        provider,
        path: normalizedPath,
      });
      if (normalizedPath) {
        rememberRecentRuntimePath(provider, normalizedPath, setRecentPaths);
      }
    } catch (error) {
      setPathActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleBrowsePath = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: t("agentRuntime.selectExecutable", { command }),
    });
    if (typeof selected === "string") {
      await savePathOverride(selected);
    }
  };

  return (
    <>
      <section className="space-y-2">
        <SettingRow title={t("agentRuntime.executablePath")}>
          <div className="flex min-w-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingPath}
                  className="h-8 min-w-0 flex-1 justify-start gap-2 px-2.5 text-left"
                  title={pathLabel}
                >
                  <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">{pathLabel}</span>
                  <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 max-w-[calc(100vw-2rem)]"
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t("agentRuntime.recentPaths")}
                </DropdownMenuLabel>
                {pathOptions.length > 0 ? (
                  pathOptions.map((path) => (
                    <DropdownMenuItem
                      key={path}
                      onClick={() => void savePathOverride(path)}
                      className="min-w-0 font-mono text-xs"
                      title={path}
                    >
                      <span className="min-w-0 flex-1 truncate">{path}</span>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    {t("agentRuntime.noRecentPaths")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {hasManualPath && (
                  <DropdownMenuItem onClick={() => void savePathOverride(null)}>
                    {t("agentRuntime.useDetectedPath")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void handleBrowsePath()}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("agentRuntime.chooseNewPath")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="h-8 min-w-28 shrink-0 justify-start gap-1.5 px-2.5 text-left"
              aria-label={t("agentRuntime.refreshRuntimeStatus")}
              title={t("agentRuntime.refreshRuntimeStatus")}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              <span className="min-w-0 truncate">{t("agentRuntime.test")}</span>
            </Button>
          </div>
        </SettingRow>

        {(error || pathActionError) && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-2 text-xs text-destructive">
            {pathActionError ?? error?.message}
          </div>
        )}
      </section>

      {(children || managementTitle) && (
        <section className="mt-2 border-t border-border pt-2">
          <SettingRow title={managementTitle ?? t("agentRuntime.currentVersion")}>
            {children && <div className="min-w-0 flex-1 space-y-2">{children}</div>}
          </SettingRow>
        </section>
      )}

      {settingsSections?.map((section) => (
        <section key={section.value} className="mt-2 border-t border-border pt-2">
          <SettingRow title={section.title} description={section.description}>
            {section.children}
          </SettingRow>
        </section>
      ))}
    </>
  );
}

function readRecentRuntimePaths(provider: CliProvider): string[] {
  try {
    const raw = localStorage.getItem(RECENT_RUNTIME_PATHS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const paths = parsed && typeof parsed === "object" ? parsed[provider] : null;
    return Array.isArray(paths) ? uniqueRuntimePaths(paths) : [];
  } catch {
    return [];
  }
}

function writeRecentRuntimePaths(provider: CliProvider, paths: string[]) {
  try {
    const raw = localStorage.getItem(RECENT_RUNTIME_PATHS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const next = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    next[provider] = paths;
    localStorage.setItem(RECENT_RUNTIME_PATHS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

function rememberRecentRuntimePath(
  provider: CliProvider,
  path: string,
  setRecentPaths: Dispatch<SetStateAction<string[]>>,
) {
  setRecentPaths((current) => {
    const next = uniqueRuntimePaths([path, ...current]).slice(0, MAX_RECENT_RUNTIME_PATHS);
    writeRecentRuntimePaths(provider, next);
    return next;
  });
}

function uniqueRuntimePaths(paths: Array<string | null | undefined>): string[] {
  return paths
    .map((path) => path?.trim())
    .filter((path): path is string => Boolean(path))
    .filter((path, index, all) => all.indexOf(path) === index)
    .slice(0, MAX_RECENT_RUNTIME_PATHS);
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <SectionHeader title={title} description={description} className="shrink-0 sm:w-32" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  const titleElement = (
    <p className={cn("text-xs font-medium text-foreground", description && "cursor-help")}>{title}</p>
  );

  return (
    <div className={className}>
      {description ? (
        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>{titleElement}</TooltipTrigger>
          <TooltipContent sideOffset={6} className="max-w-xs whitespace-pre-line text-left">
            {description}
          </TooltipContent>
        </Tooltip>
      ) : (
        titleElement
      )}
    </div>
  );
}
