import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BookOpenText, Copy, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useStreamedSessions } from "@/hooks/useStreamedSessions";
import { getSessionMessages, copyText } from "@/modules/api/ataru";
import type { Message, Session } from "@/types";
import { ConversationReader } from "@/views/Chat/ConversationReader";
import { restoreSlashCommand } from "@/views/Chat/utils";

function sessionTitle(session: Session) {
  const title = session.title || session.summary || session.last_prompt;
  if (!title) return `会话 ${session.id.slice(0, 8)}`;
  const readable = restoreSlashCommand(title).replace(/\s+/g, " ").trim();
  return readable.length > 88 ? `${readable.slice(0, 88)}…` : readable;
}

function projectLabel(session: Session) {
  const path = session.project_path?.trim();
  if (!path) return session.project_id;
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function formatSessionTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function transcriptAsMarkdown(session: Session, messages: Message[]) {
  const body = messages
    .filter((message) => !message.is_meta)
    .map((message) => {
      const role = message.is_tool ? "工具" : message.role === "user" ? "用户" : "AI";
      return `## ${role}\n\n${restoreSlashCommand(message.content)}`;
    })
    .join("\n\n---\n\n");
  return `# ${sessionTitle(session)}\n\n${body}`;
}

export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions, initialLoading } = useStreamedSessions();
  const [filter, setFilter] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredSessions = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) => {
      const haystack = [
        sessionTitle(session),
        session.project_path,
        session.project_id,
        session.source,
      ].filter(Boolean).join("\n").toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, sessions]);

  const requestedProjectId = searchParams.get("projectId");
  const requestedSessionId = searchParams.get("sessionId");
  const selectedSession = useMemo(() => {
    const exact = sessions.find(
      (session) =>
        session.id === requestedSessionId &&
        (!requestedProjectId || session.project_id === requestedProjectId),
    );
    return exact ?? filteredSessions[0] ?? sessions[0] ?? null;
  }, [filteredSessions, requestedProjectId, requestedSessionId, sessions]);
  // The streamed session list replaces Session objects as cached/full snapshots arrive.
  // Fetch transcripts by their durable identity, not by the snapshot object's reference.
  const selectedProjectId = selectedSession?.project_id ?? null;
  const selectedSessionId = selectedSession?.id ?? null;

  const rowVirtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 60,
    overscan: 12,
  });

  const selectSession = useCallback((session: Session) => {
    const next = new URLSearchParams();
    next.set("projectId", session.project_id);
    next.set("sessionId", session.id);
    setSearchParams(next);
  }, [setSearchParams]);

  useEffect(() => {
    if (!selectedProjectId || !selectedSessionId) {
      setMessages([]);
      setMessageLoading(false);
      setMessageError(null);
      return;
    }
    let cancelled = false;
    setMessageLoading(true);
    setMessageError(null);
    setCopied(false);
    getSessionMessages(selectedProjectId, selectedSessionId)
      .then((next) => {
        if (!cancelled) setMessages(next.filter((message) => !message.is_meta));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessages([]);
          setMessageError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setMessageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, selectedSessionId]);

  useEffect(() => {
    if (!selectedSession || requestedSessionId) return;
    const next = new URLSearchParams(searchParams);
    next.set("projectId", selectedSession.project_id);
    next.set("sessionId", selectedSession.id);
    setSearchParams(next, { replace: true });
  }, [requestedSessionId, searchParams, selectedSession, setSearchParams]);

  const copyTranscript = async () => {
    if (!selectedSession) return;
    await copyText(transcriptAsMarkdown(selectedSession, messages));
    setCopied(true);
  };

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="font-serif text-lg font-semibold">AI 对话资料库</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {initialLoading ? "正在读取本地记录" : `${sessions.length.toLocaleString("zh-CN")} 个会话`}
              </p>
            </div>
            <BookOpenText className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="筛选标题、项目或来源"
              aria-label="筛选历史会话"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" aria-label="历史会话列表">
          {filteredSessions.length === 0 && !initialLoading ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">没有匹配的历史会话</div>
          ) : (
            <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const session = filteredSessions[virtualRow.index];
                const active = selectedSession?.id === session.id && selectedSession.project_id === session.project_id;
                return (
                  <button
                    key={`${session.project_id}:${session.id}`}
                    type="button"
                    onClick={() => selectSession(session)}
                    aria-current={active ? "page" : undefined}
                    className={`absolute left-0 top-0 flex w-full flex-col border-b border-border/60 px-4 py-2 text-left transition-colors ${
                      active ? "bg-primary/10" : "hover:bg-muted/60"
                    }`}
                    style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <span className="truncate text-sm font-medium">{sessionTitle(session)}</span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="truncate">{projectLabel(session)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0 uppercase">{session.source}</span>
                      <span aria-hidden="true">·</span>
                      <time className="shrink-0">{formatSessionTime(session.last_modified)}</time>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {selectedSession ? (
          <>
            <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate font-serif text-lg font-semibold">{sessionTitle(selectedSession)}</h2>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {selectedSession.project_path || selectedSession.project_id} · {messages.length} 条消息
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-lg"
                onClick={() => void copyTranscript()}
                disabled={messageLoading || messages.length === 0}
              >
                <Copy className="mr-2 h-4 w-4" />
                {copied ? "已复制" : "复制全文"}
              </Button>
            </header>
            <ConversationReader
              messages={messages}
              loading={messageLoading}
              error={messageError}
              sessionId={selectedSession.id}
              projectId={selectedSession.project_id}
              targetMessageId={searchParams.get("messageId")}
              targetLineNumber={Number(searchParams.get("lineNumber")) || null}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div>
              <BookOpenText className="mx-auto h-8 w-8 text-primary" />
              <h2 className="mt-4 font-serif text-xl font-semibold">还没有可读的会话</h2>
              <p className="mt-2 text-sm text-muted-foreground">Ataru 会在这里展示本机已有的 AI 对话记录。</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
