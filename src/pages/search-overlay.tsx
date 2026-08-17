import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  BookOpenText,
  GitBranch,
  Layers3,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useSearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";
import { getSearchIndexActivity } from "@/lib/searchIndexStatus";
import { invoke } from "@/lib/tauri";
import { ataruSearch, type SearchHit, type SearchLevel, type SearchMode, type SearchResponse } from "@/modules/api/ataru";
import { getSearchModeCopy } from "@/modules/ai/query";
import { ErrorState, HighlightedText } from "@/modules/ui/ataru-search/SearchFeedback";
import {
  formatCount,
  formatTimestamp,
  getSearchResultContextLabel,
  getSearchResultExcerpt,
  getSearchResultMatchLabel,
  getSearchResultTitle,
  projectName,
} from "@/modules/ui/ataru-search/utils";

type SearchScope = SearchLevel | "all";

const ALL_LEVELS: SearchLevel[] = ["project", "session", "run", "turn"];
const RESULT_LIMIT = 40;
const RECENT_SEARCH_STORAGE_KEY = "lovcode:search-overlay:recent-searches";
const IME_ENTER_GUARD_MS = 160;

const SCOPES: Array<{ value: SearchScope; label: string; icon: typeof Layers3 }> = [
  { value: "all", label: "全部", icon: Layers3 },
  { value: "project", label: "Project", icon: Layers3 },
  { value: "session", label: "Session", icon: BookOpenText },
  { value: "run", label: "Run", icon: GitBranch },
  { value: "turn", label: "Turn", icon: Search },
];

const LEVEL_LABELS: Record<SearchHit["level"], string> = {
  turn: "Turn",
  run: "Run",
  session: "Session",
  project: "Project",
};

function readRecentSearches(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function writeRecentSearches(values: string[]) {
  try {
    window.localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Search remains usable when the overlay storage is unavailable.
  }
}

function mergeSearchResponses(
  responses: SearchResponse[],
  requestedMode: SearchMode,
  warnings: string[] = [],
): SearchResponse | null {
  const first = responses[0];
  if (!first) return null;
  const modes = new Set(responses.map((response) => response.mode));
  return {
    ...first,
    requestedMode,
    mode: modes.size === 1 ? first.mode : requestedMode,
    tookMs: responses.reduce((total, response) => total + response.tookMs, 0),
    total: responses.reduce((total, response) => total + response.total, 0),
    hits: responses.flatMap((response) => response.hits),
    semanticAvailable: responses.some((response) => response.semanticAvailable),
    warnings: [...new Set([
      ...responses.flatMap((response) => response.warnings),
      ...warnings,
    ])],
  };
}

export default function SearchOverlay() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState(readRecentSearches);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSequence = useRef(0);
  const compositionEndAt = useRef(0);
  const indexStartAttempted = useRef(false);
  const { status: indexStatus, progress: indexProgress, start: startIndexBuild } = useSearchIndexBuildStatus();

  const hide = useCallback(() => {
    requestSequence.current += 1;
    void getCurrentWindow().hide();
  }, []);

  const rememberSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setRecentSearches((current) => {
      const next = [trimmed, ...current.filter((item) => item.toLocaleLowerCase() !== trimmed.toLocaleLowerCase())].slice(0, 8);
      writeRecentSearches(next);
      return next;
    });
  }, []);

  const performSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      requestSequence.current += 1;
      setResponse(null);
      setError(null);
      setSearching(false);
      setActiveIndex(0);
      return;
    }

    if (!indexStatus || !indexStatus.searchAvailable) {
      setSearching(indexStatus?.state === "building");
      return;
    }

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setSearching(true);
    setError(null);

    const levels = scope === "all" ? ALL_LEVELS : [scope];
    const completed: SearchResponse[] = [];
    const warnings: string[] = [];
    try {
      for (const level of levels) {
        try {
          const next = await ataruSearch({ query: trimmed, level, mode, limit: RESULT_LIMIT });
          if (requestSequence.current !== sequence) return;
          completed.push(next);
          const merged = mergeSearchResponses(completed, mode, warnings);
          if (merged) {
            setResponse(merged);
            setActiveIndex((current) => Math.min(current, Math.max(0, merged.hits.length - 1)));
          }
        } catch (levelError) {
          warnings.push(`${level} 检索未完成：${levelError instanceof Error ? levelError.message : String(levelError)}`);
        }
      }

      if (completed.length === 0) {
        throw new Error(warnings.join("\n") || "搜索没有返回结果");
      }
      setResponse(mergeSearchResponses(completed, mode, warnings));
      rememberSearch(trimmed);
    } catch (searchError) {
      if (requestSequence.current !== sequence) return;
      setResponse(null);
      setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      if (requestSequence.current === sequence) setSearching(false);
    }
  }, [indexStatus, mode, query, rememberSearch, scope]);

  useEffect(() => {
    if (indexStatus?.state !== "idle" || indexStartAttempted.current) return;
    indexStartAttempted.current = true;
    startIndexBuild(false).catch(() => {
      indexStartAttempted.current = false;
    });
  }, [indexStatus?.state, startIndexBuild]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      void performSearch();
      return;
    }
    const timer = window.setTimeout(() => void performSearch(), 180);
    return () => window.clearTimeout(timer);
  }, [performSearch, query, scope, mode, indexStatus?.state]);

  useEffect(() => {
    document.documentElement.classList.add("transparent-window");
    return () => document.documentElement.classList.remove("transparent-window");
  }, []);

  useEffect(() => {
    invoke("make_window_nonactivating_panel").catch(() => {});
  }, []);

  useEffect(() => {
    const windowHandle = getCurrentWindow();
    const unlistenFocus = windowHandle.onFocusChanged(({ payload: focused }) => {
      if (!focused) hide();
    });
    const unlistenShow = listen("search-overlay:show", () => {
      setQuery("");
      setResponse(null);
      setError(null);
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
      if (indexStatus?.state === "idle") void startIndexBuild(false);
    });
    return () => {
      unlistenFocus.then((dispose) => dispose()).catch(() => {});
      unlistenShow.then((dispose) => dispose()).catch(() => {});
    };
  }, [hide, indexStatus?.state, startIndexBuild]);

  const openHit = useCallback((hit: SearchHit) => {
    if (!hit.sessionId) return;
    rememberSearch(query);
    emitTo("main", "open-chat", {
      projectId: hit.projectId,
      projectPath: hit.projectPath,
      sessionId: hit.sessionId,
      summary: hit.sessionTitle,
      messageId: hit.messageId ?? null,
      lineNumber: hit.lineNumber ?? null,
      roundIndex: hit.runIndex ?? null,
      highlight: query,
    }).catch(() => {});
    hide();
  }, [hide, query, rememberSearch]);

  const openActive = useCallback(() => {
    const hit = response?.hits[activeIndex];
    if (hit) openHit(hit);
  }, [activeIndex, openHit, response?.hits]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Process") return;
    if (event.key !== "Enter") return;
    const isImeConfirming =
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      composing ||
      Date.now() - compositionEndAt.current < IME_ENTER_GUARD_MS;
    if (isImeConfirming) return;
    event.preventDefault();
    openActive();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, (response?.hits.length ?? 1) - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    }
  };

  const indexActivity = getSearchIndexActivity(indexStatus);
  const searchStateLabel = indexActivity.fullBuild
    ? `整理本地索引 ${Math.round((indexProgress ?? 0) * 100)}%${indexStatus?.searchAvailable ? " · 可继续搜索" : ""}`
    : searching
      ? "正在搜索…"
      : response
        ? `${formatCount(response.total)} 个结果 · ${formatDuration(response.tookMs)}`
        : indexActivity.syncing
          ? "正在同步最新会话"
          : "输入关键词开始搜索";

  return (
    <div className="fixed inset-0 flex items-start justify-center px-3 pb-6 pt-4 sm:px-6 sm:pt-6" onKeyDown={handleKeyDown}>
      <div className="flex max-h-[calc(100vh-2.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-md sm:max-h-[calc(100vh-3rem)]">
        <header className="shrink-0 border-b border-border bg-card/95 px-4 pb-3 pt-3">
          <div className="flex items-center justify-between gap-3 pb-2" data-tauri-drag-region>
            <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region>
              <Search className="h-4 w-4 shrink-0 text-primary" />
              <h1 className="truncate font-serif text-base font-semibold">找回对话上下文</h1>
            </div>
            <button type="button" onClick={hide} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="关闭搜索">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2 transition-colors focus-within:border-primary">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => {
                compositionEndAt.current = Date.now();
                setComposing(false);
              }}
              aria-label="搜索 AI 对话记录"
              placeholder="搜索你记得的一句话、一个工具调用或一个项目…"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {searching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
          </div>

          <div className="mt-2 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="搜索层级">
            {SCOPES.map((item) => {
              const Icon = item.icon;
              const active = scope === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScope(item.value)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
            <span className="ml-auto hidden shrink-0 text-[11px] text-muted-foreground sm:inline">↑↓ 浏览 · Enter 打开 · Esc 关闭</span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>{searchStateLabel}</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as SearchMode)}
              aria-label="检索方式"
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary"
            >
              {(["auto", "keyword", "hybrid", "semantic"] as SearchMode[]).map((item) => (
                <option key={item} value={item}>{getSearchModeCopy(item).label}</option>
              ))}
            </select>
          </div>
        </header>

        {recentSearches.length > 0 && !query.trim() && (
          <div className="flex gap-1.5 overflow-x-auto border-b border-border/70 px-4 py-2">
            {recentSearches.map((term) => (
              <button key={term} type="button" onClick={() => setQuery(term)} className="max-w-[12rem] shrink-0 truncate rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground" title={term}>
                {term}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="px-4 py-6"><ErrorState error={error} onRetry={() => void performSearch()} /></div>
          ) : response && response.hits.length > 0 ? (
            <div className="py-1" role="listbox" aria-label="搜索结果">
              {response.warnings.length > 0 && (
                <div className="mx-4 my-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-[11px] leading-5 text-foreground/80">
                  {response.warnings.map((warning, index) => <p key={`${warning}:${index}`}>{warning}</p>)}
                </div>
              )}
              {response.hits.map((hit, index) => (
                <OverlayResultCard
                  key={hit.id}
                  hit={hit}
                  query={query}
                  active={index === activeIndex}
                  onOpen={() => openHit(hit)}
                  onMouseEnter={() => setActiveIndex(index)}
                />
              ))}
            </div>
          ) : response && query.trim() && !searching ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">没有找到匹配“{query.trim()}”的内容</div>
          ) : query.trim() ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              {indexActivity.fullBuild ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span>{indexActivity.fullBuild ? "首次搜索需要整理本地索引…" : "等待搜索结果…"}</span>
            </div>
          ) : (
            <div className="px-4 py-10 text-center">
              <BookOpenText className="mx-auto h-7 w-7 text-primary/70" />
              <p className="mt-3 font-serif text-base font-semibold">从本地对话中找回上下文</p>
              <p className="mt-1 text-xs text-muted-foreground">Turn 是原子消息，Run 是一次完整执行。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverlayResultCard({
  hit,
  query,
  active,
  onOpen,
  onMouseEnter,
}: {
  hit: SearchHit;
  query: string;
  active: boolean;
  onOpen: () => void;
  onMouseEnter: () => void;
}) {
  const title = getSearchResultTitle(hit, query);
  const heading = title || getSearchResultContextLabel(hit);
  const excerpt = getSearchResultExcerpt(hit, query, title);
  const matchLocation = getSearchResultMatchLabel(hit, query, excerpt);
  const matchSummary = hit.level === "run" && hit.matchCount > 1
    ? `${hit.matchCount} 条 Turn 命中`
    : hit.matchCount > 1
      ? `${hit.matchCount} 处命中`
      : "";

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onOpen}
      onMouseEnter={onMouseEnter}
      className={`block w-full border-b border-border/70 px-4 py-3 text-left transition-colors last:border-b-0 ${active ? "bg-primary/10" : "hover:bg-muted/60"}`}
    >
      <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-foreground/80">{projectName(hit.projectPath)}</span>
          <span aria-hidden="true">›</span>
          <span className="shrink-0">{LEVEL_LABELS[hit.level]}</span>
          {hit.timestamp && <><span aria-hidden="true">·</span><time className="shrink-0" dateTime={hit.timestamp}>{formatTimestamp(hit.timestamp)}</time></>}
        </span>
        {matchSummary && <span className="shrink-0 font-medium text-primary/80">{matchSummary}</span>}
      </div>
      <div className="mt-1 truncate font-serif text-[15px] font-semibold text-foreground">
        <HighlightedText text={heading} query={query} />
      </div>
      <div className="mt-1 flex gap-2 text-xs leading-5 text-foreground/75">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-primary/75">
          {matchLocation}
        </span>
        <span className="line-clamp-2 min-w-0"><HighlightedText text={excerpt} query={query} /></span>
      </div>
    </button>
  );
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${Math.max(0, Math.round(value))} ms` : `${(value / 1_000).toFixed(1)} s`;
}
