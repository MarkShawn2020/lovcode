import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { FolderKanban, History, Search, X } from "lucide-react";
import { ATARU_QUERY_EXAMPLES } from "@/modules/ai/query";

interface RecallHomeProps {
  query: string;
  recentQueries: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onInputCompositionStart: () => void;
  onInputCompositionEnd: () => void;
  onSelectQuery: (query: string) => void;
  onRemoveRecentQuery: (query: string) => void;
}

/**
 * The empty search state is intentionally quiet: one clear question, the
 * searches people just made, and two low-frequency ways to browse history.
 */
export function RecallHome({
  query,
  recentQueries,
  inputRef,
  onQueryChange,
  onInputKeyDown,
  onInputCompositionStart,
  onInputCompositionEnd,
  onSelectQuery,
  onRemoveRecentQuery,
}: RecallHomeProps) {
  const navigate = useNavigate();
  const suggestions = recentQueries.length > 0 ? recentQueries.slice(0, 5) : ATARU_QUERY_EXAMPLES.slice(0, 3);
  const hasRecentQueries = recentQueries.length > 0;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-6 sm:px-8">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col py-8 sm:py-12">
        <div className="my-auto flex flex-col items-center text-center">
        <div className="flex items-center gap-2.5">
          <img src="/ataru.svg" alt="" className="h-9 w-9 shrink-0 object-contain" />
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Ataru</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">高性能 Agent 聊天检索</p>

        <div className="relative mt-6 w-full">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            onCompositionStart={onInputCompositionStart}
            onCompositionEnd={onInputCompositionEnd}
            placeholder="搜索关键词或描述…"
            aria-label="搜索 AI 对话记录"
            enterKeyHint="search"
            autoFocus
            className="h-11 w-full rounded-lg border border-foreground/15 bg-card pl-11 pr-20 text-sm font-medium shadow-sm outline-none transition placeholder:text-muted-foreground hover:border-primary/60 focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-base"
          />
          <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-sm border border-foreground/15 bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground sm:flex">
            <span>⌘</span><span>K</span>
          </div>
        </div>

        <section className="mt-7 w-full text-left" aria-labelledby="recent-searches-heading">
          <div className="flex items-center justify-between px-1">
            <h2 id="recent-searches-heading" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {hasRecentQueries ? "最近搜索" : "可以这样问"}
            </h2>
            {hasRecentQueries && (
              <span className="text-xs text-muted-foreground">{recentQueries.length} 条</span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="list">
            {suggestions.map((suggestion) => hasRecentQueries ? (
              <div
                key={suggestion}
                role="listitem"
                className="group inline-flex h-8 max-w-full items-center rounded-full border border-foreground/15 bg-muted/35 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
              >
                <button
                  type="button"
                  onClick={() => onSelectQuery(suggestion)}
                  aria-label={`搜索：${suggestion}`}
                  className="inline-flex min-w-0 items-center rounded-l-full py-1.5 pl-3 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="min-w-0 truncate">{suggestion}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveRecentQuery(suggestion)}
                  aria-label={`移除最近搜索：${suggestion}`}
                  title="移除最近搜索"
                  className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div key={suggestion} role="listitem" className="contents">
                <button
                  type="button"
                  onClick={() => onSelectQuery(suggestion)}
                  className="group inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-foreground/15 bg-muted/35 px-3 text-left text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                  <span className="min-w-0 truncate">{suggestion}</span>
                </button>
              </div>
            ))}
            {suggestions.length === 0 && (
              <p className="text-sm text-muted-foreground">完成一次搜索后，它会显示在这里。</p>
            )}
          </div>
        </section>

        <nav className="mt-6 flex w-full flex-wrap justify-center gap-2" aria-label="历史记录入口">
          <BrowseLink icon={<History className="h-4 w-4" />} label="全部历史" onClick={() => navigate("/workbench")} />
          <BrowseLink icon={<FolderKanban className="h-4 w-4" />} label="按项目查看" onClick={() => navigate("/history")} />
        </nav>
        </div>
      </div>
    </main>
  );
}

function BrowseLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-foreground/15 bg-card px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/60 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      {icon}
      {label}
    </button>
  );
}
