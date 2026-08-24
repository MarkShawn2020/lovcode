import {
  BookOpenText,
  Check,
  Copy,
  Loader2,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRelativeTimeNow, useSessionTimeFormat } from "@/hooks/useSessionTimeFormat";
import {
  formatAbsoluteSessionTime,
  formatSessionTime,
  type SessionTimeFormat,
} from "@/lib/sessionTime";
import { cn } from "@/lib/utils";
import {
  copyText,
  type SearchHit,
  type SearchResponse,
} from "@/modules/api/ataru";
import { ErrorState, HighlightedText } from "./SearchFeedback";
import {
  formatCount,
  getSearchResultContextLabel,
  getSearchResultExcerpt,
  getSearchResultTitle,
  projectName,
  searchHitIndexAsJson,
  searchHitIndexesAsJson,
} from "./utils";

const RESULT_LEVEL_LABELS: Record<SearchHit["level"], string> = {
  turn: "Turn",
  run: "Run",
  session: "Session",
  project: "Project",
};

const SEARCH_SORT_OPTIONS = [
  { value: "updated-desc", label: "最新更新时间" },
  { value: "updated-asc", label: "最早更新时间" },
  { value: "relevance", label: "相关度" },
] as const;

type SearchSort = (typeof SEARCH_SORT_OPTIONS)[number]["value"];

function timestampValue(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

export function sortSearchHits(hits: SearchHit[], sort: SearchSort): SearchHit[] {
  return hits
    .map((hit, index) => ({ hit, index, timestamp: timestampValue(hit.timestamp) }))
    .sort((left, right) => {
      if (sort === "relevance") {
        return right.hit.score - left.hit.score || left.index - right.index;
      }

      if (left.timestamp === null || right.timestamp === null) {
        if (left.timestamp === right.timestamp) return left.index - right.index;
        return left.timestamp === null ? 1 : -1;
      }

      const timeDifference = sort === "updated-desc"
        ? right.timestamp - left.timestamp
        : left.timestamp - right.timestamp;
      return timeDifference || left.index - right.index;
    })
    .map(({ hit }) => hit);
}

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
  const [sort, setSort] = useState<SearchSort>("updated-desc");
  const timeFormat = useSessionTimeFormat();
  const relativeTimeNow = useRelativeTimeNow(timeFormat === "relative");
  const hits = useMemo(
    () => (response ? sortSearchHits(response.hits, sort) : []),
    [response, sort],
  );

  return (
    <section
      id="ataru-search-results"
      className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto border-r border-border/70 bg-background"
      aria-label="搜索结果"
      aria-busy={loading}
      role="tabpanel"
    >
      <SearchSummary
        response={response}
        hits={hits}
        loading={loading}
        error={error}
        sort={sort}
        onSortChange={(value) => setSort(value as SearchSort)}
      />
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
      ) : response && hits.length === 0 && !loading ? (
        <EmptyResults query={response.query} onSelectQuery={onSelectQuery} />
      ) : (
        <div className="mx-auto w-full max-w-3xl px-5 pb-12 pt-2 sm:px-8">
          {hits.map((hit, index) => (
            <ResultCard
              key={hit.id}
              hit={hit}
              rank={index + 1}
              query={response?.query ?? ""}
              timeFormat={timeFormat}
              now={relativeTimeNow}
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
  hits,
  loading,
  error,
  sort,
  onSortChange,
}: {
  response: SearchResponse | null;
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
  sort: SearchSort;
  onSortChange: (sort: string) => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => setCopyStatus("idle"), [hits, response?.query]);
  const detail = error
    ? "这次搜索没有完成"
    : response
      ? `${formatCount(response.total)} 个结果 · ${formatSearchDuration(response.tookMs)}`
      : loading
        ? "正在搜索…"
        : "输入关键词后按 Enter 搜索";
  const copyAllIndexes = () => {
    if (!response || hits.length === 0) return;
    setCopyStatus("idle");
    void copyText(searchHitIndexesAsJson(hits, response.query))
      .then(() => setCopyStatus("copied"))
      .catch(() => setCopyStatus("error"));
  };

  return (
    <div className="mx-auto flex min-h-[84px] w-full max-w-3xl items-end justify-between gap-4 px-5 pb-3 pt-7 sm:px-8">
      <h2 className="sr-only">搜索结果</h2>
      <p className="text-xs font-medium text-muted-foreground" role="status" aria-live="polite">
        {detail}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {response && hits.length > 0 && (
          <button
            type="button"
            onClick={copyAllIndexes}
            aria-label={copyStatus === "copied"
              ? "已复制全部搜索结果索引"
              : copyStatus === "error"
                ? "复制全部搜索结果索引失败，点击重试"
                : "复制全部搜索结果索引给 Agent"}
            title={copyStatus === "copied"
              ? "已复制全部索引"
              : copyStatus === "error"
                ? "复制失败，点击重试"
                : "复制全部索引给 Agent"}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5",
              copyStatus === "copied" && "text-primary",
              copyStatus === "error" && "text-destructive",
            )}
          >
            {copyStatus === "copied"
              ? <Check className="h-3.5 w-3.5" />
              : <Copy className="h-3.5 w-3.5" />}
            <span className="sr-only sm:not-sr-only">
              {copyStatus === "copied" ? "已复制全部" : "复制全部索引"}
            </span>
          </button>
        )}
        {response && response.hits.length > 1 && (
          <Select value={sort} onValueChange={onSortChange}>
            <SelectTrigger
              className="h-8 w-[8.5rem] rounded-md border-border bg-card px-2.5 text-xs font-medium shadow-none"
              aria-label="搜索结果排序"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-border shadow-lg">
              {SEARCH_SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-label="正在搜索" />}
      </div>
    </div>
  );
}

function formatSearchDuration(value: number): string {
  if (value < 1_000) return `${Math.max(0, Math.round(value))} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function ResultCard({
  hit,
  rank,
  query,
  timeFormat,
  now,
  selected,
  onSelect,
  onOpenContext,
}: {
  hit: SearchHit;
  rank: number;
  query: string;
  timeFormat: SessionTimeFormat;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onOpenContext: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const title = getSearchResultTitle(hit, query);
  const heading = title || getSearchResultContextLabel(hit);
  const excerpt = getSearchResultExcerpt(hit, query, title);
  const timestamp = hit.timestamp ? timestampValue(hit.timestamp) : null;
  const levelLabel = RESULT_LEVEL_LABELS[hit.level];
  const matchSummary = hit.level === "run" && hit.matchCount > 1
    ? `${hit.matchCount} 条 Turn 命中`
    : hit.matchCount > 1
      ? `${hit.matchCount} 处命中`
      : null;
  const copyIndex = () => {
    setCopyStatus("idle");
    void copyText(searchHitIndexAsJson(hit))
      .then(() => setCopyStatus("copied"))
      .catch(() => setCopyStatus("error"));
  };

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
        aria-controls="ataru-transcript-preview"
        aria-expanded={selected}
        aria-label={`${selected ? "收起" : "展开"}第 ${rank} 条结果的详情：${heading}。${excerpt}`}
        className={cn(
          "group block w-full rounded-xl px-2.5 py-4 pr-12 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-3 sm:py-5 sm:pr-14",
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
                  <time
                    dateTime={hit.timestamp}
                    title={timestamp === null
                      ? hit.timestamp
                      : formatAbsoluteSessionTime(timestamp / 1_000)}
                    className="shrink-0"
                  >
                    {timestamp === null
                      ? hit.timestamp
                      : formatSessionTime(timestamp / 1_000, timeFormat, now)}
                  </time>
                </>
              )}
            </span>
            {(matchSummary || hit.sessionCount > 1) && (
              <span className="flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground/80">
                {matchSummary && <span>{matchSummary}</span>}
                {matchSummary && hit.sessionCount > 1 && (
                  <span aria-hidden="true" className="text-foreground/30">·</span>
                )}
                {hit.sessionCount > 1 && <span>{hit.sessionCount} 个会话</span>}
              </span>
            )}
          </span>
          <span className="mt-1.5 block h-6 overflow-hidden line-clamp-1 font-serif text-[17px] font-semibold leading-6 text-primary decoration-primary/60 underline-offset-2 group-hover:underline">
            {title ? <HighlightedText text={title} query={query} /> : heading}
          </span>
          <span className="mt-1.5 block h-12 overflow-hidden line-clamp-2 text-[13px] leading-6 text-foreground/80">
            <HighlightedText text={excerpt} query={query} />
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={copyIndex}
        aria-label={copyStatus === "copied"
          ? `已复制第 ${rank} 条结果的索引`
          : copyStatus === "error"
            ? `复制第 ${rank} 条结果的索引失败，点击重试`
            : `复制第 ${rank} 条结果的索引给 Agent`}
        title={copyStatus === "copied"
          ? "已复制索引"
          : copyStatus === "error"
            ? "复制失败，点击重试"
            : "复制索引给 Agent"}
        className={cn(
          "absolute right-2 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-3 sm:top-4",
          copyStatus === "copied" && "text-primary",
        )}
      >
        {copyStatus === "copied"
          ? <Check className="h-4 w-4" />
          : <Copy className="h-4 w-4" />}
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
