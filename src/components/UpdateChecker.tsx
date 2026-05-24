import { useState, useEffect, useRef, useCallback } from "react";
import { atom, useAtom } from "jotai";
import { check, type CheckOptions, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { RefreshCw, X } from "lucide-react";
import { queryKeys, useInvokeQuery } from "../hooks";
import { useI18n } from "@/i18n";

export type UpdateStage = "checking" | "latest" | "available" | "downloading" | "done" | "error" | "disabled";

interface UpdateState {
  stage: UpdateStage;
  update: Update | null;
  error: string;
}

export const updateStateAtom = atom<UpdateState>({
  stage: "checking",
  update: null,
  error: "",
});

type UpdateAction = "check" | "disable" | "install" | "relaunch" | "show";

const UPDATE_ACTION_EVENT = "lovcode:update-action";
const CHECK_TIMEOUT_MS = 15_000;

export function requestUpdateAction(action: UpdateAction) {
  window.dispatchEvent(new CustomEvent<UpdateAction>(UPDATE_ACTION_EVENT, { detail: action }));
}

export function UpdateChecker() {
  const [state, setState] = useAtom(updateStateAtom);
  const { t } = useI18n();
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const { data: autoUpdateEnabled = true, isLoading: loadingAutoUpdate } = useInvokeQuery<boolean>(
    queryKeys.lovcodeAutoupdaterEnabled,
    "get_lovcode_autoupdater_enabled",
  );
  const { data: updaterProxy = null, isLoading: loadingUpdaterProxy } = useInvokeQuery<string | null>(
    queryKeys.lovcodeUpdaterProxy,
    "get_lovcode_updater_proxy",
  );

  const checkId = useRef(0);
  const initialCheckStartedRef = useRef(false);

  const runCheck = useCallback(async (manual = true) => {
    const currentCheckId = checkId.current + 1;
    checkId.current = currentCheckId;

    setDismissed(false);
    setProgress(0);
    setState({ stage: "checking", update: null, error: "" });

    if (!manual) {
      if (!autoUpdateEnabled) {
        if (checkId.current !== currentCheckId) return;
        setState({ stage: "disabled", update: null, error: "" });
        return;
      }
    }

    const timeout = window.setTimeout(() => {
      if (checkId.current !== currentCheckId) return;
      checkId.current = currentCheckId + 1;
      setState({
        stage: "error",
        update: null,
        error: "Update check timed out. Check your network and try again.",
      });
    }, CHECK_TIMEOUT_MS);

    const checkOptions: CheckOptions = updaterProxy
      ? { timeout: CHECK_TIMEOUT_MS, proxy: updaterProxy }
      : { timeout: CHECK_TIMEOUT_MS };

    check(checkOptions)
      .then((u) => {
        window.clearTimeout(timeout);
        if (checkId.current !== currentCheckId) return;
        if (u?.available) {
          setState({ stage: "available", update: u, error: "" });
        } else {
          setState({ stage: "latest", update: null, error: "" });
        }
      })
      .catch((e) => {
        window.clearTimeout(timeout);
        if (checkId.current !== currentCheckId) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[UpdateChecker]", e);
        setState({ stage: "error", update: null, error: msg });
      });
  }, [autoUpdateEnabled, setState, updaterProxy]);

  const { stage, update, error } = state;

  useEffect(() => {
    if (!loadingAutoUpdate && !loadingUpdaterProxy && !initialCheckStartedRef.current) {
      initialCheckStartedRef.current = true;
      runCheck(false);
    }
  }, [loadingAutoUpdate, loadingUpdaterProxy, runCheck]);

  const handleUpdate = useCallback(async () => {
    if (!update) return;
    setDismissed(false);
    setState((s) => ({ ...s, stage: "downloading" }));
    setProgress(0);
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });
      setState((s) => ({ ...s, stage: "done" }));
    } catch (e) {
      console.error("[UpdateChecker]", e);
      setState((s) => ({
        ...s,
        stage: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [setState, update]);

  useEffect(() => {
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<UpdateAction>).detail;
      if (action === "check") {
        runCheck();
      } else if (action === "disable") {
        checkId.current += 1;
        setDismissed(true);
        setProgress(0);
        setState({ stage: "disabled", update: null, error: "" });
      } else if (action === "install") {
        void handleUpdate();
      } else if (action === "relaunch") {
        void handleRelaunch();
      } else if (action === "show") {
        setDismissed(false);
      }
    };

    window.addEventListener(UPDATE_ACTION_EVENT, handleAction);
    return () => window.removeEventListener(UPDATE_ACTION_EVENT, handleAction);
  }, [handleUpdate, runCheck]);

  const canShow =
    stage === "available" ||
    stage === "downloading" ||
    stage === "done" ||
    stage === "error";

  if (!canShow || dismissed) return null;

  const title = stage === "error"
    ? t("updates.notificationFailed")
    : stage === "done"
      ? t("updates.notificationInstalled")
      : t("updates.notificationAvailable");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden bg-card border border-border rounded-xl shadow-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-serif text-sm font-semibold text-foreground">
            {title}
          </p>
          {update && (
            <p className="text-xs text-muted-foreground mt-0.5">
              v{update.version} is ready
            </p>
          )}
        </div>
        {stage !== "downloading" && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("updates.dismissNotification")}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {stage === "downloading" && (
        <div className="space-y-1.5">
          <Progress value={progress} className="h-1.5" />
          <p className="text-xs text-muted-foreground text-right">
            {progress}%
          </p>
        </div>
      )}

      {stage === "error" && (
        <p
          className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted px-2 py-1.5 text-xs text-destructive [overflow-wrap:anywhere]"
          title={error}
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {stage === "available" && (
          <Button size="sm" onClick={handleUpdate}>
            {t("updates.updateNow")}
          </Button>
        )}
        {stage === "done" && (
          <Button size="sm" onClick={handleRelaunch}>
            {t("updates.relaunch")}
          </Button>
        )}
        {stage === "error" && (
          <Button size="sm" variant="outline" onClick={() => runCheck()}>
            <RefreshCw className="w-3.5 h-3.5" />
            {t("common.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}

async function handleRelaunch() {
  await relaunch();
}
