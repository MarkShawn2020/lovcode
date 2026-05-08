import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@/lib/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Loader2, Search } from "lucide-react";
import type { Session } from "../types";
import { matchesScopedSessionMetadata, parseScopedSearchQuery } from "../lib/searchScopes";
import { formatDate, formatRelativeTime } from "../views/Chat/utils";
import { HighlightText } from "../views/Chat/HighlightText";

interface SearchChatHit {
  session_id: string;
  content?: string;
  session_summary?: string | null;
  title?: string | null;
  summary?: string | null;
  last_prompt?: string | null;
}

interface ContentMatchPreview {
  text: string;
  highlightQuery: string;
}

const RECENT_SEARCH_LIMIT = 20;
const RECENT_SEARCH_BADGE_LIMIT = 8;
const RECENT_SEARCH_STORAGE_KEY = "lovcode:search-overlay:recent-searches";
const FULL_TEXT_SEARCH_LIMIT = 600;
const MATCH_CONTEXT_RADIUS = 96;

const SEARCH_PLACEHOLDER = "Search conversations, title:..., prompt:..., or in:title,prompt";
const SEARCH_EMPTY_LABEL = "Search all conversations";

function getProjectName(session: Session) {
  return session.project_path?.split("/").filter(Boolean).pop() ?? "";
}

function normalizeSnippetValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractSearchTerms(query: string) {
  const reservedTerms = new Set(["and", "or", "not"]);
  return (query.match(/"[^"]+"|'[^']+'|\S+/g) ?? [])
    .map((term) => normalizeSnippetValue(term).replace(/^["']|["']$/g, ""))
    .map((term) => term.replace(/^[-+]+|[*~^:]+$/g, ""))
    .filter((term) => term.length > 0 && !reservedTerms.has(term.toLowerCase()));
}

function findSnippetMatch(content: string, query: string) {
  const normalizedQuery = normalizeSnippetValue(query).replace(/^["']|["']$/g, "");
  const lowerContent = content.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();

  if (lowerQuery) {
    const exactIndex = lowerContent.indexOf(lowerQuery);
    if (exactIndex >= 0) {
      return { index: exactIndex, length: normalizedQuery.length, highlightQuery: normalizedQuery };
    }
  }

  for (const term of extractSearchTerms(query)) {
    const termIndex = lowerContent.indexOf(term.toLowerCase());
    if (termIndex >= 0) {
      return { index: termIndex, length: term.length, highlightQuery: term };
    }
  }

  return null;
}

function buildContentPreview(
  content: string | null | undefined,
  query: string,
  allowFallback = true
): ContentMatchPreview | null {
  const normalizedContent = normalizeSnippetValue(content ?? "");
  if (!normalizedContent) return null;

  const match = findSnippetMatch(normalizedContent, query);
  if (!match) {
    if (!allowFallback) return null;
    const fallback = normalizedContent.slice(0, MATCH_CONTEXT_RADIUS * 2).trim();
    return {
      text: `${fallback}${fallback.length < normalizedContent.length ? " ..." : ""}`,
      highlightQuery: query,
    };
  }

  const start = Math.max(0, match.index - MATCH_CONTEXT_RADIUS);
  const end = Math.min(normalizedContent.length, match.index + match.length + MATCH_CONTEXT_RADIUS);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < normalizedContent.length ? " ..." : "";

  return {
    text: `${prefix}${normalizedContent.slice(start, end).trim()}${suffix}`,
    highlightQuery: match.highlightQuery,
  };
}

function buildSearchHitPreview(result: SearchChatHit, query: string) {
  return buildContentPreview(result.content, query, false)
    ?? buildContentPreview(result.title, query, false)
    ?? buildContentPreview(result.summary, query, false)
    ?? buildContentPreview(result.last_prompt, query, false)
    ?? buildContentPreview(result.session_summary, query, false)
    ?? buildContentPreview(
      result.content || result.title || result.summary || result.last_prompt || result.session_summary,
      query
    );
}

function buildMetadataPreview(session: Session, query: string) {
  const metadataFields = [
    session.summary,
    session.last_prompt,
    session.project_path,
    getProjectName(session),
    session.source,
    session.title,
  ];

  for (const field of metadataFields) {
    const preview = buildContentPreview(field, query, false);
    if (preview) return preview;
  }

  return null;
}

function uniqueSessions(groups: Session[][]) {
  const seen = new Set<string>();
  const ordered: Session[] = [];

  for (const group of groups) {
    for (const session of group) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      ordered.push(session);
    }
  }

  return ordered;
}

function sortByLastModified(sessions: Session[]) {
  return [...sessions].sort((a, b) => b.last_modified - a.last_modified);
}

function readRecentSearches() {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map(normalizeSnippetValue)
      .filter(Boolean)
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentSearches(searches: string[]) {
  try {
    window.localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // Ignore storage failures; search still works without history.
  }
}

export default function SearchOverlay() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Session[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [indexReady, setIndexReady] = useState(false);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
  const [contentMatchPreviews, setContentMatchPreviews] = useState<Map<string, ContentMatchPreview>>(new Map());
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const indexBuildInFlightRef = useRef(false);
  const sessionsById = useMemo(() => {
    return new Map(allSessions.map((session) => [session.id, session]));
  }, [allSessions]);
  const trimmedQuery = query.trim();
  const recentSearchBadges = useMemo(() => {
    return recentSearches.slice(0, RECENT_SEARCH_BADGE_LIMIT);
  }, [recentSearches]);
  const fullTextIndexing = indexBuilding;
  const fullTextModePending = !indexReady && indexBuilding && !!trimmedQuery && results.length === 0;
  const parsedQuery = useMemo(() => parseScopedSearchQuery(trimmedQuery), [trimmedQuery]);
  const highlightQuery = parsedQuery.highlightQuery;

  const rememberSearch = useCallback((value: string) => {
    const term = normalizeSnippetValue(value);
    if (!term) return;
    setRecentSearches((current) => {
      const next = [
        term,
        ...current.filter((item) => item.toLowerCase() !== term.toLowerCase()),
      ].slice(0, RECENT_SEARCH_LIMIT);
      writeRecentSearches(next);
      return next;
    });
  }, []);

  const refreshSearchData = useCallback((options: { rebuildIndex?: boolean } = {}) => {
    invoke<Session[]>("list_all_sessions").then(setAllSessions).catch(() => {});

    if (!options.rebuildIndex || indexBuildInFlightRef.current) return;
    indexBuildInFlightRef.current = true;
    setIndexBuilding(true);
    invoke<number>("build_search_index")
      .then(() => setIndexReady(true))
      .catch(() => {})
      .finally(() => {
        indexBuildInFlightRef.current = false;
        setIndexBuilding(false);
      });
  }, []);

  // Make html/body transparent so only the floating card paints. This window
  // has `transparent: true` in tauri.conf.json — without this the canvas
  // background bleeds through as a solid block.
  useEffect(() => {
    document.documentElement.classList.add("transparent-window");
    return () => { document.documentElement.classList.remove("transparent-window"); };
  }, []);

  // Convert this window into a nonactivating NSPanel on macOS so showing it
  // doesn't bring the lovcode app to the foreground. Idempotent — safe to
  // call once on mount.
  useEffect(() => {
    invoke("make_window_nonactivating_panel").catch((err) => {
      console.warn("[search-overlay] panel conversion failed:", err);
    });
  }, []);

  // Hide on blur — Spotlight-style dismiss when user clicks elsewhere.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) hide();
    });
    return () => { unlisten.then((fn) => fn()).catch(() => {}); };
  }, []);

  // Re-focus input every time the overlay becomes visible / focused.
  useEffect(() => {
    const unlisten = listen("search-overlay:show", () => {
      setQuery("");
      setActiveIdx(0);
      refreshSearchData({ rebuildIndex: true });
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    // Also try to focus immediately on first mount.
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [refreshSearchData]);

  // Load sessions + build index on mount, then refresh again whenever the panel is shown.
  useEffect(() => {
    refreshSearchData({ rebuildIndex: true });
  }, [refreshSearchData]);

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setContentMatchPreviews(new Map());
      setSearching(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const metadataMatches = allSessions.filter((session) =>
          matchesScopedSessionMetadata(session, parsedQuery)
        );

        const nextContentMatchIds = new Set<string>();
        const nextContentMatchPreviews = new Map<string, ContentMatchPreview>();
        let contentMatches: Session[] = [];

        const contentResults = await invoke<SearchChatHit[]>(
          "search_chats",
          { query: trimmedQuery, limit: FULL_TEXT_SEARCH_LIMIT }
        ).catch(() => []);

        const orderedContentIds: string[] = [];

        for (const result of contentResults) {
          if (nextContentMatchIds.has(result.session_id)) continue;
          nextContentMatchIds.add(result.session_id);
          const preview = buildSearchHitPreview(result, highlightQuery);
          if (preview) nextContentMatchPreviews.set(result.session_id, preview);
          orderedContentIds.push(result.session_id);
        }

        contentMatches = orderedContentIds
          .map((id) => sessionsById.get(id))
          .filter((session): session is Session => session !== undefined);

        if (cancelled) return;

        const combinedMatches = uniqueSessions([metadataMatches, contentMatches]);
        const nextResults = sortByLastModified(combinedMatches);

        setContentMatchPreviews(nextContentMatchPreviews);
        setResults(nextResults);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, parsedQuery, highlightQuery, allSessions, sessionsById, indexReady]);

  useEffect(() => {
    if (!trimmedQuery) return;
    const timer = setTimeout(() => rememberSearch(trimmedQuery), 1200);
    return () => clearTimeout(timer);
  }, [trimmedQuery, rememberSearch]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, results.length]);

  const hide = () => {
    getCurrentWindow().hide().catch(() => {});
  };

  const onResultMouseEnter = (index: number) => {
    setActiveIdx(index);
  };

  const onSelectRecentSearch = (term: string) => {
    rememberSearch(term);
    setQuery(term);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onSelect = (s: Session) => {
    rememberSearch(query);
    emitTo("main", "open-chat", {
      projectId: s.project_id,
      projectPath: s.project_path || "",
      sessionId: s.id,
      summary: s.summary,
    }).catch(() => {});
    hide();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); hide(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = results[activeIdx];
      if (s) onSelect(s);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center px-3 pb-6 pt-4 sm:px-6 sm:pt-6"
      onKeyDown={onKeyDown}
    >
      <div
        className="flex max-h-[calc(100vh-2.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-md sm:max-h-[calc(100vh-3rem)]"
      >
        <div className="shrink-0 border-b border-border bg-card/90">
          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3" data-tauri-drag-region>
            <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region>
              <Search className="h-4 w-4 shrink-0 text-primary" />
              <h1 className="truncate font-serif text-base font-semibold text-foreground">Search</h1>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {allSessions.length} sessions
              </span>
            </div>
            <kbd className="rounded-lg border border-border bg-card-alt px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>

          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2 transition-colors focus-within:border-primary">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search"
                placeholder={fullTextModePending ? "Building search index..." : SEARCH_PLACEHOLDER}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {(searching || fullTextIndexing) && (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              )}
            </div>

            {!trimmedQuery && recentSearchBadges.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Recent searches">
                <span className="shrink-0 text-[11px] text-muted-foreground">Recent</span>
                {recentSearchBadges.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => onSelectRecentSearch(term)}
                    className="max-w-[12rem] truncate rounded-lg border border-border bg-card-alt px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                    aria-label={`Search for ${term}`}
                    title={term}
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!trimmedQuery && results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="font-serif text-base font-semibold text-foreground">{SEARCH_EMPTY_LABEL}</div>
            </div>
          ) : fullTextModePending ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Building full-text index</span>
            </div>
          ) : results.length === 0 && !searching ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results
            </div>
          ) : (
            <div className="py-1" aria-label="Search results">
              <div className="flex items-center justify-between gap-3 px-4 py-1.5 text-[11px] text-muted-foreground">
                <span>
                  {searching
                    ? "Searching"
                    : `${results.length} result${results.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {results.map((s, i) => {
                const title = s.title || s.summary || s.last_prompt || "Untitled";
                const projectName = getProjectName(s);
                const isActive = i === activeIdx;
                const metadataPreview = matchesScopedSessionMetadata(s, parsedQuery)
                  ? buildMetadataPreview(s, highlightQuery)
                  : null;
                const matchPreview = contentMatchPreviews.get(s.id) ?? metadataPreview;
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelect(s)}
                    onMouseEnter={() => onResultMouseEnter(i)}
                    aria-current={isActive ? "true" : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      isActive ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
                    }`}
                  >
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-current opacity-50" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        <HighlightText text={title} query={highlightQuery} />
                      </div>
                      <div className="mt-0.5 min-w-0 text-[11px] text-muted-foreground/75">
                        {matchPreview ? (
                          <span className="block line-clamp-2 leading-4">
                            <HighlightText text={matchPreview.text} query={matchPreview.highlightQuery} />
                          </span>
                        ) : (
                          <div className="flex min-w-0 items-center gap-2">
                            {projectName && (
                              <span className="truncate">
                                <HighlightText text={projectName} query={highlightQuery} />
                              </span>
                            )}
                            <span className="min-w-0 truncate font-mono">
                              <HighlightText text={s.id} query={highlightQuery} />
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-muted-foreground tabular-nums">
                      <span title={formatDate(s.last_modified)}>{formatRelativeTime(s.last_modified)}</span>
                      <span title={`${s.message_count} messages total`}>{s.rounds} rounds</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-border px-4 py-2 text-[10px] text-muted-foreground/80">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-card-alt px-1 font-mono">↑</kbd>
              <kbd className="rounded border border-border bg-card-alt px-1 font-mono">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-card-alt px-1 font-mono">↵</kbd>
              open
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
