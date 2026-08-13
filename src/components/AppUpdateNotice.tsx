import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AlertCircle, CheckCircle2, Copy, Download, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downloadAndInstallAppUpdate,
  formatAppUpdateDiagnostic,
  restartToFinishAppUpdate,
  startInitialAppUpdateCheck,
  useAppUpdater,
} from "@/lib/appUpdater";

export function AppUpdateNotice() {
  const isMainWindow = getCurrentWebviewWindow().label === "main";
  const update = useAppUpdater();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isMainWindow) startInitialAppUpdateCheck();
  }, [isMainWindow]);

  const noticeKey = `${update.stage}:${update.availableVersion ?? "none"}:${update.error?.contextId ?? "none"}`;
  const visible =
    update.stage === "available" ||
    update.stage === "downloading" ||
    update.stage === "installing" ||
    update.stage === "ready" ||
    (update.stage === "error" && update.error?.operation !== "check");

  if (!isMainWindow || !visible || dismissedKey === noticeKey) return null;

  const title = update.stage === "available"
    ? "发现 Ataru 新版本"
    : update.stage === "downloading"
      ? "正在下载更新"
      : update.stage === "installing"
        ? "正在准备安装"
        : update.stage === "ready"
          ? "更新已准备就绪"
          : "更新未完成";

  const copyDiagnostic = async () => {
    await navigator.clipboard.writeText(formatAppUpdateDiagnostic(update));
    setCopied(true);
  };

  return (
    <aside
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
          {update.stage === "ready"
            ? <CheckCircle2 className="h-4 w-4" />
            : update.stage === "error"
              ? <AlertCircle className="h-4 w-4" />
              : <Download className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {update.stage === "available" && `版本 ${update.availableVersion} 可用，当前版本为 ${update.currentVersion}。`}
            {update.stage === "downloading" && (update.progress === null ? "正在接收签名更新包…" : `下载进度 ${update.progress}%`)}
            {update.stage === "installing" && "更新包已校验，正在交给系统安装。"}
            {update.stage === "ready" && "重新启动后将运行新版本。"}
            {update.stage === "error" && update.error?.message}
          </p>
        </div>
        {update.stage !== "downloading" && update.stage !== "installing" && (
          <button
            type="button"
            onClick={() => setDismissedKey(noticeKey)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="暂时关闭更新提示"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {(update.stage === "downloading" || update.stage === "installing") && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${update.progress ?? 20}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {update.stage === "available" && (
          <Button size="sm" onClick={() => void downloadAndInstallAppUpdate()}>
            <Download className="h-4 w-4" />
            下载并安装
          </Button>
        )}
        {update.stage === "ready" && (
          <Button size="sm" onClick={() => void restartToFinishAppUpdate()}>
            <RotateCcw className="h-4 w-4" />
            重新启动
          </Button>
        )}
        {update.stage === "error" && (
          <Button size="sm" variant="outline" onClick={() => void copyDiagnostic()}>
            <Copy className="h-4 w-4" />
            {copied ? "已复制" : "复制诊断"}
          </Button>
        )}
      </div>
    </aside>
  );
}
