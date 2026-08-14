import { useEffect, useMemo, useState } from "react";
import { BookOpenText, Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText, getSessionMessages, type SearchHit } from "@/modules/api/ataru";
import type { Message } from "@/types";
import { ConversationReader } from "@/views/Chat/ConversationReader";
import { HighlightedText } from "./SearchFeedback";
import {
  getSearchResultContextLabel,
  getSearchResultExcerpt,
  getSearchResultMatchLabel,
  getSearchResultTitle,
  projectName,
  readableError,
} from "./utils";

export function TranscriptPreview({
  hit,
  query,
  onOpenContext,
  open = false,
  onClose,
}: {
  hit: SearchHit | null;
  query: string;
  onOpenContext: (hit: SearchHit) => void;
  open?: boolean;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setCopied(false);
    if (!open || !hit?.sessionId || !hit.projectId) return;
    let cancelled = false;
    setLoading(true);
    getSessionMessages(hit.projectId, hit.sessionId)
      .then((next) => {
        if (!cancelled) setMessages(next.filter((message) => !message.is_meta));
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(readableError(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hit?.projectId, hit?.sessionId, open]);

  useEffect(() => {
    if (!open || !onClose) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  const nearbyMessages = useMemo(() => {
    if (!hit || messages.length === 0) return [];
    let anchor = messages.findIndex((message) => hit.messageId && message.uuid === hit.messageId);
    if (anchor < 0) anchor = messages.findIndex((message) => hit.lineNumber && message.line_number === hit.lineNumber);
    if (anchor < 0) anchor = 0;
    return messages.slice(Math.max(0, anchor - 4), Math.min(messages.length, anchor + 8));
  }, [hit, messages]);

  // The first search hit is available for result rendering, but the context pane
  // must enter the layout only after the user explicitly opens it.
  if (!hit || !open) return null;

  const title = getSearchResultTitle(hit, query);
  const contextLabel = getSearchResultContextLabel(hit);
  const snippet = getSearchResultExcerpt(hit, query, title);
  const matchLabel = getSearchResultMatchLabel(hit, query, snippet);
  const matchSummary = hit.matchCount > 1 ? `${hit.matchCount} 条 Turn 命中` : "1 条 Turn 命中";

  return (
    <section
      id="ataru-transcript-preview"
      data-ataru-preview="true"
      data-preview-open={open}
      className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-card md:flex"
      aria-label="会话预览"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.14em] text-primary">命中 Turn 与上下文</p>
          <h2 className="mt-1 line-clamp-2 font-serif text-base font-semibold">{title || contextLabel}</h2>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {title ? `${contextLabel} · ` : ""}{projectName(hit.projectPath)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} aria-label="关闭上下文预览">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <section className="shrink-0 border-b border-primary/20 bg-primary/5 px-4 py-3" aria-label="命中证据">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium">
          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-primary">{matchLabel}</span>
          <span className="text-muted-foreground">{matchSummary}</span>
          {hit.lineNumber && <span className="text-muted-foreground">第 {hit.lineNumber} 行</span>}
        </div>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-foreground" aria-label="本次搜索的命中证据">
          <HighlightedText text={snippet} query={query} />
        </p>
      </section>

      <ConversationReader
        messages={nearbyMessages}
        loading={loading}
        error={error}
        projectId={hit.projectId}
        sessionId={hit.sessionId ?? ""}
        targetMessageId={hit.messageId}
        targetLineNumber={hit.lineNumber}
        compact
      />

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="ghost" size="sm" className="rounded-lg" onClick={() => void copyText(snippet).then(() => setCopied(true))}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? "已复制" : "复制命中"}
        </Button>
        <Button type="button" size="sm" className="rounded-lg" onClick={() => onOpenContext(hit)} disabled={!hit.sessionId}>
          <BookOpenText className="mr-2 h-4 w-4" />
          定位完整会话
        </Button>
      </footer>
    </section>
  );
}
