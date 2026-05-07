import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAtom } from "jotai";
import { invoke } from "@/lib/tauri";
import {
  AlertCircle,
  ArrowRightLeft,
  ClipboardList,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderInput,
  FolderOpen,
  Info,
  MessageSquare,
  Archive,
  ArchiveRestore,
  Pin,
  PinOff,
  Settings2,
  Terminal,
} from "lucide-react";
import { ExternalLinkIcon, ChatBubbleIcon, Cross2Icon } from "@radix-ui/react-icons";
import {
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";
import {
  archivedSessionIdsAtom,
  expandMessagesAtom,
  markdownPreviewAtom,
  originalChatAtom,
  pinnedSessionIdsAtom,
  userPromptsOnlyAtom,
} from "@/store";
import type { ContentBlock, Message, Session, SessionRuntimeFork } from "@/types";
import {
  checkPaths,
  extractMarkdownLinkHrefs,
  extractPathCandidates,
  stripPathDecorations,
  type PathHit,
} from "@/views/Chat/pathDetection";
import { PathLink } from "@/views/Chat/PathLink";

type HandoffTarget = "claude" | "codex";
type TranslateFn = ReturnType<typeof useI18n>["t"];

const HANDOFF_TARGET_LABELS: Record<HandoffTarget, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

const MAX_RELATED_FILES = 60;
const MAX_SCAN_TEXT_LENGTH = 50_000;

interface RelatedSessionFile {
  raw: string;
  path: string;
  exists?: boolean;
  isDir?: boolean;
}

interface SessionInfo {
  projectId: string;
  sessionId: string;
  title?: string;
  source?: Session["source"];
  projectPath?: string;
  transcriptPath?: string;
  messageCount?: number;
  userMessageCount?: number;
  relatedFiles: RelatedSessionFile[];
  relatedFilesTruncated: boolean;
}

interface SessionInfoState {
  status: "loading" | "ready" | "error";
  info: SessionInfo;
  error?: string;
}

export interface SessionMenuConfig {
  projectId: string;
  sessionId: string;
  title?: string;
  source?: Session["source"];
  projectPath?: string;
  originalChat?: boolean;
  setOriginalChat?: (v: boolean) => void;
  markdownPreview?: boolean;
  setMarkdownPreview?: (v: boolean) => void;
  onExport?: () => void;
  onResume?: () => void;
  onCopySessionId?: () => void;
  /** Archive this session and every session after it in the visible list. Count is used for the label. */
  onArchiveAllAfter?: () => void;
  archiveAfterCount?: number;
  /** Pin override: when supplied, takes precedence over the local useSessionPin atom.
   * Use this to integrate with the effective pin set (which can include external
   * sources like Claude app starredIds). */
  isPinnedOverride?: boolean;
  onTogglePinOverride?: () => void;
  /** Archive override: when supplied, takes precedence over the local sidebar archive atom. */
  isArchivedOverride?: boolean;
  onToggleArchiveOverride?: () => void;
}

export interface SessionDetailMenuConfig extends SessionMenuConfig {
  onClose?: () => void;
  displayMode?: "chat" | "pty";
  onDisplayModeChange?: (mode: "chat" | "pty") => void;
  onOpenConversation?: () => void;
  environmentActionLabel?: string;
  environmentActionDisabled?: boolean;
  onRunEnvironmentAction?: () => void;
  onEnvironment?: () => void;
  onRestartRuntime?: () => void;
  onStartRuntime?: () => void;
  onStopRuntime?: () => void;
  runtimeConnected?: boolean;
  unread?: boolean;
  onToggleRead?: () => void;
  needsReview?: boolean;
  onMarkNeedsReview?: () => void;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sourceProviderForMenu(source?: Session["source"]): HandoffTarget {
  return source === "codex" ? "codex" : "claude";
}

function getHandoffTargets(source?: Session["source"]): HandoffTarget[] {
  if (source === "app-web" || source === "app-cowork") {
    return ["claude", "codex"];
  }
  const sourceProvider = sourceProviderForMenu(source);
  return (["claude", "codex"] as HandoffTarget[]).filter((target) => target !== sourceProvider);
}

function sourceLabel(source?: Session["source"], t?: TranslateFn): string {
  switch (source) {
    case "codex":
      return "Codex";
    case "app-code":
      return "Claude Code app";
    case "app-web":
      return "Claude web";
    case "app-cowork":
      return "Claude Cowork";
    case "cli":
      return "Claude Code CLI";
    default:
      return t ? t("common.unknown") : "Unknown";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createBaseSessionInfo({
  projectId,
  sessionId,
  title,
  source,
  projectPath,
}: Pick<SessionMenuConfig, "projectId" | "sessionId" | "title" | "source" | "projectPath">): SessionInfo {
  return {
    projectId,
    sessionId,
    title: title?.trim() || undefined,
    source,
    projectPath,
    relatedFiles: [],
    relatedFilesTruncated: false,
  };
}

function scanTextWindow(text: string): string {
  if (text.length <= MAX_SCAN_TEXT_LENGTH) return text;
  const half = Math.floor(MAX_SCAN_TEXT_LENGTH / 2);
  return `${text.slice(0, half)}\n${text.slice(-half)}`;
}

function contentBlockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "thinking":
      return block.thinking;
    case "tool_use":
      return [block.summary, block.input].filter(Boolean).join("\n");
    case "tool_result":
      return [block.content, block.raw].filter(Boolean).join("\n");
    default:
      return "";
  }
}

function messageScanTexts(message: Message): string[] {
  const texts = [message.content];
  for (const block of message.content_blocks ?? []) {
    const text = contentBlockText(block);
    if (text) texts.push(text);
  }
  return texts;
}

function extractSessionFileCandidates(messages: Message[]): { paths: string[]; truncated: boolean } {
  const paths = new Set<string>();
  let truncated = false;

  for (const message of messages) {
    for (const text of messageScanTexts(message)) {
      const scanText = scanTextWindow(text);
      const candidates = [...extractPathCandidates(scanText), ...extractMarkdownLinkHrefs(scanText)];

      for (const candidate of candidates) {
        const normalized = stripPathDecorations(candidate.trim()).replace(/[,.;:!?)\]]+$/, "");
        if (!normalized) continue;
        paths.add(normalized);
        if (paths.size >= MAX_RELATED_FILES) {
          truncated = true;
          return { paths: Array.from(paths), truncated };
        }
      }
    }
  }

  return { paths: Array.from(paths), truncated };
}

async function resolveRelatedSessionFiles(paths: string[], projectPath?: string): Promise<RelatedSessionFile[]> {
  if (paths.length === 0) return [];
  const hits = await checkPaths(paths, projectPath);

  return paths.map((raw) => {
    const hit = hits.get(raw);
    return {
      raw,
      path: hit?.resolved ?? inferSessionPath(raw, projectPath),
      exists: Boolean(hit),
      isDir: hit?.isDir,
    };
  });
}

function inferSessionPath(raw: string, projectPath?: string): string {
  const trimmed = raw.trim();
  if (!projectPath || trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed.startsWith("../")) {
    return trimmed;
  }

  const base = projectPath.replace(/\/+$/, "");
  const relative = trimmed.replace(/^\.\//, "");
  return `${base}/${relative}`;
}

function useSessionInfo(
  config: Pick<SessionMenuConfig, "projectId" | "sessionId" | "title" | "source" | "projectPath">,
): SessionInfoState {
  const baseInfo = useMemo(() => createBaseSessionInfo(config), [
    config.projectId,
    config.sessionId,
    config.title,
    config.source,
    config.projectPath,
  ]);
  const [state, setState] = useState<SessionInfoState>({ status: "loading", info: baseInfo });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", info: baseInfo });

    async function load() {
      const [transcriptPathResult, messagesResult] = await Promise.allSettled([
        invoke<string>("get_session_file_path", { projectId: baseInfo.projectId, sessionId: baseInfo.sessionId }),
        invoke<Message[]>("get_session_messages", { projectId: baseInfo.projectId, sessionId: baseInfo.sessionId }),
      ]);

      const messages = messagesResult.status === "fulfilled" ? messagesResult.value : [];
      const { paths, truncated } = extractSessionFileCandidates(messages);
      const relatedFiles = await resolveRelatedSessionFiles(paths, baseInfo.projectPath);

      if (cancelled) return;

      const info: SessionInfo = {
        ...baseInfo,
        transcriptPath: transcriptPathResult.status === "fulfilled" ? transcriptPathResult.value : undefined,
        messageCount: messagesResult.status === "fulfilled" ? messages.length : undefined,
        userMessageCount:
          messagesResult.status === "fulfilled"
            ? messages.filter((message) => message.role === "user" && !message.is_tool).length
            : undefined,
        relatedFiles,
        relatedFilesTruncated: truncated,
      };

      if (messagesResult.status === "rejected") {
        setState({ status: "error", info, error: errorMessage(messagesResult.reason) });
      } else {
        setState({ status: "ready", info });
      }
    }

    load().catch((error) => {
      if (!cancelled) {
        setState({ status: "error", info: baseInfo, error: errorMessage(error) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [baseInfo]);

  return state;
}

function sessionInfoRows(info: SessionInfo, t?: TranslateFn): Array<{ label: string; value: string; mono?: boolean }> {
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t ? t("session.title") : "Title", value: info.title || (t ? t("common.untitledConversation") : "Untitled conversation") },
    { label: t ? t("session.source") : "Source", value: sourceLabel(info.source, t) },
    { label: t ? t("session.sessionId") : "Session ID", value: info.sessionId, mono: true },
    { label: t ? t("session.projectId") : "Project ID", value: info.projectId, mono: true },
  ];

  if (info.projectPath) rows.push({ label: t ? t("session.projectPath") : "Project path", value: info.projectPath, mono: true });
  if (info.transcriptPath) rows.push({ label: t ? t("session.transcript") : "Transcript", value: info.transcriptPath, mono: true });
  if (info.messageCount !== undefined) {
    rows.push({
      label: t ? t("session.messages") : "Messages",
      value: `${info.userMessageCount ?? 0} user / ${info.messageCount} total`,
    });
  }

  return rows;
}

function formatRelatedFile(file: RelatedSessionFile): string {
  const suffixes = [];
  if (file.raw !== file.path) suffixes.push(`mentioned: ${file.raw}`);
  if (file.exists === false) suffixes.push("not found");
  if (file.isDir) suffixes.push("directory");

  return suffixes.length > 0 ? `${file.path} (${suffixes.join("; ")})` : file.path;
}

function buildSessionInfoText(info: SessionInfo, t?: TranslateFn): string {
  const lines = ["# Session Basic Info", ""];
  for (const row of sessionInfoRows(info, t)) {
    lines.push(`- ${row.label}: ${row.value}`);
  }

  lines.push("", "## Related File Paths");
  if (info.relatedFiles.length === 0) {
    lines.push("- No related file paths detected.");
  } else {
    info.relatedFiles.forEach((file) => lines.push(`- ${formatRelatedFile(file)}`));
    if (info.relatedFilesTruncated) {
      lines.push(`- Additional file paths were omitted after the first ${MAX_RELATED_FILES}.`);
    }
  }

  return lines.join("\n");
}

function buildRelatedFilesText(info: SessionInfo): string {
  if (info.relatedFiles.length === 0) return "No related file paths detected.";
  const lines = info.relatedFiles.map(formatRelatedFile);
  if (info.relatedFilesTruncated) lines.push(`Additional file paths were omitted after the first ${MAX_RELATED_FILES}.`);
  return lines.join("\n");
}

function buildTraceContextText(info: SessionInfo): string {
  return `${buildSessionInfoText(info)}

## Trace Context
- Use the transcript path to inspect the original conversation record when needed.
- Treat related file paths as starting points for analysis; verify current file state before drawing conclusions.
- Use the session ID and project path when asking another AI or teammate to continue, debug, or audit this session.`;
}

async function copyTextWithToast(text: string, messages: { copied: string; failed: (message: string) => string }) {
  try {
    await invoke("copy_to_clipboard", { text });
    toast.success(messages.copied);
  } catch (error) {
    toast.error(messages.failed(errorMessage(error)));
  }
}

function useSessionInfoActions(
  config: Pick<SessionMenuConfig, "projectId" | "sessionId" | "title" | "source" | "projectPath">,
) {
  const { t } = useI18n();
  const sessionInfoState = useSessionInfo(config);
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  const readyToCopy = sessionInfoState.status !== "loading";
  const hasRelatedFiles = sessionInfoState.info.relatedFiles.length > 0;

  const openSessionInfoDialog = useCallback(() => {
    setInfoDialogOpen(true);
  }, []);

  const handleCopySessionInfo = useCallback(() => {
    const label = t("session.infoLabel");
    return copyTextWithToast(buildSessionInfoText(sessionInfoState.info, t), {
      copied: t("session.infoCopied", { label }),
      failed: (message) => t("session.copyFailed", { label, message }),
    });
  }, [sessionInfoState.info, t]);

  const handleCopyRelatedFiles = useCallback(() => {
    const label = t("session.relatedPathsLabel");
    return copyTextWithToast(buildRelatedFilesText(sessionInfoState.info), {
      copied: t("session.infoCopied", { label }),
      failed: (message) => t("session.copyFailed", { label, message }),
    });
  }, [sessionInfoState.info, t]);

  const handleCopyTraceContext = useCallback(() => {
    const label = t("session.traceContextLabel");
    return copyTextWithToast(buildTraceContextText(sessionInfoState.info), {
      copied: t("session.infoCopied", { label }),
      failed: (message) => t("session.copyFailed", { label, message }),
    });
  }, [sessionInfoState.info, t]);

  return {
    sessionInfoState,
    infoDialogOpen,
    setInfoDialogOpen,
    openSessionInfoDialog,
    readyToCopy,
    hasRelatedFiles,
    handleCopySessionInfo,
    handleCopyRelatedFiles,
    handleCopyTraceContext,
  };
}

// Shared handlers
export function useSessionMenuHandlers(projectId: string, sessionId: string, source?: Session["source"], title?: string) {
  const { t } = useI18n();
  const sessionTitle = title?.trim();
  const handleReveal = () => invoke("reveal_session_file", { projectId, sessionId });
  const handleOpenInEditor = () => invoke("open_session_in_editor", { projectId, sessionId });
  const handleCopyPath = async () => {
    const path = await invoke<string>("get_session_file_path", { projectId, sessionId });
    await invoke("copy_to_clipboard", { text: path });
  };
  const handleCopySessionTitle = () => {
    if (!sessionTitle) return;
    return invoke("copy_to_clipboard", { text: sessionTitle });
  };
  const handleCopySessionId = () => invoke("copy_to_clipboard", { text: sessionId });
  const handleCopyResumeCommand = (projectPath: string) => {
    const resume = source === "codex" ? `codex resume ${sessionId}` : `claude --resume ${sessionId}`;
    const cmd = `cd ${shellQuote(projectPath)} && ${resume}`;
    return invoke("copy_to_clipboard", { text: cmd });
  };
  const handoffTargets = getHandoffTargets(source);
  const handleCopyHandoffPrompt = async (targetProvider: HandoffTarget) => {
    try {
      const runtimeFork = await invoke<SessionRuntimeFork>("create_session_runtime_fork", {
        projectId,
        sessionId,
        targetProvider,
      });
      const resume =
        targetProvider === "codex"
          ? `codex resume ${runtimeFork.targetSessionId}`
          : `claude --resume ${runtimeFork.targetSessionId}`;
      const cmd = `cd ${shellQuote(runtimeFork.projectPath)} && ${resume}`;
      await invoke("copy_to_clipboard", { text: cmd });
      toast.success(t("session.copyRuntimeResumeSuccess", { target: HANDOFF_TARGET_LABELS[targetProvider] }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("session.copyRuntimeResumeFailed", { message }));
    }
  };

  return {
    canCopySessionTitle: Boolean(sessionTitle),
    handoffTargets,
    handleReveal,
    handleOpenInEditor,
    handleCopyPath,
    handleCopySessionTitle,
    handleCopySessionId,
    handleCopyResumeCommand,
    handleCopyHandoffPrompt,
  };
}

// Archive state for a session (client-side hidden-in-sidebar flag)
export function useSessionArchive(sessionId: string) {
  const [archivedIds, setArchivedIds] = useAtom(archivedSessionIdsAtom);
  const isArchived = archivedIds.includes(sessionId);
  const toggleArchived = () => {
    setArchivedIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };
  return { isArchived, toggleArchived };
}

// Pin state for a session (client-side, sticky-to-top in lists).
// Stored in localStorage — Claude app's pin state lives in its IndexedDB and
// is not externally readable, so we keep this independent.
export function useSessionPin(sessionId: string) {
  const [pinnedIds, setPinnedIds] = useAtom(pinnedSessionIdsAtom);
  const isPinned = pinnedIds.includes(sessionId);
  const togglePinned = () => {
    setPinnedIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };
  return { isPinned, togglePinned };
}

function useResolvedSessionMenuState({
  projectId,
  sessionId,
  title,
  source,
  isPinnedOverride,
  onTogglePinOverride,
  isArchivedOverride,
  onToggleArchiveOverride,
}: Pick<
  SessionMenuConfig,
  | "projectId"
  | "sessionId"
  | "title"
  | "source"
  | "isPinnedOverride"
  | "onTogglePinOverride"
  | "isArchivedOverride"
  | "onToggleArchiveOverride"
>) {
  const handlers = useSessionMenuHandlers(projectId, sessionId, source, title);
  const { isArchived: localIsArchived, toggleArchived: localToggleArchived } = useSessionArchive(sessionId);
  const { isPinned: localIsPinned, togglePinned: localTogglePinned } = useSessionPin(sessionId);

  return {
    ...handlers,
    isArchived: isArchivedOverride ?? localIsArchived,
    toggleArchived: onToggleArchiveOverride ?? localToggleArchived,
    isPinned: isPinnedOverride ?? localIsPinned,
    togglePinned: onTogglePinOverride ?? localTogglePinned,
  };
}

function useSessionDetailViewState() {
  const [userPromptsOnly, setUserPromptsOnly] = useAtom(userPromptsOnlyAtom);
  const [expandMessages, setExpandMessages] = useAtom(expandMessagesAtom);
  const [markdownPreview, setMarkdownPreview] = useAtom(markdownPreviewAtom);
  const [originalChat, setOriginalChat] = useAtom(originalChatAtom);

  return {
    userPromptsOnly,
    setUserPromptsOnly,
    expandMessages,
    setExpandMessages,
    markdownPreview,
    setMarkdownPreview,
    originalChat,
    setOriginalChat,
  };
}

function SessionInfoRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  if (!value && !children) return null;
  return (
    <div className="grid gap-1 border-b border-border/60 py-2 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-muted-foreground">{label}</span>
      {children ?? (
        <span className={`min-w-0 break-words text-foreground ${mono ? "font-mono text-xs" : ""}`} title={value}>
          {value}
        </span>
      )}
    </div>
  );
}

function SessionPathLink({
  text,
  path,
  raw,
  exists = true,
  isDir = false,
  cwd,
}: {
  text?: string;
  path: string;
  raw?: string;
  exists?: boolean;
  isDir?: boolean;
  cwd?: string;
}) {
  const hit = useMemo<PathHit>(
    () => ({
      raw: raw ?? path,
      resolved: path,
      isDir,
      exists,
    }),
    [exists, isDir, path, raw],
  );

  return (
    <span className="font-mono text-xs leading-relaxed break-all">
      <PathLink text={text ?? raw ?? path} hit={hit} cwd={cwd} />
    </span>
  );
}

function SessionInfoDialog({
  open,
  onOpenChange,
  state,
  onCopySessionInfo,
  onCopyRelatedFiles,
  onCopyTraceContext,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: SessionInfoState;
  onCopySessionInfo: () => void;
  onCopyRelatedFiles: () => void;
  onCopyTraceContext: () => void;
}) {
  const { t } = useI18n();
  const { info, status, error } = state;
  const hasRelatedFiles = info.relatedFiles.length > 0;
  const messageSummary =
    info.messageCount === undefined
      ? status === "loading"
        ? t("common.loading")
        : undefined
      : t("session.messagesUserTotal", { user: info.userMessageCount ?? 0, total: info.messageCount });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[84vh] max-w-3xl !flex-col !gap-0 !overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="font-serif text-xl">{t("session.information")}</DialogTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={status === "loading"} onClick={onCopySessionInfo}>
              <Info size={14} />
              {t("session.copyInfo")}
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={status === "loading" || !hasRelatedFiles} onClick={onCopyRelatedFiles}>
              <FolderInput size={14} />
              {t("session.copyPaths")}
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={status === "loading"} onClick={onCopyTraceContext}>
              <ClipboardList size={14} />
              {t("session.copyTrace")}
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {status === "error" && error && (
            <div className="rounded-lg border border-border bg-card-alt px-3 py-2 text-xs text-muted-foreground" title={error}>
              {t("session.couldNotLoadDetails", { message: error })}
            </div>
          )}

          <section>
            <h3 className="font-serif text-base font-semibold text-foreground">{t("session.basic")}</h3>
            <div className="mt-2 rounded-xl border border-border bg-card px-3">
              <SessionInfoRow label={t("session.title")} value={info.title || t("common.untitledConversation")} />
              <SessionInfoRow label={t("session.source")} value={sourceLabel(info.source, t)} />
              <SessionInfoRow label={t("session.sessionId")} value={info.sessionId} mono />
              <SessionInfoRow label={t("session.projectId")} value={info.projectId} mono />
              <SessionInfoRow label={t("session.projectPath")}>
                {info.projectPath ? (
                  <SessionPathLink path={info.projectPath} isDir />
                ) : (
                  <span className="text-muted-foreground">{t("common.unknown")}</span>
                )}
              </SessionInfoRow>
              <SessionInfoRow label={t("session.transcript")}>
                {info.transcriptPath ? (
                  <SessionPathLink path={info.transcriptPath} cwd={info.projectPath} />
                ) : (
                  <span className="text-muted-foreground">{status === "loading" ? t("common.loading") : t("common.unknown")}</span>
                )}
              </SessionInfoRow>
              <SessionInfoRow label={t("session.messages")} value={messageSummary} />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-serif text-base font-semibold text-foreground">{t("session.relatedFilePaths")}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {status === "loading" ? t("common.loading") : t("session.detectedCount", { count: info.relatedFiles.length })}
              </span>
            </div>
            <div className="mt-2 rounded-xl border border-border bg-card">
              {status === "loading" ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">{t("session.loadingRelatedPaths")}</div>
              ) : info.relatedFiles.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">{t("session.noFilePathsDetected")}</div>
              ) : (
                <div className="max-h-[40vh] divide-y divide-border/60 overflow-y-auto">
                  {info.relatedFiles.map((file, index) => (
                    <div key={`${file.raw}:${file.path}`} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[2rem_minmax(0,1fr)]">
                      <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                      <div className="min-w-0 space-y-1">
                        <SessionPathLink
                          text={file.raw}
                          raw={file.raw}
                          path={file.path}
                          exists={file.exists}
                          isDir={file.isDir}
                          cwd={info.projectPath}
                        />
                        {file.raw !== file.path && (
	                          <div className="break-all font-mono text-[11px] text-muted-foreground">
	                            {t("session.resolvedPath", { path: file.path })}
	                          </div>
                        )}
                        {file.exists === false && (
                          <div className="text-[11px] text-muted-foreground">{t("session.notFoundOnDisk")}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {info.relatedFilesTruncated && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {t("session.additionalPathsOmitted", { count: MAX_RELATED_FILES })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>,
    document.body,
  );
}

function SessionInfoMenuHint({ state }: { state: SessionInfoState }) {
  const { t } = useI18n();
  const { info, status } = state;
  const countLabel = status === "loading" ? t("common.loading") : t("session.relatedPathsCount", { count: info.relatedFiles.length });

  return (
    <div className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">
      {countLabel}
    </div>
  );
}

function DropdownHandoffSubmenu({
  targets,
  onCopy,
}: {
  targets: HandoffTarget[];
  onCopy: (target: HandoffTarget) => void;
}) {
  const { t } = useI18n();
  if (targets.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <ArrowRightLeft size={14} />
        {t("session.resumeInRuntime")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {targets.map((target) => (
          <DropdownMenuItem key={target} onClick={() => onCopy(target)} className="gap-2">
            <ArrowRightLeft size={14} />
            {t("session.copyRuntimeResumeFor", { target: HANDOFF_TARGET_LABELS[target] })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ContextHandoffSubmenu({
  targets,
  onCopy,
}: {
  targets: HandoffTarget[];
  onCopy: (target: HandoffTarget) => void;
}) {
  const { t } = useI18n();
  if (targets.length === 0) return null;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="gap-2">
        <ArrowRightLeft size={14} />
        {t("session.resumeInRuntime")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {targets.map((target) => (
          <ContextMenuItem key={target} onClick={() => onCopy(target)} className="gap-2">
            <ArrowRightLeft size={14} />
            {t("session.copyRuntimeResumeFor", { target: HANDOFF_TARGET_LABELS[target] })}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function SessionDetailDropdownMenuItems({
  onClose,
  displayMode,
  onDisplayModeChange,
  onEnvironment,
  unread,
  onToggleRead,
  needsReview,
  onMarkNeedsReview,
  ...sessionConfig
}: SessionDetailMenuConfig) {
  const { t } = useI18n();
  const {
    userPromptsOnly,
    setUserPromptsOnly,
    expandMessages,
    setExpandMessages,
    markdownPreview,
    setMarkdownPreview,
    originalChat,
    setOriginalChat,
  } = useSessionDetailViewState();
  const {
    handleReveal,
    handleOpenInEditor,
    handleCopyPath,
    handleCopySessionTitle,
    handleCopySessionId,
    handleCopyResumeCommand,
    handleCopyHandoffPrompt,
    canCopySessionTitle,
    handoffTargets,
    isArchived,
    toggleArchived,
    isPinned,
    togglePinned,
  } = useResolvedSessionMenuState(sessionConfig);
  const {
    sessionInfoState,
    infoDialogOpen,
    setInfoDialogOpen,
    openSessionInfoDialog,
    readyToCopy,
    hasRelatedFiles,
    handleCopySessionInfo,
    handleCopyRelatedFiles,
    handleCopyTraceContext,
  } = useSessionInfoActions(sessionConfig);

  return (
    <>
      <SessionInfoDialog
        open={infoDialogOpen}
        onOpenChange={setInfoDialogOpen}
        state={sessionInfoState}
        onCopySessionInfo={handleCopySessionInfo}
        onCopyRelatedFiles={handleCopyRelatedFiles}
        onCopyTraceContext={handleCopyTraceContext}
      />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Eye size={14} />
          {t("session.view")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-80">
          {displayMode && onDisplayModeChange && (
            <>
              <DropdownMenuRadioGroup
                value={displayMode}
                onValueChange={(value) => onDisplayModeChange(value as "chat" | "pty")}
              >
                <DropdownMenuRadioItem value="chat">{t("session.chatRecord")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="pty">PTY</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuCheckboxItem checked={userPromptsOnly} onCheckedChange={setUserPromptsOnly}>
            {t("session.promptsOnly")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={expandMessages} onCheckedChange={setExpandMessages}>
            {t("session.expandMessages")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={markdownPreview} onCheckedChange={setMarkdownPreview}>
            {t("session.markdownPreview")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={originalChat} onCheckedChange={setOriginalChat}>
            {t("session.readableSlashCommand")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              openSessionInfoDialog();
            }}
            className="gap-2"
          >
            <Info size={14} />
            {t("session.informationEllipsis")}
          </DropdownMenuItem>
          <SessionInfoMenuHint state={sessionInfoState} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Pin size={14} />
          {t("session.manage")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={togglePinned} className="gap-2">
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            {isPinned ? t("session.unpin") : t("session.pinToTop")}
          </DropdownMenuItem>
          {onToggleRead && (
            <DropdownMenuItem onClick={onToggleRead} className="gap-2">
              {unread ? <Eye size={14} /> : <EyeOff size={14} />}
              {unread ? t("session.markAsRead") : t("session.markAsUnread")}
            </DropdownMenuItem>
          )}
          {onMarkNeedsReview && (
            <DropdownMenuItem onClick={onMarkNeedsReview} className="gap-2">
              <AlertCircle size={14} />
              {needsReview ? t("workspace.needsReview") : t("workspace.markNeedsReview")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={toggleArchived} className="gap-2">
            {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {isArchived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
          </DropdownMenuItem>
          {sessionConfig.onArchiveAllAfter && sessionConfig.archiveAfterCount !== undefined && sessionConfig.archiveAfterCount > 0 && (
            <DropdownMenuItem onClick={sessionConfig.onArchiveAllAfter} className="gap-2">
              <Archive size={14} />
              {t("session.archiveThisAndAfter", { count: sessionConfig.archiveAfterCount })}
            </DropdownMenuItem>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {onEnvironment && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Settings2 size={14} />
            {t("workspace.advanced")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={onEnvironment} className="gap-2">
              <Settings2 size={14} />
              {t("session.configureRunScripts")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Copy size={14} />
          {t("session.copy")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem disabled={!readyToCopy} onClick={handleCopySessionInfo} className="gap-2">
            <Info size={14} />
            {t("session.sessionInfo")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!readyToCopy || !hasRelatedFiles} onClick={handleCopyRelatedFiles} className="gap-2">
            <FolderInput size={14} />
            {t("session.relatedFilePaths")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!readyToCopy} onClick={handleCopyTraceContext} className="gap-2">
            <ClipboardList size={14} />
            {t("session.traceContext")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {canCopySessionTitle && (
            <DropdownMenuItem onClick={handleCopySessionTitle} className="gap-2">
              <MessageSquare size={14} />
              {t("session.sessionTitle")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleCopySessionId} className="gap-2">
            <Copy size={14} />
            Session ID
          </DropdownMenuItem>
          {sessionConfig.projectPath && (
            <DropdownMenuItem onClick={() => handleCopyResumeCommand(sessionConfig.projectPath!)} className="gap-2">
              <Terminal size={14} />
            {t("session.resumeCommand")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleCopyPath} className="gap-2">
            <FolderInput size={14} />
            {t("session.filePath")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownHandoffSubmenu targets={handoffTargets} onCopy={handleCopyHandoffPrompt} />
      {sessionConfig.onExport && (
        <DropdownMenuItem onClick={sessionConfig.onExport} className="gap-2">
          <Download size={14} />
          Export
        </DropdownMenuItem>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <FolderOpen size={14} />
          {t("session.files")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={handleReveal} className="gap-2">
            <FolderOpen size={14} />
            {t("fileViewer.revealInFinder")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenInEditor} className="gap-2">
            <ExternalLinkIcon width={14} />
            {t("common.openInEditor")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {onClose && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClose} className="gap-2">
            <Cross2Icon width={14} />
            {t("workspace.closePanel")}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

export function SessionDetailContextMenuItems({
  onClose,
  displayMode,
  onDisplayModeChange,
  onEnvironment,
  unread,
  onToggleRead,
  needsReview,
  onMarkNeedsReview,
  ...sessionConfig
}: SessionDetailMenuConfig) {
  const { t } = useI18n();
  const {
    userPromptsOnly,
    setUserPromptsOnly,
    expandMessages,
    setExpandMessages,
    markdownPreview,
    setMarkdownPreview,
    originalChat,
    setOriginalChat,
  } = useSessionDetailViewState();
  const {
    handleReveal,
    handleOpenInEditor,
    handleCopyPath,
    handleCopySessionTitle,
    handleCopySessionId,
    handleCopyResumeCommand,
    handleCopyHandoffPrompt,
    canCopySessionTitle,
    handoffTargets,
    isArchived,
    toggleArchived,
    isPinned,
    togglePinned,
  } = useResolvedSessionMenuState(sessionConfig);
  const {
    sessionInfoState,
    infoDialogOpen,
    setInfoDialogOpen,
    openSessionInfoDialog,
    readyToCopy,
    hasRelatedFiles,
    handleCopySessionInfo,
    handleCopyRelatedFiles,
    handleCopyTraceContext,
  } = useSessionInfoActions(sessionConfig);

  return (
    <>
      <SessionInfoDialog
        open={infoDialogOpen}
        onOpenChange={setInfoDialogOpen}
        state={sessionInfoState}
        onCopySessionInfo={handleCopySessionInfo}
        onCopyRelatedFiles={handleCopyRelatedFiles}
        onCopyTraceContext={handleCopyTraceContext}
      />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Eye size={14} />
          {t("session.view")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-80">
          {displayMode && onDisplayModeChange && (
            <>
              <ContextMenuRadioGroup
                value={displayMode}
                onValueChange={(value) => onDisplayModeChange(value as "chat" | "pty")}
              >
                <ContextMenuRadioItem value="chat">{t("session.chatRecord")}</ContextMenuRadioItem>
                <ContextMenuRadioItem value="pty">PTY</ContextMenuRadioItem>
              </ContextMenuRadioGroup>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuCheckboxItem checked={userPromptsOnly} onCheckedChange={setUserPromptsOnly}>
            {t("session.promptsOnly")}
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={expandMessages} onCheckedChange={setExpandMessages}>
            {t("session.expandMessages")}
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={markdownPreview} onCheckedChange={setMarkdownPreview}>
            {t("session.markdownPreview")}
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem checked={originalChat} onCheckedChange={setOriginalChat}>
            {t("session.readableSlashCommand")}
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={(event) => {
              event.preventDefault();
              openSessionInfoDialog();
            }}
            className="gap-2"
          >
            <Info size={14} />
            {t("session.informationEllipsis")}
          </ContextMenuItem>
          <SessionInfoMenuHint state={sessionInfoState} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Pin size={14} />
          {t("session.manage")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={togglePinned} className="gap-2">
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            {isPinned ? t("session.unpin") : t("session.pinToTop")}
          </ContextMenuItem>
          {onToggleRead && (
            <ContextMenuItem onClick={onToggleRead} className="gap-2">
              {unread ? <Eye size={14} /> : <EyeOff size={14} />}
              {unread ? t("session.markAsRead") : t("session.markAsUnread")}
            </ContextMenuItem>
          )}
          {onMarkNeedsReview && (
            <ContextMenuItem onClick={onMarkNeedsReview} className="gap-2">
              <AlertCircle size={14} />
              {needsReview ? t("workspace.needsReview") : t("workspace.markNeedsReview")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={toggleArchived} className="gap-2">
            {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {isArchived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
          </ContextMenuItem>
          {sessionConfig.onArchiveAllAfter && sessionConfig.archiveAfterCount !== undefined && sessionConfig.archiveAfterCount > 0 && (
            <ContextMenuItem onClick={sessionConfig.onArchiveAllAfter} className="gap-2">
              <Archive size={14} />
              {t("session.archiveThisAndAfter", { count: sessionConfig.archiveAfterCount })}
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {onEnvironment && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <Settings2 size={14} />
            {t("workspace.advanced")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={onEnvironment} className="gap-2">
              <Settings2 size={14} />
              {t("session.configureRunScripts")}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Copy size={14} />
          {t("session.copy")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={!readyToCopy} onClick={handleCopySessionInfo} className="gap-2">
            <Info size={14} />
            {t("session.sessionInfo")}
          </ContextMenuItem>
          <ContextMenuItem disabled={!readyToCopy || !hasRelatedFiles} onClick={handleCopyRelatedFiles} className="gap-2">
            <FolderInput size={14} />
            {t("session.relatedFilePaths")}
          </ContextMenuItem>
          <ContextMenuItem disabled={!readyToCopy} onClick={handleCopyTraceContext} className="gap-2">
            <ClipboardList size={14} />
            {t("session.traceContext")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {canCopySessionTitle && (
            <ContextMenuItem onClick={handleCopySessionTitle} className="gap-2">
              <MessageSquare size={14} />
              {t("session.sessionTitle")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={handleCopySessionId} className="gap-2">
            <Copy size={14} />
            Session ID
          </ContextMenuItem>
          {sessionConfig.projectPath && (
            <ContextMenuItem onClick={() => handleCopyResumeCommand(sessionConfig.projectPath!)} className="gap-2">
              <Terminal size={14} />
            {t("session.resumeCommand")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={handleCopyPath} className="gap-2">
            <FolderInput size={14} />
            {t("session.filePath")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextHandoffSubmenu targets={handoffTargets} onCopy={handleCopyHandoffPrompt} />
      {sessionConfig.onExport && (
        <ContextMenuItem onClick={sessionConfig.onExport} className="gap-2">
          <Download size={14} />
          Export
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <FolderOpen size={14} />
          {t("session.files")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={handleReveal} className="gap-2">
            <FolderOpen size={14} />
            {t("fileViewer.revealInFinder")}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleOpenInEditor} className="gap-2">
            <ExternalLinkIcon width={14} />
            {t("common.openInEditor")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {onClose && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onClose} className="gap-2">
            <Cross2Icon width={14} />
            {t("workspace.closePanel")}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

// DropdownMenu items
export function SessionDropdownMenuItems({
  projectId,
  sessionId,
  title,
  source,
  projectPath,
  originalChat,
  setOriginalChat,
  markdownPreview,
  setMarkdownPreview,
  onExport,
  onResume,
  onArchiveAllAfter,
  archiveAfterCount,
  isPinnedOverride,
  onTogglePinOverride,
  isArchivedOverride,
  onToggleArchiveOverride,
}: SessionMenuConfig) {
  const { t } = useI18n();
  const {
    handleReveal,
    handleOpenInEditor,
    handleCopyPath,
    handleCopySessionTitle,
    handleCopySessionId,
    handleCopyResumeCommand,
    handleCopyHandoffPrompt,
    canCopySessionTitle,
    handoffTargets,
    isArchived,
    toggleArchived,
    isPinned,
    togglePinned,
  } = useResolvedSessionMenuState({
    projectId,
    sessionId,
    title,
    source,
    isPinnedOverride,
    onTogglePinOverride,
    isArchivedOverride,
    onToggleArchiveOverride,
  });
  const {
    readyToCopy,
    hasRelatedFiles,
    handleCopySessionInfo,
    handleCopyRelatedFiles,
    handleCopyTraceContext,
  } = useSessionInfoActions({ projectId, sessionId, title, source, projectPath });

  return (
    <>
      <DropdownMenuItem onClick={togglePinned} className="gap-2">
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        {isPinned ? t("session.unpin") : t("session.pinToTop")}
      </DropdownMenuItem>
      {onResume && (
        <DropdownMenuItem onClick={onResume} className="gap-2">
          <ChatBubbleIcon className="w-3.5 h-3.5" />
          {t("session.resumeSession")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={toggleArchived} className="gap-2">
        {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {isArchived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
      </DropdownMenuItem>
      {onArchiveAllAfter && archiveAfterCount !== undefined && archiveAfterCount > 0 && (
        <DropdownMenuItem onClick={onArchiveAllAfter} className="gap-2">
          <Archive size={14} />
          {t("session.archiveThisAndAfter", { count: archiveAfterCount })}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Copy size={14} />
          {t("session.copy")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem disabled={!readyToCopy} onClick={handleCopySessionInfo} className="gap-2">
            <Info size={14} />
            {t("session.sessionInfo")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!readyToCopy || !hasRelatedFiles} onClick={handleCopyRelatedFiles} className="gap-2">
            <FolderInput size={14} />
            {t("session.relatedFilePaths")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!readyToCopy} onClick={handleCopyTraceContext} className="gap-2">
            <ClipboardList size={14} />
            {t("session.traceContext")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {canCopySessionTitle && (
            <DropdownMenuItem onClick={handleCopySessionTitle} className="gap-2">
              <MessageSquare size={14} />
              {t("session.sessionTitle")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleCopySessionId} className="gap-2">
            <Copy size={14} />
            Session ID
          </DropdownMenuItem>
          {projectPath && (
            <DropdownMenuItem onClick={() => handleCopyResumeCommand(projectPath)} className="gap-2">
              <Terminal size={14} />
            {t("session.resumeCommand")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleCopyPath} className="gap-2">
            <FolderInput size={14} />
            {t("session.filePath")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownHandoffSubmenu targets={handoffTargets} onCopy={handleCopyHandoffPrompt} />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <FolderOpen size={14} />
          {t("common.open")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={handleReveal} className="gap-2">
            <FolderOpen size={14} />
            {t("fileViewer.revealInFinder")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenInEditor} className="gap-2">
            <ExternalLinkIcon width={14} />
            {t("common.openInEditor")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {(setOriginalChat || setMarkdownPreview) && (
        <>
          <DropdownMenuSeparator />
          {setOriginalChat && (
            <DropdownMenuCheckboxItem checked={originalChat} onCheckedChange={setOriginalChat}>
              {t("session.readableSlashCommand")}
            </DropdownMenuCheckboxItem>
          )}
          {setMarkdownPreview && (
            <DropdownMenuCheckboxItem checked={markdownPreview} onCheckedChange={setMarkdownPreview}>
              {t("session.markdownPreview")}
            </DropdownMenuCheckboxItem>
          )}
        </>
      )}
      {onExport && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onExport} className="gap-2">
            <Download size={14} />
            {t("export.export")}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

// ContextMenu items
export function SessionContextMenuItems({
  projectId,
  sessionId,
  title,
  source,
  projectPath,
  originalChat,
  setOriginalChat,
  markdownPreview,
  setMarkdownPreview,
  onExport,
  onResume,
  onArchiveAllAfter,
  archiveAfterCount,
  isPinnedOverride,
  onTogglePinOverride,
  isArchivedOverride,
  onToggleArchiveOverride,
}: SessionMenuConfig) {
  const { t } = useI18n();
  const {
    handleReveal,
    handleOpenInEditor,
    handleCopyPath,
    handleCopySessionTitle,
    handleCopySessionId,
    handleCopyResumeCommand,
    handleCopyHandoffPrompt,
    canCopySessionTitle,
    handoffTargets,
    isArchived,
    toggleArchived,
    isPinned,
    togglePinned,
  } = useResolvedSessionMenuState({
    projectId,
    sessionId,
    title,
    source,
    isPinnedOverride,
    onTogglePinOverride,
    isArchivedOverride,
    onToggleArchiveOverride,
  });
  const {
    readyToCopy,
    hasRelatedFiles,
    handleCopySessionInfo,
    handleCopyRelatedFiles,
    handleCopyTraceContext,
  } = useSessionInfoActions({ projectId, sessionId, title, source, projectPath });

  return (
    <>
      <ContextMenuItem onClick={togglePinned} className="gap-2">
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        {isPinned ? t("session.unpin") : t("session.pinToTop")}
      </ContextMenuItem>
      {onResume && (
        <ContextMenuItem onClick={onResume} className="gap-2">
          <ChatBubbleIcon className="w-3.5 h-3.5" />
          {t("session.resumeSession")}
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={toggleArchived} className="gap-2">
        {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {isArchived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
      </ContextMenuItem>
      {onArchiveAllAfter && archiveAfterCount !== undefined && archiveAfterCount > 0 && (
        <ContextMenuItem onClick={onArchiveAllAfter} className="gap-2">
          <Archive size={14} />
          {t("session.archiveThisAndAfter", { count: archiveAfterCount })}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Copy size={14} />
          {t("session.copy")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={!readyToCopy} onClick={handleCopySessionInfo} className="gap-2">
            <Info size={14} />
            {t("session.sessionInfo")}
          </ContextMenuItem>
          <ContextMenuItem disabled={!readyToCopy || !hasRelatedFiles} onClick={handleCopyRelatedFiles} className="gap-2">
            <FolderInput size={14} />
            {t("session.relatedFilePaths")}
          </ContextMenuItem>
          <ContextMenuItem disabled={!readyToCopy} onClick={handleCopyTraceContext} className="gap-2">
            <ClipboardList size={14} />
            {t("session.traceContext")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {canCopySessionTitle && (
            <ContextMenuItem onClick={handleCopySessionTitle} className="gap-2">
              <MessageSquare size={14} />
              {t("session.sessionTitle")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={handleCopySessionId} className="gap-2">
            <Copy size={14} />
            Session ID
          </ContextMenuItem>
          {projectPath && (
            <ContextMenuItem onClick={() => handleCopyResumeCommand(projectPath)} className="gap-2">
              <Terminal size={14} />
            {t("session.resumeCommand")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={handleCopyPath} className="gap-2">
            <FolderInput size={14} />
            {t("session.filePath")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextHandoffSubmenu targets={handoffTargets} onCopy={handleCopyHandoffPrompt} />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <FolderOpen size={14} />
          {t("common.open")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={handleReveal} className="gap-2">
            <FolderOpen size={14} />
            {t("fileViewer.revealInFinder")}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleOpenInEditor} className="gap-2">
            <ExternalLinkIcon width={14} />
            {t("common.openInEditor")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {(setOriginalChat || setMarkdownPreview) && (
        <>
          <ContextMenuSeparator />
          {setOriginalChat && (
            <ContextMenuCheckboxItem checked={originalChat} onCheckedChange={setOriginalChat}>
              {t("session.readableSlashCommand")}
            </ContextMenuCheckboxItem>
          )}
          {setMarkdownPreview && (
            <ContextMenuCheckboxItem checked={markdownPreview} onCheckedChange={setMarkdownPreview}>
              {t("session.markdownPreview")}
            </ContextMenuCheckboxItem>
          )}
        </>
      )}
      {onExport && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onExport} className="gap-2">
            <Download size={14} />
            {t("export.export")}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}
