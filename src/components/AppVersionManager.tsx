import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { requestUpdateAction, updateStateAtom } from "./UpdateChecker";
import { queryKeys, useInvokeMutation, useInvokeQuery, useQueryClient } from "../hooks";
import { useI18n } from "@/i18n";
import type { LovcodeRelease, LovcodeVersionInfo } from "../types";

interface AppVersionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const releaseSourceLabels = {
  github_api: "GitHub API",
  cache: "Cached GitHub API",
  github_atom: "GitHub Atom fallback",
} as const;

function formatError(error: unknown) {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string | null, locale: string) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function releaseSummary(release: LovcodeRelease, fallback: string) {
  const lines = (release.body ?? "")
    .split("\n")
    .map((line) => line
      .replace(/^#+\s*/, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
    .trim())
    .filter(Boolean);
  return lines[0] ?? fallback;
}

export function AppVersionManager({ open, onOpenChange }: AppVersionManagerProps) {
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const updateState = useAtomValue(updateStateAtom);
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    data: info,
    error: queryError,
    isFetching,
    isLoading,
  } = useInvokeQuery<LovcodeVersionInfo>(
    queryKeys.lovcodeVersionInfo,
    "get_lovcode_version_info",
    undefined,
    { enabled: open },
  );
  const refreshMutation = useInvokeMutation<LovcodeVersionInfo, void>("refresh_lovcode_version_info");
  const setAutoUpdateMutation = useInvokeMutation<void, { enabled: boolean }>(
    "set_lovcode_autoupdater",
    [queryKeys.lovcodeAutoupdaterEnabled, queryKeys.lovcodeVersionInfo],
  );

  const latestRelease = useMemo(() => {
    if (!info?.latest_version) return null;
    return info.releases.find((release) => release.version === info.latest_version) ?? null;
  }, [info]);

  const isCurrentLatest =
    Boolean(info?.latest_version) && info?.current_version === info?.latest_version;

  const error = actionError ?? formatError(queryError);
  const loading = isLoading || refreshMutation.isPending;
  const fetching = isFetching || refreshMutation.isPending;
  const statusLabels = {
    checking: t("updates.checkingForUpdates"),
    latest: t("updates.upToDate"),
    available: t("updates.updateAvailable"),
    downloading: t("updates.downloadingUpdate"),
    done: t("updates.restartRequired"),
    error: t("updates.checkFailed"),
    disabled: t("updates.autoUpdateDisabled"),
  } as const;

  const handleRefresh = async () => {
    setActionError(null);
    try {
      const next = await refreshMutation.mutateAsync(undefined);
      queryClient.setQueryData(queryKeys.lovcodeVersionInfo, next);
    } catch (e) {
      setActionError(formatError(e));
    }
  };

  const handleAutoUpdateChange = async (enabled: boolean) => {
    const previous = queryClient.getQueryData<LovcodeVersionInfo>(queryKeys.lovcodeVersionInfo);
    setActionError(null);
    queryClient.setQueryData<LovcodeVersionInfo | undefined>(
      queryKeys.lovcodeVersionInfo,
      (current) => current ? { ...current, auto_update_enabled: enabled } : current,
    );
    queryClient.setQueryData(queryKeys.lovcodeAutoupdaterEnabled, enabled);
    try {
      await setAutoUpdateMutation.mutateAsync({ enabled });
      requestUpdateAction(enabled ? "check" : "disable");
    } catch (e) {
      queryClient.setQueryData(queryKeys.lovcodeVersionInfo, previous);
      if (previous) {
        queryClient.setQueryData(queryKeys.lovcodeAutoupdaterEnabled, previous.auto_update_enabled);
      }
      setActionError(formatError(e));
    }
  };

  const handleOpenRelease = (release: LovcodeRelease) => {
    void openUrl(release.html_url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-4">
        <DialogHeader>
          <DialogTitle>{t("updates.versionTitle")}</DialogTitle>
          <DialogDescription>
            {t("updates.versionDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-xs text-muted-foreground">{t("common.current")}</p>
              <p className="mt-1 font-serif text-lg text-foreground">v{info?.current_version ?? "..."}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-xs text-muted-foreground">{t("common.latest")}</p>
              <p className="mt-1 font-serif text-lg text-foreground">v{info?.latest_version ?? "..."}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-xs text-muted-foreground">{t("common.status")}</p>
              <p className="mt-1 text-sm font-medium text-foreground">{statusLabels[updateState.stage]}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t("common.autoUpdate")}</p>
              <p className="text-xs text-muted-foreground">
                {t("updates.autoUpdateDescription")}
              </p>
            </div>
            <Switch
              checked={info?.auto_update_enabled ?? true}
              disabled={setAutoUpdateMutation.isPending || fetching}
              onCheckedChange={handleAutoUpdateChange}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleRefresh}
              disabled={fetching}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${fetching ? "animate-spin" : ""}`} />
              {t("updates.refreshReleases")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => requestUpdateAction("check")}>
              {t("updates.checkNow")}
            </Button>
            {updateState.stage === "available" && (
              <Button size="sm" onClick={() => requestUpdateAction("install")}>
                {t("common.install")} v{updateState.update?.version}
              </Button>
            )}
            {updateState.stage === "done" && (
              <Button size="sm" onClick={() => requestUpdateAction("relaunch")}>
                {t("updates.relaunch")}
              </Button>
            )}
          </div>

          {error && (
            <p
              className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted p-2 text-xs text-destructive [overflow-wrap:anywhere]"
              title={error}
            >
              {error}
            </p>
          )}

          {latestRelease && !isCurrentLatest && (
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-sm font-medium text-foreground">{t("updates.latestRelease")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("updates.publishedOn", {
                  version: latestRelease.version,
                  date: formatDate(latestRelease.published_at, locale) ?? t("common.unknown"),
                })}
              </p>
              <p className="mt-2 text-sm text-foreground">{releaseSummary(latestRelease, t("updates.noReleaseNotes"))}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{t("updates.publishedVersions")}</p>
              <p className="text-xs text-muted-foreground">
                {info?.releases.length ?? 0} releases
                {info ? ` · ${releaseSourceLabels[info.release_source]}` : ""}
              </p>
            </div>

            {info?.releases_truncated && (
              <p className="rounded-lg border border-border bg-muted p-2 text-xs text-muted-foreground">
                GitHub API is unavailable, so only the recent Atom feed entries are shown.
              </p>
            )}

            {loading && !info && (
              <p className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                {t("updates.loadingReleases")}
              </p>
            )}

            {info?.releases.map((release) => (
              <button
                key={release.tag_name}
                type="button"
                onClick={() => handleOpenRelease(release)}
                className="grid h-9 w-full grid-cols-[minmax(5.5rem,7rem)_minmax(6rem,8rem)_minmax(0,1fr)_1rem] items-center gap-3 rounded-lg border border-border bg-card px-3 text-left text-xs hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium text-foreground">v{release.version}</span>
                  {release.version === info.current_version && (
                    <span className="rounded-lg bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      {t("updates.currentBadge")}
                    </span>
                  )}
                  {release.prerelease && (
                    <span className="rounded-lg bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t("updates.preBadge")}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {formatDate(release.published_at, locale) ?? t("common.unknown")}
                </span>
                <span className="truncate text-muted-foreground">
                  {releaseSummary(release, t("updates.noReleaseNotes"))}
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
