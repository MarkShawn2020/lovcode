import { Check, Loader2, RefreshCw } from "lucide-react";
import type { SearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";
import { formatCount } from "./utils";

export function IndexStatus({
  status,
  progress,
  onRetry,
}: {
  status: SearchIndexBuildStatus | null;
  progress: number;
  onRetry: () => void;
}) {
  if (!status) return <span className="text-xs font-medium text-foreground/70" role="status">读取索引状态…</span>;
  if (status.state === "building") {
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground/70" role="status">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        <span className="hidden truncate sm:inline">更新记忆索引</span>
        <span className="tabular-nums">{Math.round(progress * 100)}%</span>
      </div>
    );
  }
  if (status.state === "error") {
    return (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <RefreshCw className="h-3.5 w-3.5" />
        索引失败，重试
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/80" role="status">
      <Check className="h-3.5 w-3.5 text-primary" />
      {formatCount(status.indexedMessages)} 条消息可检索
    </span>
  );
}
