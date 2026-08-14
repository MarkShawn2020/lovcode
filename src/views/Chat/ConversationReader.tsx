import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Copy, Wrench } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { copyText } from "@/modules/api/ataru";
import type { ContentBlock, Message } from "@/types";
import { restoreSlashCommand } from "./utils";

function roleLabel(message: Message) {
  if (message.is_tool) return "工具";
  if (message.role === "user") return "用户";
  if (message.role === "assistant") return "AI";
  return message.role || "消息";
}

function formatTimestamp(timestamp: string) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(parsed));
}

function MessageMarkdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-foreground prose-headings:font-serif prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-code:break-words prose-a:text-primary">
      <Markdown remarkPlugins={[remarkGfm]}>{restoreSlashCommand(children)}</Markdown>
    </div>
  );
}

function ToolBlock({ block }: { block: Extract<ContentBlock, { type: "tool_use" | "tool_result" }> }) {
  const title = block.type === "tool_use" ? `工具调用 · ${block.name}` : "工具结果";
  const summary = block.type === "tool_use" ? block.summary : block.content;
  const detail = block.type === "tool_use" ? block.input : block.raw;
  return (
    <details className="rounded-lg border border-border bg-muted/40 open:bg-muted/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
        <Wrench className="h-3.5 w-3.5 text-primary" />
        <span className="truncate">{title}{summary ? ` · ${summary}` : ""}</span>
      </summary>
      {detail && <pre className="max-h-80 overflow-auto border-t border-border p-3 text-xs leading-5 whitespace-pre-wrap">{detail}</pre>}
      {block.type === "tool_result" && block.images?.map((image, index) => (
        <img
          key={`${image.media_type}:${index}`}
          src={`data:${image.media_type};base64,${image.data}`}
          alt={`工具结果图片 ${index + 1}`}
          className="max-h-96 w-auto border-t border-border object-contain p-3"
        />
      ))}
    </details>
  );
}

function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === "text") return <MessageMarkdown key={index}>{block.text}</MessageMarkdown>;
        if (block.type === "thinking") {
          return (
            <details key={index} className="rounded-lg border border-border bg-muted/30">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">思考过程</summary>
              <div className="border-t border-border px-3 py-2"><MessageMarkdown>{block.thinking}</MessageMarkdown></div>
            </details>
          );
        }
        return <ToolBlock key={index} block={block} />;
      })}
    </div>
  );
}

function CopyError({ error, projectId, sessionId }: { error: string; projectId: string; sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const debugText = `读取会话失败\nprojectId=${projectId}\nsessionId=${sessionId}\nerror=${error}`;
  return (
    <div className="mx-auto my-10 max-w-xl rounded-xl border border-destructive/40 bg-card p-5">
      <h3 className="font-serif text-lg font-semibold text-destructive">会话读取失败</h3>
      <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{error}</p>
      <Button type="button" variant="outline" size="sm" className="mt-4 rounded-lg" onClick={() => void copyText(debugText).then(() => setCopied(true))}>
        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
        {copied ? "已复制调试信息" : "复制调试信息"}
      </Button>
    </div>
  );
}

export const ConversationReader = memo(function ConversationReader({
  messages,
  loading,
  error,
  sessionId,
  projectId,
  targetMessageId,
  targetLineNumber,
  compact = false,
}: {
  messages: Message[];
  loading: boolean;
  error: string | null;
  sessionId: string;
  projectId: string;
  targetMessageId?: string | null;
  targetLineNumber?: number | null;
  compact?: boolean;
}) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleMessages = useMemo(() => messages.filter((message) => !message.is_meta), [messages]);
  const rowVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    overscan: 6,
    measureElement: (element) => element.getBoundingClientRect().height + 12,
  });
  const targetIndex = useMemo(() => {
    if (targetMessageId) {
      const messageIndex = visibleMessages.findIndex((message) => message.uuid === targetMessageId);
      if (messageIndex >= 0) return messageIndex;
    }
    if (targetLineNumber) {
      return visibleMessages.findIndex((message) => message.line_number === targetLineNumber);
    }
    return -1;
  }, [targetLineNumber, targetMessageId, visibleMessages]);

  useEffect(() => {
    if (loading || targetIndex < 0) return;
    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(targetIndex, { align: "center" });
    });
  }, [loading, rowVirtualizer, targetIndex]);

  if (error) return <CopyError error={error} projectId={projectId} sessionId={sessionId} />;
  if (loading) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">正在读取会话内容…</div>;
  if (visibleMessages.length === 0) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">这个会话没有可显示的消息</div>;

  return (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-3 py-3" : "px-5 py-5"}`}>
      <div className={`relative mx-auto ${compact ? "max-w-3xl" : "max-w-5xl"}`} style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = visibleMessages[virtualRow.index];
          const isUser = message.role === "user" && !message.is_tool;
          const isTarget = virtualRow.index === targetIndex;
          const timestamp = formatTimestamp(message.timestamp);
          return (
            <article
              key={`${message.uuid}:${message.line_number}:${virtualRow.index}`}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              data-message-id={message.uuid || undefined}
              data-line-number={message.line_number}
              className={`group absolute left-0 top-0 w-full rounded-xl border p-4 ${
                isTarget
                  ? "border-primary/45 bg-primary/5 ring-1 ring-primary/15"
                  : `border-border ${isUser ? "bg-primary/5" : "bg-card"}`
              }`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <header className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`text-xs font-semibold ${isUser ? "text-primary" : "text-foreground"}`}>{roleLabel(message)}</span>
                  {isTarget && <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">命中</span>}
                  {timestamp && <time className="truncate text-[11px] text-muted-foreground">{timestamp}</time>}
                </div>
                <button
                  type="button"
                  onClick={() => void copyText(restoreSlashCommand(message.content)).then(() => setCopiedMessageId(message.uuid))}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  aria-label="复制这条消息"
                >
                  {copiedMessageId === message.uuid ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedMessageId === message.uuid ? "已复制" : "复制"}
                </button>
              </header>
              {message.content_blocks?.length ? (
                <ContentBlocks blocks={message.content_blocks} />
              ) : (
                <MessageMarkdown>{message.content}</MessageMarkdown>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
});
