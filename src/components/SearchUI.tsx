import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  focusMainWindow,
  listConnectors,
  rebuildIndex,
  search,
  type ConnectorInfo,
  type SearchResult,
} from "@/lib/api";

interface Props {
  /** Compact = floating palette (no header, no metadata column). */
  compact?: boolean;
}

export function SearchUI({ compact = false }: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [source, setSource] = useState<string>("");
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listConnectors().then(setConnectors).catch(() => {});
    inputRef.current?.focus();
  }, []);

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
          limit: compact ? 10 : 40,
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

  const totals = useMemo(() => {
    const ready = connectors.filter((c) => c.state === "ready");
    return {
      conversations: ready.reduce((s, c) => s + c.discovered, 0),
      activeSources: ready.length,
      totalSources: connectors.length,
    };
  }, [connectors]);

  const onSelect = (r: SearchResult) => {
    if (compact) focusMainWindow(r.conversation_id).catch(() => {});
    else navigate(`/conversation/${encodeURIComponent(r.conversation_id)}`);
  };

  if (compact) {
    return (
      <div className="flex h-screen flex-col rounded-xl border border-paper-edge bg-paper/95 paper-grain backdrop-blur">
        <div className="border-b border-paper-edge px-4 py-3 input-underline">
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the archive…"
            className="w-full bg-transparent font-serif text-lg text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && results.length === 0 && (
            <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">Listening…</p>
          )}
          {!loading && q && results.length === 0 && (
            <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">No entries.</p>
          )}
          <ol className="space-y-2">
            {results.map((r, i) => (
              <Entry key={r.conversation_id + r.source} r={r} index={i} compact onSelect={() => onSelect(r)} />
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-paper paper-grain">
      {/* Hero — masthead + search input. */}
      <section className="border-b border-paper-edge">
        <div className="mx-auto grid max-w-6xl grid-cols-12 gap-6 px-8 pb-10 pt-12 rise">
          {/* Edition mark */}
          <div className="col-span-12 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink-faint">
            <span>Vol. 0 · No. 40</span>
            <span className="h-px flex-1 bg-paper-edge" aria-hidden />
            <span className="tabular">
              {new Date().toISOString().slice(0, 10)}
            </span>
          </div>

          {/* Masthead */}
          <h1 className="col-span-12 md:col-span-8 font-serif text-[clamp(48px,7vw,96px)] leading-[0.95] tracking-[-0.02em] text-ink">
            The archive of every<br />
            <span className="italic font-light text-cinnabar">conversation</span> you've had<br />
            with an <em className="not-italic underline decoration-cinnabar decoration-[3px] underline-offset-[10px]">AI</em>.
          </h1>

          {/* Stats column (kept compact, right-aligned) */}
          <aside className="col-span-12 md:col-span-4 self-end space-y-3 border-l border-paper-edge pl-6 font-mono text-[11px] uppercase tracking-widest text-ink-soft">
            <Stat label="Indexed" value={totals.conversations.toLocaleString()} accent />
            <Stat label="Live sources" value={`${totals.activeSources} / ${totals.totalSources}`} />
            <button
              type="button"
              disabled={reindexing}
              onClick={async () => {
                setReindexing(true);
                setReindexMsg(null);
                try {
                  const n = await rebuildIndex();
                  setReindexMsg(`+ ${n.toLocaleString()}`);
                  listConnectors().then(setConnectors).catch(() => {});
                } catch (e) {
                  setReindexMsg(`! ${e}`);
                } finally {
                  setReindexing(false);
                }
              }}
              className="group block w-full border-t border-paper-edge pt-3 text-left uppercase tracking-widest text-ink-soft transition hover:text-cinnabar disabled:opacity-50"
            >
              <span className="tabular">→</span> {reindexing ? "Re-cataloguing…" : reindexMsg ?? "Re-catalogue"}
            </button>
          </aside>

          {/* Search row */}
          <div className="col-span-12 mt-6 grid grid-cols-12 items-baseline gap-6">
            <div className="col-span-12 md:col-span-9">
              <div className="input-underline border-b border-ink/30 pb-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Type a word, a phrase, a memory…"
                  className="w-full bg-transparent font-serif text-3xl tracking-tight text-ink placeholder:text-ink-faint focus:outline-none"
                />
              </div>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                Full-text · CJK-aware · {totals.conversations.toLocaleString()} entries
              </p>
            </div>
            <div className="col-span-12 md:col-span-3 flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-soft">
              <span>Filter</span>
              <SourceSelect connectors={connectors} value={source} onChange={setSource} />
            </div>
          </div>
        </div>
      </section>

      {/* Results section */}
      <section className="mx-auto max-w-6xl px-8 py-10">
        <div className="mb-6 flex items-baseline gap-4 font-mono text-[10px] uppercase tracking-[0.3em] text-ink-faint">
          <span>{q.trim() ? "Found" : "Idle"}</span>
          <span className="h-px flex-1 bg-paper-edge" aria-hidden />
          <span className="tabular">
            {loading ? "…" : results.length.toString().padStart(2, "0")}
          </span>
        </div>

        {!q.trim() && <EmptyState connectors={connectors} />}

        {q.trim() && !loading && results.length === 0 && (
          <p className="font-serif text-2xl italic text-ink-soft">
            Silence — nothing in the archive answers to that.
          </p>
        )}

        <ol className="space-y-px">
          {results.map((r, i) => (
            <Entry
              key={r.conversation_id + r.source}
              r={r}
              index={i}
              onSelect={() => onSelect(r)}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-faint">{label}</div>
      <div
        className={`font-serif text-3xl leading-none tracking-tight tabular ${
          accent ? "text-cinnabar" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SourceSelect({
  connectors,
  value,
  onChange,
}: {
  connectors: ConnectorInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative flex-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none border-b border-ink/30 bg-transparent pb-1 pr-5 font-mono text-[11px] uppercase tracking-widest text-ink focus:border-cinnabar focus:outline-none"
      >
        <option value="">All sources</option>
        {connectors
          .filter((c) => c.state === "ready")
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.discovered}
            </option>
          ))}
      </select>
      <span className="pointer-events-none absolute right-0 bottom-1 text-ink-soft">▾</span>
    </div>
  );
}

function Entry({
  r,
  index,
  compact,
  onSelect,
}: {
  r: SearchResult;
  index: number;
  compact?: boolean;
  onSelect: () => void;
}) {
  const date = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 10) : "—";
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
      className={`group grid grid-cols-12 gap-4 border-t border-paper-edge ${compact ? "py-3" : "py-5"} transition hover:bg-paper-deep/40 cursor-pointer`}
    >
      <div className="col-span-1 font-mono text-[11px] tabular text-ink-faint group-hover:text-cinnabar">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className={compact ? "col-span-11" : "col-span-9"}>
        {r.title && (
          <h3 className={`font-serif ${compact ? "text-base line-clamp-1" : "text-xl line-clamp-2"} leading-snug tracking-tight text-ink`}>
            {r.title}
          </h3>
        )}
        <p className={`mt-1 ${compact ? "line-clamp-2 text-xs" : "line-clamp-2 text-sm"} text-ink-soft`}>
          {r.snippet}
        </p>
      </div>
      {!compact && (
        <div className="col-span-2 flex flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          <span className="text-cinnabar tabular">{r.score.toFixed(1)}</span>
          <span className="tabular">{date}</span>
          <span className="truncate text-ink-soft">{r.source}</span>
        </div>
      )}
    </li>
  );
}

function EmptyState({ connectors }: { connectors: ConnectorInfo[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="border-l-2 border-cinnabar pl-4">
        <h2 className="font-serif text-2xl tracking-tight text-ink">
          Every dialogue, every model, one corpus.
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
          Lovcode reads your local AI conversations — Claude Code, Codex, ChatGPT
          exports — and folds them into one searchable archive. Local-first.
          No copy ever leaves your machine.
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          ⌘⇧K · invoke palette · anywhere
        </p>
      </div>
      <div>
        <div className="mb-2 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-ink-faint">
          <span>Connectors</span>
          <span className="h-px flex-1 bg-paper-edge" />
        </div>
        <ul className="space-y-px">
          {connectors.map((c) => (
            <ConnectorRow key={c.id} c={c} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConnectorRow({ c }: { c: ConnectorInfo }) {
  const badge: Record<string, string> = {
    "ready":         "text-cinnabar",
    "needs-config":  "text-ochre",
    "disabled":      "text-ink-faint",
    "error":         "text-cinnabar-deep",
    "unimplemented": "text-ink-faint italic",
  };
  return (
    <li className="grid grid-cols-12 items-baseline gap-3 border-t border-paper-edge py-2">
      <span className="col-span-5 font-serif text-base text-ink">{c.name}</span>
      <span className="col-span-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">{c.family}</span>
      <span className={`col-span-3 font-mono text-[10px] uppercase tracking-widest ${badge[c.state]}`}>
        {c.state.replace("-", " ")}
      </span>
      <span className="col-span-2 text-right font-mono text-[11px] tabular text-ink-soft">
        {c.discovered.toLocaleString()}
      </span>
    </li>
  );
}
