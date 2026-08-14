import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BookOpenText,
  FolderKanban,
  GitBranch,
  Layers3,
  MessageSquareText,
  Search,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";
import {
  ataruSearch,
  type SearchHit,
  type SearchLevel,
  type SearchMode,
  type SearchResponse,
} from "@/modules/api/ataru";
import { getSearchModeCopy } from "@/modules/ai/query";
import { RecallHome } from "./ataru-search/RecallHome";
import { SearchResults } from "./ataru-search/SearchResults";
import { TranscriptPreview } from "./ataru-search/TranscriptPreview";
import { readableError } from "./ataru-search/utils";

const RECENT_QUERY_KEY = "ataru:recentQueries";
const LEGACY_RECENT_QUERY_KEY = "lovcode:search-overlay:recent-searches";
const IME_ENTER_GUARD_MS = 160;
const RESULT_LIMIT = 40;
const ALL_LEVELS: SearchLevel[] = ["project", "session", "run", "turn"];

type SearchScope = SearchLevel | "all";

const SCOPES: Array<{
  value: SearchScope;
  label: string;
  description: string;
  icon: typeof MessageSquareText;
}> = [
  { value: "all", label: "ALL", description: "依次召回项目、会话、执行与原子消息", icon: Layers3 },
  { value: "project", label: "Project", description: "跨会话归并项目", icon: FolderKanban },
  { value: "session", label: "Session", description: "汇总同一会话中的多次执行", icon: BookOpenText },
  { value: "run", label: "Run", description: "聚合一次完整执行中的多个 Turn", icon: GitBranch },
  { value: "turn", label: "Turn", description: "直接命中一条原子消息或工具记录", icon: MessageSquareText },
];

const MODES: SearchMode[] = ["auto", "keyword", "hybrid", "semantic"];

function isSearchScope(value: string | null): value is SearchScope {
  return value === "all" || value === "turn" || value === "run" || value === "session" || value === "project";
}

function isSearchMode(value: string | null): value is SearchMode {
  return value === "auto" || value === "keyword" || value === "semantic" || value === "hybrid";
}

function loadRecentQueries(): string[] {
  try {
    const values = [RECENT_QUERY_KEY, LEGACY_RECENT_QUERY_KEY].flatMap((key) => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    });
    return [...new Set(values)].slice(0, 6);
  } catch {
    return [];
  }
}

function storeRecentQuery(query: string, current: string[]): string[] {
  const next = [query, ...current.filter((item) => item !== query)].slice(0, 6);
  try {
    window.localStorage.setItem(RECENT_QUERY_KEY, JSON.stringify(next));
    window.localStorage.setItem(LEGACY_RECENT_QUERY_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

function removeRecentQuery(query: string, current: string[]): string[] {
  const next = current.filter((item) => item !== query);
  try {
    window.localStorage.setItem(RECENT_QUERY_KEY, JSON.stringify(next));
    window.localStorage.setItem(LEGACY_RECENT_QUERY_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

function mergeSearchResponses(
  responses: SearchResponse[],
  requestedMode: SearchMode,
  additionalWarnings: string[] = [],
): SearchResponse {
  const first = responses[0];
  const modes = new Set(responses.map((item) => item.mode));
  return {
    ...first,
    requestedMode,
    mode: modes.size === 1 ? first.mode : requestedMode,
    semanticAvailable: responses.some((item) => item.semanticAvailable),
    tookMs: responses.reduce((total, item) => total + item.tookMs, 0),
    total: responses.reduce((total, item) => total + item.total, 0),
    hits: responses.flatMap((item) => item.hits),
    warnings: [...new Set([
      ...responses.flatMap((item) => item.warnings),
      ...additionalWarnings,
    ])],
  };
}

export function AtaruSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialLevel = searchParams.get("level");
  const initialMode = searchParams.get("mode");
  const [query, setQuery] = useState(() => initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(() => initialQuery);
  const [level, setLevel] = useState<SearchScope>(() => (isSearchScope(initialLevel) ? initialLevel : "turn"));
  const [mode, setMode] = useState<SearchMode>(() => (isSearchMode(initialMode) ? initialMode : "auto"));
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>(loadRecentQueries);
  const requestSequence = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastSearchKey = useRef("");
  const composingRef = useRef(false);
  const compositionEndAtRef = useRef(0);

  const { status: indexStatus } = useSearchIndexBuildStatus();

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    compositionEndAtRef.current = Date.now();
    // Keep the ref active through the trailing Enter keydown used by some IMEs
    // to commit a candidate. The next frame then returns control to the input.
    requestAnimationFrame(() => {
      composingRef.current = false;
    });
  }, []);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const performSearch = useCallback(
    async (rawQuery: string, force = false) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        requestSequence.current += 1;
        lastSearchKey.current = "";
        setResponse(null);
        setSelectedHitId(null);
        setIsPreviewOpen(false);
        setSearchError(null);
        setIsSearching(false);
        setSearchParams({}, { replace: true });
        return;
      }

      if (!indexStatus?.searchAvailable) {
        lastSearchKey.current = "";
        setIsSearching(true);
        setSearchError(null);
        return;
      }

      const searchKey = `${trimmed}\u0000${level}\u0000${mode}`;
      if (!force && searchKey === lastSearchKey.current) return;
      lastSearchKey.current = searchKey;
      setIsPreviewOpen(false);
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      setIsSearching(true);
      setSearchError(null);

      const nextParams = new URLSearchParams();
      nextParams.set("q", trimmed);
      nextParams.set("level", level);
      if (mode !== "auto") nextParams.set("mode", mode);
      setSearchParams(nextParams, { replace: true });

      try {
        const levels = level === "all" ? ALL_LEVELS : [level];
        const completedResponses: SearchResponse[] = [];
        const failedLevels: string[] = [];

        for (const currentLevel of levels) {
          try {
            const next = await ataruSearch({
              query: trimmed,
              level: currentLevel,
              mode,
              limit: RESULT_LIMIT,
            });
            if (requestSequence.current !== sequence) return;
            completedResponses.push(next);
            const merged = mergeSearchResponses(completedResponses, mode, failedLevels);
            setResponse(merged);
            setSelectedHitId((current) => {
              if (current && merged.hits.some((hit) => hit.id === current)) return current;
              return merged.hits.at(0)?.id ?? null;
            });
          } catch (error) {
            if (requestSequence.current !== sequence) return;
            failedLevels.push(`${currentLevel} 检索未完成：${readableError(error)}`);
          }
        }

        if (completedResponses.length === 0) {
          throw new Error(failedLevels.join("\n"));
        }

        if (failedLevels.length > 0) {
          setResponse(mergeSearchResponses(completedResponses, mode, failedLevels));
        }
        setRecentQueries((current) => storeRecentQuery(trimmed, current));
      } catch (error) {
        if (requestSequence.current !== sequence) return;
        if (lastSearchKey.current === searchKey) lastSearchKey.current = "";
        setResponse(null);
        setSelectedHitId(null);
        setSearchError(readableError(error));
      } finally {
        if (requestSequence.current === sequence) setIsSearching(false);
      }
    },
    [indexStatus?.searchAvailable, indexStatus?.state, level, mode, setSearchParams],
  );

  useEffect(() => {
    if (!submittedQuery.trim()) return;
    void performSearch(submittedQuery);
  }, [performSearch, submittedQuery]);

  const submitQuery = useCallback(
    (nextQuery: string) => {
      const trimmed = nextQuery.trim();
      setSubmittedQuery(trimmed);
      void performSearch(trimmed);
    },
    [performSearch],
  );

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Process") return;
    if (event.key !== "Enter") return;
    const isImeConfirming =
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      composingRef.current ||
      Date.now() - compositionEndAtRef.current < IME_ENTER_GUARD_MS;
    if (isImeConfirming) return;
    event.preventDefault();
    submitQuery(query);
  };

  const selectQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    submitQuery(nextQuery);
    searchInputRef.current?.focus();
  };

  const selectedHit = response?.hits.find((hit) => hit.id === selectedHitId) ?? response?.hits.at(0) ?? null;
  const hasQuery = submittedQuery.trim().length > 0;
  const selectHit = useCallback((hitId: string) => {
    if (isPreviewOpen && selectedHitId === hitId) {
      setIsPreviewOpen(false);
      return;
    }
    setSelectedHitId(hitId);
    setIsPreviewOpen(true);
  }, [isPreviewOpen, selectedHitId]);
  const closePreview = useCallback(() => setIsPreviewOpen(false), []);
  const openHitContext = useCallback((hit: SearchHit) => {
    if (!hit.sessionId) return;
    const params = new URLSearchParams({ projectId: hit.projectId, sessionId: hit.sessionId });
    if (hit.messageId) params.set("messageId", hit.messageId);
    if (hit.lineNumber) params.set("lineNumber", String(hit.lineNumber));
    if (hit.runIndex) params.set("roundIndex", String(hit.runIndex));
    params.set("q", response?.query ?? query);
    navigate(`/workbench?${params.toString()}`);
  }, [navigate, query, response?.query]);

  return (
    <div className="ataru-linear-shell flex h-full min-h-0 flex-col overflow-hidden bg-card text-foreground">
      {hasQuery && <header className="shrink-0 border-b border-foreground/10 bg-card px-4 py-1.5 sm:px-6">
        <div className="mx-auto flex min-w-0 max-w-[1480px] items-center gap-3 overflow-x-auto">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder="搜索关键词，或描述你记得的那次对话…"
              aria-label="搜索 AI 对话记录"
              enterKeyHint="search"
              autoFocus
              className="h-9 w-full rounded-md border border-foreground/15 bg-card pl-9 pr-20 text-sm font-medium text-foreground shadow-none outline-none transition placeholder:text-muted-foreground hover:border-foreground/30 focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <div className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-sm border border-foreground/15 bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground sm:flex">
              <span>⌘</span><span>K</span>
            </div>
          </div>
          <Select value={level} onValueChange={(value) => setLevel(value as SearchScope)}>
            <SelectTrigger className="h-9 w-28 shrink-0 rounded-md border-foreground/15 bg-card px-3.5 text-sm font-medium shadow-none sm:w-32" aria-label="结果类型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-foreground/15 shadow-lg">
              {SCOPES.map((item) => {
                const Icon = item.icon;
                return (
                  <SelectItem key={item.value} value={item.value} aria-label={`${item.label}：${item.description}`}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={mode} onValueChange={(value) => setMode(value as SearchMode)}>
            <SelectTrigger className="h-9 w-28 shrink-0 rounded-md border-foreground/15 bg-card px-3.5 text-sm font-medium shadow-none sm:w-32" aria-label="检索方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-foreground/15 shadow-lg">
              {MODES.map((item) => {
                const copy = getSearchModeCopy(item);
                return (
                  <SelectItem key={item} value={item} aria-label={`${copy.label}：${copy.description}`}>
                    {copy.label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </header>}

      {!hasQuery ? (
        <RecallHome
          query={query}
          recentQueries={recentQueries}
          inputRef={searchInputRef}
          onQueryChange={setQuery}
          onInputKeyDown={handleInputKeyDown}
          onInputCompositionStart={handleCompositionStart}
          onInputCompositionEnd={handleCompositionEnd}
          onSelectQuery={selectQuery}
          onRemoveRecentQuery={(recentQuery) => setRecentQueries((current) => removeRecentQuery(recentQuery, current))}
        />
      ) : (
        <div
          className="ataru-search-grid mx-auto grid min-h-0 w-full max-w-[1480px] min-w-0 flex-1 grid-cols-1 border-t border-foreground/10"
          data-preview-open={isPreviewOpen}
        >
          <SearchResults
            response={response}
            loading={isSearching}
            error={searchError}
            selectedHitId={isPreviewOpen ? selectedHit?.id ?? null : null}
            onSelectHit={selectHit}
            onOpenContext={openHitContext}
            onRetry={() => void performSearch(submittedQuery, true)}
            onSelectQuery={selectQuery}
          />
          <TranscriptPreview
            hit={selectedHit}
            query={response?.query ?? query}
            onOpenContext={openHitContext}
            open={isPreviewOpen}
            onClose={closePreview}
          />
        </div>
      )}
    </div>
  );
}
