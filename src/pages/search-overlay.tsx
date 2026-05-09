import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@/lib/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Loader2, Search } from "lucide-react";
import type { Session } from "../types";
import { matchesScopedSessionMetadata, parseScopedSearchQuery } from "../lib/searchScopes";
import { formatDate, formatRelativeTime, restoreSlashCommand } from "../views/Chat/utils";
import { HighlightText } from "../views/Chat/HighlightText";

interface SearchChatHit {
  session_id: string;
  uuid: string;
  content?: string;
  role?: string;
  line_number?: number;
  session_summary?: string | null;
  title?: string | null;
  summary?: string | null;
  last_prompt?: string | null;
  round_index?: number;
  round_prompt?: string | null;
  round_timestamp?: string | null;
  timestamp?: string;
  score?: number;
}

interface ContentMatchPreview {
  text: string;
  highlightQuery: string;
}

type SearchViewMode = "round" | "session" | "project";

const SEARCH_VIEW_MODES: Array<{ id: SearchViewMode; label: string }> = [
  { id: "round", label: "Round" },
  { id: "session", label: "Session" },
  { id: "project", label: "Project" },
];

interface RoundSearchResultItem {
  kind: "round";
  key: string;
  session: Session;
  hit: SearchChatHit;
  preview: ContentMatchPreview | null;
}

interface SessionSearchResultItem {
  kind: "session";
  key: string;
  session: Session;
  hit?: SearchChatHit | null;
  preview: ContentMatchPreview | null;
  matchedRoundCount?: number;
}

interface ProjectSearchResultItem {
  kind: "project";
  key: string;
  projectId: string;
  projectPath: string;
  projectName: string;
  session: Session;
  hit?: SearchChatHit | null;
  preview: ContentMatchPreview | null;
  matchedRoundCount: number;
  matchedSessionCount: number;
}

type SearchResultItem = RoundSearchResultItem | SessionSearchResultItem | ProjectSearchResultItem;

const RECENT_SEARCH_LIMIT = 20;
const RECENT_SEARCH_BADGE_LIMIT = 8;
const RECENT_SEARCH_STORAGE_KEY = "lovcode:search-overlay:recent-searches";
const SEARCH_VIEW_STORAGE_KEY = "lovcode:search-overlay:view-mode";
const FULL_TEXT_SEARCH_LIMIT = 600;
const MATCH_CONTEXT_RADIUS = 96;

const SEARCH_PLACEHOLDER = "Search rounds, title:..., round:..., AND/OR, -exclude";
const SEARCH_EMPTY_LABEL = "Search conversations";

function getProjectName(session: Session) {
  return session.project_path?.split("/").filter(Boolean).pop() ?? "";
}

function getSessionTitle(session: Session) {
  return session.title || session.summary || session.last_prompt || "Untitled";
}

function normalizeSnippetValue(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePreviewValue(value: string) {
  return normalizeSnippetValue(restoreSlashCommand(value));
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
  const normalizedContent = normalizePreviewValue(content ?? "");
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
    ?? buildContentPreview(result.round_prompt, query, false)
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

function sortByLastModified(sessions: Session[]) {
  return [...sessions].sort((a, b) => b.last_modified - a.last_modified);
}

function timestampToSeconds(timestamp: string | null | undefined, fallback: number) {
  if (!timestamp) return fallback;
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis)) return fallback;
  return Math.floor(millis / 1000);
}

function getItemHit(item: SearchResultItem) {
  return item.kind === "round" ? item.hit : item.hit ?? null;
}

function itemTimestampSeconds(item: SearchResultItem) {
  const hit = getItemHit(item);
  if (hit) return timestampToSeconds(hit.round_timestamp ?? hit.timestamp, item.session.last_modified);
  return item.session.last_modified;
}

function sortSearchItems(items: SearchResultItem[]) {
  return [...items].sort((a, b) => itemTimestampSeconds(b) - itemTimestampSeconds(a));
}

function getItemRoundKey(item: SearchResultItem) {
  const hit = getItemHit(item);
  if (!hit) return null;
  return `${hit.session_id}:${hit.round_index ?? 0}`;
}

function aggregateSessionItems(items: SearchResultItem[]): SearchResultItem[] {
  const bySession = new Map<
    string,
    {
      item: SessionSearchResultItem;
      roundKeys: Set<string>;
    }
  >();

  for (const item of sortSearchItems(items)) {
    const sessionId = item.session.id;
    const hit = getItemHit(item);
    const existing = bySession.get(sessionId);
    if (!existing) {
      bySession.set(sessionId, {
        item: {
          kind: "session",
          key: `session:${sessionId}`,
          session: item.session,
          hit,
          preview: item.preview,
          matchedRoundCount: 0,
        },
        roundKeys: new Set(),
      });
    } else {
      if (!existing.item.hit && hit) existing.item.hit = hit;
      if (!existing.item.preview && item.preview) existing.item.preview = item.preview;
    }

    const roundKey = getItemRoundKey(item);
    if (roundKey) bySession.get(sessionId)?.roundKeys.add(roundKey);
  }

  return sortSearchItems(
    Array.from(bySession.values()).map(({ item, roundKeys }) => ({
      ...item,
      matchedRoundCount: roundKeys.size,
    }))
  );
}

function aggregateProjectItems(items: SearchResultItem[]): SearchResultItem[] {
  const byProject = new Map<
    string,
    {
      item: ProjectSearchResultItem;
      sessionIds: Set<string>;
      roundKeys: Set<string>;
    }
  >();

  for (const item of sortSearchItems(items)) {
    const session = item.session;
    const projectId = session.project_id;
    const projectPath = session.project_path || "";
    const projectKey = projectPath || projectId || session.id;
    const projectName = getProjectName(session) || projectPath || projectId;
    const hit = getItemHit(item);
    const existing = byProject.get(projectKey);

    if (!existing) {
      byProject.set(projectKey, {
        item: {
          kind: "project",
          key: `project:${projectKey}`,
          projectId,
          projectPath,
          projectName,
          session,
          hit,
          preview: item.preview,
          matchedRoundCount: 0,
          matchedSessionCount: 0,
        },
        sessionIds: new Set(),
        roundKeys: new Set(),
      });
    } else {
      if (!existing.item.hit && hit) existing.item.hit = hit;
      if (!existing.item.preview && item.preview) existing.item.preview = item.preview;
    }

    const bucket = byProject.get(projectKey);
    bucket?.sessionIds.add(session.id);
    const roundKey = getItemRoundKey(item);
    if (roundKey) bucket?.roundKeys.add(roundKey);
  }

  return sortSearchItems(
    Array.from(byProject.values()).map(({ item, sessionIds, roundKeys }) => ({
      ...item,
      matchedSessionCount: sessionIds.size,
      matchedRoundCount: roundKeys.size,
    }))
  );
}

function aggregateSearchItems(items: SearchResultItem[], viewMode: SearchViewMode) {
  if (viewMode === "session") return aggregateSessionItems(items);
  if (viewMode === "project") return aggregateProjectItems(items);
  return items;
}

function roundLabel(hit: SearchChatHit) {
  const index = hit.round_index ?? 0;
  return index > 0 ? `Round ${index}` : "Session prelude";
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

function isSearchViewMode(value: unknown): value is SearchViewMode {
  return SEARCH_VIEW_MODES.some((mode) => mode.id === value);
}

function readSearchViewMode(): SearchViewMode {
  try {
    const stored = window.localStorage.getItem(SEARCH_VIEW_STORAGE_KEY);
    return isSearchViewMode(stored) ? stored : "round";
  } catch {
    return "round";
  }
}

function writeSearchViewMode(mode: SearchViewMode) {
  try {
    window.localStorage.setItem(SEARCH_VIEW_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory view switch still works.
  }
}

export default function SearchOverlay() {
  const [query, setQuery] = useState("");
  const [sourceResults, setSourceResults] = useState<SearchResultItem[]>([]);
  const [viewMode, setViewMode] = useState<SearchViewMode>(readSearchViewMode);
  const [searching, setSearching] = useState(false);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [indexReady, setIndexReady] = useState(false);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
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
  const results = useMemo(() => aggregateSearchItems(sourceResults, viewMode), [sourceResults, viewMode]);
  const viewCounts = useMemo(() => ({
    round: sourceResults.length,
    session: aggregateSessionItems(sourceResults).length,
    project: aggregateProjectItems(sourceResults).length,
  }), [sourceResults]);
  const fullTextIndexing = indexBuilding;
  const fullTextModePending = !indexReady && indexBuilding && !!trimmedQuery && sourceResults.length === 0;
  const parsedQuery = useMemo(() => parseScopedSearchQuery(trimmedQuery), [trimmedQuery]);
  const highlightQuery = parsedQuery.highlightQuery;
  const currentViewLabel = SEARCH_VIEW_MODES.find((mode) => mode.id === viewMode)?.label ?? "Result";

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
      setSourceResults([]);
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

        const contentResults = await invoke<SearchChatHit[]>(
          "search_chats",
          { query: trimmedQuery, limit: FULL_TEXT_SEARCH_LIMIT }
        ).catch(() => []);

        const seenRoundKeys = new Set<string>();
        const contentSessionIds = new Set<string>();
        const roundItems: SearchResultItem[] = [];

        for (const result of contentResults) {
          const session = sessionsById.get(result.session_id);
          if (!session) continue;
          const roundKey = `${result.session_id}:${result.round_index ?? 0}`;
          if (seenRoundKeys.has(roundKey)) continue;
          seenRoundKeys.add(roundKey);
          contentSessionIds.add(result.session_id);
          const preview = buildSearchHitPreview(result, highlightQuery);
          roundItems.push({
            kind: "round",
            key: `round:${roundKey}`,
            session,
            hit: result,
            preview,
          });
        }

        const metadataItems: SearchResultItem[] = sortByLastModified(
          metadataMatches.filter((session) => !contentSessionIds.has(session.id))
        ).map((session) => ({
          kind: "session",
          key: `session:${session.id}`,
          session,
          preview: buildMetadataPreview(session, highlightQuery),
        }));

        if (cancelled) return;

        const nextResults = sortSearchItems([...roundItems, ...metadataItems]);

        setSourceResults(nextResults);
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
    writeSearchViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, results.length, viewMode]);

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

  const onSelect = (item: SearchResultItem) => {
    const s = item.session;
    const hit = getItemHit(item);
    rememberSearch(query);

    if (item.kind === "project" && item.projectPath) {
      emitTo("main", "open-project", {
        projectId: item.projectId,
        projectPath: item.projectPath,
      }).catch(() => {});
      hide();
      return;
    }

    emitTo("main", "open-chat", {
      projectId: s.project_id,
      projectPath: s.project_path || "",
      sessionId: s.id,
      summary: s.summary,
      messageId: hit?.uuid ?? null,
      lineNumber: hit?.line_number ?? null,
      highlight: highlightQuery,
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
      const item = results[activeIdx];
      if (item) onSelect(item);
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
              <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap" aria-label="Recent searches">
                <span className="shrink-0 text-[11px] text-muted-foreground">Recent</span>
                {recentSearchBadges.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => onSelectRecentSearch(term)}
                    className="max-w-[12rem] shrink-0 truncate rounded-lg border border-border bg-card-alt px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                    aria-label={`Search for ${term}`}
                    title={term}
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border border-border bg-card-alt p-0.5" aria-label="Search view">
                {SEARCH_VIEW_MODES.map((mode) => {
                  const active = viewMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setViewMode(mode.id)}
                      aria-pressed={active}
                      className={`flex min-w-[5rem] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-card hover:text-foreground"
                      }`}
                    >
                      <span>{mode.label}</span>
                      <span className={active ? "text-primary-foreground/80" : "text-muted-foreground/70"}>
                        {viewCounts[mode.id]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {trimmedQuery && (
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  {currentViewLabel} view
                </span>
              )}
            </div>
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
                    : `${results.length} ${currentViewLabel.toLowerCase()}${results.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {results.map((item, i) => {
                const s = item.session;
                const title = getSessionTitle(s);
                const projectName = getProjectName(s);
                const isActive = i === activeIdx;
                let label = title;
                let contextLabel = [projectName, s.id].filter(Boolean).join(" · ");
                let metaLabel = `${s.rounds} rounds`;
                let metaTitle = `${s.message_count} messages total`;

                if (item.kind === "round") {
                  label = `${roundLabel(item.hit)}${item.hit.role ? ` · ${item.hit.role}` : ""}`;
                  contextLabel = [title, projectName].filter(Boolean).join(" · ");
                  metaLabel = roundLabel(item.hit);
                  metaTitle = item.hit.round_prompt || `${s.message_count} messages total`;
                } else if (item.kind === "session") {
                  const matchedRounds = item.matchedRoundCount ?? 0;
                  metaLabel = matchedRounds > 0
                    ? `${matchedRounds} matching round${matchedRounds === 1 ? "" : "s"}`
                    : `${s.rounds} rounds`;
                  metaTitle = `${s.message_count} messages total`;
                } else {
                  label = item.projectName;
                  contextLabel = [item.projectPath, title].filter(Boolean).join(" · ");
                  metaLabel = `${item.matchedSessionCount} session${item.matchedSessionCount === 1 ? "" : "s"}`;
                  if (item.matchedRoundCount > 0) {
                    metaLabel += ` · ${item.matchedRoundCount} round${item.matchedRoundCount === 1 ? "" : "s"}`;
                  }
                  metaTitle = item.projectPath || item.projectId;
                }

                const matchPreview = item.preview;
                const timestamp = itemTimestampSeconds(item);
                return (
                  <button
                    key={item.key}
                    onClick={() => onSelect(item)}
                    onMouseEnter={() => onResultMouseEnter(i)}
                    aria-current={isActive ? "true" : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      isActive ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
                    }`}
                  >
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-current opacity-50" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        <HighlightText text={label} query={highlightQuery} />
                      </div>
                      <div className="mt-0.5 min-w-0 text-[11px] text-muted-foreground/75">
                        {matchPreview ? (
                          <span className="block line-clamp-2 leading-4">
                            <HighlightText text={matchPreview.text} query={matchPreview.highlightQuery} />
                          </span>
                        ) : (
                          <div className="flex min-w-0 items-center gap-2">
                            {contextLabel && (
                              <span className="truncate">
                                <HighlightText text={contextLabel} query={highlightQuery} />
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {contextLabel && matchPreview ? (
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/60">
                          <HighlightText text={contextLabel} query={highlightQuery} />
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-muted-foreground tabular-nums">
                      <span title={formatDate(timestamp)}>{formatRelativeTime(timestamp)}</span>
                      <span title={metaTitle}>{metaLabel}</span>
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
