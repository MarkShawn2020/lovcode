import {
  BookOpenText,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type SearchHit,
  type SearchResponse,
} from "@/modules/api/ataru";
import { ErrorState, HighlightedText } from "./SearchFeedback";
import {
  cleanSearchExcerpt,
  cleanSearchTitle,
  formatCount,
  formatTimestamp,
  projectName,
} from "./utils";

const RESULT_LEVEL_LABELS: Record<SearchHit["level"], string> = {
  turn: "对话回合",
  session: "会话",
  project: "项目",
};

export function SearchResults({
  response,
  loading,
  error,
  selectedHitId,
  onSelectHit,
  onOpenContext,
  onRetry,
  onSelectQuery,
}: {
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
  selectedHitId: string | null;
  onSelectHit: (hitId: string) => void;
  onOpenContext: (hit: SearchHit) => void;
  onRetry: () => void;
  onSelectQuery: (query: string) => void;
}) {
  return (
    <section
      id="ataru-search-results"
      className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-r border-border/70 bg-background"
      aria-label="搜索结果"
      aria-busy={loading}
      role="tabpanel"
    >
      <SearchSummary response={response} loading={loading} error={error} />
      {response && response.warnings.length > 0 && (
        <div className="mx-auto w-full max-w-3xl px-5 pt-2 sm:px-8">
          <div
            className="rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-xs leading-5 text-foreground/80"
            role="status"
            aria-label="搜索提示"
          >
            {response.warnings.map((warning, index) => (
              <p key={`${warning}:${index}`}>{warning}</p>
            ))}
          </div>
        </div>
      )}
      {error ? (
        <div className="mx-auto w-full max-w-3xl px-5 pb-12 pt-7 sm:px-8">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      ) : response && response.hits.length === 0 && !loading ? (
        <EmptyResults query={response.query} onSelectQuery={onSelectQuery} />
      ) : (
        <div className="mx-auto w-full max-w-3xl px-5 pb-12 pt-2 sm:px-8">
          {response?.hits.map((hit, index) => (
            <ResultCard
              key={hit.id}
              hit={hit}
              rank={index + 1}
              query={response.query}
              selected={hit.id === selectedHitId}
              onSelect={() => onSelectHit(hit.id)}
              onOpenContext={() => onOpenContext(hit)}
            />
          ))}
          {loading && !response && <ResultSkeleton />}
        </div>
      )}
    </section>
  );
}

function SearchSummary({
  response,
  loading,
  error,
}: {
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const detail = error
    ? "这次搜索没有完成"
    : response
      ? `${formatCount(response.total)} 个结果 · ${formatSearchDuration(response.tookMs)}`
      : loading
        ? "正在搜索…"
        : "输入关键词后按 Enter 搜索";

  return (
    <div className="mx-auto flex min-h-[84px] w-full max-w-3xl items-end justify-between gap-4 px-5 pb-3 pt-7 sm:px-8">
      <h2 className="sr-only">搜索结果</h2>
      <p className="text-xs font-medium text-muted-foreground" role="status" aria-live="polite">
        {detail}
      </p>
      {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-label="正在搜索" />}
    </div>
  );
}

function formatSearchDuration(value: number): string {
  if (value < 1_000) return `${Math.max(0, Math.round(value))} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function resultExcerpt(hit: SearchHit, query: string): string {
  return (
    cleanSearchExcerpt(hit.snippet, query) ||
    cleanSearchExcerpt(hit.turnPrompt ?? hit.sessionTitle ?? hit.title, query) ||
    "查看原始会话上下文"
  );
}

function resultTitle(hit: SearchHit, query: string): string {
  const source = hit.level === "turn"
    ? hit.turnPrompt ?? hit.title
    : hit.sessionTitle ?? hit.title;
  return cleanSearchTitle(
    source,
    query,
    hit.level === "project" ? "未命名项目" : "未命名对话",
  );
}

function ResultCard({
  hit,
  rank,
  query,
  selected,
  onSelect,
  onOpenContext,
}: {
  hit: SearchHit;
  rank: number;
  query: string;
  selected: boolean;
  onSelect: () => void;
  onOpenContext: () => void;
}) {
  const title = resultTitle(hit, query);
  const excerpt = resultExcerpt(hit, query);
  const levelLabel = RESULT_LEVEL_LABELS[hit.level];

  return (
    <article
      className={cn(
        "relative",
        selected
          ? "my-2 rounded-xl border border-primary/30 bg-primary/5 shadow-sm"
          : "border-b border-border/70 last:border-b-0",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`查看第 ${rank} 条结果：${title}`}
        className={cn(
          "group block w-full rounded-xl px-2.5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-3 sm:py-5",
          !selected && "hover:bg-card/70",
        )}
      >
        <span className="block min-w-0">
          <span className="flex min-w-0 items-center justify-between gap-3 text-[11px] leading-4 text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <span className="truncate font-medium text-foreground/75" title={hit.projectPath}>
                {projectName(hit.projectPath)}
              </span>
              <span aria-hidden="true" className="shrink-0 text-foreground/30">›</span>
              <span className="shrink-0">{levelLabel}</span>
              {hit.timestamp && (
                <>
                  <span aria-hidden="true" className="shrink-0 text-foreground/30">·</span>
                  <time dateTime={hit.timestamp} className="shrink-0">
                    {formatTimestamp(hit.timestamp)}
                  </time>
                </>
              )}
            </span>
            {(hit.matchCount > 1 || hit.sessionCount > 1) && (
              <span className="flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground/80">
                {hit.matchCount > 1 && <span>{hit.matchCount} 处命中</span>}
                {hit.matchCount > 1 && hit.sessionCount > 1 && (
                  <span aria-hidden="true" className="text-foreground/30">·</span>
                )}
                {hit.sessionCount > 1 && <span>{hit.sessionCount} 个会话</span>}
              </span>
            )}
          </span>
          <span className="mt-1.5 block line-clamp-2 font-sans text-[15px] font-semibold leading-6 text-primary decoration-primary/60 underline-offset-2 group-hover:underline">
            <HighlightedText text={title} query={query} />
          </span>
          <span className="mt-1 block line-clamp-2 text-[13px] leading-6 text-foreground/80">
            <HighlightedText text={excerpt} query={query} />
          </span>
        </span>
      </button>
      {hit.sessionId && (
        <div
          className={cn(
            "flex items-center gap-1 px-3 pb-3 pt-2 md:hidden",
            selected ? "border-t border-primary/15" : "border-t border-border/60",
          )}
        >
          <button
            type="button"
            onClick={onOpenContext}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <BookOpenText className="h-3.5 w-3.5" />
            完整会话
          </button>
        </div>
      )}
    </article>
  );
}

function EmptyResults({
  query,
  onSelectQuery,
}: {
  query: string;
  onSelectQuery: (query: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-12 pt-10 sm:px-8">
      <div className="rounded-xl border border-dashed border-border bg-card/60 px-6 py-10 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Search className="h-5 w-5" />
        </div>
        <h3 className="mt-4 font-sans text-lg font-semibold tracking-tight">
          没有找到匹配“{query}”的结果
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          试试更短的关键词，或换一种描述方式。
        </p>
        <button
          type="button"
          onClick={() => onSelectQuery(query.replace(/[^\p{L}\p{N}\s]/gu, " "))}
          className="mt-5 inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          放宽当前查询
        </button>
      </div>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-0" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="space-y-3 border-b border-border/70 py-6 last:border-b-0">
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
          <div className="h-5 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
