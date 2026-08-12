import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BookOpenText, ChevronDown, ChevronRight, Copy, Folder, FolderOpen, Search } from "lucide-react";
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

type ArchiveView = "session" | "project";

interface ProjectGroup {
  projectId: string;
  projectPath: string | null;
  label: string;
  sessions: Session[];
  lastModified: number;
}

function SessionRow({
  session,
  active,
  onSelect,
  nested = false,
  style,
}: {
  session: Session;
  active: boolean;
  onSelect: (session: Session) => void;
  nested?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      aria-current={active ? "page" : undefined}
      className={`flex w-full flex-col border-b border-border/60 py-2 text-left transition-colors ${
        nested ? "pl-8 pr-4" : "absolute left-0 top-0 px-4"
      } ${active ? "bg-primary/10" : "hover:bg-muted/60"}`}
      style={style}
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
    return sessions.find(
      (session) =>
        session.id === requestedSessionId &&
        (!requestedProjectId || session.project_id === requestedProjectId),
    ) ?? null;
  }, [requestedProjectId, requestedSessionId, sessions]);
  // The streamed session list replaces Session objects as cached/full snapshots arrive.
  // Fetch transcripts by their durable identity, not by the snapshot object's reference.
  const selectedProjectId = selectedSession?.project_id ?? null;
  const selectedSessionId = selectedSession?.id ?? null;
  const archiveView: ArchiveView = searchParams.get("group") === "project" ? "project" : "session";
  const projectGroups = useMemo(() => {
    const groups = new Map<string, ProjectGroup>();
    for (const session of filteredSessions) {
      const existing = groups.get(session.project_id);
      if (existing) {
        existing.sessions.push(session);
        existing.lastModified = Math.max(existing.lastModified, session.last_modified);
        continue;
      }
      groups.set(session.project_id, {
        projectId: session.project_id,
        projectPath: session.project_path,
        label: projectLabel(session),
        sessions: [session],
        lastModified: session.last_modified,
      });
    }
    return Array.from(groups.values()).sort((a, b) => b.lastModified - a.lastModified);
  }, [filteredSessions]);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (archiveView !== "project") return;
    setExpandedProjectId((current) => {
      if (current && projectGroups.some((group) => group.projectId === current)) return current;
      return selectedSession?.project_id ?? null;
    });
  }, [archiveView, projectGroups, selectedSession?.project_id]);

  const rowVirtualizer = useVirtualizer({
    count: archiveView === "session" ? filteredSessions.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 60,
    overscan: 12,
  });

  const setArchiveView = useCallback((nextView: ArchiveView) => {
    const next = new URLSearchParams(searchParams);
    if (nextView === "project") next.set("group", "project");
    else next.delete("group");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectSession = useCallback((session: Session) => {
    const next = new URLSearchParams();
    next.set("projectId", session.project_id);
    next.set("sessionId", session.id);
    if (archiveView === "project") next.set("group", "project");
    setSearchParams(next);
  }, [archiveView, setSearchParams]);

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
                {initialLoading
                  ? "正在读取本地记录"
                  : archiveView === "project"
                    ? `${projectGroups.length.toLocaleString("zh-CN")} 个项目 · ${filteredSessions.length.toLocaleString("zh-CN")} 个会话`
                    : `${sessions.length.toLocaleString("zh-CN")} 个会话`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="inline-flex rounded-lg border border-border bg-background p-0.5" role="group" aria-label="档案分组方式">
                <button
                  type="button"
                  aria-pressed={archiveView === "session"}
                  onClick={() => setArchiveView("session")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    archiveView === "session" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  会话
                </button>
                <button
                  type="button"
                  aria-pressed={archiveView === "project"}
                  onClick={() => setArchiveView("project")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    archiveView === "project" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  项目
                </button>
              </div>
              <BookOpenText className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
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
          ) : archiveView === "session" ? (
            <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const session = filteredSessions[virtualRow.index];
                const active = selectedSession?.id === session.id && selectedSession.project_id === session.project_id;
                return <SessionRow
                  key={`${session.project_id}:${session.id}`}
                  session={session}
                  active={active}
                  onSelect={selectSession}
                  style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                />;
              })}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {projectGroups.map((group) => {
                const expanded = expandedProjectId === group.projectId;
                const active = selectedSession?.project_id === group.projectId;
                return (
                  <div key={group.projectId}>
                    <button
                      type="button"
                      onClick={() => setExpandedProjectId((current) => current === group.projectId ? null : group.projectId)}
                      aria-expanded={expanded}
                      className={`flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors ${
                        active ? "bg-primary/5" : "hover:bg-muted/60"
                      }`}
                    >
                      {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                      {expanded ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{group.label}</span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="truncate">{group.projectPath || group.projectId}</span>
                          <span aria-hidden="true">·</span>
                          <span className="shrink-0">{group.sessions.length} 个会话</span>
                        </span>
                      </span>
                    </button>
                    {expanded && (
                      <div className="bg-background/50">
                        {group.sessions.map((session) => (
                          <SessionRow
                            key={`${session.project_id}:${session.id}`}
                            session={session}
                            active={selectedSession?.id === session.id && selectedSession.project_id === session.project_id}
                            onSelect={selectSession}
                            nested
                          />
                        ))}
                      </div>
                    )}
                  </div>
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
              <h2 className="mt-4 font-serif text-xl font-semibold">请选择一个会话</h2>
              <p className="mt-2 text-sm text-muted-foreground">从左侧档案中选择一条会话，这里会展示完整内容。</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
