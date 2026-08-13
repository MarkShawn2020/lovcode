import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Download, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  formatAppUpdateDiagnostic,
  prepareAppUpdater,
  restartToFinishAppUpdate,
  useAppUpdater,
} from "@/lib/appUpdater";

function formatCheckedAt(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AppUpdatePanel() {
  const update = useAppUpdater();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void prepareAppUpdater();
  }, []);

  const isBusy = update.stage === "checking" || update.stage === "downloading" || update.stage === "installing";
  const checkedAt = formatCheckedAt(update.lastCheckedAt);

  const copyDiagnostic = async () => {
    await navigator.clipboard.writeText(formatAppUpdateDiagnostic(update));
    setCopied(true);
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">软件更新</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            当前版本 {update.currentVersion}
            {checkedAt ? ` · 上次检查 ${checkedAt}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(update.stage === "idle" || update.stage === "latest" || update.stage === "error") && (
            <Button variant="outline" onClick={() => void checkForAppUpdate(true)} disabled={isBusy}>
              <RefreshCw className="h-4 w-4" />
              检查更新
            </Button>
          )}
          {update.stage === "available" && (
            <Button onClick={() => void downloadAndInstallAppUpdate()}>
              <Download className="h-4 w-4" />
              下载并安装
            </Button>
          )}
          {update.stage === "ready" && (
            <Button onClick={() => void restartToFinishAppUpdate()}>
              <RotateCcw className="h-4 w-4" />
              重新启动
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-background p-4" aria-live="polite">
        {update.stage === "unsupported" && (
          <p className="text-sm text-muted-foreground">请在 Ataru 桌面应用中检查更新。</p>
        )}
        {update.stage === "idle" && (
          <p className="text-sm text-muted-foreground">Ataru 会在启动后自动检查稳定版更新。</p>
        )}
        {update.stage === "checking" && (
          <StatusLine icon={<LoaderCircle className="h-4 w-4 animate-spin" />} title="正在检查更新" detail="连接更新服务并核对当前平台与架构。" />
        )}
        {update.stage === "latest" && (
          <StatusLine icon={<CheckCircle2 className="h-4 w-4" />} title="已是最新版本" detail="当前没有需要安装的稳定版更新。" />
        )}
        {update.stage === "available" && (
          <StatusLine icon={<Download className="h-4 w-4" />} title={`版本 ${update.availableVersion} 可用`} detail={update.notes || "更新包已找到，安装前会校验发布签名。"} />
        )}
        {update.stage === "downloading" && (
          <div className="space-y-3">
            <StatusLine icon={<LoaderCircle className="h-4 w-4 animate-spin" />} title="正在下载更新" detail={update.progress === null ? "正在接收更新包。" : `已完成 ${update.progress}%`} />
            <Progress value={update.progress} />
          </div>
        )}
        {update.stage === "installing" && (
          <StatusLine icon={<LoaderCircle className="h-4 w-4 animate-spin" />} title="正在准备安装" detail="更新包已下载并通过签名校验，正在完成安装交接。" />
        )}
        {update.stage === "ready" && (
          <StatusLine icon={<CheckCircle2 className="h-4 w-4" />} title="更新已准备就绪" detail="重新启动 Ataru 后生效。" />
        )}
        {update.stage === "error" && (
          <div className="space-y-3">
            <StatusLine icon={<AlertCircle className="h-4 w-4" />} title="更新检查未完成" detail={update.error?.message || "请稍后重试。"} destructive />
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <code className="truncate text-xs text-muted-foreground">{update.error?.contextId}</code>
              <Button size="sm" variant="ghost" onClick={() => void copyDiagnostic()}>
                <Copy className="h-4 w-4" />
                {copied ? "已复制" : "复制诊断"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        更新包按操作系统与处理器架构匹配；下载、安装或重启中断后均可重新检查。
      </p>
    </section>
  );
}

function StatusLine({
  icon,
  title,
  detail,
  destructive = false,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={destructive ? "mt-0.5 text-destructive" : "mt-0.5 text-primary"}>{icon}</div>
      <div className="min-w-0">
        <p className={destructive ? "text-sm font-medium text-destructive" : "text-sm font-medium text-foreground"}>{title}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function Progress({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${value ?? 20}%` }}
      />
    </div>
  );
}
