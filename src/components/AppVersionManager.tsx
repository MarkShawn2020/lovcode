import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { requestUpdateAction, updateStateAtom } from "./UpdateChecker";
import type { LovcodeRelease, LovcodeVersionInfo } from "../types";

interface AppVersionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusLabels = {
  checking: "Checking for updates",
  latest: "Up to date",
  available: "Update available",
  downloading: "Downloading update",
  done: "Restart required",
  error: "Update check failed",
  disabled: "Auto update disabled",
} as const;

function formatDate(value: string | null) {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function releaseSummary(release: LovcodeRelease) {
  const lines = (release.body ?? "")
    .split("\n")
    .map((line) => line
      .replace(/^#+\s*/, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .trim())
    .filter(Boolean);
  return lines[0] ?? "No release notes.";
}

export function AppVersionManager({ open, onOpenChange }: AppVersionManagerProps) {
  const updateState = useAtomValue(updateStateAtom);
  const [info, setInfo] = useState<LovcodeVersionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingAutoUpdate, setSavingAutoUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<LovcodeVersionInfo>("get_lovcode_version_info");
      setInfo(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadInfo();
    }
  }, [open]);

  const latestRelease = useMemo(() => {
    if (!info?.latest_version) return null;
    return info.releases.find((release) => release.version === info.latest_version) ?? null;
  }, [info]);

  const isCurrentLatest =
    Boolean(info?.latest_version) && info?.current_version === info?.latest_version;

  const handleAutoUpdateChange = async (enabled: boolean) => {
    const previous = info;
    setSavingAutoUpdate(true);
    setError(null);
    setInfo((current) => current ? { ...current, auto_update_enabled: enabled } : current);
    try {
      await invoke("set_lovcode_autoupdater", { enabled });
      requestUpdateAction(enabled ? "check" : "disable");
    } catch (e) {
      setInfo(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAutoUpdate(false);
    }
  };

  const handleOpenRelease = (release: LovcodeRelease) => {
    void openUrl(release.html_url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-4">
        <DialogHeader>
          <DialogTitle>Lovcode Version</DialogTitle>
          <DialogDescription>
            Current version, update state, and published releases.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="mt-1 font-serif text-lg text-foreground">v{info?.current_version ?? "..."}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-xs text-muted-foreground">Latest</p>
              <p className="mt-1 font-serif text-lg text-foreground">v{info?.latest_version ?? "..."}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="mt-1 text-sm font-medium text-foreground">{statusLabels[updateState.stage]}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Auto update</p>
              <p className="text-xs text-muted-foreground">
                Check for Lovcode updates on launch and show the install prompt.
              </p>
            </div>
            <Switch
              checked={info?.auto_update_enabled ?? true}
              disabled={savingAutoUpdate || loading}
              onCheckedChange={handleAutoUpdateChange}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadInfo} disabled={loading}>
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh releases
            </Button>
            <Button variant="outline" size="sm" onClick={() => requestUpdateAction("check")}>
              Check now
            </Button>
            {updateState.stage === "available" && (
              <Button size="sm" onClick={() => requestUpdateAction("install")}>
                Install v{updateState.update?.version}
              </Button>
            )}
            {updateState.stage === "done" && (
              <Button size="sm" onClick={() => requestUpdateAction("relaunch")}>
                Relaunch
              </Button>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-border bg-muted p-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {latestRelease && !isCurrentLatest && (
            <div className="rounded-lg border border-border bg-card p-2">
              <p className="text-sm font-medium text-foreground">Latest release</p>
              <p className="mt-1 text-xs text-muted-foreground">
                v{latestRelease.version} published {formatDate(latestRelease.published_at)}
              </p>
              <p className="mt-2 text-sm text-foreground">{releaseSummary(latestRelease)}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Published versions</p>
              <p className="text-xs text-muted-foreground">{info?.releases.length ?? 0} releases</p>
            </div>

            {loading && !info && (
              <p className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                Loading releases...
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
                      Current
                    </span>
                  )}
                  {release.prerelease && (
                    <span className="rounded-lg bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Pre
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {formatDate(release.published_at)}
                </span>
                <span className="truncate text-muted-foreground">
                  {releaseSummary(release)}
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
