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
import { cn } from "@/lib/utils";
import {
  ataruSearch,
  type SearchHit,
  type SearchLevel,
  type SearchMode,
  type SearchResponse,
} from "@/modules/api/ataru";
import { getSearchModeCopy } from "@/modules/ai/query";
import { IndexStatus } from "./ataru-search/IndexStatus";
import { RecallHome } from "./ataru-search/RecallHome";
import { SearchResults } from "./ataru-search/SearchResults";
import { TranscriptPreview } from "./ataru-search/TranscriptPreview";
import { readableError } from "./ataru-search/utils";

const RECENT_QUERY_KEY = "ataru:recentQueries";
const LEGACY_RECENT_QUERY_KEY = "lovcode:search-overlay:recent-searches";
const SEARCH_DELAY_MS = 160;
const IME_ENTER_GUARD_MS = 160;
const RESULT_LIMIT = 40;

const LEVELS: Array<{
  value: SearchLevel;
  label: string;
  description: string;
  icon: typeof MessageSquareText;
}> = [
  { value: "turn", label: "Turn", description: "直接命中一轮问答", icon: MessageSquareText },
  { value: "session", label: "Session", description: "汇总整段会话", icon: BookOpenText },
  { value: "project", label: "Project", description: "跨会话归并项目", icon: FolderKanban },
];

const MODES: SearchMode[] = ["auto", "keyword", "hybrid", "semantic"];

function isSearchLevel(value: string | null): value is SearchLevel {
  return value === "turn" || value === "session" || value === "project";
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

export function AtaruSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialLevel = searchParams.get("level");
  const initialMode = searchParams.get("mode");
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [level, setLevel] = useState<SearchLevel>(() => (isSearchLevel(initialLevel) ? initialLevel : "turn"));
  const [mode, setMode] = useState<SearchMode>(() => (isSearchMode(initialMode) ? initialMode : "auto"));
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>(loadRecentQueries);
  const [isComposing, setIsComposing] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(() => Boolean(searchParams.get("q")?.trim()));
  const requestSequence = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastSearchKey = useRef("");
  const composingRef = useRef(false);
  const compositionEndAtRef = useRef(0);

  const { status: indexStatus, progress: indexProgress, start: startIndexBuild } = useSearchIndexBuildStatus();
  const indexStartAttempted = useRef(false);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    compositionEndAtRef.current = Date.now();
    // Keep the ref active through the trailing Enter keydown used by some IMEs
    // to commit a candidate. The next frame then searches the committed value.
    requestAnimationFrame(() => {
      composingRef.current = false;
      setIsComposing(false);
    });
  }, []);

  useEffect(() => {
    if (indexStatus?.state !== "idle" || indexStartAttempted.current) return;
    indexStartAttempted.current = true;
    startIndexBuild(false).catch(() => {
      indexStartAttempted.current = false;
    });
  }, [indexStatus?.state, startIndexBuild]);

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

  useEffect(() => {
    if (isComposing) return;
    setShowSearchResults(query.trim().length > 0);
  }, [isComposing, query]);

  const performSearch = useCallback(
    async (rawQuery: string, force = false) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        requestSequence.current += 1;
        lastSearchKey.current = "";
        setResponse(null);
        setSelectedHitId(null);
        setIsPreviewOpen(true);
        setSearchError(null);
        setIsSearching(false);
        setSearchParams({}, { replace: true });
        return;
      }

      if (indexStatus?.state === "idle" || indexStatus?.state === "building") {
        lastSearchKey.current = "";
        setIsSearching(true);
        setSearchError(null);
        return;
      }

      const searchKey = `${trimmed}\u0000${level}\u0000${mode}`;
      if (!force && searchKey === lastSearchKey.current) return;
      lastSearchKey.current = searchKey;
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
        const next = await ataruSearch({ query: trimmed, level, mode, limit: RESULT_LIMIT });
        if (requestSequence.current !== sequence) return;
        setResponse(next);
        setIsPreviewOpen(true);
        setSelectedHitId((current) => {
          if (current && next.hits.some((hit) => hit.id === current)) return current;
          return next.hits.at(0)?.id ?? null;
        });
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
    [indexStatus?.state, level, mode, setSearchParams],
  );

  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => {
      void performSearch(query);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isComposing, performSearch, query]);

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
    void performSearch(query);
  };

  const selectQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    searchInputRef.current?.focus();
  };

  const selectedHit = response?.hits.find((hit) => hit.id === selectedHitId) ?? response?.hits.at(0) ?? null;
  const hasQuery = showSearchResults;
  const selectHit = useCallback((hitId: string) => {
    setSelectedHitId(hitId);
    setIsPreviewOpen(true);
  }, []);
  const closePreview = useCallback(() => setIsPreviewOpen(false), []);
  const openHitContext = useCallback((hit: SearchHit) => {
    if (!hit.sessionId) return;
    const params = new URLSearchParams({ projectId: hit.projectId, sessionId: hit.sessionId });
    if (hit.messageId) params.set("messageId", hit.messageId);
    if (hit.lineNumber) params.set("lineNumber", String(hit.lineNumber));
    if (hit.turnIndex) params.set("roundIndex", String(hit.turnIndex));
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
          <Select value={mode} onValueChange={(value) => setMode(value as SearchMode)}>
            <SelectTrigger className="h-9 w-28 shrink-0 rounded-md border-foreground/15 bg-card px-3.5 text-sm font-medium shadow-none sm:w-32" aria-label="检索方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-[6px] border-foreground/15 shadow-lg">
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
          <div className="flex shrink-0 items-center gap-4 border-b border-foreground/10" role="tablist" aria-label="召回层级">
            {LEVELS.map((item) => {
              const Icon = item.icon;
              const active = level === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  id={`ataru-level-${item.value}`}
                  aria-selected={active}
                  aria-controls="ataru-search-results"
                  aria-label={`${item.label}：${item.description}`}
                  onClick={() => setLevel(item.value)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-none border-b-2 border-transparent px-0 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    active
                      ? "border-primary text-foreground"
                      : "text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="shrink-0">
            <IndexStatus status={indexStatus} progress={indexProgress} onRetry={() => void startIndexBuild(false)} />
          </div>
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
            selectedHitId={selectedHit?.id ?? null}
            onSelectHit={selectHit}
            onOpenContext={openHitContext}
            onRetry={() => void performSearch(query, true)}
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
