import { Check, ChevronDown, Copy, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";
import { formatByteSize, getSearchIndexActivity, getSearchIndexTiming } from "@/lib/searchIndexStatus";
import { copyText } from "@/modules/api/ataru";

const countFormatter = new Intl.NumberFormat("zh-CN");

function formatCount(value: number) {
  return countFormatter.format(value);
}

function formatLastActivity(updatedAt: number | null | undefined) {
  if (!updatedAt) return "尚未收到进度";
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - updatedAt));
  if (seconds < 5) return "刚刚有进度";
  if (seconds < 60) return `${seconds} 秒前有进度`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前有进度`;
  return `${Math.floor(minutes / 60)} 小时前有进度`;
}

function getStateTitle(status: SearchIndexBuildStatus) {
  const { fullBuild, syncing } = getSearchIndexActivity(status);
  if (syncing) return "正在同步最新会话";
  if (fullBuild) return "正在建立记忆索引";
  if (status.state === "error") return "记忆索引更新未完成";
  if (status.state === "ready") return "记忆索引已就绪";
  return "正在读取记忆索引";
}

function getStateHint(status: SearchIndexBuildStatus) {
  const { fullBuild, syncing } = getSearchIndexActivity(status);
  if (syncing) return "已有索引持续可搜索，新增会话在后台补齐。";
  if (fullBuild && status.searchAvailable) return "旧索引仍可搜索，新索引在后台生成。";
  return "索引任务独立于应用编译和启动。";
}

function getCurrentItem(status: SearchIndexBuildStatus) {
  if (status.currentTitle?.trim()) return status.currentTitle.trim();
  if (status.currentSessionId?.trim()) return `会话 ${status.currentSessionId.trim()}`;
  return status.state === "building" ? "正在准备下一段会话" : "当前没有处理中的会话";
}

function formatDiagnostic(status: SearchIndexBuildStatus, progress: number) {
  const timing = getSearchIndexTiming(status, progress);
  return [
    "Ataru 记忆索引诊断",
    `状态: ${status.state}`,
    `模式: ${status.mode ?? "-"}`,
    `进度: ${Math.round(progress * 100)}%`,
    `可搜索: ${status.searchAvailable ? "是" : "否"}`,
    `会话: ${status.processedSessions}/${status.totalSessions}`,
    `消息: ${status.processedMessages ?? 0}/${status.totalMessages ?? 0}`,
    `数据: ${status.processedBytes ?? 0}/${status.totalBytes ?? 0} bytes`,
    `索引大小: ${status.indexSizeBytes ?? 0} bytes`,
    `当前会话: ${status.currentSessionId ?? "-"}`,
    `当前标题: ${status.currentTitle ?? "-"}`,
    `当前项目: ${status.currentProjectPath ?? "-"}`,
    `已用时间: ${timing.elapsed}`,
    `预计剩余: ${timing.eta}`,
    `开始时间: ${status.startedAt ?? "-"}`,
    `最近进度: ${status.updatedAt ?? "-"}`,
    `跳过会话: ${status.skippedSessions}`,
    `错误: ${status.error ?? "-"}`,
  ].join("\n");
}

function getBadgeLabel(status: SearchIndexBuildStatus) {
  const { fullBuild } = getSearchIndexActivity(status);
  if (fullBuild) return "建立记忆索引";
  if (status.state === "error") return "索引更新未完成";
  if (status.state === "ready" || status.searchAvailable) return "记忆索引就绪";
  return "记忆索引待建立";
}

export function SearchIndexStatus({
  status,
  progress,
  onRetry,
}: {
  status: SearchIndexBuildStatus | null;
  progress: number;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    const closeOnOutside = (event: Event) => {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  if (!status) return <span className="text-xs font-medium text-foreground/70" role="status">读取索引状态…</span>;

  const { building, fullBuild, syncing } = getSearchIndexActivity(status);
  const timing = getSearchIndexTiming(status, progress);
  const percent = Math.round(progress * 100);
  const copyDiagnostic = async () => {
    try {
      await copyText(formatDiagnostic(status, progress));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group relative"
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-foreground/70 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
        aria-label="查看记忆索引详情"
        title={getStateTitle(status)}
      >
        {fullBuild ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : syncing ? (
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground [animation-duration:1.8s]" />
        ) : status.state === "error" ? (
          <RefreshCw className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <span className="hidden truncate sm:inline">{getBadgeLabel(status)}</span>
        <span className="sr-only" role="status">{getStateTitle(status)}</span>
        {fullBuild && <span className="tabular-nums">{percent}%</span>}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-4rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-serif text-base font-semibold text-foreground">{getStateTitle(status)}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{getStateHint(status)}</p>
            </div>
            {fullBuild && (
              <span className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-xs font-semibold tabular-nums text-primary">{percent}%</span>
            )}
          </div>

          {fullBuild && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`索引进度 ${percent}%`}>
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>

        <div className="space-y-4 px-4 py-4">
          {status.state === "error" && status.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="break-words text-xs leading-5 text-destructive">{status.error}</p>
            </div>
          )}

          {building && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">当前处理</p>
              <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-5 text-foreground">{getCurrentItem(status)}</p>
              {status.currentProjectPath && (
                <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">{status.currentProjectPath}</p>
              )}
              {status.currentSessionId && status.currentTitle && (
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{status.currentSessionId}</p>
              )}
            </section>
          )}

          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border pt-4 text-xs">
            <Metric
              label={syncing ? "本次数据" : "数据"}
              value={`${formatByteSize(status.processedBytes)} / ${formatByteSize(status.totalBytes)}`}
            />
            <Metric
              label={syncing ? "本次会话" : "会话"}
              value={`${formatCount(status.processedSessions)} / ${formatCount(status.totalSessions)}`}
            />
            <Metric
              label={syncing ? "可检索消息" : "消息"}
              value={
                syncing
                  ? formatCount(status.indexedMessages)
                  : status.totalMessages
                    ? `${formatCount(status.processedMessages ?? 0)} / ${formatCount(status.totalMessages)}`
                    : formatCount(status.processedMessages ?? 0)
              }
            />
            <Metric label={fullBuild ? "临时索引" : "索引大小"} value={formatByteSize(status.indexSizeBytes)} />
            <Metric label="已用时间" value={timing.elapsed} />
            {fullBuild && <Metric label="预计剩余" value={timing.eta === "estimating" ? "计算中" : timing.eta} />}
          </dl>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="min-w-0 truncate text-[11px] text-muted-foreground">{formatLastActivity(status.updatedAt)}</p>
            <div className="flex shrink-0 items-center gap-1">
              {status.state === "error" && (
                <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyDiagnostic()}>
                {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制诊断"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-medium tabular-nums text-foreground" title={value}>{value}</dd>
    </div>
  );
}
