import { useEffect, useMemo, useRef, useState } from "react";
import { focusMainWindow, listSources, rebuildIndex, search, type SearchResult, type SourceSummary } from "@/lib/api";
import { useNavigate } from "react-router-dom";

interface Props {
  /** Compact = floating palette (no header, no rebuild). */
  compact?: boolean;
}

export function SearchUI({ compact = false }: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [source, setSource] = useState<string>("");
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listSources().then(setSources).catch(() => {});
    inputRef.current?.focus();
  }, []);

  // Debounced search.
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await search({
          q,
          source: source || undefined,
          limit: compact ? 10 : 30,
        });
        setResults(r);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [q, source, compact]);

  const totalDocs = useMemo(
    () => sources.reduce((s, x) => s + x.count, 0),
    [sources],
  );

  return (
    <div className={compact ? "flex h-screen flex-col" : "min-h-screen"}>
      {!compact && (
        <header className="border-b border-border bg-card px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-baseline gap-4">
            <h1 className="font-serif text-xl text-foreground">Lovcode</h1>
            <span className="text-xs text-muted-foreground">
              {totalDocs.toLocaleString()} conversations indexed
            </span>
            <div className="ml-auto flex items-center gap-2">
              {reindexMsg && (
                <span className="text-xs text-muted-foreground">{reindexMsg}</span>
              )}
              <button
                type="button"
                disabled={reindexing}
                onClick={async () => {
                  setReindexing(true);
                  setReindexMsg(null);
                  try {
                    const n = await rebuildIndex();
                    setReindexMsg(`Indexed ${n.toLocaleString()}`);
                    const fresh = await listSources();
                    setSources(fresh);
                  } catch (e) {
                    setReindexMsg(`Error: ${e}`);
                  } finally {
                    setReindexing(false);
                  }
                }}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
              >
                {reindexing ? "Indexing…" : "Rebuild index"}
              </button>
            </div>
          </div>
        </header>
      )}

      <div className={compact ? "flex-1 overflow-hidden p-4" : "mx-auto max-w-5xl px-6 py-6"}>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search every conversation…"
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {!compact && (
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded-xl border border-border bg-card px-3 py-3 text-sm text-foreground focus:outline-none"
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className={compact ? "mt-3 flex-1 overflow-y-auto" : "mt-6"}>
          {loading && results.length === 0 && (
            <p className="text-sm text-muted-foreground">Searching…</p>
          )}
          {!loading && q && results.length === 0 && (
            <p className="text-sm text-muted-foreground">No results.</p>
          )}
          <ul className="space-y-3">
            {results.map((r) => (
              <ResultCard
                key={r.conversation_id + r.source}
                r={r}
                compact={compact}
                onSelect={() => {
                  if (compact) {
                    focusMainWindow(r.conversation_id).catch(() => {});
                  } else {
                    navigate(`/conversation/${encodeURIComponent(r.conversation_id)}`);
                  }
                }}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ r, compact, onSelect }: { r: SearchResult; compact: boolean; onSelect: () => void }) {
  const date = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 10) : "—";
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter") onSelect(); }}
      className={`cursor-pointer rounded-xl border border-border bg-card transition hover:border-primary/40 hover:bg-muted/50 ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex items-baseline gap-3 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{r.source}</span>
        <span>{date}</span>
        {r.project && <span className="truncate">{r.project}</span>}
        <span className="ml-auto font-mono">{r.score.toFixed(1)}</span>
      </div>
      {r.title && (
        <div className={`mt-1 font-medium text-foreground ${compact ? "line-clamp-1" : "line-clamp-2"}`}>
          {r.title}
        </div>
      )}
      <div className={`mt-1 text-sm text-muted-foreground ${compact ? "line-clamp-2" : "line-clamp-3"}`}>
        {r.snippet}
      </div>
    </li>
  );
}
