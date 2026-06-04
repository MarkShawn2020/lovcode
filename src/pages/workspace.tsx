import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { invoke } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAtomValue } from "jotai";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderInput,
  FolderOpen,
  Info,
  ListFilter,
  LocateFixed,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { AgentComposer } from "@/components/AgentComposer";
import { EnvironmentDialog, type EnvironmentRunKind } from "@/components/Environment/EnvironmentDialog";
import {
  EnvironmentTerminalDock,
  type EnvironmentTerminalSession,
} from "@/components/Environment/EnvironmentTerminalDock";
import { TerminalPane, disposeTerminal } from "@/components/Terminal";
import { SessionDetailHeader } from "@/components/shared/SessionDetailHeader";
import { ProjectPathMenuItems, type ProjectPathMenuVariant } from "@/components/shared/ProjectPathMenuItems";
import { SessionDetailContextMenuItems, SessionDetailDropdownMenuItems, type SessionDetailMenuConfig } from "@/components/shared/SessionMenuItems";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildAgentCommand, labelForProvider, makeSessionTitle, prefixCommandEnv, runtimeForProvider } from "@/lib/agent/commands";
import { readDevResumeState, writeWorkspaceDevResumeState } from "@/lib/appResume";
import type { EditorTargetId } from "@/lib/editorTargets";
import {
  buildEnvironmentCommand,
  getDefaultSessionEnvironmentKey,
  getCurrentEnvironmentPlatform,
  getEnvironmentScript,
  getProjectName as getEnvironmentProjectName,
  isDefaultSessionEnvironmentKey,
  normalizeEnvironmentKey,
} from "@/lib/agent/environment";
import { useInvokeQuery, usePtyStatus, useStreamedSessions } from "@/hooks";
import { useResize } from "@/hooks/useResize";
import { useI18n } from "@/i18n";
import { sidebarCollapsedAtom } from "@/store";
import {
  normalizeSessionDetailDisplayMode,
  SESSION_ACTIVITY_EVENT,
  SessionDetail,
  StandardMessageList,
  type SessionDetailDisplayMode,
  type SessionForkPayload,
} from "@/views/Chat/ProjectList";
import { ExportDialog } from "@/views/Chat/ExportDialog";
import { useReadableText } from "@/views/Chat/utils";
import type {
  AgentHistoryLinkStatus,
  AgentHarnessMessage,
  AgentLaunchMode,
  AgentProvider,
  AgentRuntime,
  AgentSession,
  AgentWorkspaceSidebarState,
  AgentWorkspaceState,
  EnvironmentAction,
  EnvironmentConfig,
  EnvironmentScope,
  Message,
  Project,
  Session,
  SessionRuntimeFork,
  WorkbenchConversationMeta,
} from "@/types";

type TranslateFn = ReturnType<typeof useI18n>["t"];

interface PtyDataEvent {
  id: string;
  data: number[];
}

interface PtyExitEvent {
  id: string;
}

type AgentHarnessEvent =
  | { kind: "started"; sessionId: string; provider: AgentProvider; command: string }
  | {
      kind: "json";
      sessionId: string;
      stream: "stdout" | "stderr";
      eventType?: string | null;
      itemId?: string | null;
      role?: string | null;
      text?: string | null;
      raw: unknown;
    }
  | { kind: "stdout"; sessionId: string; text: string }
  | { kind: "stderr"; sessionId: string; text: string }
  | { kind: "exit"; sessionId: string; code?: number | null; success: boolean }
  | { kind: "error"; sessionId: string; message: string };

interface AgentWorkspaceHookConfig {
  eventsDir: string;
  scriptPath: string;
}

interface AgentHookEvent {
  sessionId?: string;
  conversationId?: string;
  projectId?: string;
  event: "UserPromptSubmit" | "Stop" | "StopFailure" | string;
  timestamp?: number;
  provider?: AgentProvider | string;
}

interface SessionFileActivityRequest {
  projectId: string;
  sessionId: string;
}

interface SessionFileActivity {
  projectId: string;
  sessionId: string;
  modifiedAt: number;
  size: number;
}

interface EnvironmentDialogTarget {
  projectPath: string | null;
  sessionKey: string | null;
  sessionTitle: string | null;
}

const AGENT_OUTPUT_IDLE_MS = 3500;
const AGENT_SUBMIT_IDLE_FALLBACK_MS = 120000;
const AGENT_STALE_WORKING_MS = AGENT_SUBMIT_IDLE_FALLBACK_MS;
const WATCH_AGENT_RUNNING_MS = 45000;
const RUNTIME_HISTORY_LINK_GRACE_MS = 120000;
const LINK_DEBUG_HISTORY_LOOKBACK_MS = 60_000;
const LINK_DEBUG_RECENT_HISTORY_LIMIT = 10;
const HISTORY_LINK_NOT_FOUND_REASON = "complete history snapshot did not contain a matching transcript";
const SESSION_ACTIVITY_POLL_MS = 2500;
const SESSION_ACTIVITY_POLL_LIMIT = 600;
const SESSIONS_SIDEBAR_MIN_WIDTH = 300;
const SESSIONS_SIDEBAR_MAX_WIDTH = 560;
const DEFAULT_SESSIONS_SIDEBAR_WIDTH = 360;
const PROJECT_GROUP_INLINE_LIMIT = 8;
const MENU_ITEM_TOOLTIP_DELAY_MS = 650;
const LOVCODE_HOOK_ENV_RE = /^(?:LOVCODE_AGENT_SESSION_ID|LOVCODE_AGENT_HOOK_FILE)=(?:'[^']*'|"[^"]*"|\S+)\s*/;
const AGENT_WORKSPACE_STATE_UPDATED_EVENT = "agent-workspace-state-updated";
const HARNESS_STREAM_DEBUG = true;
type SessionListMode = "active" | "archived";
type WorkbenchOutlineMode = "project" | "day" | "recent";
type WorkbenchDisplayFilter = "all" | "running" | "review";
type WorkbenchSortMode = "last-modified" | "created" | "name";
type WorkbenchDisplayMode = SessionDetailDisplayMode;
type PersistedSidebarState = {
  sessionListMode: SessionListMode;
  outlineMode: WorkbenchOutlineMode;
  displayFilter: WorkbenchDisplayFilter;
  sortMode: WorkbenchSortMode;
  reorderGroups: boolean;
  mergeWorktrees: boolean;
  showProjectNewConversation: boolean;
  collapsedProjectPaths: string[];
  expandedProjectPaths: string[];
  sessionsSidebarWidth: number;
  activeConversationId: string | null;
};
type WorkbenchConversation = {
  id: string;
  conversationId: string;
  timestamp: number;
  createdAt: number;
  projectPath: string;
  archived: boolean;
  archivedAt?: number | null;
  pinned: boolean;
  unread: boolean;
  needsReview: boolean;
  agentRunning: boolean;
  agentRunningSource?: "runtime" | "hook" | "watch" | null;
  agentRunningAt?: number | null;
  displayMode: WorkbenchDisplayMode;
  meta?: WorkbenchConversationMeta;
  transcript?: Session;
  runtime?: AgentSession;
};
type DailyReportPlatform = "blog" | "wechat";
type WorkbenchDayProject = {
  key: string;
  path: string;
  rows: WorkbenchConversation[];
  lastActive: number;
  running: number;
  needsReview: number;
};
type WorkbenchDayGroup = {
  key: string;
  dayStart: number;
  rows: WorkbenchConversation[];
  lastActive: number;
  projects: WorkbenchDayProject[];
  projectCount: number;
  running: number;
  needsReview: number;
};
type DailyReportEvidence = {
  rowId: string;
  userPrompts: string[];
  assistantExcerpts: string[];
  loadFailed?: boolean;
};
type ExternalAgentRun = {
  source: "hook" | "watch";
  updatedAt: number;
  expiresAt?: number | null;
  provider?: AgentProvider | null;
};
type ProjectConversationStats = {
  active: number;
  archived: number;
  running: number;
  unread: number;
  needsReview: number;
  history: number;
  total: number;
  lastActive: number;
  createdAt: number;
};

const DAILY_REPORT_PLATFORMS: DailyReportPlatform[] = ["blog", "wechat"];
const DAILY_REPORT_EVIDENCE_BATCH_SIZE = 6;
const DAILY_REPORT_ASSISTANT_EXCERPT_LIMIT = 4;
const DAILY_REPORT_EXCERPT_LIMIT = 520;
const DAILY_REPORT_USER_PROMPT_LIMIT = 2200;

const harnessStreamReceiveCounts = new Map<string, number>();
const harnessStreamReceiveTotals = new Map<string, number>();

function getHarnessDebugTime() {
  return Number(performance.now().toFixed(1));
}

function getHarnessEventDebugType(event: AgentHarnessEvent) {
  return event.kind === "json" ? event.eventType ?? "json" : event.kind;
}

function getHarnessEventDebugTextLength(event: AgentHarnessEvent) {
  if (event.kind === "json") return event.text?.length ?? 0;
  if (event.kind === "stdout" || event.kind === "stderr") return event.text.length;
  if (event.kind === "error") return event.message.length;
  return 0;
}

function shouldLogHarnessStreamPoint(count: number, eventType: string) {
  return count <= 12 || count % 20 === 0 || /assistant|result|stop|exit|error|started/i.test(eventType);
}

function logHarnessStreamDebug(stage: string, payload: Record<string, unknown>) {
  if (!HARNESS_STREAM_DEBUG) return;
  console.log(`[DEBUG][HarnessStream] ${stage}`, { t: getHarnessDebugTime(), ...payload });
}

function logHarnessEventDebug(stage: string, event: AgentHarnessEvent) {
  if (!HARNESS_STREAM_DEBUG) return;
  const eventType = getHarnessEventDebugType(event);
  const key = `${event.sessionId}:${eventType}`;
  const count = (harnessStreamReceiveCounts.get(key) ?? 0) + 1;
  const textLength = getHarnessEventDebugTextLength(event);
  harnessStreamReceiveCounts.set(key, count);
  harnessStreamReceiveTotals.set(key, (harnessStreamReceiveTotals.get(key) ?? 0) + textLength);
  if (!shouldLogHarnessStreamPoint(count, eventType)) return;
  logHarnessStreamDebug(stage, {
    sessionId: event.sessionId,
    kind: event.kind,
    eventType,
    count,
    textLength,
    totalTextLength: harnessStreamReceiveTotals.get(key) ?? textLength,
  });
}

function getObjectField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function getStringField(record: Record<string, unknown>, ...keys: string[]) {
  const value = getObjectField(record, ...keys);
  return typeof value === "string" ? value : null;
}

function getOptionalStringField(record: Record<string, unknown>, ...keys: string[]) {
  const value = getObjectField(record, ...keys);
  return typeof value === "string" ? value : null;
}

function getOptionalNumberField(record: Record<string, unknown>, ...keys: string[]) {
  const value = getObjectField(record, ...keys);
  return typeof value === "number" ? value : null;
}

function getBooleanField(record: Record<string, unknown>, fallback: boolean, ...keys: string[]) {
  const value = getObjectField(record, ...keys);
  return typeof value === "boolean" ? value : fallback;
}

function normalizeHarnessProvider(value: unknown): AgentProvider {
  return value === "codex" ? "codex" : "claude";
}

function normalizeHarnessStream(value: unknown): "stdout" | "stderr" {
  return value === "stderr" ? "stderr" : "stdout";
}

function normalizeAgentHarnessEvent(value: unknown): AgentHarnessEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = getStringField(record, "kind");
  const sessionId = getStringField(record, "sessionId", "session_id");
  if (!kind || !sessionId) {
    logHarnessStreamDebug("drop-unrecognized-payload", {
      kind,
      hasSessionId: Boolean(sessionId),
      keys: Object.keys(record).slice(0, 12),
    });
    return null;
  }

  if (kind === "started") {
    return {
      kind,
      sessionId,
      provider: normalizeHarnessProvider(getObjectField(record, "provider")),
      command: getStringField(record, "command") ?? "",
    };
  }
  if (kind === "json") {
    return {
      kind,
      sessionId,
      stream: normalizeHarnessStream(getObjectField(record, "stream")),
      eventType: getOptionalStringField(record, "eventType", "event_type"),
      itemId: getOptionalStringField(record, "itemId", "item_id"),
      role: getOptionalStringField(record, "role"),
      text: getOptionalStringField(record, "text"),
      raw: getObjectField(record, "raw") ?? null,
    };
  }
  if (kind === "stdout" || kind === "stderr") {
    return {
      kind,
      sessionId,
      text: getStringField(record, "text") ?? "",
    };
  }
  if (kind === "exit") {
    return {
      kind,
      sessionId,
      code: getOptionalNumberField(record, "code"),
      success: getBooleanField(record, false, "success"),
    };
  }
  if (kind === "error") {
    return {
      kind,
      sessionId,
      message: getStringField(record, "message") ?? "Unknown harness error",
    };
  }

  logHarnessStreamDebug("drop-unknown-kind", { kind, sessionId });
  return null;
}
const AGENT_ICON_SRC: Partial<Record<AgentProvider, string>> = {
  claude: "/agent-icons/claude.png",
  codex: "/agent-icons/openai.png",
};

function getDefaultSidebarState(): PersistedSidebarState {
  return {
    sessionListMode: "active",
    outlineMode: "recent",
    displayFilter: "all",
    sortMode: "last-modified",
    reorderGroups: false,
    mergeWorktrees: true,
    showProjectNewConversation: false,
    collapsedProjectPaths: [],
    expandedProjectPaths: [],
    sessionsSidebarWidth: DEFAULT_SESSIONS_SIDEBAR_WIDTH,
    activeConversationId: null,
  };
}

const emptyWorkspace = (): AgentWorkspaceState => ({
  version: 5,
  sessions: [],
  conversationMeta: {},
  globalEnvironment: null,
  projectEnvironments: {},
  sessionEnvironments: {},
  sidebar: getDefaultSidebarState(),
  activeSessionId: null,
});

let cachedAgentWorkspaceState: AgentWorkspaceState | null = null;
let cachedAgentWorkspaceFilePath: string | null = null;
let cachedPlainChatWorkspacePath: string | null = null;
let cachedExternalAgentRuns: Record<string, ExternalAgentRun> = {};
let cachedSessionActivitySnapshot = new Map<string, Pick<SessionFileActivity, "modifiedAt" | "size">>();

function clampSessionsSidebarWidth(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SESSIONS_SIDEBAR_WIDTH;
  return Math.min(SESSIONS_SIDEBAR_MAX_WIDTH, Math.max(SESSIONS_SIDEBAR_MIN_WIDTH, numeric));
}

function normalizeSidebarState(sidebar?: AgentWorkspaceSidebarState | null): PersistedSidebarState {
  const persistedOutlineMode = sidebar?.outlineMode;
  const collapsedProjectPaths = Array.isArray(sidebar?.collapsedProjectPaths)
    ? [...new Set(sidebar.collapsedProjectPaths.map((path) => normalizeProjectPath(path)).filter(Boolean))]
    : [];
  const expandedProjectPaths = Array.isArray(sidebar?.expandedProjectPaths)
    ? [...new Set(sidebar.expandedProjectPaths.map((path) => normalizeProjectPath(path)).filter(Boolean))]
    : [];
  const displayFilter =
    sidebar?.displayFilter === "running" || sidebar?.displayFilter === "review"
      ? sidebar.displayFilter
      : "all";
  const sortMode =
    sidebar?.sortMode === "created" || sidebar?.sortMode === "name"
      ? sidebar.sortMode
      : "last-modified";
  const activeConversationId =
    typeof sidebar?.activeConversationId === "string" && sidebar.activeConversationId.trim()
      ? sidebar.activeConversationId
      : null;

  return {
    sessionListMode: sidebar?.sessionListMode === "archived" ? "archived" : "active",
    outlineMode: persistedOutlineMode === "project" || persistedOutlineMode === "day" ? persistedOutlineMode : "recent",
    displayFilter,
    sortMode,
    reorderGroups: sidebar?.reorderGroups === true,
    mergeWorktrees: sidebar?.mergeWorktrees === false ? false : true,
    showProjectNewConversation: sidebar?.showProjectNewConversation === true,
    collapsedProjectPaths,
    expandedProjectPaths,
    sessionsSidebarWidth: clampSessionsSidebarWidth(sidebar?.sessionsSidebarWidth),
    activeConversationId,
  };
}

function sidebarStatesEqual(a: PersistedSidebarState, b: PersistedSidebarState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function now() {
  return Date.now();
}

function pruneExternalAgentRuns(runs: Record<string, ExternalAgentRun>, timestamp = now()) {
  let changed = false;
  const next = { ...runs };
  Object.entries(next).forEach(([conversationId, run]) => {
    if (run.expiresAt && run.expiresAt <= timestamp) {
      delete next[conversationId];
      changed = true;
    }
  });
  return changed ? next : runs;
}

function getProjectName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function normalizeProjectPath(path?: string | null) {
  return path ? path.replace(/[/\\]+$/, "") : "";
}

function parseWorkbenchWorktreePath(path: string) {
  const normalized = normalizeProjectPath(path);
  const match = normalized.match(/^(.*?)[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)$/);
  if (!match?.[1]) return { origin: normalized, worktreeName: null };
  return { origin: match[1], worktreeName: match[2] };
}

function getProjectGroupPath(path: string, mergeWorktrees: boolean) {
  if (!mergeWorktrees) return normalizeProjectPath(path);
  return normalizeProjectPath(parseWorkbenchWorktreePath(path).origin);
}

function getProjectGroupKey(path: string | null | undefined, mergeWorktrees: boolean) {
  return path ? normalizeProjectPath(getProjectGroupPath(path, mergeWorktrees)) : "";
}

function getHistorySessionTitle(session: Session, fallback = "Untitled conversation") {
  return session.title || session.summary || session.last_prompt || fallback || "Untitled conversation";
}

function getHistoryConversationId(session: Session) {
  return `history:${session.project_id}:${session.id}`;
}

function getRuntimeConversationId(session: AgentSession, transcript?: Session) {
  return transcript ? getHistoryConversationId(transcript) : `runtime:${session.id}`;
}

function normalizeDisplayMode(mode?: string | null): WorkbenchDisplayMode | null {
  return normalizeSessionDetailDisplayMode(mode);
}

function getStoredDisplayMode(meta: WorkbenchConversationMeta | undefined, runtime?: AgentSession | null): WorkbenchDisplayMode {
  return normalizeDisplayMode(meta?.displayMode) ?? (runtime ? (isHarnessSession(runtime) ? "standard" : "cli") : "standard");
}

function getConversationDisplayMode(row: Pick<WorkbenchConversation, "displayMode" | "runtime">): WorkbenchDisplayMode {
  return row.displayMode ?? (row.runtime ? (isHarnessSession(row.runtime) ? "standard" : "cli") : "standard");
}

function getConversationTitle(row: WorkbenchConversation, labels?: { untitledConversation?: string; shell?: string; newSession?: string }) {
  return row.transcript
    ? getHistorySessionTitle(row.transcript, labels?.untitledConversation)
    : row.runtime
      ? getSessionDisplayTitle(row.runtime, labels)
      : labels?.untitledConversation ?? "Untitled conversation";
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function providerForTranscript(session?: Session): AgentProvider | null {
  if (!session) return null;
  if (session.source === "codex") return "codex";
  if (session.source === "cli" || session.source === "app-code" || session.source === "app-web" || session.source === "app-cowork") {
    return "claude";
  }
  return null;
}

function canResumeTranscriptLocally(session: Session) {
  return Boolean(
    session.project_path &&
      (session.source === "cli" || session.source === "app-code" || session.source === "codex"),
  );
}

function formatRelativeTime(timestamp?: number | null, t?: TranslateFn) {
  if (!timestamp) return t ? t("common.noActivity") : "No activity";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 10) return t ? t("relative.justNow") : "now";
  if (diffSeconds < 60) return t ? t("relative.secondsAgo", { count: diffSeconds }) : `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return t ? t("relative.minutesAgo", { count: diffMinutes }) : `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return t ? t("relative.hoursAgo", { count: diffHours }) : `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return t ? t("relative.daysAgo", { count: diffDays }) : `${diffDays}d ago`;
}

function formatDateTime(timestamp?: number | null, t?: TranslateFn) {
  if (!timestamp) return t ? t("common.noActivity") : "No activity";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function getLocalDayStart(timestamp?: number | null) {
  if (!timestamp) return 0;
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDayGroupLabel(dayStart: number, t: TranslateFn) {
  if (!dayStart) return t("common.noActivity");
  const today = getLocalDayStart(Date.now());
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.getTime();
  if (dayStart === today) return t("workspace.today");
  if (dayStart === yesterday) return t("workspace.yesterday");

  const date = new Date(dayStart);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  if (!sameYear) options.year = "numeric";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatLocalDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatChineseReportDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(timestamp));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function normalizeAgentEventTimestamp(timestamp?: number) {
  if (!timestamp) return undefined;
  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
}

function formatCost(value: number) {
  if (!value) return "$0";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function getDailyReportPlatformLabel(platform: DailyReportPlatform, t: TranslateFn) {
  return platform === "blog" ? t("workspace.shougongchuanBlog") : t("workspace.wechatArticle");
}

function getDailyReportPlatformName(platform: DailyReportPlatform) {
  return platform === "blog" ? "手工川官网博客" : "公众号文章";
}

function getDailyReportTotals(day: WorkbenchDayGroup) {
  return day.rows.reduce(
    (totals, row) => ({
      rounds: totals.rounds + (row.transcript?.rounds ?? 0),
      messages: totals.messages + (row.transcript?.message_count ?? 0),
      runtime: totals.runtime + (row.runtime ? 1 : 0),
      history: totals.history + (row.transcript ? 1 : 0),
    }),
    { rounds: 0, messages: 0, runtime: 0, history: 0 },
  );
}

function getDailyReportStatus(row: WorkbenchConversation) {
  if (isConversationAgentRunning(row)) return "运行中";
  if (row.needsReview) return "待检查";
  if (row.archived) return "已归档";
  return row.runtime ? "运行时已记录" : "历史已沉淀";
}

function normalizeDailyReportText(value?: string | null, limit = DAILY_REPORT_EXCERPT_LIMIT) {
  if (!value) return "";
  const text = value
    .replace(/```[\s\S]*?```/g, "[代码片段]")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function normalizeDailyReportPromptText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateDailyReportPromptMiddle(value?: string | null, limit = DAILY_REPORT_USER_PROMPT_LIMIT) {
  const text = normalizeDailyReportPromptText(value);
  if (text.length <= limit) return text;
  const placeholderMarker = "\n...[中间省略]...\n";
  const edgeLength = Math.max(240, Math.floor((limit - placeholderMarker.length) / 2));
  const marker = `\n...[中间省略 ${Math.max(0, text.length - edgeLength * 2)} 字]...\n`;
  return `${text.slice(0, edgeLength).trimEnd()}${marker}${text.slice(-edgeLength).trimStart()}`;
}

function getDailyReportMessageText(message: Message) {
  if (message.content_blocks?.length) {
    return message.content_blocks
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "tool_use") return `[工具调用：${block.name}${block.summary ? `，${block.summary}` : ""}]`;
        if (block.type === "tool_result") return block.content;
        if (block.type === "thinking") return "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return message.content;
}

function getDailyReportEvidenceFromMessages(messages: Message[]) {
  const readableMessages = messages.filter((message) => !message.is_meta && !message.is_tool);
  const userPrompts = readableMessages
    .filter((message) => message.role === "user")
    .map((message) => truncateDailyReportPromptMiddle(getDailyReportMessageText(message)))
    .filter((text): text is string => Boolean(text));
  const assistantExcerpts = readableMessages
    .filter((message) => message.role === "assistant")
    .map((message) => normalizeDailyReportText(getDailyReportMessageText(message)))
    .filter((text): text is string => Boolean(text))
    .slice(-DAILY_REPORT_ASSISTANT_EXCERPT_LIMIT);

  return { userPrompts, assistantExcerpts };
}

function getDailyReportEvidenceCacheKey(day: WorkbenchDayGroup) {
  const signatures = day.rows.map((row) =>
    row.transcript
      ? [
          row.transcript.project_id,
          row.transcript.id,
          row.transcript.last_modified,
          row.transcript.message_count,
        ].join(":")
      : row.id,
  );
  return `${day.dayStart}:${signatures.join("|")}`;
}

function getDailyReportHeadline(day: WorkbenchDayGroup, getProjectLabel: (path: string) => string) {
  const firstProject = day.projects[0] ? getProjectLabel(day.projects[0].path) : "产品工作台";
  if (day.projectCount > 1) return `${firstProject} 等 ${day.projectCount} 个项目同步推进`;
  if (day.rows.length > 1) return `${firstProject} 连续推进 ${day.rows.length} 项工作`;
  return `${firstProject} 的关键进展完成记录`;
}

function buildDailyReportPrompt(
  day: WorkbenchDayGroup,
  platform: DailyReportPlatform,
  getProjectLabel: (path: string) => string,
  evidence: DailyReportEvidence[] = [],
) {
  const dateLabel = formatChineseReportDate(day.dayStart);
  const isoDate = formatLocalDateKey(day.dayStart);
  const totals = getDailyReportTotals(day);
  const headline = getDailyReportHeadline(day, getProjectLabel);
  const evidenceByRowId = new Map(evidence.map((item) => [item.rowId, item]));
  const platformName = getDailyReportPlatformName(platform);
  const titleRule = platform === "wechat"
    ? `公众号标题必须是「你生成的吸引人精选标题 | 手工川工作室产品日报（${dateLabel}）」；竖线后的固定后缀不能改。`
    : `官网博客标题建议使用「手工川工作室产品日报：${dateLabel}」，可以另给一个更适合博客列表页的副标题。`;
  const styleRule = platform === "wechat"
    ? "公众号文章要有打开率意识，开头先抛出今天对用户有价值的变化，再展开产品判断；语言可以更有节奏，但不要夸张营销。"
    : "官网博客要克制、可信、结构清晰，适合长期归档；语言偏产品日志和工作室公开记录。";
  const projectSections = day.projects.map((project, index) => {
    const projectName = getProjectLabel(project.path);
    const status = [
      `${project.rows.length} 条对话`,
      project.running ? `${project.running} 条运行中` : null,
      project.needsReview ? `${project.needsReview} 条待检查` : null,
    ].filter(Boolean);
    const rows = project.rows.map((row) => {
      const transcript = row.transcript;
      const rowEvidence = evidenceByRowId.get(row.id);
      const title = getConversationTitle(row, {
        untitledConversation: "未命名对话",
        shell: "Shell",
        newSession: "新对话",
      });
      const lines = [
        `  - 对话：${normalizeDailyReportText(title, 160)}`,
        `    状态：${getDailyReportStatus(row)}`,
      ];
      if (transcript) {
        lines.push(`    轮次：${transcript.rounds ?? 0}`);
        lines.push(`    消息：${transcript.message_count ?? 0}`);
      }
      if (transcript?.summary) lines.push(`    摘要：${normalizeDailyReportText(transcript.summary, 360)}`);

      if (rowEvidence?.loadFailed) {
        lines.push("    用户 prompts：读取失败，仅使用标题和摘要判断。");
      } else if (rowEvidence?.userPrompts.length) {
        lines.push("    用户 prompts（逐条完整录入，单条过长时省略中间）：");
        rowEvidence.userPrompts.forEach((prompt, promptIndex) => {
          const promptLines = prompt.split("\n");
          lines.push(`      ${promptIndex + 1}. ${promptLines[0] ?? ""}`);
          promptLines.slice(1).forEach((line) => lines.push(`         ${line}`));
        });
      } else if (transcript?.last_prompt) {
        lines.push("    用户 prompts（摘要回退，可能只有最近一条）：");
        lines.push(`      1. ${truncateDailyReportPromptMiddle(transcript.last_prompt)}`);
      }

      if (rowEvidence?.assistantExcerpts.length) {
        lines.push("    AI 输出摘录（最近几条，仅供判断结果，不要照抄）：");
        rowEvidence.assistantExcerpts.forEach((excerpt) => lines.push(`      - ${excerpt}`));
      }

      return lines.join("\n");
    });
    return [`${index + 1}. ${projectName}（${status.join("，")}）`, ...rows].join("\n");
  })
    .join("\n\n");

  return [
    "你是手工川工作室的产品作者。请基于下面的 AI 工作记录，写一篇真正面向用户的产品日报文章。",
    "",
    "写作目标：",
    `- 平台：${platformName}`,
    `- 日期：${dateLabel}（${isoDate}）`,
    `- 标题规则：${titleRule}`,
    `- 平台风格：${styleRule}`,
    "- 读者不是内部执行人员，而是关心产品能解决什么问题、体验如何变化、接下来能期待什么的用户。",
    "- 文章要先提炼“今天对用户真正有意义的变化”，再解释背后的产品推进。",
    "- 不要机械复述每条会话、轮次、消息数；这些数据只能作为判断素材，不能成为正文主体。",
    "- 素材里的“用户 prompts”是当天用户真实需求，请优先从这些 prompt 中提炼用户视角、问题场景和价值变化。",
    "- 可以合并相似项目，抽象成 2-4 个用户价值主题，例如：体验改善、内容生产效率、发布质量、基础能力沉淀。",
    "- 如果素材不足以确认具体事实，要用克制表达，避免编造上线、收入、客户、性能数据。",
    "- 输出 Markdown 正文即可，不要解释你的写作过程。",
    "",
    "建议结构：",
    "- 标题",
    "- 开头 1-2 段：从用户视角说明今天最值得注意的产品变化",
    "- 今日进展：按用户价值主题组织，不按项目流水账组织",
    "- 对用户意味着什么：明确读者能感受到的改善",
    "- 接下来：只写自然、可信的后续关注",
    "",
    "当天工作概况（仅供判断权重，不要照抄）：",
    `- 初步主题：${headline}`,
    `- 项目数：${day.projectCount}`,
    `- 工作对话：${day.rows.length}`,
    `- 用户轮次：${totals.rounds}`,
    `- 消息数：${totals.messages}`,
    `- 运行中：${day.running}`,
    `- 待检查：${day.needsReview}`,
    "",
    "素材：",
    projectSections || "- 暂无可汇总项目。",
  ].join("\n");
}

function runtimeForLaunch(provider: AgentProvider, launchMode: AgentLaunchMode): AgentRuntime {
  if (provider === "terminal") return "terminal-pty";
  if (launchMode === "standard") return provider === "claude" ? "claude-cli-json" : "codex-cli-json";
  return runtimeForProvider(provider);
}

function isHarnessRuntime(runtime?: string | null) {
  return runtime === "claude-cli-json" || runtime === "codex-cli-json";
}

function isHarnessSession(session?: AgentSession | null) {
  return Boolean(session && isAgentProvider(session.provider) && isHarnessRuntime(session.runtime));
}

function getSessionCommand(provider: AgentProvider, prompt: string, env?: Record<string, string>, resumeSessionId?: string) {
  if (provider === "terminal") return undefined;
  const extraArgs = resumeSessionId
    ? provider === "claude"
      ? `--resume ${resumeSessionId}`
      : `resume ${resumeSessionId}`
    : undefined;
  return buildAgentCommand(provider, prompt, extraArgs, env);
}

function getInitialInput(provider: AgentProvider, prompt: string) {
  if (provider !== "terminal") return undefined;
  return prompt.trim() ? prompt.trim() : undefined;
}

function getHarnessDisplayCommand(provider: AgentProvider, prompt: string, resumeSessionId?: string) {
  if (!isAgentProvider(provider)) return null;
  if (provider === "claude") {
    const resume = resumeSessionId ? ` --resume ${resumeSessionId}` : "";
    return `claude --output-format stream-json --verbose -p ${prompt ? "\"...\"" : "\"\""} --include-partial-messages${resume}`.trim();
  }
  const resume = resumeSessionId ? ` resume ${resumeSessionId}` : "";
  return `codex exec --json${resume} ${prompt ? "\"...\"" : ""}`.trim();
}

function isAgentProvider(provider: AgentProvider) {
  return provider === "claude" || provider === "codex";
}

function usesAgentHooks(provider: AgentProvider) {
  return provider === "claude" || provider === "codex";
}

function isAgentRunning(session: AgentSession) {
  if (!isAgentProvider(session.provider)) return false;
  if (session.workState) {
    const lastActivity = Math.max(session.lastActivityAt ?? 0, session.updatedAt ?? 0, session.createdAt ?? 0);
    return session.workState === "working" && now() - lastActivity < AGENT_STALE_WORKING_MS;
  }
  return session.status === "running";
}

function isConversationAgentRunning(row: WorkbenchConversation) {
  return row.agentRunning || Boolean(row.runtime && isAgentRunning(row.runtime));
}

function hasAgentPrompt(provider: AgentProvider, prompt: string) {
  return isAgentProvider(provider) && prompt.trim().length > 0;
}

function hasReusableAgentPrompt(session: AgentSession) {
  if (isHarnessSession(session)) return Boolean(getSessionSubmittedPrompt(session));
  const command = stripLovcodeHookEnvPrefix(session.command?.trim() ?? "");
  return isAgentProvider(session.provider) && Boolean(command) && command !== session.provider;
}

function getSessionDisplayTitle(session: AgentSession, labels?: { shell?: string; newSession?: string }) {
  const providerLabel = labelForProvider(session.provider);
  const trimmed = session.title.trim();
  const prefixedTitle = `${providerLabel}: `;
  if (trimmed.startsWith(prefixedTitle)) return trimmed.slice(prefixedTitle.length).trim() || providerLabel;
  return trimmed || (session.provider === "terminal" ? labels?.shell ?? "Shell" : labels?.newSession ?? "New session");
}

function stripLovcodeHookEnvPrefix(command: string) {
  let rest = command.trimStart();
  let next = rest.replace(LOVCODE_HOOK_ENV_RE, "");
  while (next !== rest) {
    rest = next.trimStart();
    next = rest.replace(LOVCODE_HOOK_ENV_RE, "");
  }
  return rest;
}

function unescapeDoubleQuotedShellArg(value: string) {
  return value.replace(/\\(["\\$`])/g, "$1");
}

function extractSubmittedPromptFromCommand(session: AgentSession) {
  if (!isAgentProvider(session.provider)) return null;
  const command = stripLovcodeHookEnvPrefix(session.command?.trim() ?? "");
  const match = command.match(/"((?:\\.|[^"\\])*)"\s*$/);
  return match ? unescapeDoubleQuotedShellArg(match[1]).trim() || null : null;
}

function getSessionSubmittedPrompt(session: AgentSession) {
  const prompt = session.submittedPrompt ?? session.initialInput ?? extractSubmittedPromptFromCommand(session);
  return prompt?.trim() || null;
}

function transcriptMatchesProvider(session: AgentSession, transcript: Session) {
  if (session.provider === "codex") return transcript.source === "codex";
  if (session.provider === "claude") return transcript.source !== "codex";
  return false;
}

function normalizePromptForHistoryLink(prompt?: string | null) {
  return prompt?.trim().replace(/\s+/g, " ") ?? "";
}

function promptsLikelyMatch(runtimePrompt: string, transcriptPrompt?: string | null) {
  const runtime = normalizePromptForHistoryLink(runtimePrompt);
  const transcript = normalizePromptForHistoryLink(transcriptPrompt);
  if (!runtime || !transcript) return false;
  if (runtime === transcript) return true;
  if (Math.min(runtime.length, transcript.length) < 200) return false;
  return runtime.slice(0, 200) === transcript.slice(0, 200) && runtime.slice(-200) === transcript.slice(-200);
}

function findLikelyTranscriptForRuntimeSession(
  session: AgentSession,
  transcripts: Session[],
  claimedTranscriptIds: Set<string>,
) {
  if (!isAgentProvider(session.provider)) return undefined;
  const prompt = getSessionSubmittedPrompt(session);
  if (!prompt) return undefined;
  const cwd = normalizeProjectPath(session.cwd);
  const runtimeStart = session.createdAt - 60_000;
  return transcripts
    .filter((transcript) => {
      if (claimedTranscriptIds.has(transcript.id)) return false;
      if (!transcriptMatchesProvider(session, transcript)) return false;
      if (normalizeProjectPath(transcript.project_path) !== cwd) return false;
      if (!promptsLikelyMatch(prompt, transcript.last_prompt)) return false;
      const createdAt = transcript.created_at * 1000;
      const lastModified = transcript.last_modified * 1000;
      return createdAt >= runtimeStart || lastModified >= runtimeStart;
    })
    .sort((a, b) => b.last_modified - a.last_modified)
    [0];
}

function normalizeHistoryLinkStatus(status?: string | null): AgentHistoryLinkStatus | null {
  return status === "pending" || status === "linked" || status === "not-found" ? status : null;
}

function canRetryNotFoundHistoryLink(session: AgentSession) {
  return normalizeHistoryLinkStatus(session.historyLinkStatus) === "not-found" && isHarnessSession(session);
}

function shouldAttemptHistoryLink(session: AgentSession) {
  if (session.linkedHistorySessionId) return false;
  if (!isAgentProvider(session.provider)) return false;
  if (!getSessionSubmittedPrompt(session)) return false;
  const status = normalizeHistoryLinkStatus(session.historyLinkStatus);
  return status !== "not-found" || canRetryNotFoundHistoryLink(session);
}

function isPastHistoryLinkGrace(session: AgentSession, timestamp: number) {
  const lastKnownActivity = Math.max(session.createdAt, session.updatedAt, session.lastActivityAt ?? 0);
  return timestamp - lastKnownActivity >= RUNTIME_HISTORY_LINK_GRACE_MS;
}

function shouldMarkHistoryLinkNotFound(session: AgentSession, timestamp: number) {
  return !isAgentRunning(session) && isPastHistoryLinkGrace(session, timestamp);
}

function getRuntimeLinkDebugSignature(sessions: AgentSession[], recentHistory: Session[]) {
  return JSON.stringify({
    runtime: sessions.map((session) => ({
      id: session.id,
      provider: session.provider,
      cwd: normalizeProjectPath(session.cwd),
      prompt: getSessionSubmittedPrompt(session)?.slice(0, 160),
      status: session.status,
      updatedAt: session.updatedAt,
    })),
    history: recentHistory.map((session) => ({
      id: session.id,
      projectId: session.project_id,
      source: session.source,
      lastModified: session.last_modified,
      lastPrompt: session.last_prompt?.slice(0, 160),
    })),
  });
}

function createHarnessUserMessage(sessionId: string, prompt: string, timestamp: number): AgentHarnessMessage {
  return {
    id: `${sessionId}:user`,
    role: "user",
    content: prompt.trim(),
    timestamp,
  };
}

function createHarnessAssistantPlaceholderMessage(sessionId: string, timestamp: number): AgentHarnessMessage {
  return {
    id: `${sessionId}:assistant:live`,
    role: "assistant",
    content: "",
    timestamp,
    kind: "typing",
    transient: true,
  };
}

function mergeHarnessText(current: string, nextText: string, separator = "\n") {
  const next = nextText.replace(/\r/g, "");
  if (!next) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  return `${current}${current.endsWith("\n") || next.startsWith("\n") ? "" : separator}${next}`;
}

function inferHarnessRole(event: AgentHarnessEvent): AgentHarnessMessage["role"] {
  if (event.kind === "stderr" || event.kind === "error") return "error";
  if (event.kind !== "json") return "assistant";
  if (event.stream === "stderr") return "error";
  if (event.role === "assistant") return "assistant";
  if (event.role === "user") return "user";
  const eventType = event.eventType?.toLowerCase() ?? "";
  if (eventType.includes("tool") || eventType.includes("exec") || eventType.includes("patch")) return "tool";
  if (eventType.includes("error") || eventType.includes("failed")) return "error";
  if (event.text) return "assistant";
  return "system";
}

function getHarnessJsonEventType(event: AgentHarnessEvent) {
  return event.kind === "json" ? event.eventType?.toLowerCase() ?? "" : "";
}

function isHarnessCompletionEvent(event: AgentHarnessEvent) {
  const eventType = getHarnessJsonEventType(event);
  return (
    eventType === "result" ||
    eventType === "turn.completed" ||
    eventType === "turn_completed" ||
    eventType === "task_complete" ||
    eventType === "task.completed" ||
    eventType === "agent-turn-complete" ||
    eventType === "message_stop"
  );
}

function isHarnessFailureEvent(event: AgentHarnessEvent) {
  const eventType = getHarnessJsonEventType(event);
  return eventType === "error" || eventType === "turn.failed" || eventType === "turn_failed" || eventType.endsWith(".failed");
}

function upsertHarnessMessage(
  messages: AgentHarnessMessage[],
  message: AgentHarnessMessage,
  options?: { append?: boolean; merge?: boolean; removeTransient?: boolean; separator?: string },
) {
  const base = options?.removeTransient ? messages.filter((item) => !item.transient) : messages;
  const index = base.findIndex((item) => item.id === message.id);
  if (index === -1) return [...base, message];
  const next = [...base];
  const content = options?.append
    ? `${next[index].content}${message.content}`
    : options?.merge
      ? mergeHarnessText(next[index].content, message.content, options.separator)
      : message.content;
  next[index] = {
    ...next[index],
    ...message,
    content,
    raw: message.raw ?? next[index].raw,
    transient: message.transient ?? next[index].transient,
  };
  return next;
}

function appendHarnessMessage(messages: AgentHarnessMessage[], message: AgentHarnessMessage) {
  return [...messages.filter((item) => !item.transient), message];
}

function harnessMessageToStandardMessage(message: AgentHarnessMessage, index: number, streaming = false): Message {
  return {
    uuid: message.id,
    role: message.role === "tool" ? "assistant" : message.role,
    content: message.content,
    timestamp: new Date(message.timestamp).toISOString(),
    is_meta: false,
    is_tool: message.role === "tool",
    line_number: index + 1,
    is_streaming: streaming && message.role === "assistant" && message.id.includes(":assistant:"),
    streaming_mode: streaming && message.role === "assistant" && message.id.includes(":assistant:") ? "live" : undefined,
  };
}

function applyHarnessEventToSession(
  session: AgentSession,
  event: AgentHarnessEvent,
  activeSessionId: string | null | undefined,
): AgentSession {
  const timestamp = now();
  const isActive = session.id === activeSessionId;
  const existing = session.harnessMessages ?? [];

  if (event.kind === "started") {
    return {
      ...session,
      command: event.command,
      status: "running",
      workState: "working",
      unread: false,
      lastActivityAt: timestamp,
      lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
      updatedAt: timestamp,
      harnessMessages: existing,
    };
  }

  if (event.kind === "exit") {
    if (session.status === "completed" && session.workState === "stopped") {
      return {
        ...session,
        harnessExitCode: event.code ?? session.harnessExitCode ?? null,
        updatedAt: timestamp,
        harnessMessages: existing.filter((message) => !message.transient),
      };
    }
    return {
      ...session,
      status: event.success ? "completed" : "error",
      workState: "stopped",
      unread: isActive ? false : true,
      lastActivityAt: timestamp,
      lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
      updatedAt: timestamp,
      harnessExitCode: event.code ?? null,
      harnessMessages: event.success
        ? existing.filter((message) => !message.transient)
        : appendHarnessMessage(existing, {
            id: `${session.id}:exit:${timestamp}`,
            role: "error",
            content: `Agent exited with code ${event.code ?? "unknown"}.`,
            timestamp,
            kind: "exit",
          }),
    };
  }

  if (event.kind === "error") {
    return {
      ...session,
      status: "error",
      workState: "stopped",
      unread: isActive ? false : true,
      lastActivityAt: timestamp,
      lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
      updatedAt: timestamp,
      harnessMessages: appendHarnessMessage(existing, {
        id: `${session.id}:error:${timestamp}`,
        role: "error",
        content: event.message,
        timestamp,
        kind: "error",
      }),
    };
  }

  const role = inferHarnessRole(event);
  const content =
    event.kind === "json"
      ? event.text ?? ""
      : event.kind === "stdout" || event.kind === "stderr"
        ? event.text
        : "";
  const eventType = getHarnessJsonEventType(event);
  const turnComplete = isHarnessCompletionEvent(event);
  const turnFailed = isHarnessFailureEvent(event);
  if (!content.trim()) {
    if (turnComplete || turnFailed) {
      return {
        ...session,
        status: turnFailed ? "error" : "completed",
        workState: "stopped",
        unread: isActive ? false : true,
        lastActivityAt: timestamp,
        lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
        updatedAt: timestamp,
        harnessMessages: existing.filter((message) => !message.transient),
      };
    }
    return session;
  }

  const append = role === "assistant" && event.kind === "json" && eventType.includes("delta");
  const merge = role === "assistant" && !append && (event.kind !== "json" || eventType.includes("partial"));
  const mergeSeparator = event.kind === "json" && eventType.includes("partial") ? "" : "\n";
  const messageId =
    role === "assistant"
      ? `${session.id}:assistant:live`
      : `${session.id}:${role}:${event.kind === "json" && event.itemId ? event.itemId : timestamp}`;
  const previousContentLength = existing.find((message) => message.id === messageId)?.content.length ?? 0;
  const nextHarnessMessages = upsertHarnessMessage(
    existing,
    {
      id: messageId,
      role,
      content,
      timestamp,
      kind: event.kind === "json" ? event.eventType ?? "json" : event.kind,
      stream: event.kind === "json" ? event.stream : event.kind === "stdout" || event.kind === "stderr" ? event.kind : null,
      raw: event.kind === "json" ? event.raw : undefined,
    },
    { append, merge, removeTransient: true, separator: mergeSeparator },
  );
  const nextContentLength = nextHarnessMessages.find((message) => message.id === messageId)?.content.length ?? content.length;
  if (role === "assistant" && (append || merge || eventType.includes("assistant") || eventType.includes("result"))) {
    logHarnessStreamDebug("state-update", {
      sessionId: session.id,
      eventType: eventType || event.kind,
      messageId,
      append,
      merge,
      deltaLength: content.length,
      previousContentLength,
      nextContentLength,
      active: isActive,
    });
  }
  const shouldKeepStopped = !turnComplete && !turnFailed && session.workState === "stopped";
  return {
    ...session,
    status: turnFailed ? "error" : turnComplete ? "completed" : shouldKeepStopped ? session.status : "running",
    workState: turnComplete || turnFailed || shouldKeepStopped ? "stopped" : "working",
    unread: !isActive,
    lastActivityAt: timestamp,
    lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
    updatedAt: timestamp,
    harnessMessages: nextHarnessMessages,
  };
}

function logLinkDebug(label: string, payload: unknown) {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = String(payload);
  }
  console.log(`[link-debug] ${label}: ${serialized}`);
}

export default function AgentWorkspacePage() {
  const { activeLanguage, t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const routeSessionListMode: SessionListMode = searchParams.get("view") === "archived" ? "archived" : "active";
  const routeHasSessionListMode = searchParams.has("view");
  const routeProjectId = searchParams.get("projectId");
  const routeProjectPath = searchParams.get("projectPath");
  const routeSessionId = searchParams.get("sessionId");
  const routeTargetMessageId = searchParams.get("messageId");
  const routeTargetLineNumber = (() => {
    const raw = searchParams.get("lineNumber");
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  })();
  const routeTargetRoundIndex = (() => {
    const raw = searchParams.get("roundIndex");
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  })();
  const routeSearchHighlight = searchParams.get("q") ?? undefined;
  const routeSelectionKey = routeSessionId ? `${routeProjectId ?? ""}:${routeSessionId}` : null;
  const { data: projects = [] } = useInvokeQuery<Project[]>(["projects"], "list_projects");
  const {
    sessions: streamedHistorySessions,
    initialLoading: loadingHistorySessions,
    streaming: historyStreaming,
    hasCompleteSnapshot: historySessionsComplete,
  } = useStreamedSessions();
  const hasCachedWorkspaceState = Boolean(cachedAgentWorkspaceState);
  const cachedInitialSidebar = normalizeSidebarState({
    ...(cachedAgentWorkspaceState?.sidebar ?? {}),
    sessionListMode: routeSessionListMode,
  });
  const cachedInitialWorkspaceState: AgentWorkspaceState = cachedAgentWorkspaceState
    ? {
        ...emptyWorkspace(),
        ...cachedAgentWorkspaceState,
        conversationMeta: cachedAgentWorkspaceState.conversationMeta ?? {},
        globalEnvironment: cachedAgentWorkspaceState.globalEnvironment ?? null,
        projectEnvironments: cachedAgentWorkspaceState.projectEnvironments ?? {},
        sessionEnvironments: cachedAgentWorkspaceState.sessionEnvironments ?? {},
        sidebar: cachedInitialSidebar,
      }
    : emptyWorkspace();
  const cachedActiveSession =
    cachedInitialWorkspaceState.sessions.find((session) => session.id === cachedInitialWorkspaceState.activeSessionId && !session.archived) ??
    cachedInitialWorkspaceState.sessions.find((session) => !session.archived) ??
    cachedInitialWorkspaceState.sessions[0];
  const [workspacePath, setWorkspacePath] = useState<string | null>(cachedAgentWorkspaceFilePath);
  const [plainChatWorkspacePath, setPlainChatWorkspacePath] = useState<string | null>(cachedPlainChatWorkspacePath);
  const [state, setState] = useState<AgentWorkspaceState>(() => cachedInitialWorkspaceState);
  const [selectedHistorySession, setSelectedHistorySession] = useState<Session | null>(null);
  const [pendingRuntimeForkSessions, setPendingRuntimeForkSessions] = useState<Record<string, Session>>({});
  const [selectedCwd, setSelectedCwd] = useState<string | null>(cachedActiveSession?.cwd ?? cachedInitialWorkspaceState.sessions[0]?.cwd ?? null);
  const [loaded, setLoaded] = useState(hasCachedWorkspaceState);
  const [saving, setSaving] = useState(false);
  const [launchingIds, setLaunchingIds] = useState<Set<string>>(() => new Set());
  const [attachedPtyIds, setAttachedPtyIds] = useState<Set<string>>(() => new Set());
  const [hookEventsDir, setHookEventsDir] = useState<string | null>(null);
  const [sessionListMode, setSessionListMode] = useState<SessionListMode>(cachedInitialSidebar.sessionListMode);
  const [creatingSession, setCreatingSession] = useState(false);
  const [mainPanelClosed, setMainPanelClosed] = useState(false);
  const [selectedProjectDetailsPath, setSelectedProjectDetailsPath] = useState<string | null>(null);
  const [selectedDayOverview, setSelectedDayOverview] = useState<number | null>(null);
  const [dailyReportPlatform, setDailyReportPlatform] = useState<DailyReportPlatform>("blog");
  const [generatingDailyReportKey, setGeneratingDailyReportKey] = useState<string | null>(null);
  const [dailyReportEvidenceByDay, setDailyReportEvidenceByDay] = useState<Record<string, DailyReportEvidence[]>>({});
  const [loadingDailyReportEvidenceKey, setLoadingDailyReportEvidenceKey] = useState<string | null>(null);
  const [currentConversationRowVisible, setCurrentConversationRowVisible] = useState(false);
  const [locatedConversationHighlight, setLocatedConversationHighlight] = useState<{ conversationId: string; key: number } | null>(null);
  const [outlineMode, setOutlineMode] = useState<WorkbenchOutlineMode>(cachedInitialSidebar.outlineMode);
  const [displayFilter, setDisplayFilter] = useState<WorkbenchDisplayFilter>(cachedInitialSidebar.displayFilter);
  const [sortMode, setSortMode] = useState<WorkbenchSortMode>(cachedInitialSidebar.sortMode);
  const [reorderGroups, setReorderGroups] = useState(cachedInitialSidebar.reorderGroups);
  const [mergeWorktrees, setMergeWorktrees] = useState(cachedInitialSidebar.mergeWorktrees);
  const [showProjectNewConversation, setShowProjectNewConversation] = useState(cachedInitialSidebar.showProjectNewConversation);
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(() => new Set(cachedInitialSidebar.expandedProjectPaths));
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [environmentDefaultScope, setEnvironmentDefaultScope] = useState<EnvironmentScope>("project");
  const [environmentDialogTarget, setEnvironmentDialogTarget] = useState<EnvironmentDialogTarget | null>(null);
  const [environmentTerminal, setEnvironmentTerminal] = useState<EnvironmentTerminalSession | null>(null);
  const [externalAgentRuns, setExternalAgentRuns] = useState<Record<string, ExternalAgentRun>>(() => {
    const initial = pruneExternalAgentRuns(cachedExternalAgentRuns);
    cachedExternalAgentRuns = initial;
    return initial;
  });
  const [exportTargetSession, setExportTargetSession] = useState<Session | null>(null);
  const [exportMessages, setExportMessages] = useState<Message[]>([]);
  const {
    value: sessionsSidebarWidth,
    setValue: setSessionsSidebarWidth,
    handleMouseDown: handleSessionsSidebarResize,
  } = useResize({
    direction: "horizontal",
    storageKey: "lovcode.agentWorkspace.sessionsSidebarWidth",
    defaultValue: cachedInitialSidebar.sessionsSidebarWidth,
    min: SESSIONS_SIDEBAR_MIN_WIDTH,
    max: SESSIONS_SIDEBAR_MAX_WIDTH,
  });
  const historySessions = useMemo(() => {
    const streamedIds = new Set(streamedHistorySessions.map(getHistoryConversationId));
    const pending = Object.values(pendingRuntimeForkSessions).filter(
      (session) => !streamedIds.has(getHistoryConversationId(session)),
    );
    return pending.length > 0
      ? [...pending, ...streamedHistorySessions].sort((a, b) => b.last_modified - a.last_modified)
      : streamedHistorySessions;
  }, [pendingRuntimeForkSessions, streamedHistorySessions]);
  const latestStateRef = useRef(state);
  const historySessionsRef = useRef(historySessions);
  const conversationListScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToConversationRef = useRef<string | null>(null);
  const locateArrivalFrameRef = useRef<number | null>(null);
  const locateArrivalTokenRef = useRef(0);
  const locateHighlightKeyRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightCountRef = useRef(0);
  const agentIdleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const hookLineCountsRef = useRef<Map<string, number>>(new Map());
  const sessionActivitySnapshotRef = useRef<Map<string, Pick<SessionFileActivity, "modifiedAt" | "size">>>(
    new Map(cachedSessionActivitySnapshot),
  );
  const restoredConversationIdRef = useRef<string | null>(null);
  const routeSelectionRestoredRef = useRef<string | null>(null);
  const routeProjectDetailsRestoredRef = useRef<string | null>(null);
  const projectDetailsOpenRef = useRef(false);
  const routeSessionListModeRef = useRef(routeSessionListMode);
  const exportLoadSeqRef = useRef(0);
  const linkDebugSignatureRef = useRef<string | null>(null);
  const getConversationRowElement = useCallback((conversationId: string) => {
    const scroller = conversationListScrollRef.current;
    if (!scroller) return null;
    return scroller.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(conversationId)}"]`);
  }, []);
  const scrollConversationRowIntoView = useCallback((conversationId: string) => {
    const scroller = conversationListScrollRef.current;
    const row = getConversationRowElement(conversationId);
    if (!scroller || !row) return false;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top - scrollerRect.top - scrollerRect.height / 2 + rowRect.height / 2;
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
    return true;
  }, [getConversationRowElement]);
  const isConversationRowVisible = useCallback((conversationId: string) => {
    const scroller = conversationListScrollRef.current;
    const row = getConversationRowElement(conversationId);
    if (!scroller || !row) return false;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const stickyHeaderOffset = outlineMode === "recent" ? 0 : 32;
    return rowRect.bottom > scrollerRect.top + stickyHeaderOffset && rowRect.top < scrollerRect.bottom;
  }, [getConversationRowElement, outlineMode]);
  const pulseLocatedConversation = useCallback((conversationId: string) => {
    locateHighlightKeyRef.current += 1;
    setLocatedConversationHighlight({
      conversationId,
      key: locateHighlightKeyRef.current,
    });
  }, []);
  const clearLocatedConversationHighlight = useCallback((key: number) => {
    setLocatedConversationHighlight((current) => (current?.key === key ? null : current));
  }, []);
  const highlightConversationOnArrival = useCallback((conversationId: string) => {
    if (locateArrivalFrameRef.current !== null) {
      cancelAnimationFrame(locateArrivalFrameRef.current);
      locateArrivalFrameRef.current = null;
    }

    const token = locateArrivalTokenRef.current + 1;
    locateArrivalTokenRef.current = token;
    let frameCount = 0;
    let stableFrames = 0;
    let lastScrollTop = conversationListScrollRef.current?.scrollTop ?? 0;

    const tick = () => {
      if (token !== locateArrivalTokenRef.current) return;

      const scroller = conversationListScrollRef.current;
      const row = getConversationRowElement(conversationId);
      frameCount += 1;

      if (!scroller || !row) {
        if (frameCount < 90) {
          locateArrivalFrameRef.current = requestAnimationFrame(tick);
        } else {
          locateArrivalFrameRef.current = null;
        }
        return;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const centerDelta = rowRect.top - scrollerRect.top - scrollerRect.height / 2 + rowRect.height / 2;
      const scrollDelta = Math.abs(scroller.scrollTop - lastScrollTop);
      const visible = isConversationRowVisible(conversationId);
      stableFrames = scrollDelta < 0.5 ? stableFrames + 1 : 0;
      lastScrollTop = scroller.scrollTop;

      if (visible && (Math.abs(centerDelta) <= 2 || stableFrames >= 2 || frameCount >= 45)) {
        locateArrivalFrameRef.current = null;
        pulseLocatedConversation(conversationId);
        return;
      }

      if (frameCount >= 90) {
        locateArrivalFrameRef.current = null;
        if (visible) pulseLocatedConversation(conversationId);
        return;
      }

      locateArrivalFrameRef.current = requestAnimationFrame(tick);
    };

    locateArrivalFrameRef.current = requestAnimationFrame(tick);
  }, [getConversationRowElement, isConversationRowVisible, pulseLocatedConversation]);

  const openSessionExportDialog = useCallback((session: Session) => {
    const seq = exportLoadSeqRef.current + 1;
    exportLoadSeqRef.current = seq;
    setExportTargetSession(session);
    setExportMessages([]);
    invoke<Message[]>("get_session_messages", {
      projectId: session.project_id,
      sessionId: session.id,
    })
      .then((messages) => {
        if (exportLoadSeqRef.current === seq) setExportMessages(messages);
      })
      .catch(() => {
        if (exportLoadSeqRef.current === seq) setExportMessages([]);
      });
  }, []);

  const setExportDialogOpen = useCallback((open: boolean) => {
    if (open) return;
    exportLoadSeqRef.current += 1;
    setExportTargetSession(null);
    setExportMessages([]);
  }, []);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    historySessionsRef.current = historySessions;
  }, [historySessions]);

  useEffect(() => {
    if (Object.keys(pendingRuntimeForkSessions).length === 0) return;
    const streamedIds = new Set(streamedHistorySessions.map(getHistoryConversationId));
    setPendingRuntimeForkSessions((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((conversationId) => {
        if (!streamedIds.has(conversationId)) return;
        delete next[conversationId];
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [pendingRuntimeForkSessions, streamedHistorySessions]);

  useEffect(() => {
    routeSessionListModeRef.current = routeSessionListMode;
  }, [routeSessionListMode]);

  useEffect(() => {
    if (!loaded) return;
    const linkedIds = new Set<string>();
    state.sessions.forEach((session) => {
      if (session.linkedHistorySessionId) linkedIds.add(session.linkedHistorySessionId);
    });
    const claimedThisPass = new Set<string>();
    const updates: Array<{ runtimeId: string; transcript: Session }> = [];
    const linkCandidates = state.sessions.filter(shouldAttemptHistoryLink);
    if (linkCandidates.length === 0) {
      linkDebugSignatureRef.current = null;
      return;
    }
    const recentHistory = historySessions
      .filter((h) => h.created_at * 1000 >= Math.min(...linkCandidates.map((s) => s.createdAt)) - LINK_DEBUG_HISTORY_LOOKBACK_MS)
      .slice(0, LINK_DEBUG_RECENT_HISTORY_LIMIT);
    const debugSignature = getRuntimeLinkDebugSignature(linkCandidates, recentHistory);
    if (linkDebugSignatureRef.current !== debugSignature) {
      linkDebugSignatureRef.current = debugSignature;
      logLinkDebug("unlinked runtime sessions", linkCandidates.map((s) => ({
        id: s.id,
        cwd: s.cwd,
        createdAt: s.createdAt,
        prompt: getSessionSubmittedPrompt(s)?.slice(0, 80),
      })));
      logLinkDebug("recent history candidates", recentHistory.map((h) => ({
        id: h.id,
        project_path: h.project_path,
        created_at_ms: h.created_at * 1000,
        last_prompt: h.last_prompt?.slice(0, 80),
      })));
    }
    for (const session of linkCandidates) {
      const match = findLikelyTranscriptForRuntimeSession(session, historySessions, new Set([...linkedIds, ...claimedThisPass]));
      if (match) {
        claimedThisPass.add(match.id);
        updates.push({ runtimeId: session.id, transcript: match });
      }
    }
    const timestamp = now();
    const linkMap = new Map(updates.map((u) => [u.runtimeId, u.transcript.id]));
    const notFound = historySessionsComplete && !historyStreaming
      ? linkCandidates.filter(
          (session) =>
            !linkMap.has(session.id) &&
            normalizeHistoryLinkStatus(session.historyLinkStatus) !== "not-found" &&
            shouldMarkHistoryLinkNotFound(session, timestamp),
        )
      : [];
    if (updates.length === 0 && notFound.length === 0) return;
    if (updates.length > 0) {
      logLinkDebug("linking", updates.map((update) => ({
        runtimeId: update.runtimeId,
        transcriptId: update.transcript.id,
        projectPath: update.transcript.project_path,
        createdAtMs: update.transcript.created_at * 1000,
        lastPrompt: update.transcript.last_prompt?.slice(0, 80),
      })));
    }
    if (notFound.length > 0) {
      logLinkDebug("unresolved runtime sessions marked not-found", notFound.map((s) => ({
        id: s.id,
        cwd: s.cwd,
        createdAt: s.createdAt,
        prompt: getSessionSubmittedPrompt(s)?.slice(0, 80),
        reason: HISTORY_LINK_NOT_FOUND_REASON,
      })));
    }
    const notFoundIds = new Set(notFound.map((session) => session.id));
    const base = latestStateRef.current;
    const conversationMeta = { ...(base.conversationMeta ?? {}) };
    const sidebar = normalizeSidebarState(base.sidebar);
    let activeConversationId = sidebar.activeConversationId;
    let sidebarChanged = false;
    updates.forEach((update) => {
      const runtimeConversationId = `runtime:${update.runtimeId}`;
      const historyConversationId = getHistoryConversationId(update.transcript);
      const runtimeMeta = conversationMeta[runtimeConversationId];
      const historyMeta = conversationMeta[historyConversationId];
      if (runtimeMeta || historyMeta) {
        conversationMeta[historyConversationId] = {
          ...runtimeMeta,
          ...historyMeta,
          id: historyConversationId,
        };
        delete conversationMeta[runtimeConversationId];
      }
      if (activeConversationId === runtimeConversationId) {
        activeConversationId = historyConversationId;
        sidebarChanged = true;
      }
    });
    const next: AgentWorkspaceState = {
      ...base,
      sessions: base.sessions.map((session) => {
        const transcriptId = linkMap.get(session.id);
        if (transcriptId) {
          return {
            ...session,
            linkedHistorySessionId: transcriptId,
            historyLinkStatus: "linked",
            historyLinkLastTriedAt: timestamp,
            historyLinkLastReason: null,
          };
        }
        if (notFoundIds.has(session.id)) {
          return {
            ...session,
            historyLinkStatus: "not-found",
            historyLinkLastTriedAt: timestamp,
            historyLinkLastReason: HISTORY_LINK_NOT_FOUND_REASON,
          };
        }
        return session;
      }),
      conversationMeta,
      sidebar: sidebarChanged ? { ...sidebar, activeConversationId } : base.sidebar,
    };
    persist(next).catch(console.error);
  }, [historySessions, historySessionsComplete, historyStreaming, state.sessions, loaded]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<AgentWorkspaceState>("get_agent_workspace_state"),
      invoke<string>("get_agent_workspace_file_path"),
    ])
      .then(([loadedState, path]) => {
        if (cancelled) return;
        const sidebar = normalizeSidebarState(loadedState.sidebar);
        const resumeWorkspace = routeSessionId ? null : readDevResumeState()?.workspace;
        const resumeActiveConversationId =
          resumeWorkspace && "activeConversationId" in resumeWorkspace
            ? resumeWorkspace.activeConversationId ?? null
            : sidebar.activeConversationId;
        const initialSidebar = normalizeSidebarState({
          ...sidebar,
          sessionListMode: routeHasSessionListMode
            ? routeSessionListModeRef.current
            : resumeWorkspace?.sessionListMode ?? routeSessionListModeRef.current,
          activeConversationId: routeSessionId ? sidebar.activeConversationId : resumeActiveConversationId,
        });
        const next = {
          ...emptyWorkspace(),
          ...loadedState,
          conversationMeta: loadedState.conversationMeta ?? {},
          globalEnvironment: loadedState.globalEnvironment ?? null,
          projectEnvironments: loadedState.projectEnvironments ?? {},
          sessionEnvironments: loadedState.sessionEnvironments ?? {},
          sidebar: initialSidebar,
        };
        cachedAgentWorkspaceState = next;
        cachedAgentWorkspaceFilePath = path;
        setState(next);
        setSessionListMode(initialSidebar.sessionListMode);
        setOutlineMode(initialSidebar.outlineMode);
        setDisplayFilter(initialSidebar.displayFilter);
        setSortMode(initialSidebar.sortMode);
        setReorderGroups(initialSidebar.reorderGroups);
        setMergeWorktrees(initialSidebar.mergeWorktrees);
        setShowProjectNewConversation(initialSidebar.showProjectNewConversation);
        setExpandedProjectPaths(new Set(initialSidebar.expandedProjectPaths));
        setSessionsSidebarWidth(initialSidebar.sessionsSidebarWidth);
        setWorkspacePath(path);
        const active =
          next.sessions.find((session) => session.id === next.activeSessionId && !session.archived) ??
          next.sessions.find((session) => !session.archived) ??
          next.sessions[0];
        setSelectedCwd(active?.cwd ?? next.sessions[0]?.cwd ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

	  useEffect(() => {
	    let cancelled = false;
	    invoke<string>("get_agent_plain_chat_workspace_path")
	      .then((path) => {
	        if (!cancelled) {
	          cachedPlainChatWorkspacePath = path;
	          setPlainChatWorkspacePath(path);
	        }
	      })
      .catch((error) => {
        console.error("Failed to prepare general chat workspace:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<AgentWorkspaceHookConfig>("get_agent_workspace_hook_config")
      .then((config) => {
        if (!cancelled) setHookEventsDir(config.eventsDir);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.dispatchEvent(new Event("app:ready"));
  }, [loaded]);

  const activeSession = useMemo(
    () => {
      if (!state.activeSessionId) return null;
      const selected = state.sessions.find((session) => session.id === state.activeSessionId);
      if (selected && !selected.archived) return selected;
      return null;
    },
    [state.activeSessionId, state.sessions],
  );

  const ptyIds = useMemo(
    () => state.sessions.map((session) => session.ptyId).filter((id): id is string => Boolean(id)),
    [state.sessions],
  );
  const ptyStatus = usePtyStatus(ptyIds);
  const isPlainChatWorkspace = (path?: string | null) =>
    Boolean(path && plainChatWorkspacePath && normalizeProjectPath(path) === normalizeProjectPath(plainChatWorkspacePath));
  const generalChatLabel = t("composer.generalChat");
  const getWorkbenchProjectName = (path: string) => (isPlainChatWorkspace(path) ? generalChatLabel : getProjectName(path));
  const getWorkbenchProjectTitle = (path: string) => (isPlainChatWorkspace(path) ? generalChatLabel : path);
  const getComposerCwdLabel = (path?: string | null) =>
    path ? (isPlainChatWorkspace(path) ? generalChatLabel : getProjectName(path)) : generalChatLabel;
  const ensurePlainChatWorkspace = async () => {
    if (plainChatWorkspacePath) return plainChatWorkspacePath;
    const path = await invoke<string>("get_agent_plain_chat_workspace_path");
    setPlainChatWorkspacePath(path);
    return path;
  };
  useEffect(() => {
    if (!selectedHistorySession) return;
    // Prefer exact match on (id, project_id). Fall back to id-only — session ids
    // are globally unique, and a project_id change means the session was migrated
    // between project slugs (e.g. cc-mv worktree → origin auto-fix).
    const next =
      historySessions.find(
        (session) => session.id === selectedHistorySession.id && session.project_id === selectedHistorySession.project_id,
      ) ?? historySessions.find((session) => session.id === selectedHistorySession.id);
    if (next) setSelectedHistorySession(next);
    else if (!historyStreaming) setSelectedHistorySession(null);
  }, [historySessions, historyStreaming, selectedHistorySession]);
  useEffect(() => {
    projectDetailsOpenRef.current = Boolean(selectedProjectDetailsPath);
  }, [selectedProjectDetailsPath]);

  const markExternalAgentRunning = useCallback((
    conversationIds: Iterable<string>,
    source: ExternalAgentRun["source"],
    options?: { provider?: AgentProvider | null; ttlMs?: number | null; timestamp?: number },
  ) => {
    const ids = [...new Set([...conversationIds].filter(Boolean))];
    if (ids.length === 0) return;
    const timestamp = options?.timestamp ?? now();
    const ttlMs = options?.ttlMs === undefined ? WATCH_AGENT_RUNNING_MS : options.ttlMs;
    setExternalAgentRuns((prev) => {
      let changed = false;
      const next = { ...prev };
      ids.forEach((conversationId) => {
        const value: ExternalAgentRun = {
          source,
          updatedAt: timestamp,
          expiresAt: ttlMs === null ? null : timestamp + ttlMs,
          provider: options?.provider ?? null,
        };
        const current = next[conversationId];
        if (
          current?.source === value.source &&
          current.updatedAt === value.updatedAt &&
          current.expiresAt === value.expiresAt &&
          current.provider === value.provider
        ) {
          return;
        }
        next[conversationId] = value;
        changed = true;
      });
      if (changed) cachedExternalAgentRuns = next;
      return changed ? next : prev;
    });
  }, []);

  const clearExternalAgentRunning = useCallback((conversationIds: Iterable<string>) => {
    const ids = [...new Set([...conversationIds].filter(Boolean))];
    if (ids.length === 0) return;
    setExternalAgentRuns((prev) => {
      let changed = false;
      const next = { ...prev };
      ids.forEach((conversationId) => {
        if (conversationId in next) {
          delete next[conversationId];
          changed = true;
        }
      });
      if (changed) cachedExternalAgentRuns = next;
      return changed ? next : prev;
    });
  }, []);

  const getHookConversationIds = useCallback((event: AgentHookEvent) => {
    const ids = new Set<string>();
    if (event.conversationId) ids.add(event.conversationId);
    if (event.projectId && event.sessionId) ids.add(`history:${event.projectId}:${event.sessionId}`);
    if (event.sessionId) {
      const provider = typeof event.provider === "string" ? event.provider : null;
      const currentHistorySessions = historySessionsRef.current;
      currentHistorySessions.forEach((session) => {
        if (session.id !== event.sessionId) return;
        if (provider === "codex" && session.source !== "codex") return;
        if (provider === "claude" && session.source === "codex") return;
        ids.add(getHistoryConversationId(session));
      });
      latestStateRef.current.sessions.forEach((session) => {
        if (session.id !== event.sessionId) return;
        const linkedTranscript = session.linkedHistorySessionId
          ? currentHistorySessions.find((item) => item.id === session.linkedHistorySessionId)
          : undefined;
        ids.add(getRuntimeConversationId(session, linkedTranscript));
      });
    }
    return [...ids];
  }, []);

  const allWorkbenchRows = useMemo(() => {
    const historyById = new Map(historySessions.map((session) => [session.id, session]));
    const conversationMeta = state.conversationMeta ?? {};
    const rowsById = new Map<string, WorkbenchConversation>();
    const nowMs = now();
    const claimedRuntimeTranscriptIds = new Set(
      state.sessions
        .map((session) => session.linkedHistorySessionId)
        .filter((id): id is string => Boolean(id)),
    );
    const getExternalRun = (conversationId: string) => {
      const run = externalAgentRuns[conversationId];
      if (!run) return null;
      if (run.expiresAt && run.expiresAt <= nowMs) return null;
      if (run.expiresAt === null && run.source === "hook" && nowMs - run.updatedAt >= AGENT_STALE_WORKING_MS) return null;
      return run;
    };

    historySessions
      .filter((session) => Boolean(session.project_path))
      .forEach((session) => {
        const conversationId = getHistoryConversationId(session);
        const meta = conversationMeta[conversationId];
        const externalRun = getExternalRun(conversationId);
        rowsById.set(conversationId, {
          id: conversationId,
          conversationId,
          timestamp: session.last_modified * 1000,
          createdAt: session.created_at * 1000,
          projectPath: session.project_path!,
          archived: meta?.archived ?? false,
          archivedAt: meta?.archivedAt ?? null,
          pinned: meta?.pinned ?? false,
          unread: meta?.unread ?? false,
          needsReview: meta?.needsReview ?? false,
          agentRunning: Boolean(externalRun),
          agentRunningSource: externalRun?.source ?? null,
          agentRunningAt: externalRun?.updatedAt ?? null,
          displayMode: getStoredDisplayMode(meta),
          meta,
          transcript: session,
        });
      });

    state.sessions.forEach((session) => {
      const linkedTranscript = session.linkedHistorySessionId
        ? historyById.get(session.linkedHistorySessionId)
        : shouldAttemptHistoryLink(session)
          ? findLikelyTranscriptForRuntimeSession(session, historySessions, claimedRuntimeTranscriptIds)
          : undefined;
      if (linkedTranscript) claimedRuntimeTranscriptIds.add(linkedTranscript.id);
      const conversationId = getRuntimeConversationId(session, linkedTranscript);
      const current = rowsById.get(conversationId);
      const meta = conversationMeta[conversationId] ?? current?.meta;
	      const runtimeTimestamp = session.lastActivityAt ?? session.updatedAt;
	      const runtimeCreatedAt = linkedTranscript ? linkedTranscript.created_at * 1000 : session.createdAt;
	      const runtimeRunning = isAgentRunning(session);
	      const runtimeFinished =
	        session.workState === "stopped" ||
	        session.status === "completed" ||
	        session.status === "error" ||
	        session.status === "needs-review";
	      const externalRun = runtimeFinished ? null : getExternalRun(conversationId);
	      const currentAgentRunning = runtimeFinished ? false : Boolean(current?.agentRunning);
	      rowsById.set(conversationId, {
        id: current?.id ?? `agent:${session.id}`,
        conversationId,
        timestamp: Math.max(current?.timestamp ?? 0, runtimeTimestamp),
        createdAt: current?.createdAt ?? runtimeCreatedAt,
        projectPath: current?.projectPath ?? linkedTranscript?.project_path ?? session.cwd,
        archived: meta?.archived ?? session.archived ?? current?.archived ?? false,
        archivedAt: meta?.archivedAt ?? session.archivedAt ?? current?.archivedAt ?? null,
        pinned: meta?.pinned ?? current?.pinned ?? false,
        unread: Boolean(session.unread || meta?.unread || current?.unread),
        needsReview: Boolean(session.status === "needs-review" || meta?.needsReview || current?.needsReview),
	        agentRunning: runtimeRunning || Boolean(externalRun) || currentAgentRunning,
        agentRunningSource: runtimeRunning ? "runtime" : externalRun?.source ?? current?.agentRunningSource ?? null,
        agentRunningAt: runtimeRunning ? runtimeTimestamp : externalRun?.updatedAt ?? current?.agentRunningAt ?? null,
        displayMode: getStoredDisplayMode(meta, session),
        meta,
        transcript: current?.transcript ?? linkedTranscript,
        runtime: session,
      });
    });

    return [...rowsById.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [externalAgentRuns, historySessions, state.conversationMeta, state.sessions]);
  const trackedSessionActivityRequests = useMemo<SessionFileActivityRequest[]>(() => {
    const conversationMeta = state.conversationMeta ?? {};
    return historySessions
      .filter((session) => Boolean(session.project_path))
      .filter((session) => !conversationMeta[getHistoryConversationId(session)]?.archived)
      .sort((a, b) => b.last_modified - a.last_modified)
      .slice(0, SESSION_ACTIVITY_POLL_LIMIT)
      .map((session) => ({
        projectId: session.project_id,
        sessionId: session.id,
      }));
  }, [historySessions, state.conversationMeta]);
  const workbenchRows = useMemo(() => {
    return allWorkbenchRows
      .filter((row) => (sessionListMode === "archived" ? row.archived : !row.archived))
      .filter((row) => {
        if (displayFilter === "all") return true;
        if (displayFilter === "running") return isConversationAgentRunning(row);
        return row.needsReview;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const aSort = sessionListMode === "archived" ? a.archivedAt ?? a.timestamp : a.timestamp;
        const bSort = sessionListMode === "archived" ? b.archivedAt ?? b.timestamp : b.timestamp;
        if (sortMode === "name") return compareText(getConversationTitle(a), getConversationTitle(b)) || bSort - aSort;
        if (sortMode === "created") return b.createdAt - a.createdAt || bSort - aSort || compareText(getConversationTitle(a), getConversationTitle(b));
        return bSort - aSort || compareText(getConversationTitle(a), getConversationTitle(b));
      });
  }, [allWorkbenchRows, displayFilter, sessionListMode, sortMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      const timestamp = now();
      setExternalAgentRuns((prev) => {
        let changed = false;
        const next = { ...prev };
        Object.entries(next).forEach(([conversationId, run]) => {
          if (run.expiresAt && run.expiresAt <= timestamp) {
            delete next[conversationId];
            changed = true;
          } else if (run.expiresAt === null && run.source === "hook" && timestamp - run.updatedAt >= AGENT_STALE_WORKING_MS) {
            delete next[conversationId];
            changed = true;
          }
        });
        if (changed) cachedExternalAgentRuns = next;
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!loaded || trackedSessionActivityRequests.length === 0) return;

    let cancelled = false;
    const pollSessionActivity = () => {
      invoke<SessionFileActivity[]>("get_session_file_activity", {
        sessions: trackedSessionActivityRequests,
      })
        .then((activities) => {
          if (cancelled) return;
          const timestamp = now();
          const previous = sessionActivitySnapshotRef.current;
          const next = new Map<string, Pick<SessionFileActivity, "modifiedAt" | "size">>();
          const changedConversationIds: string[] = [];
          const hadSnapshot = previous.size > 0;

          activities.forEach((activity) => {
            const conversationId = `history:${activity.projectId}:${activity.sessionId}`;
            next.set(conversationId, {
              modifiedAt: activity.modifiedAt,
              size: activity.size,
            });
            const current = previous.get(conversationId);
            if (current) {
              if (activity.modifiedAt > current.modifiedAt || activity.size > current.size) {
                changedConversationIds.push(conversationId);
              }
              return;
            }
            if (!hadSnapshot && activity.modifiedAt > 0 && timestamp - activity.modifiedAt <= WATCH_AGENT_RUNNING_MS) {
              changedConversationIds.push(conversationId);
            }
          });

          sessionActivitySnapshotRef.current = next;
          cachedSessionActivitySnapshot = next;
          if (changedConversationIds.length > 0) {
            window.dispatchEvent(new CustomEvent(SESSION_ACTIVITY_EVENT, {
              detail: { conversationIds: changedConversationIds },
            }));
            markExternalAgentRunning(changedConversationIds, "watch", { ttlMs: WATCH_AGENT_RUNNING_MS, timestamp });
          }
        })
        .catch(() => {});
    };

    pollSessionActivity();
    const timer = setInterval(pollSessionActivity, SESSION_ACTIVITY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loaded, markExternalAgentRunning, trackedSessionActivityRequests]);
  const projectPaths = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    const addPath = (path?: string | null) => {
      if (!path) return;
      const groupPath = getProjectGroupPath(path, mergeWorktrees);
      const key = normalizeProjectPath(groupPath);
      if (!key || seen.has(key)) return;
      seen.add(key);
      paths.push(groupPath);
    };

    state.sessions.forEach((session) => addPath(session.cwd));
    projects
      .filter((project) => project.session_count > 0)
      .forEach((project) => addPath(project.path));
    historySessions.forEach((session) => addPath(session.project_path));
    return paths;
  }, [historySessions, mergeWorktrees, projects, state.sessions]);
  const composerPathOptions = useMemo(() => {
    const paths = new Map<string, { path: string; lastActive: number }>();
    const addPath = (path?: string | null, lastActive = 0) => {
      if (!path) return;
      const groupPath = getProjectGroupPath(path, mergeWorktrees);
      if (isPlainChatWorkspace(groupPath)) return;
      const key = normalizeProjectPath(groupPath);
      if (!key) return;
      const current = paths.get(key);
      paths.set(key, {
        path: current?.path ?? groupPath,
        lastActive: Math.max(current?.lastActive ?? 0, lastActive),
      });
    };

    state.sessions.forEach((session) => addPath(session.cwd, session.lastActivityAt ?? session.updatedAt ?? session.createdAt));
    projects.forEach((project) => addPath(project.path, project.last_active * 1000));
    historySessions.forEach((session) => addPath(session.project_path, session.last_modified * 1000));
    addPath(selectedCwd, Number.MAX_SAFE_INTEGER);

    return [...paths.values()]
      .sort((a, b) => b.lastActive - a.lastActive || compareText(getProjectName(a.path), getProjectName(b.path)))
      .slice(0, 12)
      .map((entry) => ({
        path: entry.path,
        label: getProjectName(entry.path),
        detail: entry.path,
      }));
  }, [historySessions, mergeWorktrees, plainChatWorkspacePath, projects, selectedCwd, state.sessions]);
  const projectActivityByPath = useMemo(() => {
    const activity = new Map<string, number>();
    projects.forEach((project) => {
      const key = getProjectGroupKey(project.path, mergeWorktrees);
      if (!key) return;
      activity.set(key, Math.max(activity.get(key) ?? 0, project.last_active * 1000));
    });
    return activity;
  }, [mergeWorktrees, projects]);
  const projectStatsByPath = useMemo(() => {
    const stats = new Map<string, ProjectConversationStats>();
    const ensure = (path: string) => {
      const key = getProjectGroupKey(path, mergeWorktrees);
      const current = stats.get(key) ?? {
        active: 0,
        archived: 0,
        running: 0,
        unread: 0,
        needsReview: 0,
        history: 0,
        total: 0,
        lastActive: 0,
        createdAt: 0,
      };
      stats.set(key, current);
      return current;
    };
    allWorkbenchRows.forEach((row) => {
      const current = ensure(row.projectPath);
      current.total += 1;
      current.lastActive = Math.max(current.lastActive, row.timestamp);
      current.createdAt = current.createdAt ? Math.min(current.createdAt, row.createdAt) : row.createdAt;
      if (row.transcript) current.history += 1;
      if (row.archived) {
        current.archived += 1;
      } else {
        current.active += 1;
        if (isConversationAgentRunning(row)) current.running += 1;
        if (row.needsReview) current.needsReview += 1;
        if (row.unread) current.unread += 1;
      }
    });
    return stats;
  }, [allWorkbenchRows, mergeWorktrees]);
  const rowsByProjectPath = useMemo(() => {
    const groups = new Map<string, typeof workbenchRows>();
    for (const row of workbenchRows) {
      const key = getProjectGroupKey(row.projectPath, mergeWorktrees);
      if (!key) continue;
      const current = groups.get(key) ?? [];
      current.push(row);
      groups.set(key, current);
    }
    return groups;
  }, [mergeWorktrees, workbenchRows]);
  const projectOutline = useMemo(() => {
    const paths = new Map<string, string>();
    projectPaths.forEach((path) => paths.set(normalizeProjectPath(path), path));
    workbenchRows.forEach((row) => {
      const groupPath = getProjectGroupPath(row.projectPath, mergeWorktrees);
      paths.set(normalizeProjectPath(groupPath), groupPath);
    });

    return [...paths.entries()]
      .map(([key, path]) => {
        const rows = rowsByProjectPath.get(key) ?? [];
        const stats = projectStatsByPath.get(key);
        const projectLastActive = projectActivityByPath.get(key) ?? 0;
        return { key, path, rows, stats, lastActive: Math.max(projectLastActive, stats?.lastActive ?? 0), createdAt: stats?.createdAt ?? 0 };
      })
      .filter((project) => project.rows.length > 0 || getProjectGroupKey(selectedCwd, mergeWorktrees) === project.key)
      .sort((a, b) => {
        const aName = getWorkbenchProjectName(a.path);
        const bName = getWorkbenchProjectName(b.path);
        const groupSort = reorderGroups ? sortMode : "last-modified";
        if (groupSort === "name") return compareText(aName, bName) || b.lastActive - a.lastActive;
        if (groupSort === "created") return b.createdAt - a.createdAt || b.lastActive - a.lastActive || compareText(aName, bName);
        return b.lastActive - a.lastActive || compareText(aName, bName);
      });
  }, [mergeWorktrees, plainChatWorkspacePath, projectActivityByPath, projectPaths, projectStatsByPath, reorderGroups, rowsByProjectPath, selectedCwd, sortMode, workbenchRows]);
  const dayOutline = useMemo<WorkbenchDayGroup[]>(() => {
    const groups = new Map<number, {
      key: string;
      dayStart: number;
      rows: WorkbenchConversation[];
      lastActive: number;
      running: number;
      needsReview: number;
    }>();

    workbenchRows.forEach((row) => {
      const dayStart = getLocalDayStart(row.timestamp);
      const current = groups.get(dayStart) ?? {
        key: String(dayStart),
        dayStart,
        rows: [],
        lastActive: 0,
        running: 0,
        needsReview: 0,
      };
      current.rows.push(row);
      current.lastActive = Math.max(current.lastActive, row.timestamp);
      if (isConversationAgentRunning(row)) current.running += 1;
      if (row.needsReview) current.needsReview += 1;
      groups.set(dayStart, current);
    });

    return [...groups.values()]
      .map((group) => {
        const projectsByKey = new Map<string, WorkbenchDayProject>();

        group.rows.forEach((row) => {
          const projectPath = getProjectGroupPath(row.projectPath, mergeWorktrees);
          const key = getProjectGroupKey(row.projectPath, mergeWorktrees) || normalizeProjectPath(projectPath) || projectPath;
          const project = projectsByKey.get(key) ?? {
            key,
            path: projectPath,
            rows: [],
            lastActive: 0,
            running: 0,
            needsReview: 0,
          };
          project.rows.push(row);
          project.lastActive = Math.max(project.lastActive, row.timestamp);
          if (isConversationAgentRunning(row)) project.running += 1;
          if (row.needsReview) project.needsReview += 1;
          projectsByKey.set(key, project);
        });

        const projectsInDay = [...projectsByKey.values()].sort((a, b) => {
          const aName = getWorkbenchProjectName(a.path);
          const bName = getWorkbenchProjectName(b.path);
          return b.lastActive - a.lastActive || compareText(aName, bName);
        });

        return {
          ...group,
          projects: projectsInDay,
          projectCount: projectsInDay.length,
        };
      })
      .sort((a, b) => b.dayStart - a.dayStart || b.lastActive - a.lastActive);
  }, [mergeWorktrees, workbenchRows]);
  const selectedDayOverviewDetails = useMemo(() => {
    if (selectedDayOverview === null) return null;
    return dayOutline.find((day) => day.dayStart === selectedDayOverview) ?? null;
  }, [dayOutline, selectedDayOverview]);
  const selectedDayOverviewEvidenceKey = selectedDayOverviewDetails
    ? getDailyReportEvidenceCacheKey(selectedDayOverviewDetails)
    : null;
  const selectedDayOverviewEvidence = selectedDayOverviewEvidenceKey
    ? dailyReportEvidenceByDay[selectedDayOverviewEvidenceKey]
    : undefined;
  const selectedDayOverviewEvidenceLoading =
    Boolean(selectedDayOverviewEvidenceKey) && loadingDailyReportEvidenceKey === selectedDayOverviewEvidenceKey;
  const selectedProjectDetails = useMemo(() => {
    const key = getProjectGroupKey(selectedProjectDetailsPath, mergeWorktrees);
    if (!key || !selectedProjectDetailsPath) return null;
    const project = projects.find((item) => normalizeProjectPath(item.path) === key) ?? null;
    const path = project?.path ?? projectPaths.find((item) => normalizeProjectPath(item) === key) ?? selectedProjectDetailsPath;
    const conversations = allWorkbenchRows
      .filter((row) => getProjectGroupKey(row.projectPath, mergeWorktrees) === key)
      .sort((a, b) => {
        if (sortMode === "name") return compareText(getConversationTitle(a), getConversationTitle(b)) || b.timestamp - a.timestamp;
        if (sortMode === "created") return b.createdAt - a.createdAt || b.timestamp - a.timestamp || compareText(getConversationTitle(a), getConversationTitle(b));
        return b.timestamp - a.timestamp || compareText(getConversationTitle(a), getConversationTitle(b));
      });

    return {
      key,
      path,
      project,
      conversations,
      stats: projectStatsByPath.get(key) ?? null,
    };
  }, [allWorkbenchRows, mergeWorktrees, projectPaths, projectStatsByPath, projects, selectedProjectDetailsPath, sortMode]);

  const normalizeWorkspaceState = (next: AgentWorkspaceState, sidebarPriority: "next" | "latest" = "next"): AgentWorkspaceState => {
    const sidebar =
      sidebarPriority === "latest"
        ? normalizeSidebarState({ ...(next.sidebar ?? {}), ...(latestStateRef.current.sidebar ?? {}) })
        : normalizeSidebarState({ ...(latestStateRef.current.sidebar ?? {}), ...(next.sidebar ?? {}) });

    return {
      ...next,
      conversationMeta: next.conversationMeta ?? {},
      globalEnvironment: next.globalEnvironment ?? null,
      projectEnvironments: next.projectEnvironments ?? {},
      sessionEnvironments: next.sessionEnvironments ?? {},
      sidebar,
    };
  };

  useEffect(() => {
    const handleWorkspaceStateUpdated = (event: Event) => {
      const updatedState = (event as CustomEvent<AgentWorkspaceState>).detail;
      if (!updatedState) return;
      const nextState = normalizeWorkspaceState({
        ...latestStateRef.current,
        sessions: updatedState.sessions ?? latestStateRef.current.sessions,
        conversationMeta: updatedState.conversationMeta ?? latestStateRef.current.conversationMeta,
        globalEnvironment: updatedState.globalEnvironment ?? latestStateRef.current.globalEnvironment ?? null,
        projectEnvironments: updatedState.projectEnvironments ?? latestStateRef.current.projectEnvironments,
        sessionEnvironments: updatedState.sessionEnvironments ?? latestStateRef.current.sessionEnvironments,
      }, "latest");
      latestStateRef.current = nextState;
      cachedAgentWorkspaceState = nextState;
      setState(nextState);
    };

    window.addEventListener(AGENT_WORKSPACE_STATE_UPDATED_EVENT, handleWorkspaceStateUpdated as EventListener);
    return () => {
      window.removeEventListener(AGENT_WORKSPACE_STATE_UPDATED_EVENT, handleWorkspaceStateUpdated as EventListener);
    };
  }, []);

  const beginSaving = () => {
    saveInFlightCountRef.current += 1;
    if (saveInFlightCountRef.current !== 1 || savingIndicatorTimerRef.current) return;
    savingIndicatorTimerRef.current = setTimeout(() => {
      savingIndicatorTimerRef.current = null;
      if (saveInFlightCountRef.current > 0) setSaving(true);
    }, 250);
  };

  const endSaving = () => {
    saveInFlightCountRef.current = Math.max(0, saveInFlightCountRef.current - 1);
    if (saveInFlightCountRef.current > 0) return;
    if (savingIndicatorTimerRef.current) {
      clearTimeout(savingIndicatorTimerRef.current);
      savingIndicatorTimerRef.current = null;
    }
    setSaving(false);
  };

  const persist = async (next: AgentWorkspaceState) => {
    const nextState = normalizeWorkspaceState(next, "latest");
    setState(nextState);
    latestStateRef.current = nextState;
    cachedAgentWorkspaceState = nextState;
    beginSaving();
    try {
      const saved = await invoke<AgentWorkspaceState>("save_agent_workspace_state", { state: nextState });
      const savedState = normalizeWorkspaceState(saved, "next");
      latestStateRef.current = savedState;
      cachedAgentWorkspaceState = savedState;
      setState(savedState);
    } finally {
      endSaving();
    }
  };

  const schedulePersist = (next: AgentWorkspaceState) => {
    const nextState = normalizeWorkspaceState(next, "next");
    latestStateRef.current = nextState;
    cachedAgentWorkspaceState = nextState;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      beginSaving();
      invoke<AgentWorkspaceState>("save_agent_workspace_state", { state: latestStateRef.current })
        .then((saved) => {
          latestStateRef.current = normalizeWorkspaceState(saved, "next");
          cachedAgentWorkspaceState = latestStateRef.current;
        })
        .finally(() => {
          endSaving();
        });
    }, 1000);
  };

  const flushPendingWorkspaceSave = useCallback(() => {
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    invoke<AgentWorkspaceState>("save_agent_workspace_state", { state: latestStateRef.current }).catch(() => {});
  }, []);

  const reconcileHarnessSessionRuntimeState = useCallback((liveSessionIds: Set<string> | null) => {
    const timestamp = now();
    setState((prev) => {
      let changed = false;
      const sessions = prev.sessions.map((session) => {
        if (!isHarnessSession(session) || session.workState !== "working") return session;
        const live = liveSessionIds?.has(session.id) ?? false;
        const lastActivity = Math.max(session.lastActivityAt ?? 0, session.updatedAt ?? 0, session.createdAt ?? 0);
        const stale = timestamp - lastActivity >= AGENT_STALE_WORKING_MS;
        if (live || (liveSessionIds === null && !stale)) return session;
        changed = true;
        return {
          ...session,
          status: session.status === "error" ? ("error" as const) : ("completed" as const),
          workState: "stopped" as const,
          updatedAt: timestamp,
          harnessMessages: (session.harnessMessages ?? []).filter((message) => !message.transient),
        };
      });
      if (!changed) return prev;
      const next = { ...prev, sessions };
      schedulePersist(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;

    const reconcile = () => {
      invoke<string[]>("list_agent_harness_sessions")
        .then((sessionIds) => {
          if (cancelled) return;
          reconcileHarnessSessionRuntimeState(new Set(sessionIds));
        })
        .catch(() => {
          if (cancelled) return;
          reconcileHarnessSessionRuntimeState(null);
        });
    };

    reconcile();
    const timer = setInterval(reconcile, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loaded, reconcileHarnessSessionRuntimeState]);

  const updateSidebarState = (patch: Partial<AgentWorkspaceSidebarState>, options?: { immediate?: boolean }) => {
    const currentSidebar = normalizeSidebarState(latestStateRef.current.sidebar);
    const nextSidebar = normalizeSidebarState({
      ...currentSidebar,
      ...patch,
    });
    if (sidebarStatesEqual(currentSidebar, nextSidebar)) return nextSidebar;
    const nextState = {
      ...latestStateRef.current,
      sidebar: nextSidebar,
    };
    setState((prev) => ({
      ...prev,
      sidebar: nextSidebar,
    }));
    if (options?.immediate) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      latestStateRef.current = nextState;
      persist(nextState).catch(console.error);
    } else {
      schedulePersist(nextState);
    }
    return nextSidebar;
  };

  const setPersistedSessionListMode = (mode: SessionListMode) => {
    setSessionListMode(mode);
    return updateSidebarState({ sessionListMode: mode });
  };

  const setPersistedOutlineMode = (mode: WorkbenchOutlineMode) => {
    setOutlineMode(mode);
    updateSidebarState({ outlineMode: mode });
  };

  const setPersistedDisplayFilter = (filter: WorkbenchDisplayFilter) => {
    setDisplayFilter(filter);
    updateSidebarState({ displayFilter: filter });
  };

  const setPersistedSortMode = (mode: WorkbenchSortMode) => {
    setSortMode(mode);
    updateSidebarState({ sortMode: mode });
  };

  const setPersistedReorderGroups = (reorder: boolean) => {
    setReorderGroups(reorder);
    updateSidebarState({ reorderGroups: reorder });
  };

  const setPersistedMergeWorktrees = (merge: boolean) => {
    setMergeWorktrees(merge);
    updateSidebarState({ mergeWorktrees: merge });
  };

  const setPersistedShowProjectNewConversation = (show: boolean) => {
    setShowProjectNewConversation(show);
    updateSidebarState({ showProjectNewConversation: show });
  };

  const setPersistedActiveConversationId = (conversationId: string | null, options?: { immediate?: boolean }) =>
    updateSidebarState({ activeConversationId: conversationId }, { immediate: options?.immediate ?? true });

  const setPersistedActiveConversation = (conversationId: string | null, options?: { immediate?: boolean }) => {
    setSessionListMode("active");
    return updateSidebarState({
      sessionListMode: "active",
      activeConversationId: conversationId,
    }, { immediate: options?.immediate ?? true });
  };

  useEffect(() => {
    const handlePageHide = () => flushPendingWorkspaceSave();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingWorkspaceSave();
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (import.meta.hot) {
      import.meta.hot.dispose(flushPendingWorkspaceSave);
    }
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingWorkspaceSave]);

  useEffect(() => {
    if (!loaded) return;
    const sidebar = normalizeSidebarState(state.sidebar);
    writeWorkspaceDevResumeState({
      activeConversationId: sidebar.activeConversationId,
      sessionListMode: sidebar.sessionListMode,
    });
  }, [loaded, state.sidebar?.activeConversationId, state.sidebar?.sessionListMode]);

  useEffect(() => {
    if (!loaded || routeSessionId || sessionListMode === routeSessionListMode) return;
    setPersistedSessionListMode(routeSessionListMode);
  }, [loaded, routeSessionId, routeSessionListMode, sessionListMode]);

  useEffect(() => {
    if (!loaded) return;
    updateSidebarState({ sessionsSidebarWidth });
  }, [loaded, sessionsSidebarWidth]);

  function getAgentHookEventFile(eventsDir: string, sessionId: string) {
    return `${eventsDir.replace(/\/$/, "")}/${sessionId}.jsonl`;
  }

  function getAgentHookEnv(config: AgentWorkspaceHookConfig, sessionId: string) {
    return {
      LOVCODE_AGENT_SESSION_ID: sessionId,
      LOVCODE_AGENT_HOOK_FILE: getAgentHookEventFile(config.eventsDir, sessionId),
    };
  }

  async function ensureAgentHookConfig(provider: AgentProvider, sessionId: string) {
    const config = await invoke<AgentWorkspaceHookConfig>("ensure_agent_workspace_hooks", { provider });
    setHookEventsDir(config.eventsDir);
    hookLineCountsRef.current.set(sessionId, 0);
    await invoke("write_file", {
      path: getAgentHookEventFile(config.eventsDir, sessionId),
      content: "",
    }).catch(() => {});
    return config;
  }

  function startHarnessSession(session: AgentSession, promptOverride?: string | null, resumeSessionId?: string | null) {
    const prompt = (promptOverride ?? getSessionSubmittedPrompt(session) ?? "").trim();
    if (!isHarnessSession(session) || !prompt) return;
    logHarnessStreamDebug("invoke-start", {
      sessionId: session.id,
      provider: session.provider,
      promptLength: prompt.length,
      resumeSessionId: resumeSessionId ?? session.linkedHistorySessionId ?? null,
    });
    invoke("start_agent_harness_session", {
      sessionId: session.id,
      provider: session.provider,
      cwd: session.cwd,
      prompt,
      resumeSessionId: resumeSessionId ?? session.linkedHistorySessionId ?? null,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const event: AgentHarnessEvent = {
        kind: "error",
        sessionId: session.id,
        message,
      };
      setState((prev) => {
        let changed = false;
        const sessions = prev.sessions.map((item) => {
          if (item.id !== session.id) return item;
          changed = true;
          return applyHarnessEventToSession(item, event, prev.activeSessionId);
        });
        if (!changed) return prev;
        const next = { ...prev, sessions };
        schedulePersist(next);
        return next;
      });
    });
  }

  function clearAgentIdleTimer(sessionId: string) {
    const timer = agentIdleTimersRef.current.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    agentIdleTimersRef.current.delete(sessionId);
  }

  function markAgentIdle(sessionId: string) {
    clearAgentIdleTimer(sessionId);
    const timestamp = now();
    setState((prev) => {
      let changed = false;
      const sessions = prev.sessions.map((session) => {
        if (session.id !== sessionId || !isAgentProvider(session.provider) || session.workState !== "working") {
          return session;
        }
        changed = true;
        return {
          ...session,
          status: isHarnessSession(session) && session.status === "running" ? ("completed" as const) : session.status,
          workState: "stopped" as const,
          updatedAt: timestamp,
          harnessMessages: isHarnessSession(session)
            ? (session.harnessMessages ?? []).filter((message) => !message.transient)
            : session.harnessMessages,
        };
      });
      if (!changed) return prev;
      const next = { ...prev, sessions };
      schedulePersist(next);
      return next;
    });
  }

  function scheduleAgentIdle(sessionId: string, delay = AGENT_OUTPUT_IDLE_MS) {
    clearAgentIdleTimer(sessionId);
    const timer = setTimeout(() => {
      markAgentIdle(sessionId);
    }, delay);
    agentIdleTimersRef.current.set(sessionId, timer);
  }

  function markAgentWorking(sessionId: string) {
    clearAgentIdleTimer(sessionId);
    const timestamp = now();
    setState((prev) => {
      let changed = false;
      const sessions = prev.sessions.map((session) => {
        if (session.id !== sessionId || !isAgentProvider(session.provider)) return session;
        changed = true;
        return {
          ...session,
          status: "running" as const,
          workState: "working" as const,
          unread: false,
          lastActivityAt: timestamp,
          lastViewedAt: session.id === prev.activeSessionId ? timestamp : session.lastViewedAt ?? null,
          updatedAt: timestamp,
          historyLinkStatus: session.linkedHistorySessionId ? session.historyLinkStatus ?? "linked" : "pending",
          historyLinkLastTriedAt: session.linkedHistorySessionId ? session.historyLinkLastTriedAt ?? null : null,
          historyLinkLastReason: session.linkedHistorySessionId ? session.historyLinkLastReason ?? null : null,
        };
      });
      if (!changed) return prev;
      const next = { ...prev, sessions };
      schedulePersist(next);
      return next;
    });
    scheduleAgentIdle(sessionId, AGENT_SUBMIT_IDLE_FALLBACK_MS);
  }

  function markAgentTurnComplete(sessionId: string, failed = false) {
    clearAgentIdleTimer(sessionId);
    const timestamp = now();
    setState((prev) => {
      let changed = false;
      const sessions = prev.sessions.map((session) => {
        if (session.id !== sessionId || !isAgentProvider(session.provider)) return session;
        changed = true;
        const isActive = session.id === prev.activeSessionId;
        return {
          ...session,
          status: failed ? ("error" as const) : ("completed" as const),
          workState: "stopped" as const,
          unread: isActive ? false : true,
          lastActivityAt: timestamp,
          lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
          updatedAt: timestamp,
        };
      });
      if (!changed) return prev;
      const next = { ...prev, sessions };
      schedulePersist(next);
      return next;
    });
  }

  function handleAgentHookEvent(event: AgentHookEvent) {
    const conversationIds = getHookConversationIds(event);
    const provider = event.provider === "claude" || event.provider === "codex" ? event.provider : null;
    if (event.event === "UserPromptSubmit") {
      if (event.sessionId) markAgentWorking(event.sessionId);
      markExternalAgentRunning(conversationIds, "hook", { provider, ttlMs: AGENT_STALE_WORKING_MS, timestamp: normalizeAgentEventTimestamp(event.timestamp) });
      return;
    }
    if (event.event === "Stop" || event.event === "agent-turn-complete" || event.event === "TurnComplete") {
      if (event.sessionId) markAgentTurnComplete(event.sessionId);
      clearExternalAgentRunning(conversationIds);
      return;
    }
    if (event.event === "StopFailure") {
      if (event.sessionId) markAgentTurnComplete(event.sessionId, true);
      clearExternalAgentRunning(conversationIds);
    }
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savingIndicatorTimerRef.current) clearTimeout(savingIndicatorTimerRef.current);
      saveInFlightCountRef.current = 0;
      agentIdleTimersRef.current.forEach((timer) => clearTimeout(timer));
      agentIdleTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!hookEventsDir) return;

    const timer = setInterval(() => {
      const hookSessions = latestStateRef.current.sessions.filter((session) => usesAgentHooks(session.provider));
      hookSessions.forEach((session) => {
        invoke<string>("read_file", { path: getAgentHookEventFile(hookEventsDir, session.id) })
          .then((content) => {
            const lines = content.split(/\r?\n/).filter(Boolean);
            if (!hookLineCountsRef.current.has(session.id)) {
              hookLineCountsRef.current.set(session.id, lines.length);
              return;
            }
            const offset = hookLineCountsRef.current.get(session.id) ?? 0;
            hookLineCountsRef.current.set(session.id, lines.length);
            lines.slice(offset).forEach((line) => {
              try {
                handleAgentHookEvent(JSON.parse(line) as AgentHookEvent);
              } catch {
                // Ignore malformed hook output; hooks should never block the agent UI.
              }
            });
          })
          .catch(() => {});
      });
    }, 500);

    return () => clearInterval(timer);
  }, [hookEventsDir]);

  useEffect(() => {
    const unlistenHarness = listen<AgentHarnessEvent>("agent-harness-event", (event) => {
      const payload = normalizeAgentHarnessEvent(event.payload);
      if (!payload) return;
      logHarnessEventDebug("receive", payload);
      if (payload.kind === "exit" || payload.kind === "error" || isHarnessCompletionEvent(payload) || isHarnessFailureEvent(payload)) {
        clearAgentIdleTimer(payload.sessionId);
        clearExternalAgentRunning(getHookConversationIds({ sessionId: payload.sessionId, event: "Stop" }));
      } else if (payload.kind === "started" || getHarnessEventDebugTextLength(payload) > 0) {
        scheduleAgentIdle(payload.sessionId, AGENT_STALE_WORKING_MS);
      }
      setState((prev) => {
        let changed = false;
        const sessions = prev.sessions.map((session) => {
          if (session.id !== payload.sessionId) return session;
          changed = true;
          return applyHarnessEventToSession(session, payload, prev.activeSessionId);
        });
        if (!changed) return prev;
        const next = { ...prev, sessions };
        schedulePersist(next);
        return next;
      });
    });

    return () => {
      unlistenHarness.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlistenData = listen<PtyDataEvent>("pty-data", (event) => {
      if (event.payload.data.length === 0) return;
      const timestamp = now();
      latestStateRef.current.sessions
        .filter(
          (session) =>
            session.ptyId === event.payload.id &&
            isAgentProvider(session.provider) &&
            !usesAgentHooks(session.provider) &&
            session.status === "running",
        )
        .forEach((session) => scheduleAgentIdle(session.id));
      setState((prev) => {
        let changed = false;
        const sessions = prev.sessions.map((session) => {
          if (session.ptyId !== event.payload.id) return session;
          changed = true;
          const isActive = session.id === prev.activeSessionId;
          const isActiveAgentTurn =
            isAgentProvider(session.provider) &&
            !usesAgentHooks(session.provider) &&
            session.status === "running";
          return {
            ...session,
            workState: isActiveAgentTurn ? ("working" as const) : session.workState,
            unread: !isActive,
            lastActivityAt: timestamp,
            lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
            updatedAt: timestamp,
          };
        });
        if (!changed) return prev;
        const next = { ...prev, sessions };
        schedulePersist(next);
        return next;
      });
    });

    const unlistenExit = listen<PtyExitEvent>("pty-exit", (event) => {
      const timestamp = now();
      const exitingSessionIds = latestStateRef.current.sessions
        .filter((session) => session.ptyId === event.payload.id)
        .map((session) => session.id);
      if (exitingSessionIds.length > 0) {
        exitingSessionIds.forEach((id) => clearAgentIdleTimer(id));
        setLaunchingIds((prev) => {
          const next = new Set(prev);
          exitingSessionIds.forEach((id) => next.delete(id));
          return next;
        });
        setAttachedPtyIds((prev) => {
          const next = new Set(prev);
          next.delete(event.payload.id);
          return next;
        });
      }
      setState((prev) => {
        let changed = false;
        let conversationMetaChanged = false;
        const conversationMeta = { ...(prev.conversationMeta ?? {}) };
        const currentHistorySessions = historySessionsRef.current;
        const sessions = prev.sessions.map((session) => {
          if (session.ptyId !== event.payload.id) return session;
          changed = true;
          const isActive = session.id === prev.activeSessionId;
          const linkedTranscript = session.linkedHistorySessionId
            ? currentHistorySessions.find((item) => item.id === session.linkedHistorySessionId)
            : undefined;
          if (linkedTranscript) {
            const conversationId = getRuntimeConversationId(session, linkedTranscript);
            conversationMeta[conversationId] = {
              ...(conversationMeta[conversationId] ?? {}),
              displayMode: "standard",
              id: conversationId,
            };
            conversationMetaChanged = true;
          }
          return {
            ...session,
            status: session.status === "needs-review" ? session.status : ("completed" as const),
            workState: "stopped" as const,
            unread: isActive ? false : true,
            lastActivityAt: timestamp,
            lastViewedAt: isActive ? timestamp : session.lastViewedAt ?? null,
            updatedAt: timestamp,
          };
        });
        if (!changed) return prev;
        const next = {
          ...prev,
          sessions,
          conversationMeta: conversationMetaChanged ? conversationMeta : prev.conversationMeta,
        };
        schedulePersist(next);
        return next;
      });
    });

    return () => {
      unlistenData.then((fn) => fn());
      unlistenExit.then((fn) => fn());
    };
  }, []);

  const updateSession = (sessionId: string, updater: (session: AgentSession) => AgentSession) => {
    const base = latestStateRef.current;
    const next: AgentWorkspaceState = {
      ...base,
      sessions: base.sessions.map((session) => (session.id === sessionId ? updater(session) : session)),
    };
    persist(next).catch(console.error);
  };

  const getLinkedTranscript = (session: AgentSession) =>
    session.linkedHistorySessionId ? historySessions.find((item) => item.id === session.linkedHistorySessionId) : undefined;

  const getAgentConversationId = (session: AgentSession) => getRuntimeConversationId(session, getLinkedTranscript(session));

  const openLinkedChatAfterRuntimeExit = (session: AgentSession, transcript?: Session | null) => {
    const linkedTranscript = transcript ?? getLinkedTranscript(session);
    if (!linkedTranscript) return;
    console.log("[DEBUG][WorkspaceDayOverview] openLinkedChatAfterRuntimeExit:", {
      sessionId: session.id,
      linkedTranscriptId: linkedTranscript.id,
      selectedDayOverview,
    });

    const conversationId = getRuntimeConversationId(session, linkedTranscript);
    const base = latestStateRef.current;
    const timestamp = now();
    const nextSidebar = normalizeSidebarState({
      ...(base.sidebar ?? {}),
      sessionListMode: "active",
      activeConversationId: conversationId,
    });

    persist({
      ...base,
      conversationMeta: withConversationMeta(conversationId, {
        displayMode: "standard",
      }, base.conversationMeta ?? {}),
      sidebar: nextSidebar,
      sessions: base.sessions.map((current) =>
        current.id === session.id
          ? {
              ...current,
              status: current.status === "needs-review" ? current.status : "completed",
              workState: "stopped",
              unread: false,
              lastViewedAt: timestamp,
              updatedAt: timestamp,
            }
          : current,
      ),
    }).catch(console.error);

    setSessionListMode(nextSidebar.sessionListMode);
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setMainPanelClosed(false);
    setSelectedHistorySession(linkedTranscript);
    setSelectedCwd(linkedTranscript.project_path ?? session.cwd);
    setCreatingSession(false);
  };

  const selectedProjectPath = selectedHistorySession?.project_path ?? selectedCwd ?? (!creatingSession && !mainPanelClosed ? activeSession?.cwd : null);
  const selectedProjectEnvKey = normalizeEnvironmentKey(selectedProjectPath);
  const selectedSpecificSessionEnvKey = selectedHistorySession
    ? getHistoryConversationId(selectedHistorySession)
    : activeSession
      ? getAgentConversationId(activeSession)
      : null;
  const selectedDefaultSessionEnvKey = getDefaultSessionEnvironmentKey(selectedProjectPath);
  const selectedSessionSaveKey = selectedSpecificSessionEnvKey ?? selectedDefaultSessionEnvKey;
  const selectedSessionConfigKey =
    selectedSpecificSessionEnvKey && state.sessionEnvironments?.[selectedSpecificSessionEnvKey]
      ? selectedSpecificSessionEnvKey
      : selectedDefaultSessionEnvKey;
  const selectedEnvironmentSessionTitle = selectedHistorySession
    ? getHistorySessionTitle(selectedHistorySession, t("common.untitledConversation"))
    : activeSession
      ? getSessionDisplayTitle(activeSession, { shell: t("chat.shell"), newSession: t("chat.newSession") })
      : selectedProjectPath
        ? t("environment.projectSessions", { project: getEnvironmentProjectName(selectedProjectPath) })
      : null;
  const selectedGlobalEnvironment = state.globalEnvironment ?? null;
  const selectedProjectEnvironment = selectedProjectEnvKey
    ? state.projectEnvironments?.[selectedProjectEnvKey] ?? null
    : null;
  const selectedSessionEnvironment = selectedSessionConfigKey
    ? state.sessionEnvironments?.[selectedSessionConfigKey] ?? null
    : null;
  const environmentProjectPath = environmentDialogTarget ? environmentDialogTarget.projectPath : selectedProjectPath;
  const environmentProjectEnvKey = normalizeEnvironmentKey(environmentProjectPath);
  const environmentDefaultSessionEnvKey = getDefaultSessionEnvironmentKey(environmentProjectPath);
  const environmentSpecificSessionKey = environmentDialogTarget
    ? environmentDialogTarget.sessionKey
    : selectedSpecificSessionEnvKey;
  const environmentSessionKey = environmentDialogTarget
    ? environmentDialogTarget.sessionKey ?? environmentDefaultSessionEnvKey
    : selectedSessionSaveKey;
  const environmentSessionConfigKey =
    environmentSpecificSessionKey && state.sessionEnvironments?.[environmentSpecificSessionKey]
      ? environmentSpecificSessionKey
      : environmentSessionKey;
  const environmentSessionTitle =
    environmentDialogTarget?.sessionTitle ??
    selectedEnvironmentSessionTitle ??
    (environmentProjectPath ? t("environment.projectSessions", { project: getEnvironmentProjectName(environmentProjectPath) }) : null);
  const environmentProjectConfig = environmentProjectEnvKey
    ? state.projectEnvironments?.[environmentProjectEnvKey] ?? null
    : null;
  const environmentSessionConfig = environmentSessionConfigKey
    ? state.sessionEnvironments?.[environmentSessionConfigKey] ?? null
    : null;
  const currentEnvironmentPlatform = getCurrentEnvironmentPlatform();
  const getRunnableEnvironmentAction = (config?: EnvironmentConfig | null) =>
    config?.actions.find((action) => {
      const script = action.platformSpecific
        ? getEnvironmentScript(action.scripts, currentEnvironmentPlatform)
        : action.scripts.default?.trim() ?? "";
      return Boolean(script);
    }) ?? null;
  const sessionPrimaryEnvironmentAction = getRunnableEnvironmentAction(selectedSessionEnvironment);
  const projectPrimaryEnvironmentAction = getRunnableEnvironmentAction(selectedProjectEnvironment);
  const globalPrimaryEnvironmentAction = getRunnableEnvironmentAction(selectedGlobalEnvironment);
  const primaryEnvironmentAction = sessionPrimaryEnvironmentAction ?? projectPrimaryEnvironmentAction ?? globalPrimaryEnvironmentAction;
  const primaryEnvironmentConfig = sessionPrimaryEnvironmentAction
    ? selectedSessionEnvironment
    : projectPrimaryEnvironmentAction
      ? selectedProjectEnvironment
      : globalPrimaryEnvironmentAction
        ? selectedGlobalEnvironment
      : null;
  const primaryEnvironmentScope: EnvironmentScope = sessionPrimaryEnvironmentAction
    ? "session"
    : projectPrimaryEnvironmentAction
      ? "project"
      : "global";

  const handleEnvironmentDialogOpenChange = (open: boolean) => {
    setEnvironmentDialogOpen(open);
    if (!open) setEnvironmentDialogTarget(null);
  };

  const openEnvironmentDialog = (scope: EnvironmentScope) => {
    setEnvironmentDialogTarget(null);
    setEnvironmentDefaultScope(scope);
    setEnvironmentDialogOpen(true);
  };

  const openProjectEnvironmentDialog = (path: string) => {
    setEnvironmentDialogTarget({ projectPath: path, sessionKey: null, sessionTitle: null });
    setEnvironmentDefaultScope("project");
    setEnvironmentDialogOpen(true);
  };

  const openConversationEnvironmentDialog = (row: WorkbenchConversation) => {
    const title = row.transcript
      ? getHistorySessionTitle(row.transcript, t("common.untitledConversation"))
      : row.runtime
        ? getSessionDisplayTitle(row.runtime, { shell: t("chat.shell"), newSession: t("chat.newSession") })
        : t("common.untitledConversation");
    setEnvironmentDialogTarget({
      projectPath: row.projectPath,
      sessionKey: row.conversationId,
      sessionTitle: title,
    });
    setEnvironmentDefaultScope("session");
    setEnvironmentDialogOpen(true);
  };

  const handleEnvironmentProjectPathChange = (path: string) => {
    setEnvironmentDialogTarget({ projectPath: path, sessionKey: null, sessionTitle: null });
  };

  const pickEnvironmentProjectFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string" && picked.length > 0) {
      setEnvironmentDialogTarget({ projectPath: picked, sessionKey: null, sessionTitle: null });
    }
  };

  const saveEnvironmentConfig = (scope: EnvironmentScope, config: EnvironmentConfig) => {
    const key =
      scope === "project"
        ? environmentProjectEnvKey
        : scope === "session"
          ? environmentSessionKey
          : "";
    if (scope !== "global" && !key) return;
    const base = latestStateRef.current;
    const next: AgentWorkspaceState =
      scope === "global"
        ? {
            ...base,
            globalEnvironment: config,
          }
        : scope === "project"
        ? {
            ...base,
            projectEnvironments: {
              ...(base.projectEnvironments ?? {}),
              [key]: config,
            },
          }
        : {
            ...base,
            sessionEnvironments: {
              ...(base.sessionEnvironments ?? {}),
              [key]: config,
            },
          };
    persist(next).catch(console.error);
  };

  const closeEnvironmentTerminal = () => {
    setEnvironmentTerminal((current) => {
      if (current) {
        disposeTerminal(current.ptyId);
        invoke("pty_kill", { id: current.ptyId }).catch(() => {});
        invoke("pty_purge_scrollback", { id: current.ptyId }).catch(() => {});
      }
      return null;
    });
  };

  const runEnvironmentConfig = (
    scope: EnvironmentScope,
    kind: EnvironmentRunKind,
    config: EnvironmentConfig,
    action?: EnvironmentAction,
  ) => {
    const cwd = environmentProjectPath;
    if (!cwd) return;
    const platform = getCurrentEnvironmentPlatform();
    const scripts =
      kind === "setup"
        ? config.setupScripts
        : kind === "cleanup"
          ? config.cleanupScripts
          : action?.platformSpecific
            ? action.scripts
            : { default: action?.scripts.default ?? "" };
    const script = getEnvironmentScript(scripts, platform);
    if (!script) return;

    closeEnvironmentTerminal();
    const ptyId = crypto.randomUUID();
    const sessionLabel = scope === "session" && environmentSessionTitle
      ? environmentSessionTitle
      : scope === "global"
        ? t("environment.globalRuntime")
      : config.name;
    const title =
      kind === "action"
        ? `${action?.name || t("environment.actionFallback")} · ${sessionLabel}`
        : `${kind === "setup" ? t("environment.setup") : t("environment.cleanup")} · ${sessionLabel}`;
    const command = buildEnvironmentCommand(script, cwd, {
      CODEX_SOURCE_TREE_PATH: cwd,
      CODEX_WORKTREE_PATH: cwd,
      LOVCODE_PROJECT_PATH: cwd,
      LOVCODE_SESSION_ID: scope === "session" && !isDefaultSessionEnvironmentKey(environmentSessionKey)
        ? environmentSpecificSessionKey ?? environmentSessionKey
        : undefined,
      LOVCODE_ENV_SCOPE: scope,
    });

    setEnvironmentTerminal({
      ptyId,
      cwd,
      command,
      title,
      subtitle: cwd,
      hidden: false,
      running: true,
    });
  };

  const withConversationMeta = (
    conversationId: string,
    patch: Partial<WorkbenchConversationMeta>,
    base: Record<string, WorkbenchConversationMeta> = state.conversationMeta ?? {},
  ) => ({
    ...base,
    [conversationId]: {
      ...(base[conversationId] ?? {}),
      ...patch,
      id: conversationId,
    },
  });

  const setActiveSession = (sessionId: string) => {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (session) setSelectedCwd(session.cwd);
    if (session) setPersistedActiveConversationId(getAgentConversationId(session), { immediate: false });
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    setCreatingSession(false);
    const timestamp = now();
    persist({
      ...state,
      activeSessionId: sessionId,
      sessions: state.sessions.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              unread: false,
              lastViewedAt: timestamp,
            }
          : item,
      ),
    }).catch(console.error);
  };

  const createSession = async (
    provider: AgentProvider,
    prompt: string,
    launchMode: AgentLaunchMode = "standard",
    options?: {
      cwd?: string | null;
      title?: string;
      resumeHistorySession?: Session;
      fork?: {
        parentSessionId: string;
        fromMessageId: string;
        fromTitle: string;
      };
      focusRuntime?: boolean;
    },
  ) => {
    if (provider !== "terminal" && launchMode === "standard" && !prompt.trim()) return;
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    const requestedCwd = options?.cwd ?? options?.resumeHistorySession?.project_path ?? selectedCwd;
    let cwd = requestedCwd;
    if (!cwd) {
      try {
        cwd = await ensurePlainChatWorkspace();
      } catch (error) {
        console.error("Failed to prepare general chat workspace:", error);
        return;
      }
    }
    const effectiveLaunchMode: AgentLaunchMode = provider === "terminal" ? "cli" : launchMode;
    const runtime = runtimeForLaunch(provider, effectiveLaunchMode);
    const harness = isHarnessRuntime(runtime);
    if (options?.resumeHistorySession && (harness || !options.focusRuntime)) {
      setSelectedHistorySession(options.resumeHistorySession);
    } else {
      setSelectedHistorySession(null);
    }
    setMainPanelClosed(false);
    const timestamp = now();
    const id = crypto.randomUUID();
    const ptyId = harness ? null : crypto.randomUUID();
    const startsWorking = hasAgentPrompt(provider, prompt);
    let hookEnv: Record<string, string> | undefined;
    if (!harness && usesAgentHooks(provider)) {
      try {
        hookEnv = getAgentHookEnv(await ensureAgentHookConfig(provider, id), id);
      } catch (error) {
        console.error(`Failed to prepare ${labelForProvider(provider)} hooks:`, error);
      }
    }
    const session: AgentSession = {
      id,
      provider,
      runtime,
      cwd,
      command: harness
        ? getHarnessDisplayCommand(provider, prompt, options?.resumeHistorySession?.id)
        : getSessionCommand(provider, prompt, hookEnv, options?.resumeHistorySession?.id) ?? null,
      initialInput: harness ? null : getInitialInput(provider, prompt) ?? null,
      submittedPrompt: prompt.trim() || null,
      status: startsWorking ? "running" : "idle",
      workState: startsWorking ? "working" : "idle",
      ptyId,
      harnessMessages: harness && prompt.trim()
        ? [
            createHarnessUserMessage(id, prompt, timestamp),
            createHarnessAssistantPlaceholderMessage(id, timestamp),
          ]
        : [],
      harnessRunId: harness ? id : null,
      harnessExitCode: null,
      title: options?.title ?? makeSessionTitle(provider, prompt),
      linkedHistorySessionId: options?.resumeHistorySession?.id ?? null,
      historyLinkStatus: options?.resumeHistorySession ? "linked" : isAgentProvider(provider) && prompt.trim() ? "pending" : null,
      historyLinkLastTriedAt: null,
      historyLinkLastReason: null,
      forkParentSessionId: options?.fork?.parentSessionId ?? null,
      forkFromMessageId: options?.fork?.fromMessageId ?? null,
      forkedFromTitle: options?.fork?.fromTitle ?? null,
      archived: false,
      archivedAt: null,
      unread: false,
      lastActivityAt: timestamp,
      lastViewedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const linkedConversationId = options?.resumeHistorySession ? getHistoryConversationId(options.resumeHistorySession) : `runtime:${id}`;
    if (!harness) setLaunchingIds((prev) => new Set(prev).add(id));
    setPersistedActiveConversation(linkedConversationId, { immediate: false });
    setMainPanelClosed(false);
    setCreatingSession(false);
    setSelectedCwd(cwd);
    persist({
      ...state,
      sessions: [session, ...state.sessions],
      conversationMeta: withConversationMeta(linkedConversationId, {
        archived: false,
        archivedAt: null,
        displayMode: harness ? "standard" as const : options?.focusRuntime ? "cli" as const : "standard" as const,
      }),
      activeSessionId: id,
    }).catch(console.error);
    if (harness) startHarnessSession(session, prompt, options?.resumeHistorySession?.id ?? null);
  };

  const createRuntimeForHistorySession = async (historySession: Session) => {
    const provider = providerForTranscript(historySession);
    const cwd = historySession.project_path;
    if (!provider || !cwd || !canResumeTranscriptLocally(historySession)) {
      console.warn("Cannot create a local PTY runtime for this session", {
        sessionId: historySession.id,
        source: historySession.source,
        projectPath: historySession.project_path,
      });
      return;
    }

    const conversationId = getHistoryConversationId(historySession);
    const timestamp = now();
    const existingRuntime = latestStateRef.current.sessions.find(
      (session) =>
        session.linkedHistorySessionId === historySession.id &&
        transcriptMatchesProvider(session, historySession) &&
        !isHarnessSession(session),
    );

    if (existingRuntime) {
      const base = latestStateRef.current;
      setSelectedHistorySession(null);
      setSelectedCwd(existingRuntime.cwd);
      setSelectedProjectDetailsPath(null);
      setSelectedDayOverview(null);
      setMainPanelClosed(false);
      setCreatingSession(false);
      persist({
        ...base,
        conversationMeta: withConversationMeta(conversationId, {
          archived: false,
          archivedAt: null,
          displayMode: "cli",
        }, base.conversationMeta ?? {}),
        sidebar: normalizeSidebarState({
          ...(base.sidebar ?? {}),
          sessionListMode: "active",
          activeConversationId: conversationId,
        }),
        sessions: base.sessions.map((item) =>
          item.id === existingRuntime.id
            ? {
                ...item,
                archived: false,
                archivedAt: null,
                unread: false,
                lastViewedAt: timestamp,
                updatedAt: timestamp,
                historyLinkStatus: "linked",
                historyLinkLastReason: null,
              }
            : item,
        ),
        activeSessionId: existingRuntime.id,
      }).catch(console.error);
      return;
    }

    const id = crypto.randomUUID();
    const ptyId = crypto.randomUUID();
    let hookEnv: Record<string, string> | undefined;
    if (usesAgentHooks(provider)) {
      try {
        hookEnv = getAgentHookEnv(await ensureAgentHookConfig(provider, id), id);
      } catch (error) {
        console.error(`Failed to prepare ${labelForProvider(provider)} hooks:`, error);
      }
    }

    const runtimeSession: AgentSession = {
      id,
      provider,
      runtime: runtimeForProvider(provider),
      cwd,
      command: getSessionCommand(provider, "", hookEnv, historySession.id) ?? null,
      initialInput: null,
      submittedPrompt: null,
      status: "idle",
      workState: "idle",
      ptyId,
      title: getHistorySessionTitle(historySession, t("common.untitledConversation")),
      linkedHistorySessionId: historySession.id,
      historyLinkStatus: "linked",
      historyLinkLastTriedAt: null,
      historyLinkLastReason: null,
      forkParentSessionId: null,
      forkFromMessageId: null,
      forkedFromTitle: null,
      archived: false,
      archivedAt: null,
      unread: false,
      lastActivityAt: timestamp,
      lastViewedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const base = latestStateRef.current;
    setLaunchingIds((prev) => new Set(prev).add(id));
    setSelectedHistorySession(null);
    setSelectedCwd(cwd);
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setMainPanelClosed(false);
    setCreatingSession(false);
    persist({
      ...base,
      sessions: [runtimeSession, ...base.sessions],
      conversationMeta: withConversationMeta(conversationId, {
        archived: false,
        archivedAt: null,
        displayMode: "cli",
      }, base.conversationMeta ?? {}),
      sidebar: normalizeSidebarState({
        ...(base.sidebar ?? {}),
        sessionListMode: "active",
        activeConversationId: conversationId,
      }),
      activeSessionId: id,
    }).catch(console.error);
  };

  const relaunchSession = async (session: AgentSession) => {
    if (isHarnessSession(session)) {
      const prompt = getSessionSubmittedPrompt(session);
      if (!prompt) return;
      const timestamp = now();
      updateSession(session.id, (current) => ({
        ...current,
        status: "running",
        workState: "working",
        command: getHarnessDisplayCommand(current.provider, prompt, current.linkedHistorySessionId ?? undefined),
        harnessRunId: crypto.randomUUID(),
        harnessExitCode: null,
        harnessMessages: [
          createHarnessUserMessage(current.id, prompt, timestamp),
          createHarnessAssistantPlaceholderMessage(current.id, timestamp),
        ],
        unread: false,
        lastActivityAt: timestamp,
        lastViewedAt: timestamp,
        updatedAt: timestamp,
      }));
      startHarnessSession(session, prompt, session.linkedHistorySessionId ?? null);
      return;
    }

    const ptyId = crypto.randomUUID();
    const startsWorking = hasReusableAgentPrompt(session);
    let hookEnv: Record<string, string> | undefined;
    if (usesAgentHooks(session.provider)) {
      try {
        hookEnv = getAgentHookEnv(await ensureAgentHookConfig(session.provider, session.id), session.id);
      } catch (error) {
        console.error(`Failed to prepare ${labelForProvider(session.provider)} hooks:`, error);
      }
    }
    setLaunchingIds((prev) => new Set(prev).add(session.id));
    updateSession(session.id, (current) => ({
      ...current,
      status: startsWorking ? "running" : "idle",
      workState: startsWorking ? "working" : "idle",
      ptyId,
      command: current.command
        ? hookEnv
          ? prefixCommandEnv(stripLovcodeHookEnvPrefix(current.command), hookEnv)
          : current.command
        : current.command,
      unread: false,
      lastActivityAt: now(),
      lastViewedAt: now(),
      updatedAt: now(),
    }));
  };

  const stopSession = (session: AgentSession) => {
    if (isHarnessSession(session)) {
      invoke("cancel_agent_harness_session", { sessionId: session.id }).catch(() => {});
      clearAgentIdleTimer(session.id);
      updateSession(session.id, (current) => ({
        ...current,
        status: "completed",
        workState: "stopped",
        unread: false,
        updatedAt: now(),
      }));
      return;
    }

    if (session.ptyId) {
      disposeTerminal(session.ptyId);
      invoke("pty_kill", { id: session.ptyId }).catch(() => {});
    }
    setLaunchingIds((prev) => {
      const next = new Set(prev);
      next.delete(session.id);
      return next;
    });
    clearAgentIdleTimer(session.id);
    setAttachedPtyIds((prev) => {
      const next = new Set(prev);
      if (session.ptyId) next.delete(session.ptyId);
      return next;
    });
    updateSession(session.id, (current) => ({
      ...current,
      status: "completed",
      workState: "stopped",
      unread: false,
      updatedAt: now(),
    }));
  };

  const archiveSession = (session: AgentSession) => {
    if (isHarnessSession(session) && isAgentRunning(session)) {
      invoke("cancel_agent_harness_session", { sessionId: session.id }).catch(() => {});
    }
    if (session.ptyId) {
      disposeTerminal(session.ptyId);
      invoke("pty_kill", { id: session.ptyId }).catch(() => {});
    }
    clearAgentIdleTimer(session.id);
    setLaunchingIds((prev) => {
      const next = new Set(prev);
      next.delete(session.id);
      return next;
    });
    setAttachedPtyIds((prev) => {
      const next = new Set(prev);
      if (session.ptyId) next.delete(session.ptyId);
      return next;
    });
    const timestamp = now();
    const conversationId = getAgentConversationId(session);
    const runtimeRows = allWorkbenchRows.filter((row) => row.runtime);
    const nextActiveSession =
      runtimeRows.find((row) => row.runtime!.id !== session.id && !row.archived && row.runtime!.cwd === session.cwd)?.runtime ??
      runtimeRows.find((row) => row.runtime!.id !== session.id && !row.archived)?.runtime ??
      null;
    const nextActive = state.activeSessionId === session.id ? nextActiveSession?.id ?? null : state.activeSessionId ?? null;
    const linkedTranscript = getLinkedTranscript(session);
    const selectedLinkedTranscript =
      linkedTranscript &&
      selectedHistorySession?.id === linkedTranscript.id &&
      selectedHistorySession.project_id === linkedTranscript.project_id;
    if (state.activeSessionId === session.id || selectedLinkedTranscript) {
      setSelectedHistorySession(null);
      setSelectedCwd(nextActiveSession?.cwd ?? selectedCwd);
      setCreatingSession(!nextActiveSession);
    }
    if (
      normalizeSidebarState(latestStateRef.current.sidebar).activeConversationId === conversationId ||
      state.activeSessionId === session.id ||
      selectedLinkedTranscript
    ) {
      setPersistedActiveConversationId(nextActiveSession ? getAgentConversationId(nextActiveSession) : null, { immediate: false });
    }
    persist({
      ...state,
      conversationMeta: withConversationMeta(conversationId, {
        archived: true,
        archivedAt: timestamp,
        unread: false,
      }),
      sessions: state.sessions.map((item) =>
        item.id === session.id
          ? {
              ...item,
              archived: true,
              archivedAt: timestamp,
              status: item.status === "running" ? ("completed" as const) : item.status,
              workState: "stopped" as const,
              unread: false,
              lastActivityAt: timestamp,
              lastViewedAt: timestamp,
              updatedAt: timestamp,
            }
          : item,
      ),
      activeSessionId: nextActive,
    }).catch(console.error);
  };

  const restoreSession = (session: AgentSession) => {
    const timestamp = now();
    const conversationId = getAgentConversationId(session);
    setSelectedCwd(session.cwd);
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setSelectedHistorySession(null);
    setPersistedActiveConversation(conversationId, { immediate: false });
    setMainPanelClosed(false);
    setCreatingSession(false);
    persist({
      ...state,
      conversationMeta: withConversationMeta(conversationId, {
        archived: false,
        archivedAt: null,
        unread: false,
      }),
      sessions: state.sessions.map((item) =>
        item.id === session.id
          ? {
              ...item,
              archived: false,
              archivedAt: null,
              unread: false,
              lastViewedAt: timestamp,
              updatedAt: timestamp,
            }
          : item,
      ),
      activeSessionId: session.id,
    }).catch(console.error);
  };

  const archiveHistorySession = (session: Session) => {
    const timestamp = now();
    const conversationId = getHistoryConversationId(session);
    const selected =
      selectedHistorySession?.id === session.id && selectedHistorySession.project_id === session.project_id;
    if (selected) {
      setSelectedHistorySession(null);
      setCreatingSession(!activeSession);
    }
    if (selected || normalizeSidebarState(latestStateRef.current.sidebar).activeConversationId === conversationId) {
      setPersistedActiveConversationId(activeSession ? getAgentConversationId(activeSession) : null, { immediate: false });
    }
    persist({
      ...state,
      conversationMeta: withConversationMeta(conversationId, {
        archived: true,
        archivedAt: timestamp,
        unread: false,
      }),
    }).catch(console.error);
  };

  const restoreHistorySession = (session: Session) => {
    const conversationId = getHistoryConversationId(session);
    setSelectedCwd(session.project_path);
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setSelectedHistorySession(null);
    setPersistedActiveConversation(conversationId, { immediate: false });
    setMainPanelClosed(false);
    setCreatingSession(false);
    persist({
      ...state,
      conversationMeta: withConversationMeta(conversationId, {
        archived: false,
        archivedAt: null,
        unread: false,
      }),
    }).catch(console.error);
  };

  const pickFolder = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string" && picked.length > 0) {
      setSelectedCwd(picked);
      setSelectedProjectDetailsPath(null);
      setSelectedDayOverview(null);
      setSelectedHistorySession(null);
      setMainPanelClosed(false);
      setPersistedActiveConversation(null);
      setCreatingSession(true);
    }
  };

  const openNewSession = () => {
    setSelectedCwd(null);
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    setPersistedActiveConversation(null);
    setCreatingSession(true);
  };

  const openNewSessionForProject = (path: string) => {
    setSelectedCwd(path);
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    setPersistedActiveConversation(null);
    setCreatingSession(true);
  };

  const selectComposerCwd = (path: string | null) => {
    if (path) {
      openNewSessionForProject(path);
      return;
    }
    openNewSession();
  };

  const openProjectDetails = (path: string) => {
    projectDetailsOpenRef.current = true;
    setSelectedCwd(path);
    setSelectedProjectDetailsPath(path);
    setSelectedDayOverview(null);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    setCreatingSession(false);
    restoredConversationIdRef.current = null;
    const base = latestStateRef.current;
    const nextState = normalizeWorkspaceState({
      ...base,
      activeSessionId: null,
      sidebar: normalizeSidebarState({
        ...(base.sidebar ?? {}),
        sessionListMode: "active",
        activeConversationId: null,
      }),
    }, "next");
    latestStateRef.current = nextState;
    setState(nextState);
    persist(nextState).catch(console.error);
  };

  useEffect(() => {
    if (!routeProjectPath || routeSessionId) {
      routeProjectDetailsRestoredRef.current = null;
      return;
    }
    if (!loaded || loadingHistorySessions) return;
    if (selectedDayOverview !== null) {
      console.log("[DEBUG][WorkspaceDayOverview] skip route project restore while day overview is open:", {
        routeProjectPath: Boolean(routeProjectPath),
        selectedDayOverview,
      });
      return;
    }

    const routeKey = getProjectGroupKey(routeProjectPath, mergeWorktrees) || normalizeProjectPath(routeProjectPath);
    if (!routeKey) return;

    const targetPath =
      projectPaths.find((path) => getProjectGroupKey(path, mergeWorktrees) === routeKey) ??
      allWorkbenchRows.find((row) => getProjectGroupKey(row.projectPath, mergeWorktrees) === routeKey)?.projectPath ??
      projects.find((project) => getProjectGroupKey(project.path, mergeWorktrees) === routeKey)?.path ??
      routeProjectPath;
    const targetKey = getProjectGroupKey(targetPath, mergeWorktrees) || normalizeProjectPath(targetPath);
    const currentKey = getProjectGroupKey(selectedProjectDetailsPath, mergeWorktrees);

    if (
      routeProjectDetailsRestoredRef.current === targetKey &&
      selectedProjectDetailsPath &&
      currentKey === targetKey
    ) {
      return;
    }

    routeProjectDetailsRestoredRef.current = targetKey;
    openProjectDetails(targetPath);
  }, [
    routeProjectPath,
    routeSessionId,
    loaded,
    loadingHistorySessions,
    projectPaths,
    allWorkbenchRows,
    projects,
    mergeWorktrees,
    selectedProjectDetailsPath,
    selectedDayOverview,
  ]);

  const activePtyId = activeSession?.ptyId ?? null;
  const activePtyStatusKnown = activePtyId ? ptyStatus.has(activePtyId) : true;
  const activePtyExists = activePtyId ? Boolean(ptyStatus.get(activePtyId)) : false;
  const activePtyAttached = activePtyId ? attachedPtyIds.has(activePtyId) : false;
  const activeLaunching = activeSession ? launchingIds.has(activeSession.id) : false;
  const activeHarnessRunning = isHarnessSession(activeSession) && Boolean(activeSession && isAgentRunning(activeSession));
  const activeConnected = activeHarnessRunning || activePtyExists || activePtyAttached || activeLaunching;
  const shouldMountTerminal = Boolean(activeSession?.ptyId && !isHarnessSession(activeSession) && activeConnected);
  const terminalRestoreOnly = Boolean(activeSession?.ptyId) && !isHarnessSession(activeSession) && !activeConnected;
  const showDayOverviewView = selectedDayOverview !== null && !mainPanelClosed && !creatingSession;
  const showProjectDetailsView = !showDayOverviewView && Boolean(selectedProjectDetailsPath) && !mainPanelClosed && !creatingSession;
  const showNewSessionView = !showDayOverviewView && !showProjectDetailsView && !selectedHistorySession && (creatingSession || mainPanelClosed || !activeSession);

  const getSessionConnected = (session: AgentSession) =>
    isHarnessSession(session)
      ? isAgentRunning(session)
      : session.ptyId
        ? Boolean(ptyStatus.get(session.ptyId)) || attachedPtyIds.has(session.ptyId) || launchingIds.has(session.id)
        : false;
  const activeConversationCount = allWorkbenchRows.filter((row) => !row.archived).length;
  const archivedConversationCount = allWorkbenchRows.filter((row) => row.archived).length;
  const conversationListInitialLoading = !loaded || (!historySessionsComplete && allWorkbenchRows.length === 0);
  const sessionsHeaderTitle = sessionListMode === "archived" ? t("common.archived") : activeLanguage === "zh" ? "历史对话" : "Sessions";
  const sessionsHeaderCount = conversationListInitialLoading
    ? null
    : sessionListMode === "archived"
      ? archivedConversationCount
      : activeConversationCount;
  const toggleProjectCollapsed = (path: string) => {
    const key = getProjectGroupKey(path, mergeWorktrees);
    const next = new Set(expandedProjectPaths);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedProjectPaths(next);
    updateSidebarState({ expandedProjectPaths: [...next] });
  };
  const selectConversation = (row: WorkbenchConversation) => {
    if (row.archived) return;
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setMainPanelClosed(false);
    const displayMode = getConversationDisplayMode(row);
    if (displayMode === "cli" && row.runtime && isHarnessSession(row.runtime) && row.transcript) {
      void createRuntimeForHistorySession(row.transcript);
      return;
    }
    if (row.runtime && isHarnessSession(row.runtime)) {
      setActiveSession(row.runtime.id);
      return;
    }
    if (displayMode === "cli" && row.runtime && row.transcript && !getSessionConnected(row.runtime)) {
      setConversationDisplayMode(row, "standard");
      return;
    }
    if (displayMode === "cli" && !row.runtime && row.transcript) {
      void createRuntimeForHistorySession(row.transcript);
      return;
    }
    if (displayMode === "standard" && row.transcript) {
      setPersistedActiveConversationId(row.conversationId);
      setSelectedHistorySession(row.transcript);
      setSelectedCwd(row.transcript.project_path ?? row.runtime?.cwd ?? row.projectPath);
      setCreatingSession(false);
      return;
    }
    if (row.runtime) {
      setActiveSession(row.runtime.id);
      return;
    }
    if (row.transcript) {
      setPersistedActiveConversationId(row.conversationId);
      setSelectedHistorySession(row.transcript);
      setSelectedCwd(row.transcript.project_path ?? row.projectPath);
      setCreatingSession(false);
    }
  };
  const setConversationDisplayMode = (row: WorkbenchConversation, displayMode: WorkbenchDisplayMode) => {
    if (displayMode === "cli" && row.runtime && isHarnessSession(row.runtime)) {
      if (row.transcript) void createRuntimeForHistorySession(row.transcript);
      else setConversationDisplayMode(row, "standard");
      return;
    }
    if (displayMode === "cli" && !row.runtime && row.transcript) {
      void createRuntimeForHistorySession(row.transcript);
      return;
    }

    const base = latestStateRef.current;
    const timestamp = now();
    const nextState: AgentWorkspaceState = {
      ...base,
      conversationMeta: withConversationMeta(row.conversationId, {
        displayMode,
      }, base.conversationMeta ?? {}),
      sidebar: normalizeSidebarState({
        ...(base.sidebar ?? {}),
        sessionListMode: "active",
        activeConversationId: row.conversationId,
      }),
      activeSessionId: displayMode === "cli" && row.runtime ? row.runtime.id : base.activeSessionId ?? null,
      sessions: displayMode === "cli" && row.runtime
        ? base.sessions.map((item) =>
            item.id === row.runtime!.id
              ? {
                  ...item,
                  unread: false,
                  lastViewedAt: timestamp,
                }
              : item,
          )
        : base.sessions,
    };
    persist(nextState).catch(console.error);
    if (displayMode === "cli" && row.runtime) {
      setSelectedHistorySession(null);
      setSelectedCwd(row.runtime.cwd);
      setSelectedProjectDetailsPath(null);
      setSelectedDayOverview(null);
      setMainPanelClosed(false);
      setCreatingSession(false);
      return;
    }
    if (row.transcript) {
      setSelectedProjectDetailsPath(null);
      setSelectedDayOverview(null);
      setMainPanelClosed(false);
      setSelectedHistorySession(row.transcript);
      setSelectedCwd(row.transcript.project_path ?? row.runtime?.cwd ?? row.projectPath);
      setCreatingSession(false);
      return;
    }
    if (row.runtime) setActiveSession(row.runtime.id);
  };
  const setHistorySessionDisplayMode = (session: Session, displayMode: WorkbenchDisplayMode) => {
    const conversationId = getHistoryConversationId(session);
    const row = allWorkbenchRows.find((item) => item.conversationId === conversationId);
    if (row) {
      setConversationDisplayMode(row, displayMode);
      return;
    }
    persist({
      ...latestStateRef.current,
      conversationMeta: withConversationMeta(conversationId, {
        displayMode,
      }, latestStateRef.current.conversationMeta ?? {}),
    }).catch(console.error);
  };
  const archiveConversation = (row: WorkbenchConversation) => {
    if (row.runtime) {
      archiveSession(row.runtime);
      return;
    }
    if (row.transcript) archiveHistorySession(row.transcript);
  };
  const restoreConversation = (row: WorkbenchConversation) => {
    if (row.runtime) {
      restoreSession(row.runtime);
      return;
    }
    if (row.transcript) restoreHistorySession(row.transcript);
  };
  const setConversationReadState = (row: WorkbenchConversation, unread: boolean) => {
    const timestamp = now();
    persist({
      ...state,
      conversationMeta: withConversationMeta(row.conversationId, {
        unread,
      }),
      sessions: row.runtime
        ? state.sessions.map((current) =>
            current.id === row.runtime!.id
              ? {
                  ...current,
                  unread,
                  lastViewedAt: unread ? current.lastViewedAt ?? null : timestamp,
                  updatedAt: timestamp,
                }
              : current,
          )
        : state.sessions,
    }).catch(console.error);
  };
  const toggleConversationPinnedState = (row: WorkbenchConversation) => {
    persist({
      ...state,
      conversationMeta: withConversationMeta(row.conversationId, {
        pinned: !row.pinned,
      }),
    }).catch(console.error);
  };
  const markConversationNeedsReview = (row: WorkbenchConversation) => {
    const timestamp = now();
    persist({
      ...state,
      conversationMeta: withConversationMeta(row.conversationId, {
        needsReview: true,
        unread: false,
      }),
      sessions: row.runtime
        ? state.sessions.map((current) =>
            current.id === row.runtime!.id
              ? {
                  ...current,
                  status: "needs-review",
                  workState: "stopped",
                  unread: false,
                  lastActivityAt: timestamp,
                  lastViewedAt: timestamp,
                  updatedAt: timestamp,
                }
              : current,
          )
        : state.sessions,
    }).catch(console.error);
  };
  const closeCurrentConversation = () => {
    setSelectedCwd(null);
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setSelectedHistorySession(null);
    setCreatingSession(false);
    setMainPanelClosed(true);
    restoredConversationIdRef.current = null;
    routeSelectionRestoredRef.current = routeSelectionKey;
    setPersistedActiveConversationId(null);
    if (routeProjectId || routeProjectPath || routeSessionId) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("projectId");
        next.delete("projectPath");
        next.delete("sessionId");
        return next;
      }, { replace: true });
    }
  };
  const isConversationActive = (row: WorkbenchConversation) =>
    mainPanelClosed || selectedProjectDetailsPath || selectedDayOverview !== null
      ? false
      : row.runtime && !selectedHistorySession && row.runtime.id === activeSession?.id
      ? true
      : row.transcript
      ? selectedHistorySession?.id === row.transcript.id && selectedHistorySession.project_id === row.transcript.project_id
      : Boolean(row.runtime && !selectedHistorySession && row.runtime.id === activeSession?.id);

  const openRouteConversation = (row: WorkbenchConversation) => {
    const nextListMode: SessionListMode = row.archived ? "archived" : "active";
    const groupKey = getProjectGroupKey(row.projectPath, mergeWorktrees);
    const nextExpandedProjectPaths = new Set(expandedProjectPaths);
    if (groupKey) nextExpandedProjectPaths.add(groupKey);

    setSessionListMode(nextListMode);
    setDisplayFilter("all");
    setExpandedProjectPaths(nextExpandedProjectPaths);
    updateSidebarState({
      sessionListMode: nextListMode,
      displayFilter: "all",
      activeConversationId: row.conversationId,
      expandedProjectPaths: [...nextExpandedProjectPaths],
    }, { immediate: true });

    restoredConversationIdRef.current = row.conversationId;
    setSelectedProjectDetailsPath(null);
    setSelectedDayOverview(null);
    setMainPanelClosed(false);
    setCreatingSession(false);

    if (row.transcript) {
      setSelectedHistorySession(row.transcript);
      setSelectedCwd(row.transcript.project_path ?? row.runtime?.cwd ?? row.projectPath);
      return;
    }

    if (row.runtime) {
      setSelectedHistorySession(null);
      setSelectedCwd(row.runtime.cwd);
      setState((prev) => ({ ...prev, activeSessionId: row.runtime!.id }));
      return;
    }
  };

  useEffect(() => {
    if (!routeSelectionKey || !routeSessionId) {
      routeSelectionRestoredRef.current = null;
      return;
    }
    if (!loaded || loadingHistorySessions) return;
    if (selectedDayOverview !== null) {
      console.log("[DEBUG][WorkspaceDayOverview] skip route conversation restore while day overview is open:", {
        routeSessionId,
        selectedDayOverview,
      });
      return;
    }

    const row = allWorkbenchRows.find((item) => {
      if (item.transcript) {
        return item.transcript.id === routeSessionId &&
          (!routeProjectId || item.transcript.project_id === routeProjectId);
      }
      return item.runtime?.id === routeSessionId;
    });
    if (!row) return;
    if (routeSelectionRestoredRef.current === routeSelectionKey) return;

    routeSelectionRestoredRef.current = routeSelectionKey;
    openRouteConversation(row);
  }, [
    routeSelectionKey,
    routeProjectId,
    routeSessionId,
    loaded,
    loadingHistorySessions,
    allWorkbenchRows,
    expandedProjectPaths,
    mergeWorktrees,
    selectedDayOverview,
    isConversationActive,
  ]);

  useEffect(() => {
    const activeConversationId = state.sidebar?.activeConversationId ?? null;
    if (!loaded || loadingHistorySessions) return;
    if (mainPanelClosed || creatingSession) return;
    if (selectedProjectDetailsPath || selectedDayOverview !== null || projectDetailsOpenRef.current) {
      if (selectedDayOverview !== null) {
        console.log("[DEBUG][WorkspaceDayOverview] skip sidebar active conversation restore while day overview is open:", {
          activeConversationId,
          selectedDayOverview,
        });
      }
      return;
    }
    if (!activeConversationId) {
      restoredConversationIdRef.current = null;
      return;
    }
    const directRow = allWorkbenchRows.find((item) => item.conversationId === activeConversationId && !item.archived);
    const remappedRow = !directRow && activeConversationId.startsWith("runtime:")
      ? allWorkbenchRows.find((item) =>
          item.runtime?.id === activeConversationId.slice("runtime:".length) &&
          item.transcript &&
          !item.archived,
        )
      : null;

    if (remappedRow) {
      restoredConversationIdRef.current = remappedRow.conversationId;
      setPersistedActiveConversationId(remappedRow.conversationId, { immediate: false });
      if (!isConversationActive(remappedRow)) selectConversation(remappedRow);
      return;
    }

    if (restoredConversationIdRef.current === activeConversationId) return;

    const row = directRow;
    if (!row) return;

    restoredConversationIdRef.current = activeConversationId;
    if (!isConversationActive(row)) {
      selectConversation(row);
    }
  }, [
    loaded,
    loadingHistorySessions,
    state.sidebar?.activeConversationId,
    allWorkbenchRows,
    selectedProjectDetailsPath,
    selectedDayOverview,
    mainPanelClosed,
    creatingSession,
  ]);

  const renderWorkbenchRow = (row: (typeof workbenchRows)[number]) => (
    <ConversationButton
      key={row.id}
      conversation={row}
      menuTranscript={
        row.transcript ??
        (row.runtime?.linkedHistorySessionId && selectedHistorySession?.id === row.runtime.linkedHistorySessionId
          ? selectedHistorySession
          : undefined)
      }
      active={isConversationActive(row)}
      locateHighlightKey={
        locatedConversationHighlight?.conversationId === row.conversationId
          ? locatedConversationHighlight.key
          : undefined
      }
      connected={row.runtime ? getSessionConnected(row.runtime) : false}
      onSelect={() => selectConversation(row)}
      onStart={row.runtime ? () => relaunchSession(row.runtime!) : undefined}
      onStop={row.runtime ? () => stopSession(row.runtime!) : undefined}
      onToggleRead={() => setConversationReadState(row, !row.unread)}
      onTogglePin={() => toggleConversationPinnedState(row)}
      onMarkNeedsReview={() => markConversationNeedsReview(row)}
      onEnvironment={() => openConversationEnvironmentDialog(row)}
      onArchive={() => archiveConversation(row)}
      onRestore={() => restoreConversation(row)}
      onExport={row.transcript ? () => openSessionExportDialog(row.transcript!) : undefined}
      onClose={closeCurrentConversation}
      displayMode={getConversationDisplayMode(row)}
      onDisplayModeChange={(mode) => setConversationDisplayMode(row, mode)}
      onLocateHighlightEnd={clearLocatedConversationHighlight}
    />
  );
  const renderOverflowWorkbenchRow = (row: WorkbenchConversation) => {
    const runtime = row.runtime;
    const transcript = row.transcript;
    const provider = runtime?.provider ?? providerForTranscript(transcript);
    const displayTitle = transcript
      ? getHistorySessionTitle(transcript, t("common.untitledConversation"))
      : runtime
        ? getSessionDisplayTitle(runtime, { shell: t("chat.shell"), newSession: t("chat.newSession") })
        : t("common.untitledConversation");
    const active = isConversationActive(row);
    const running = isConversationAgentRunning(row);

    return (
      <DropdownMenuItem
        key={row.id}
        onSelect={() => {
          if (row.archived) {
            restoreConversation(row);
            return;
          }
          selectConversation(row);
        }}
        className={`h-9 min-w-0 ${active ? "bg-primary/10" : ""}`}
      >
        {provider ? (
          <ProviderIcon provider={provider} />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-card-alt text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
        {row.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
        {running && <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
        {row.needsReview && !running && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </DropdownMenuItem>
    );
  };
  const activeSessionRow = activeSession
    ? allWorkbenchRows.find((row) => row.runtime?.id === activeSession.id) ?? null
    : null;
  const activeSessionMenuProps = activeSession && activeSessionRow
    ? {
        conversation: activeSessionRow,
        menuTranscript: activeSessionRow.transcript,
        connected: activeConnected,
        onSelect: () => selectConversation(activeSessionRow),
        onStart: () => relaunchSession(activeSession),
        onStop: () => stopSession(activeSession),
        onToggleRead: () => setConversationReadState(activeSessionRow, !activeSessionRow.unread),
        onTogglePin: () => toggleConversationPinnedState(activeSessionRow),
        onMarkNeedsReview: () => markConversationNeedsReview(activeSessionRow),
        onEnvironment: () => openConversationEnvironmentDialog(activeSessionRow),
        onArchive: () => archiveConversation(activeSessionRow),
        onRestore: () => restoreConversation(activeSessionRow),
        onExport: activeSessionRow.transcript ? () => openSessionExportDialog(activeSessionRow.transcript!) : undefined,
        onClose: closeCurrentConversation,
        displayMode: getConversationDisplayMode(activeSessionRow),
        onDisplayModeChange: (mode: WorkbenchDisplayMode) => setConversationDisplayMode(activeSessionRow, mode),
      }
    : null;
  const activeSessionProjectPath = activeSession ? getProjectGroupPath(activeSession.cwd, mergeWorktrees) : null;
  const activeHeaderProjectPath = activeSessionProjectPath ?? activeSession?.cwd ?? null;
  const selectedHistoryConversationId = selectedHistorySession ? getHistoryConversationId(selectedHistorySession) : null;
  const selectedHistoryRow = selectedHistoryConversationId
    ? allWorkbenchRows.find((row) => row.conversationId === selectedHistoryConversationId)
    : null;
  const activeStandardTranscript =
    activeSession &&
    activeSessionRow?.transcript &&
    isHarnessSession(activeSession) &&
    getConversationDisplayMode(activeSessionRow) === "standard"
      ? activeSessionRow.transcript
      : null;
  const standardDetailSession = selectedHistorySession ?? activeStandardTranscript;
  const standardDetailConversationId = standardDetailSession ? getHistoryConversationId(standardDetailSession) : null;
  const standardDetailProjectPath = standardDetailSession?.project_path
    ? getProjectGroupPath(standardDetailSession.project_path, mergeWorktrees)
    : null;
  const standardDetailRow = selectedHistorySession
    ? selectedHistoryRow
    : activeStandardTranscript
      ? activeSessionRow
      : null;
  const standardDetailDisplayMode =
    standardDetailRow?.displayMode ??
    (standardDetailConversationId
      ? normalizeDisplayMode(state.conversationMeta?.[standardDetailConversationId]?.displayMode) ?? "standard"
      : "standard");
  const standardDetailPendingMessages = useMemo(() => {
    if (!activeSession || !standardDetailSession || !isHarnessSession(activeSession)) return [];
    const linkedToStandardDetail =
      activeSession.linkedHistorySessionId === standardDetailSession.id ||
      activeSessionRow?.transcript?.id === standardDetailSession.id;
    if (!linkedToStandardDetail) return [];
    return (activeSession.harnessMessages ?? [])
      .filter((message) => !message.transient || isAgentRunning(activeSession))
      .map((message, index) => harnessMessageToStandardMessage(message, index, isAgentRunning(activeSession)));
  }, [activeSession, activeSessionRow?.transcript?.id, standardDetailSession]);
  useEffect(() => {
    const liveAssistant = standardDetailPendingMessages.find((message) => message.is_streaming && message.role === "assistant");
    if (!liveAssistant) return;
    logHarnessStreamDebug("pending-props", {
      runtimeSessionId: activeSession?.id ?? null,
      transcriptSessionId: standardDetailSession?.id ?? null,
      pendingCount: standardDetailPendingMessages.length,
      liveContentLength: liveAssistant.content.length,
    });
  }, [activeSession?.id, standardDetailPendingMessages, standardDetailSession?.id]);
  const currentWorkbenchRow = allWorkbenchRows.find(isConversationActive) ?? null;
  const currentWorkbenchDayStart = currentWorkbenchRow ? getLocalDayStart(currentWorkbenchRow.timestamp) : null;

  useEffect(() => {
    const id = pendingScrollToConversationRef.current;
    if (!id) return;
    if (scrollConversationRowIntoView(id)) {
      pendingScrollToConversationRef.current = null;
      highlightConversationOnArrival(id);
    }
  });

  useEffect(() => {
    return () => {
      if (locateArrivalFrameRef.current !== null) {
        cancelAnimationFrame(locateArrivalFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentWorkbenchRow || sidebarCollapsed) {
      setCurrentConversationRowVisible(false);
      return;
    }

    const scroller = conversationListScrollRef.current;
    if (!scroller) {
      setCurrentConversationRowVisible(false);
      return;
    }

    let frame: number | null = null;
    const conversationId = currentWorkbenchRow.conversationId;
    const updateVisibility = () => {
      frame = null;
      const visible = isConversationRowVisible(conversationId);
      setCurrentConversationRowVisible((prev) => (prev === visible ? prev : visible));
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(updateVisibility);
    };

    scheduleUpdate();
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    currentWorkbenchRow?.conversationId,
    sidebarCollapsed,
    isConversationRowVisible,
    sessionListMode,
    displayFilter,
    outlineMode,
    expandedProjectPaths,
    workbenchRows.length,
  ]);

  useEffect(() => {
    if (!activeSession || selectedHistorySession || mainPanelClosed || creatingSession) return;
    if (selectedDayOverview !== null) {
      console.log("[DEBUG][WorkspaceDayOverview] skip runtime-exit linked chat restore while day overview is open:", {
        activeSessionId: activeSession.id,
        selectedDayOverview,
      });
      return;
    }
    if (isHarnessSession(activeSession)) return;
    if (!activePtyStatusKnown || activeConnected) return;
    if (!activeSessionRow?.transcript) return;
    console.log("[DEBUG][WorkspaceDayOverview] runtime-exit linked chat restore is opening session:", {
      activeSessionId: activeSession.id,
      linkedTranscriptId: activeSessionRow.transcript.id,
    });
    openLinkedChatAfterRuntimeExit(activeSession, activeSessionRow.transcript);
  }, [
    activeConnected,
    activePtyStatusKnown,
    activeSession,
    activeSessionRow?.transcript,
    creatingSession,
    mainPanelClosed,
    selectedDayOverview,
    selectedHistorySession,
  ]);

  const getMostRecentProviderForProject = (projectPath?: string | null): AgentProvider | null => {
    const targetKey = getProjectGroupKey(projectPath, mergeWorktrees);
    const row = allWorkbenchRows.find((item) => {
      if (item.archived) return false;
      if (!getConversationProvider(item)) return false;
      if (!targetKey) return true;
      return getProjectGroupKey(item.projectPath, mergeWorktrees) === targetKey;
    });
    return row ? getConversationProvider(row) : null;
  };
  const newSessionDefaultProvider =
    getMostRecentProviderForProject(selectedCwd ?? selectedProjectPath) ?? activeSession?.provider ?? "claude";
  const newSessionProviderContextKey = `new:${getProjectGroupKey(selectedCwd ?? selectedProjectPath, mergeWorktrees) || "general"}`;
  const selectedHistoryDefaultProvider =
    standardDetailRow
      ? getConversationProvider(standardDetailRow) ?? "claude"
      : providerForTranscript(standardDetailSession ?? undefined) ?? "claude";
  const openProjectInEditor = async (path: string, editor?: EditorTargetId) => {
    try {
      await invoke("open_in_editor", { path, editor });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("workspace.openProjectInEditorFailed", { message }));
    }
  };
  const renderProjectPathMenuItems = (projectPath: string, variant: ProjectPathMenuVariant) => (
    <ProjectPathMenuItems
      path={projectPath}
      variant={variant}
      isPlainChat={isPlainChatWorkspace(projectPath)}
      onViewDetails={openProjectDetails}
      onOpenInEditor={openProjectInEditor}
      onConfigureRuntimeEnvironment={openProjectEnvironmentDialog}
    />
  );
  const loadDailyReportEvidence = useCallback(async (day: WorkbenchDayGroup): Promise<DailyReportEvidence[]> => {
    const transcriptRows = day.rows.filter((row) => row.transcript);
    const evidence: DailyReportEvidence[] = [];

    for (let index = 0; index < transcriptRows.length; index += DAILY_REPORT_EVIDENCE_BATCH_SIZE) {
      const batch = transcriptRows.slice(index, index + DAILY_REPORT_EVIDENCE_BATCH_SIZE);
      const loaded = await Promise.all(batch.map(async (row) => {
        const transcript = row.transcript!;
        try {
          const messages = await invoke<Message[]>("get_session_messages", {
            projectId: transcript.project_id,
            sessionId: transcript.id,
          });
          const extracted = getDailyReportEvidenceFromMessages(messages);
          return {
            rowId: row.id,
            userPrompts: extracted.userPrompts,
            assistantExcerpts: extracted.assistantExcerpts,
          };
        } catch (error) {
          console.warn("[DEBUG][WorkspaceDayOverview] daily report evidence load failed:", {
            projectId: transcript.project_id,
            sessionId: transcript.id,
            error,
          });
          return {
            rowId: row.id,
            userPrompts: [],
            assistantExcerpts: [],
            loadFailed: true,
          };
        }
      }));
      evidence.push(...loaded);
    }

    return evidence;
  }, []);
  const getDailyReportEvidenceForDay = async (day: WorkbenchDayGroup) => {
    const key = getDailyReportEvidenceCacheKey(day);
    const cached = dailyReportEvidenceByDay[key];
    if (cached) return cached;
    const evidence = await loadDailyReportEvidence(day);
    setDailyReportEvidenceByDay((prev) => (prev[key] ? prev : { ...prev, [key]: evidence }));
    return evidence;
  };
  useEffect(() => {
    if (!showDayOverviewView || !selectedDayOverviewDetails || !selectedDayOverviewEvidenceKey) return;
    if (dailyReportEvidenceByDay[selectedDayOverviewEvidenceKey]) return;

    let cancelled = false;
    setLoadingDailyReportEvidenceKey(selectedDayOverviewEvidenceKey);
    loadDailyReportEvidence(selectedDayOverviewDetails)
      .then((evidence) => {
        if (cancelled) return;
        setDailyReportEvidenceByDay((prev) =>
          prev[selectedDayOverviewEvidenceKey]
            ? prev
            : { ...prev, [selectedDayOverviewEvidenceKey]: evidence },
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingDailyReportEvidenceKey((current) =>
          current === selectedDayOverviewEvidenceKey ? null : current,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    dailyReportEvidenceByDay,
    loadDailyReportEvidence,
    selectedDayOverviewDetails,
    selectedDayOverviewEvidenceKey,
    showDayOverviewView,
  ]);
  const copyDailyReportPrompt = async (day: WorkbenchDayGroup, platform: DailyReportPlatform) => {
    const platformLabel = getDailyReportPlatformLabel(platform, t);
    try {
      const evidence = await getDailyReportEvidenceForDay(day);
      const content = buildDailyReportPrompt(day, platform, getWorkbenchProjectName, evidence);
      await invoke("copy_to_clipboard", { text: content });
      toast.success(t("workspace.dailyReportPromptCopied", { platform: platformLabel }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("workspace.dailyReportPromptCopyFailed", { message }));
    }
  };
  const generateDailyReportWithAi = async (day: WorkbenchDayGroup, platform: DailyReportPlatform) => {
    const platformLabel = getDailyReportPlatformLabel(platform, t);
    const key = `${day.dayStart}:${platform}`;
    setGeneratingDailyReportKey(key);
    setSelectedDayOverview(day.dayStart);
    setDailyReportPlatform(platform);
    try {
      const evidence = await getDailyReportEvidenceForDay(day);
      const prompt = buildDailyReportPrompt(day, platform, getWorkbenchProjectName, evidence);
      const providerFromDay = day.rows
        .map(getConversationProvider)
        .find((provider): provider is Exclude<AgentProvider, "terminal"> => provider === "claude" || provider === "codex");
      const provider: Exclude<AgentProvider, "terminal"> =
        providerFromDay ?? (newSessionDefaultProvider === "terminal" ? "claude" : newSessionDefaultProvider);
      const cwd = await ensurePlainChatWorkspace();
      await createSession(provider, prompt, "standard", {
        cwd,
        title: `${formatChineseReportDate(day.dayStart)} ${platformLabel}日报`,
      });
      toast.success(t("workspace.dailyReportGenerationStarted", { platform: platformLabel }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("workspace.dailyReportGenerationFailed", { message }));
    } finally {
      setGeneratingDailyReportKey((current) => (current === key ? null : current));
    }
  };
  const openDayOverview = (dayStart: number, platform: DailyReportPlatform = dailyReportPlatform) => {
    console.log("[DEBUG][WorkspaceDayOverview] openDayOverview:", {
      dayStart,
      platform,
      activeSessionId: activeSession?.id ?? null,
      selectedHistorySessionId: selectedHistorySession?.id ?? null,
      routeSessionId,
      routeProjectId,
      previousSelectedDayOverview: selectedDayOverview,
    });
    projectDetailsOpenRef.current = false;
    restoredConversationIdRef.current = null;
    routeSelectionRestoredRef.current = routeSelectionKey;
    setSelectedDayOverview(dayStart);
    setDailyReportPlatform(platform);
    setSelectedProjectDetailsPath(null);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    setCreatingSession(false);
    setPersistedActiveConversationId(null);
    if (routeProjectId || routeProjectPath || routeSessionId || routeTargetMessageId || routeTargetLineNumber !== null || routeTargetRoundIndex !== null || routeSearchHighlight) {
      console.log("[DEBUG][WorkspaceDayOverview] clear route selection params for day overview:", {
        routeSessionId,
        routeProjectId,
        routeProjectPath: Boolean(routeProjectPath),
      });
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("projectId");
        next.delete("projectPath");
        next.delete("sessionId");
        next.delete("messageId");
        next.delete("lineNumber");
        next.delete("roundIndex");
        next.delete("q");
        return next;
      }, { replace: true });
    }
  };
  const continueHistorySession = async (
    session: Session,
    provider: AgentProvider,
    prompt: string,
    launchMode: AgentLaunchMode,
  ) => {
    const sourceProvider = providerForTranscript(session);
    const nativeResume = provider !== "terminal" && provider === sourceProvider && canResumeTranscriptLocally(session);

    if (nativeResume) {
      void createSession(provider, prompt, launchMode, {
        cwd: session.project_path,
        title: getHistorySessionTitle(session, t("common.untitledConversation")),
        resumeHistorySession: session,
        focusRuntime: true,
      });
      return;
    }

    if (provider === "terminal") {
      void createSession(provider, prompt, "cli", {
        cwd: session.project_path,
        title: getHistorySessionTitle(session, t("common.untitledConversation")),
      });
      return;
    }

    const historyTitle = getHistorySessionTitle(session, t("common.untitledConversation"));
    let runtimeFork: SessionRuntimeFork;
    try {
      runtimeFork = await invoke<SessionRuntimeFork>("create_session_runtime_fork", {
        projectId: session.project_id,
        sessionId: session.id,
        targetProvider: provider,
      });
      toast.info(t("workspace.runtimeSwitchPrepared", { provider: labelForProvider(provider) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("workspace.runtimeSwitchFailed", { message }));
      return;
    }

    setPendingRuntimeForkSessions((prev) => ({
      ...prev,
      [getHistoryConversationId(runtimeFork.targetSession)]: runtimeFork.targetSession,
    }));
    void createSession(provider, prompt, launchMode, {
      cwd: runtimeFork.projectPath,
      title: historyTitle.slice(0, 80),
      resumeHistorySession: runtimeFork.targetSession,
      focusRuntime: true,
      fork: {
        parentSessionId: session.id,
        fromMessageId: session.id,
        fromTitle: historyTitle,
      },
    });
  };
  const forkHistorySession = (payload: SessionForkPayload) => {
    const title = t("workspace.forkTitle", { title: getHistorySessionTitle(payload.session, t("common.untitledConversation")) }).slice(0, 80);
    const provider = providerForTranscript(payload.session) ?? "claude";
    const prompt = [
      "Continue from this forked conversation context.",
      "",
      "Treat the context below as prior conversation state. Start a new independent thread from it.",
      "",
      "<fork-context>",
      payload.context,
      "</fork-context>",
    ].join("\n");
    void createSession(provider, prompt, "standard", {
      cwd: payload.session.project_path,
      title,
      fork: {
        parentSessionId: payload.session.id,
        fromMessageId: payload.messageId,
        fromTitle: getHistorySessionTitle(payload.session, t("common.untitledConversation")),
      },
    });
  };
  const locateCurrentConversation = () => {
    if (!currentWorkbenchRow) return;
    pendingScrollToConversationRef.current = currentWorkbenchRow.conversationId;
    openRouteConversation(currentWorkbenchRow);
    if (scrollConversationRowIntoView(currentWorkbenchRow.conversationId)) {
      pendingScrollToConversationRef.current = null;
      highlightConversationOnArrival(currentWorkbenchRow.conversationId);
      return;
    }
    requestAnimationFrame(() => {
      if (scrollConversationRowIntoView(currentWorkbenchRow.conversationId)) {
        pendingScrollToConversationRef.current = null;
        highlightConversationOnArrival(currentWorkbenchRow.conversationId);
      }
    });
  };
  const locateButtonSubtle = Boolean(currentWorkbenchRow && currentConversationRowVisible);
  const locateButtonTitle = locateButtonSubtle
    ? t("workspace.currentConversationVisible")
    : t("workspace.locateCurrentConversation");
  const locateButtonClass = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    locateButtonSubtle
      ? "bg-background text-muted-foreground/40 hover:bg-card-alt/60 hover:text-muted-foreground"
      : "bg-background text-primary hover:bg-primary/10 hover:text-primary"
  }`;

  return (
    <div className="flex h-full min-h-0 bg-background">
      {!sidebarCollapsed && (
        <section
          className="relative flex shrink-0 flex-col border-r border-border bg-card"
          style={{ width: sessionsSidebarWidth }}
        >
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0" title={workspacePath ?? undefined}>
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="flex min-w-0 items-baseline gap-1.5 font-serif text-lg font-semibold text-foreground">
                    <span className="truncate">{sessionsHeaderTitle}</span>
                    {sessionsHeaderCount !== null ? (
                      <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                        ({formatNumber(sessionsHeaderCount)})
                      </span>
                    ) : null}
                  </h1>
                  {saving ? (
                    <span className="shrink-0 rounded-md bg-card-alt px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {t("workspace.saving")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={locateCurrentConversation}
                  disabled={!currentWorkbenchRow}
                  className={locateButtonClass}
                  title={locateButtonTitle}
                  aria-label={locateButtonTitle}
                >
                  <LocateFixed className="h-4 w-4" />
                </button>
                <WorkbenchOutlineMenu
                  outlineMode={outlineMode}
                  onOutlineModeChange={setPersistedOutlineMode}
                  mergeWorktrees={mergeWorktrees}
                  onMergeWorktreesChange={setPersistedMergeWorktrees}
                  showProjectNewConversation={showProjectNewConversation}
                  onShowProjectNewConversationChange={setPersistedShowProjectNewConversation}
                  displayFilter={displayFilter}
                  onDisplayFilterChange={setPersistedDisplayFilter}
                  sortMode={sortMode}
                  onSortModeChange={setPersistedSortMode}
                  reorderGroups={reorderGroups}
                  onReorderGroupsChange={setPersistedReorderGroups}
                />
                <button
                  type="button"
                  onClick={openNewSession}
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border transition-colors ${
                    showNewSessionView
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-card-alt hover:text-foreground"
                  }`}
                  title={t("workspace.newConversation")}
                  aria-label={t("workspace.newConversation")}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div
            ref={conversationListScrollRef}
            className={`min-h-0 flex-1 overflow-y-auto ${
              loaded && workbenchRows.length > 0 && outlineMode !== "recent" ? "p-0" : "p-3"
            }`}
          >
          {conversationListInitialLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {!loaded ? t("common.loading") : t("workspace.loadingConversations")}
            </div>
          ) : workbenchRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card-alt/40 px-4 py-8 text-center">
              <div className="text-sm text-muted-foreground">
                {loadingHistorySessions
                  ? t("workspace.loadingConversations")
                  : sessionListMode === "archived"
                  ? t("settings.noArchivedConversations")
                  : t("workspace.noConversationsYet")}
              </div>
              {sessionListMode !== "archived" && (
                <button
                  type="button"
                  onClick={openNewSession}
                  className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  {t("workspace.newConversation")}
                </button>
              )}
            </div>
          ) : outlineMode === "recent" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1.5 text-xs font-medium text-muted-foreground">
                <span>{t("workspace.allConversations")}</span>
                <span>{workbenchRows.length}</span>
              </div>
              <div className="space-y-px">
                {workbenchRows.map(renderWorkbenchRow)}
              </div>
            </div>
          ) : outlineMode === "day" ? (
            <div className="py-1">
              {dayOutline.map((day) => {
                const active = selectedDayOverview === day.dayStart || currentWorkbenchDayStart === day.dayStart;
                const dayLabel = formatDayGroupLabel(day.dayStart, t);
                return (
                  <div key={day.key}>
                    <div
                      className={`group sticky top-0 z-30 flex h-8 w-full items-center gap-1 border-b border-l-2 bg-card px-2 text-left transition-colors ${
                        active
                          ? "border-b-border border-l-primary bg-card-alt"
                          : "border-b-border border-l-transparent hover:bg-card-alt"
                      }`}
                      title={dayLabel}
                    >
                      <button
                        type="button"
                        onClick={() => openDayOverview(day.dayStart)}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("workspace.viewDayOverview", { day: dayLabel })}
                      >
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                          {dayLabel}
                        </span>
                        {day.running ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : null}
                        {day.needsReview && !day.running ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                        <span className="shrink-0 truncate text-xs tabular-nums text-muted-foreground">
                          {t("workspace.projectCount", { count: day.projectCount })}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{day.rows.length}</span>
                      </button>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="pointer-events-none inline-flex h-6 w-0 shrink-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground opacity-0 transition-[width,opacity,background-color,color] duration-150 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:pointer-events-auto group-hover:w-6 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:w-6 group-focus-within:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:w-6 data-[state=open]:opacity-100"
                            title={t("workspace.dayActions")}
                            aria-label={t("workspace.dayActions")}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuItem onSelect={() => openDayOverview(day.dayStart)} className="gap-2">
                            <FileText className="h-4 w-4" />
                            {t("workspace.dayOverview")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.generateDailyReport")}</DropdownMenuLabel>
                          {DAILY_REPORT_PLATFORMS.map((platform) => (
                            <DropdownMenuItem
                              key={platform}
                              onSelect={() => void generateDailyReportWithAi(day, platform)}
                              className="gap-2"
                            >
                              {platform === "blog" ? <FileText className="h-4 w-4" /> : <Newspaper className="h-4 w-4" />}
                              {getDailyReportPlatformLabel(platform, t)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="ml-5 space-y-1 border-l border-border py-1 pl-1 pr-2.5">
                      {day.projects.map((project) => {
                        const activeRowIndex = project.rows.findIndex(isConversationActive);
                        const visibleRows =
                          activeRowIndex >= PROJECT_GROUP_INLINE_LIMIT
                            ? [
                                ...project.rows.slice(0, PROJECT_GROUP_INLINE_LIMIT - 1),
                                project.rows[activeRowIndex],
                              ]
                            : project.rows.slice(0, PROJECT_GROUP_INLINE_LIMIT);
                        const visibleRowIds = new Set(visibleRows.map((row) => row.id));
                        const overflowRows = project.rows.filter((row) => !visibleRowIds.has(row.id));

                        return (
                          <div key={project.key} className="space-y-px">
                            <div className="flex h-6 min-w-0 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
                              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 flex-1 truncate" title={project.path}>
                                {getWorkbenchProjectName(project.path)}
                              </span>
                              {project.running ? <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-primary" /> : null}
                              {project.needsReview && !project.running ? <AlertCircle className="h-3 w-3 shrink-0 text-primary" /> : null}
                              <span className="shrink-0 tabular-nums">{project.rows.length}</span>
                            </div>
                            {visibleRows.map(renderWorkbenchRow)}
                            {overflowRows.length > 0 && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
                                    title={t("workspace.moreConversationCount", { count: overflowRows.length })}
                                  >
                                    <MoreHorizontal className="h-4 w-4 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate">{t("workspace.moreConversations")}</span>
                                    <span className="shrink-0 text-xs">{overflowRows.length}</span>
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="right" align="start" className="max-h-[min(420px,80vh)] w-80 overflow-y-auto">
                                  <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
                                    {getWorkbenchProjectName(project.path)}
                                  </DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {overflowRows.map(renderOverflowWorkbenchRow)}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-1">
              {projectOutline.map((project) => {
                const active = getProjectGroupKey(selectedCwd, mergeWorktrees) === project.key;
                const collapsed = !expandedProjectPaths.has(project.key);
                const stats = project.stats;
                const activeRowIndex = project.rows.findIndex(isConversationActive);
                const visibleRows =
                  activeRowIndex >= PROJECT_GROUP_INLINE_LIMIT
                    ? [
                        ...project.rows.slice(0, PROJECT_GROUP_INLINE_LIMIT - 1),
                        project.rows[activeRowIndex],
                      ]
                    : project.rows.slice(0, PROJECT_GROUP_INLINE_LIMIT);
                const visibleRowIds = new Set(visibleRows.map((row) => row.id));
                const overflowRows = project.rows.filter((row) => !visibleRowIds.has(row.id));
                return (
                  <div key={project.key}>
                    <ContextMenu modal={false}>
                      <ContextMenuTrigger asChild>
                        <div
                          className={`group sticky top-0 z-30 flex h-8 w-full items-center gap-1 border-b border-l-2 bg-card px-2 text-left transition-colors ${
                            active
                              ? "border-b-border border-l-primary bg-card-alt"
                              : "border-b-border border-l-transparent hover:bg-card-alt"
                          }`}
                          title={getWorkbenchProjectTitle(project.path)}
                        >
                          <button
                            type="button"
                            onClick={() => toggleProjectCollapsed(project.path)}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-expanded={!collapsed}
                            aria-label={`${collapsed ? t("common.expand") : t("common.collapse")} ${getWorkbenchProjectName(project.path)}`}
                          >
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground">
                              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                              {getWorkbenchProjectName(project.path)}
                            </span>
                            {stats?.running ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : null}
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="pointer-events-none inline-flex h-6 w-0 shrink-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground opacity-0 transition-[width,opacity,background-color,color] duration-150 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:pointer-events-auto group-hover:w-6 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:w-6 group-focus-within:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:w-6 data-[state=open]:opacity-100"
                                  title={t("workspace.projectActions")}
                                  aria-label={t("workspace.projectActions")}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {renderProjectPathMenuItems(project.path, "dropdown")}
                            </DropdownMenuContent>
                          </DropdownMenu>
                            <button
                              type="button"
                              onClick={() => openNewSessionForProject(project.path)}
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-[opacity,background-color,color] hover:bg-card-alt hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
                              title={t("workspace.newConversationInProject", { project: getWorkbenchProjectName(project.path) })}
                              aria-label={t("workspace.newConversationInProject", { project: getWorkbenchProjectName(project.path) })}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
                      {renderProjectPathMenuItems(project.path, "context")}
                    </ContextMenuContent>
                    </ContextMenu>
                    {!collapsed && (
                      <div className="ml-5 space-y-px border-l border-border py-0.5 pl-1 pr-2.5">
                        {(showProjectNewConversation || project.rows.length === 0) && (
                          <button
                            type="button"
                            onClick={() => openNewSessionForProject(project.path)}
                            className="group/new-conversation flex h-[31px] w-full items-center gap-2 rounded-lg pl-2.5 pr-2 text-left text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={t("workspace.newConversationInProject", { project: getWorkbenchProjectName(project.path) })}
                            aria-label={t("workspace.newConversationInProject", { project: getWorkbenchProjectName(project.path) })}
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-card-alt text-muted-foreground transition-colors group-hover/new-conversation:text-foreground">
                              <Plus className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{t("workspace.newConversation")}</span>
                          </button>
                        )}
                        {project.rows.length > 0 && visibleRows.map(renderWorkbenchRow)}
                        {overflowRows.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
                                title={t("workspace.moreConversationCount", { count: overflowRows.length })}
                              >
                                <MoreHorizontal className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{t("workspace.moreConversations")}</span>
                                <span className="shrink-0 text-xs">{overflowRows.length}</span>
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side="right" align="start" className="max-h-[min(420px,80vh)] w-80 overflow-y-auto">
                              <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
                                {getWorkbenchProjectName(project.path)}
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {overflowRows.map(renderOverflowWorkbenchRow)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("workspace.resizeSessionsSidebar")}
          aria-valuemin={SESSIONS_SIDEBAR_MIN_WIDTH}
          aria-valuemax={SESSIONS_SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(sessionsSidebarWidth)}
          tabIndex={0}
          onMouseDown={handleSessionsSidebarResize}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const delta = event.shiftKey ? 24 : 12;
            setSessionsSidebarWidth((width) =>
              Math.min(
                SESSIONS_SIDEBAR_MAX_WIDTH,
                Math.max(SESSIONS_SIDEBAR_MIN_WIDTH, width + (event.key === "ArrowRight" ? delta : -delta)),
              ),
            );
          }}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none transition-colors before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:transition-colors hover:bg-primary/5 hover:before:bg-primary/50 focus-visible:bg-primary/10 focus-visible:before:bg-primary"
          title={t("environment.dragToResize")}
        />
        </section>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        {showDayOverviewView ? (
          selectedDayOverviewDetails ? (
            <DayOverviewPanel
              day={selectedDayOverviewDetails}
              platform={dailyReportPlatform}
              onPlatformChange={setDailyReportPlatform}
              onClose={closeCurrentConversation}
              generating={generatingDailyReportKey === `${selectedDayOverviewDetails.dayStart}:${dailyReportPlatform}`}
              evidence={selectedDayOverviewEvidence}
              evidenceLoading={selectedDayOverviewEvidenceLoading}
              onGenerateReport={(platform) => void generateDailyReportWithAi(selectedDayOverviewDetails, platform)}
              onCopyPrompt={(platform) => void copyDailyReportPrompt(selectedDayOverviewDetails, platform)}
              onSelectConversation={selectConversation}
              getProjectLabel={getWorkbenchProjectName}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          )
        ) : showProjectDetailsView ? (
          selectedProjectDetails ? (
            <ProjectDetailsPanel
              projectPath={selectedProjectDetails.path}
              project={selectedProjectDetails.project}
              conversations={selectedProjectDetails.conversations}
              stats={selectedProjectDetails.stats}
              onClose={closeCurrentConversation}
              onNewConversation={() => openNewSessionForProject(selectedProjectDetails.path)}
              onEnvironment={() => openProjectEnvironmentDialog(selectedProjectDetails.path)}
              onSelectConversation={selectConversation}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          )
        ) : showNewSessionView ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto bg-background px-6 py-10">
            <div className="m-auto flex w-full max-w-3xl flex-col">
              <div className="mb-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedProjectPath || !primaryEnvironmentAction || !primaryEnvironmentConfig) return;
                    runEnvironmentConfig(primaryEnvironmentScope, "action", primaryEnvironmentConfig, primaryEnvironmentAction);
                  }}
                  disabled={!selectedProjectPath || !primaryEnvironmentAction || !primaryEnvironmentConfig}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground disabled:opacity-40"
	                >
	                  <Terminal className="h-4 w-4" />
	                  {t("environment.run")}
	                </button>
                <button
                  type="button"
                  onClick={() => openEnvironmentDialog(selectedProjectPath ? "project" : "global")}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground disabled:opacity-40"
	                >
	                  <Settings2 className="h-4 w-4" />
	                  {t("common.environment")}
	                </button>
              </div>
              <AgentComposer
                cwd={selectedCwd}
                cwdLabel={getComposerCwdLabel(selectedCwd)}
                hasProjectPath={Boolean(selectedCwd && !isPlainChatWorkspace(selectedCwd))}
                pathOptions={composerPathOptions}
                allowNoProject
                variant="panel"
                autoFocus
                defaultProvider={newSessionDefaultProvider}
                providerContextKey={newSessionProviderContextKey}
                onPickFolder={pickFolder}
                onSelectCwd={selectComposerCwd}
                onCancel={
                  creatingSession && activeSession
                    ? () => {
                        setSelectedCwd(activeSession.cwd);
                        setCreatingSession(false);
                      }
                    : undefined
                }
                onCreate={createSession}
              />
            </div>
          </div>
        ) : standardDetailSession ? (
          <SessionDetail
            session={standardDetailSession}
            projectPath={standardDetailProjectPath}
            projectPathMenuItems={
              standardDetailProjectPath ? renderProjectPathMenuItems(standardDetailProjectPath, "context") : undefined
            }
            onClose={closeCurrentConversation}
            onFork={forkHistorySession}
            displayMode={standardDetailDisplayMode}
            onDisplayModeChange={(mode) => setHistorySessionDisplayMode(standardDetailSession, mode)}
            targetMessageId={routeTargetMessageId}
            targetLineNumber={routeTargetLineNumber}
            targetRoundIndex={routeTargetRoundIndex}
            highlight={routeSearchHighlight}
            pendingMessages={standardDetailPendingMessages}
            composerOverride={
              <AgentComposer
                cwd={standardDetailSession.project_path}
                cwdLabel={getComposerCwdLabel(standardDetailSession.project_path)}
                hasProjectPath={Boolean(standardDetailSession.project_path && !isPlainChatWorkspace(standardDetailSession.project_path))}
                pathOptions={composerPathOptions}
                variant="dock"
                placeholder={t("workspace.messageConversation")}
                defaultProvider={selectedHistoryDefaultProvider}
                providerContextKey={standardDetailConversationId ?? standardDetailSession.id}
                onPickFolder={pickFolder}
                onSelectCwd={selectComposerCwd}
                onCreate={(provider, prompt, launchMode) => continueHistorySession(standardDetailSession, provider, prompt, launchMode)}
              />
            }
          />
        ) : activeSession ? (
          <>
            <SessionDetailHeader
              projectPath={activeHeaderProjectPath}
              projectPathMenuItems={
                activeHeaderProjectPath ? renderProjectPathMenuItems(activeHeaderProjectPath, "context") : undefined
              }
              titlePrefix={<ProviderIcon provider={activeSession.provider} />}
	              title={
	                <h2 className="min-w-0 flex-1 truncate font-serif text-base font-semibold text-foreground">
	                  {getSessionDisplayTitle(activeSession, { shell: t("chat.shell"), newSession: t("chat.newSession") })}
	                </h2>
	              }
              actions={
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1.5 rounded-lg text-muted-foreground hover:bg-card-alt" title={t("workspace.conversationActions")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
                    {activeSessionMenuProps ? (
                      <WorkspaceConversationDropdownMenuItems {...activeSessionMenuProps} />
                    ) : (
                      <DropdownMenuItem onSelect={closeCurrentConversation} className="gap-2">
                        <X className="h-4 w-4" />
                        {t("workspace.closePanel")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />

            <div className={`min-h-0 flex-1 ${isHarnessSession(activeSession) ? "flex flex-col bg-background" : "bg-terminal"}`}>
              {isHarnessSession(activeSession) ? (
                <>
                  <HarnessChatPane
                    session={activeSession}
                    cwd={activeSession.cwd}
                  />
                  <AgentComposer
                    cwd={activeSession.cwd}
                    cwdLabel={getComposerCwdLabel(activeSession.cwd)}
                    hasProjectPath={Boolean(activeSession.cwd && !isPlainChatWorkspace(activeSession.cwd))}
                    pathOptions={composerPathOptions}
                    variant="dock"
                    placeholder={t("workspace.messageConversation")}
                    defaultProvider={activeSession.provider}
                    providerContextKey={`runtime:${activeSession.id}`}
                    disabled={isAgentRunning(activeSession)}
                    onPickFolder={pickFolder}
                    onSelectCwd={selectComposerCwd}
                    onCreate={(provider, prompt, launchMode) =>
                      createSession(provider, prompt, launchMode, {
                        cwd: activeSession.cwd,
                        title: makeSessionTitle(provider, prompt),
                      })
                    }
                  />
                </>
              ) : shouldMountTerminal && activeSession.ptyId ? (
                <TerminalPane
                  key={activeSession.ptyId}
                  ptyId={activeSession.ptyId}
                  cwd={activeSession.cwd}
                  command={activeSession.command ?? undefined}
                  initialInput={activeSession.initialInput ?? undefined}
                  visible
                  autoFocus
                  fallbackToShellOnCommandExit={false}
                  restoreOnly={terminalRestoreOnly}
                  onReady={() => {
                    setLaunchingIds((prev) => {
                      const next = new Set(prev);
                      next.delete(activeSession.id);
                      return next;
                    });
                    setAttachedPtyIds((prev) => new Set(prev).add(activeSession.ptyId!));
                  }}
                  onExit={() => {
                    clearAgentIdleTimer(activeSession.id);
                    setLaunchingIds((prev) => {
                      const next = new Set(prev);
                      next.delete(activeSession.id);
                      return next;
                    });
                    setAttachedPtyIds((prev) => {
                      const next = new Set(prev);
                      next.delete(activeSession.ptyId!);
                      return next;
                    });
                    updateSession(activeSession.id, (current) => ({
                      ...current,
                      status: "completed",
                      workState: "stopped",
                      unread: false,
                      lastViewedAt: now(),
                      updatedAt: now(),
                    }));
                    openLinkedChatAfterRuntimeExit(activeSession, activeSessionRow?.transcript);
                  }}
                  onUserSubmit={() => markAgentWorking(activeSession.id)}
                  onUserInterrupt={() => markAgentIdle(activeSession.id)}
                />
              ) : (
                <DetachedState
                  session={activeSession}
                  onStart={() => relaunchSession(activeSession)}
                  onRestore={() => restoreSession(activeSession)}
                />
              )}
            </div>
          </>
        ) : null}
        <EnvironmentTerminalDock
          session={environmentTerminal}
          onHide={() => setEnvironmentTerminal((current) => current ? { ...current, hidden: true } : current)}
          onShow={() => setEnvironmentTerminal((current) => current ? { ...current, hidden: false } : current)}
          onExit={() => setEnvironmentTerminal((current) => current ? { ...current, running: false } : current)}
          onClose={closeEnvironmentTerminal}
        />
      </main>
      <ExportDialog
        open={Boolean(exportTargetSession)}
        onOpenChange={setExportDialogOpen}
        allMessages={exportMessages}
        selectedIds={new Set()}
        onSelectedIdsChange={() => {}}
        defaultName={exportTargetSession?.summary?.slice(0, 50).replace(/[/\\?%*:|"<>]/g, "-") || "session"}
      />
      <EnvironmentDialog
        open={environmentDialogOpen}
        onOpenChange={handleEnvironmentDialogOpenChange}
        projectPath={environmentProjectPath ?? null}
        sessionKey={environmentSessionKey}
        sessionTitle={environmentSessionTitle}
        globalConfig={state.globalEnvironment ?? null}
        projectConfig={environmentProjectConfig}
        sessionConfig={environmentSessionConfig}
        projectOptions={composerPathOptions}
        defaultScope={environmentDefaultScope}
        onSave={saveEnvironmentConfig}
        onPickProjectFolder={pickEnvironmentProjectFolder}
        onProjectPathChange={handleEnvironmentProjectPathChange}
        onRun={runEnvironmentConfig}
      />
    </div>
  );
}

function ProviderIcon({ provider }: { provider: AgentProvider }) {
  if (provider === "terminal") return <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />;
  const src = AGENT_ICON_SRC[provider];
  if (!src) return null;
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-card ring-1 ring-border/70" aria-hidden="true">
      <img src={src} alt="" className="h-4 w-4 object-contain" draggable={false} />
    </span>
  );
}

function getConversationProvider(row: WorkbenchConversation) {
  return row.runtime?.provider ?? providerForTranscript(row.transcript);
}

function getConversationSourceLabel(row: WorkbenchConversation, t?: TranslateFn) {
  const provider = getConversationProvider(row);
  if (provider) return labelForProvider(provider);
  if (row.transcript?.source === "codex") return "Codex";
  if (row.transcript?.source === "app-code") return "Claude Code";
  if (row.transcript?.source === "app-web") return "Claude Web";
  if (row.transcript?.source === "app-cowork") return "Claude Cowork";
  if (row.transcript?.source === "cli") return "Claude CLI";
  return t ? t("session.history") : "History";
}

function getConversationCreatedAt(row: WorkbenchConversation) {
  return row.transcript?.created_at ? row.transcript.created_at * 1000 : row.runtime?.createdAt ?? row.timestamp;
}

function getConversationStatusLabel(row: WorkbenchConversation, t?: TranslateFn) {
  if (row.archived) return t ? t("workspace.archived") : "archived";
  if (isConversationAgentRunning(row)) return t ? t("workspace.agentRunning") : "agent running";
  if (row.runtime) return getAgentStatusLabel(row.runtime, t);
  if (row.needsReview) return t ? t("workspace.needsReview") : "needs review";
  if (row.unread) return t ? t("workspace.unread") : "unread";
  return t ? t("workspace.history") : "history";
}

function DayOverviewPanel({
  day,
  platform,
  onPlatformChange,
  onClose,
  generating,
  evidence,
  evidenceLoading,
  onGenerateReport,
  onCopyPrompt,
  onSelectConversation,
  getProjectLabel,
}: {
  day: WorkbenchDayGroup;
  platform: DailyReportPlatform;
  onPlatformChange: (platform: DailyReportPlatform) => void;
  onClose: () => void;
  generating: boolean;
  evidence?: DailyReportEvidence[];
  evidenceLoading: boolean;
  onGenerateReport: (platform: DailyReportPlatform) => void;
  onCopyPrompt: (platform: DailyReportPlatform) => void;
  onSelectConversation: (row: WorkbenchConversation) => void;
  getProjectLabel: (path: string) => string;
}) {
  const { t } = useI18n();
  const totals = useMemo(() => getDailyReportTotals(day), [day]);
  const prompt = useMemo(() => buildDailyReportPrompt(day, platform, getProjectLabel, evidence), [day, evidence, getProjectLabel, platform]);
  const dateLabel = formatDayGroupLabel(day.dayStart, t);

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card-alt text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
            </span>
            <h2 className="truncate font-serif text-lg font-semibold text-foreground">
              {t("workspace.dayOverviewTitle", { day: dateLabel })}
            </h2>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {formatChineseReportDate(day.dayStart)} / {formatLocalDateKey(day.dayStart)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton title={t("workspace.generateDailyReportWithAi")} onClick={() => onGenerateReport(platform)}>
            {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </IconButton>
          <IconButton title={t("workspace.copyDailyReportPrompt")} onClick={() => onCopyPrompt(platform)}>
            <Copy className="h-4 w-4" />
          </IconButton>
          <IconButton title={t("workspace.closeDetails")} onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ProjectMetric
              label={t("common.projects")}
              value={formatNumber(day.projectCount)}
              detail={t("workspace.conversationCount", { count: formatNumber(day.rows.length) })}
              icon={<FolderOpen className="h-4 w-4" />}
            />
            <ProjectMetric
              label={t("workspace.sessions")}
              value={formatNumber(day.rows.length)}
              detail={t("workspace.roundsMessages", { rounds: formatNumber(totals.rounds), messages: formatNumber(totals.messages) })}
              icon={<MessageSquare className="h-4 w-4" />}
            />
            <ProjectMetric
              label={t("common.runtime")}
              value={formatNumber(totals.runtime)}
              detail={t("workspace.runningCount", { count: formatNumber(day.running) })}
              icon={<Terminal className="h-4 w-4" />}
            />
            <ProjectMetric
              label={t("workspace.needsReview")}
              value={formatNumber(day.needsReview)}
              detail={t("workspace.conversationCount", { count: formatNumber(totals.history) })}
              icon={<AlertCircle className="h-4 w-4" />}
            />
          </section>

          <section className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h3 className="font-serif text-base font-semibold text-foreground">{t("workspace.dailyReportBrief")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {evidenceLoading ? t("workspace.loadingDailyReportEvidence") : getDailyReportPlatformLabel(platform, t)}
                </p>
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-border bg-background p-1">
                {DAILY_REPORT_PLATFORMS.map((option) => {
                  const active = option === platform;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onPlatformChange(option)}
                      className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
                      }`}
                    >
                      {option === "blog" ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <Newspaper className="h-3.5 w-3.5 shrink-0" />}
                      <span className="min-w-0 truncate">{getDailyReportPlatformLabel(option, t)}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => onGenerateReport(platform)}
                  disabled={generating}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                >
                  {generating ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 shrink-0" />}
                  {t("workspace.generateDailyReportWithAi")}
                </button>
                <button
                  type="button"
                  onClick={() => onCopyPrompt(platform)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5 shrink-0" />
                  {t("workspace.copyDailyReportPrompt")}
                </button>
              </div>
            </div>
            <pre className="max-h-[min(46vh,520px)] overflow-auto whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-6 text-foreground">{prompt}</pre>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="font-serif text-base font-semibold text-foreground">{t("workspace.projectResults")}</h3>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{formatNumber(day.projectCount)}</span>
            </div>
            <div className="divide-y divide-border">
              {day.projects.map((project) => (
                <div key={project.key} className="px-4 py-4">
                  <div className="mb-2 flex min-w-0 items-center gap-2">
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <h4 className="min-w-0 flex-1 truncate font-serif text-base font-semibold text-foreground" title={project.path}>
                      {getProjectLabel(project.path)}
                    </h4>
                    {project.running ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : null}
                    {project.needsReview && !project.running ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatNumber(project.rows.length)}</span>
                  </div>
                  <div className="space-y-px">
                    {project.rows.map((row) => {
                      const provider = getConversationProvider(row);
                      const title = getConversationTitle(row, {
                        untitledConversation: t("common.untitledConversation"),
                        shell: t("chat.shell"),
                        newSession: t("chat.newSession"),
                      });
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => onSelectConversation(row)}
                          disabled={row.archived}
                          className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-card-alt disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
                          title={title}
                        >
                          {provider ? (
                            <ProviderIcon provider={provider} />
                          ) : (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-card-alt text-muted-foreground">
                              <MessageSquare className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{getConversationStatusLabel(row, t)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ProjectDetailsPanel({
  projectPath,
  project,
  conversations,
  stats,
  onClose,
  onNewConversation,
  onEnvironment,
  onSelectConversation,
}: {
  projectPath: string;
  project: Project | null;
  conversations: WorkbenchConversation[];
  stats: ProjectConversationStats | null;
  onClose: () => void;
  onNewConversation: () => void;
  onEnvironment: () => void;
  onSelectConversation: (row: WorkbenchConversation) => void;
}) {
  const { t } = useI18n();
  const analysis = useMemo(() => {
    const nowMs = Date.now();
    const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000;
    const providerCounts = new Map<string, number>();
    const createdTimestamps: number[] = [];
    let active = 0;
    let archived = 0;
    let running = 0;
    let needsReview = 0;
    let unread = 0;
    let runtime = 0;
    let history = 0;
    let recent = 0;
    let stale = 0;
    let rounds = 0;
    let messages = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let contextTokens = 0;
    let cost = 0;

    for (const row of conversations) {
      const providerLabel = getConversationSourceLabel(row, t);
      providerCounts.set(providerLabel, (providerCounts.get(providerLabel) ?? 0) + 1);
      createdTimestamps.push(getConversationCreatedAt(row));
      if (row.archived) archived += 1;
      else active += 1;
      if (row.runtime) {
        runtime += 1;
      }
      if (isConversationAgentRunning(row)) running += 1;
      if (row.transcript) {
        history += 1;
        rounds += row.transcript.rounds ?? 0;
        messages += row.transcript.message_count ?? 0;
        inputTokens += row.transcript.usage?.input_tokens ?? 0;
        outputTokens += row.transcript.usage?.output_tokens ?? 0;
        contextTokens += row.transcript.usage?.context_tokens ?? 0;
        cost += row.transcript.usage?.cost_usd ?? 0;
      }
      if (row.needsReview) needsReview += 1;
      if (row.unread) unread += 1;
      if (row.timestamp >= sevenDaysAgo) recent += 1;
      if (row.timestamp > 0 && row.timestamp < thirtyDaysAgo) stale += 1;
    }

    const lastActivity = Math.max(project?.last_active ? project.last_active * 1000 : 0, ...conversations.map((row) => row.timestamp));
    const firstActivity = createdTimestamps.length > 0 ? Math.min(...createdTimestamps) : null;
    const providerEntries = [...providerCounts.entries()].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));

    return {
      total: conversations.length,
      active,
      archived,
      running,
      needsReview,
      unread,
      runtime,
      history,
      recent,
      stale,
      rounds,
      messages,
      inputTokens,
      outputTokens,
      contextTokens,
      cost,
      lastActivity: lastActivity > 0 ? lastActivity : null,
      firstActivity,
      providerEntries,
    };
  }, [conversations, project?.last_active, t]);

  const statSource = stats ?? {
    active: analysis.active,
    archived: analysis.archived,
    running: analysis.running,
    unread: analysis.unread,
    needsReview: analysis.needsReview,
    history: analysis.history,
    total: analysis.total,
    lastActive: analysis.lastActivity ?? 0,
    createdAt: analysis.firstActivity ?? 0,
  };

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card-alt text-muted-foreground">
              <FolderOpen className="h-4 w-4" />
            </span>
            <h2 className="truncate font-serif text-lg font-semibold text-foreground">
              {getProjectName(projectPath)}
            </h2>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={projectPath}>
            {projectPath}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton title={t("workspace.newConversation")} onClick={onNewConversation}>
            <Plus className="h-4 w-4" />
          </IconButton>
          <IconButton title={t("common.environment")} onClick={onEnvironment}>
            <Settings2 className="h-4 w-4" />
          </IconButton>
          <IconButton title={t("workspace.closeDetails")} onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ProjectMetric
              label={t("workspace.sessions")}
              value={formatNumber(analysis.total)}
              detail={t("workspace.activeArchived", { active: formatNumber(statSource.active), archived: formatNumber(statSource.archived) })}
              icon={<MessageSquare className="h-4 w-4" />}
            />
            <ProjectMetric
              label={t("common.runtime")}
              value={formatNumber(analysis.runtime)}
              detail={t("workspace.runtimeCount", { count: formatNumber(statSource.running) })}
              icon={<Terminal className="h-4 w-4" />}
            />
            <ProjectMetric
              label={t("workspace.needsReview")}
              value={formatNumber(statSource.needsReview)}
              detail={t("workspace.unreadCount", { count: formatNumber(statSource.unread) })}
              icon={<AlertCircle className="h-4 w-4" />}
            />
            <ProjectMetric
              label={t("session.history")}
              value={formatNumber(analysis.history)}
              detail={t("workspace.roundsMessages", { rounds: formatNumber(analysis.rounds), messages: formatNumber(analysis.messages) })}
              icon={<Archive className="h-4 w-4" />}
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="font-serif text-base font-semibold text-foreground">{t("workspace.projectInformation")}</h3>
              </div>
              <div className="grid gap-0 divide-y divide-border">
                <ProjectInfoRow label={t("workspace.path")} value={projectPath} mono />
                <ProjectInfoRow label={t("workspace.lastActivity")} value={formatDateTime(analysis.lastActivity, t)} detail={formatRelativeTime(analysis.lastActivity, t)} />
                <ProjectInfoRow label={t("workspace.firstSession")} value={formatDateTime(analysis.firstActivity, t)} />
                <ProjectInfoRow label={t("workspace.projectIndex")} value={project ? t("chat.sessionCount", { count: formatNumber(project.session_count) }) : t("workspace.notIndexed")} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="font-serif text-base font-semibold text-foreground">{t("workspace.sessionAnalysis")}</h3>
              </div>
              <div className="space-y-4 px-4 py-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <ProjectAnalysisItem label={t("workspace.last7Days")} value={formatNumber(analysis.recent)} />
                  <ProjectAnalysisItem label={t("workspace.olderThan30Days")} value={formatNumber(analysis.stale)} />
                  <ProjectAnalysisItem label={t("workspace.inputTokens")} value={formatNumber(analysis.inputTokens)} />
                  <ProjectAnalysisItem label={t("workspace.outputTokens")} value={formatNumber(analysis.outputTokens)} />
                  <ProjectAnalysisItem label={t("workspace.contextTokens")} value={formatNumber(analysis.contextTokens)} />
                  <ProjectAnalysisItem label={t("workspace.cost")} value={formatCost(analysis.cost)} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("workspace.providerMix")}</div>
                  <div className="flex flex-wrap gap-2">
                    {analysis.providerEntries.length > 0 ? (
                      analysis.providerEntries.map(([label, count]) => (
                        <span
                          key={label}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-alt px-2 py-1 text-xs font-medium text-foreground"
                        >
                          <span>{label}</span>
                          <span className="tabular-nums text-muted-foreground">{formatNumber(count)}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("common.noSessions")}</span>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="font-serif text-base font-semibold text-foreground">{t("workspace.allSessions")}</h3>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{formatNumber(analysis.total)}</span>
            </div>
            <div className="divide-y divide-border">
              {conversations.length > 0 ? (
                conversations.map((row) => {
                  const provider = getConversationProvider(row);
                  const status = getConversationStatusLabel(row, t);
                  const title = getConversationTitle(row, {
                    untitledConversation: t("common.untitledConversation"),
                    shell: t("chat.shell"),
                    newSession: t("chat.newSession"),
                  });
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onSelectConversation(row)}
                      disabled={row.archived}
                      className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card-alt disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
                      title={row.archived ? t("workspace.archivedSession") : title}
                    >
                      {provider ? (
                        <ProviderIcon provider={provider} />
                      ) : (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-card-alt text-muted-foreground">
                          <MessageSquare className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{title}</div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{getConversationSourceLabel(row, t)}</span>
                          <span>/</span>
                          <span>{status}</span>
                          {row.transcript ? (
                            <>
                              <span>/</span>
                              <span>{t("chat.rounds", { count: formatNumber(row.transcript.rounds) })}</span>
                              <span>/</span>
                              <span>{t("chat.messagesTotal", { count: formatNumber(row.transcript.message_count) })}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatRelativeTime(row.timestamp, t)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("common.noSessions")}</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ProjectMetric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-2 text-muted-foreground">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-card-alt">{icon}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ProjectInfoRow({ label, value, detail, mono }: { label: string; value: string; detail?: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="min-w-0">
        <div className={`truncate text-sm text-foreground ${mono ? "font-mono" : ""}`} title={value}>
          {value}
        </div>
        {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

function ProjectAnalysisItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card-alt px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function MenuItemTooltip({
  title,
  description,
  rules,
  children,
}: {
  title: string;
  description: string;
  rules?: string[];
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={MENU_ITEM_TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        sideOffset={8}
        className="z-[60] w-72 max-w-[calc(100vw-2rem)] p-3 text-left"
      >
        <div className="space-y-2">
          <div className="text-sm font-medium leading-none">{title}</div>
          <p className="text-xs leading-relaxed text-background/80">{description}</p>
          {rules && rules.length > 0 ? (
            <div className="space-y-1 border-t border-background/20 pt-2">
              {rules.map((rule) => (
                <div key={rule} className="flex gap-2 text-xs leading-snug text-background/80">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-background/60" />
                  <span>{rule}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function WorkbenchOutlineMenu({
  outlineMode,
  onOutlineModeChange,
  mergeWorktrees,
  onMergeWorktreesChange,
  showProjectNewConversation,
  onShowProjectNewConversationChange,
  displayFilter,
  onDisplayFilterChange,
  sortMode,
  onSortModeChange,
  reorderGroups,
  onReorderGroupsChange,
}: {
  outlineMode: WorkbenchOutlineMode;
  onOutlineModeChange: (mode: WorkbenchOutlineMode) => void;
  mergeWorktrees: boolean;
  onMergeWorktreesChange: (merge: boolean) => void;
  showProjectNewConversation: boolean;
  onShowProjectNewConversationChange: (show: boolean) => void;
  displayFilter: WorkbenchDisplayFilter;
  onDisplayFilterChange: (filter: WorkbenchDisplayFilter) => void;
  sortMode: WorkbenchSortMode;
  onSortModeChange: (mode: WorkbenchSortMode) => void;
  reorderGroups: boolean;
  onReorderGroupsChange: (reorder: boolean) => void;
}) {
  const { t } = useI18n();
  const outlineLabel =
    outlineMode === "project"
      ? t("workspace.byProject")
      : outlineMode === "day"
        ? t("workspace.byDay")
        : t("common.none");
  const sortLabel = sortMode === "last-modified" ? t("workspace.latestModified") : sortMode === "created" ? t("workspace.created") : t("common.name");
  const filterLabel = displayFilter === "running" ? t("workspace.running") : displayFilter === "review" ? t("workspace.needsReview") : t("workspace.allConversations");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
          title={t("workspace.groupSortFilter")}
          aria-label={t("workspace.groupSortFilter")}
        >
          <ListFilter className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={12}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-56 overflow-y-auto overscroll-contain"
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.group")}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer rounded-lg">
            <span className="min-w-0 flex-1">{t("workspace.by")}</span>
            <span className="mr-1 max-w-24 truncate text-xs text-muted-foreground">{outlineLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent sideOffset={8} alignOffset={-4} className="w-64 rounded-xl p-1.5">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.groupBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={outlineMode} onValueChange={(value) => onOutlineModeChange(value as WorkbenchOutlineMode)}>
	              <MenuItemTooltip
	                title={t("common.none")}
	                description={t("workspace.doNotGroupConversations")}
	                rules={[t("workspace.sortAppliesToConversations")]}
	              >
                <DropdownMenuRadioItem value="recent">{t("common.none")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
	              <MenuItemTooltip
	                title={t("workspace.byProject")}
	                description={t("workspace.groupConversationsByProject")}
	                rules={[t("workspace.projectConversationsUseSort"), t("workspace.groupOrderLatestUnlessReorder")]}
	              >
                <DropdownMenuRadioItem value="project">{t("workspace.byProject")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
	              <MenuItemTooltip
	                title={t("workspace.byDay")}
	                description={t("workspace.groupConversationsByDay")}
	                rules={[t("workspace.dayGroupsShowProjects"), t("workspace.dayConversationsUseSort")]}
	              >
                <DropdownMenuRadioItem value="day">{t("workspace.byDay")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
	        <MenuItemTooltip
	          title={t("workspace.reorderGroups")}
	          description={t("workspace.applySortToProjectGroups")}
	          rules={[t("workspace.groupsStayLatestByDefault"), t("workspace.onlyWhenGroupedByProject")]}
	        >
          <DropdownMenuCheckboxItem
            checked={reorderGroups}
            onCheckedChange={(checked) => onReorderGroupsChange(checked === true)}
          >
            {t("workspace.reorderGroups")}
          </DropdownMenuCheckboxItem>
        </MenuItemTooltip>
	        <MenuItemTooltip
	          title={t("workspace.newConversationInEachProject")}
	          description={t("workspace.showNewConversationInProjects")}
	          rules={[t("workspace.offByDefault"), t("workspace.emptyGroupsAlwaysShowNew")]}
	        >
          <DropdownMenuCheckboxItem
            checked={showProjectNewConversation}
            onCheckedChange={(checked) => onShowProjectNewConversationChange(checked === true)}
          >
            {t("workspace.newConversationInEachProject")}
          </DropdownMenuCheckboxItem>
        </MenuItemTooltip>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.sort")}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer rounded-lg">
            <span className="min-w-0 flex-1">{t("workspace.by")}</span>
            <span className="mr-1 max-w-24 truncate text-xs text-muted-foreground">{sortLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent sideOffset={8} alignOffset={-4} className="w-64 rounded-xl p-1.5">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.sortBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sortMode} onValueChange={(value) => onSortModeChange(value as WorkbenchSortMode)}>
	              <MenuItemTooltip
	                title={t("workspace.latestModified")}
	                description={t("workspace.ordersByRecentActivity")}
	                rules={[t("workspace.allLatestConversationModified"), t("workspace.projectLatestActivity")]}
	              >
                <DropdownMenuRadioItem value="last-modified">{t("workspace.latestModified")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
	              <MenuItemTooltip
	                title={t("workspace.created")}
	                description={t("workspace.ordersByCreationTime")}
	                rules={[t("workspace.allConversationCreated"), t("workspace.projectEarliestConversation")]}
	              >
                <DropdownMenuRadioItem value="created">{t("workspace.created")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
	              <MenuItemTooltip
	                title={t("common.name")}
	                description={t("workspace.ordersAlphabetically")}
	                rules={[t("workspace.allConversationTitle"), t("workspace.projectName"), t("workspace.recentActivityBreaksTies")]}
	              >
                <DropdownMenuRadioItem value="name">{t("common.name")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.filter")}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer rounded-lg">
            <span className="min-w-0 flex-1">{t("workspace.by")}</span>
            <span className="mr-1 max-w-24 truncate text-xs text-muted-foreground">{filterLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent sideOffset={8} alignOffset={-4} className="w-64 rounded-xl p-1.5">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.filterBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={displayFilter} onValueChange={(value) => onDisplayFilterChange(value as WorkbenchDisplayFilter)}>
	              <MenuItemTooltip
	                title={t("workspace.allConversations")}
	                description={t("workspace.showEveryConversation")}
	                rules={[t("workspace.noRuntimeOrReviewFilter")]}
	              >
                <DropdownMenuRadioItem value="all">{t("workspace.allConversations")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
	              <MenuItemTooltip
	                title={t("workspace.running")}
	                description={t("workspace.showActiveRuntimeWork")}
	                rules={[t("workspace.includesRunningOrWorking")]}
	              >
                <DropdownMenuRadioItem value="running">{t("workspace.running")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
	              <MenuItemTooltip
	                title={t("workspace.needsReview")}
	                description={t("workspace.showMarkedForReview")}
	                rules={[t("workspace.includesReviewMarkers")]}
	              >
                <DropdownMenuRadioItem value="review">{t("workspace.needsReview")}</DropdownMenuRadioItem>
              </MenuItemTooltip>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("workspace.advanced")}</DropdownMenuLabel>
	        <MenuItemTooltip
	          title={t("workspace.mergeWorktrees")}
	          description={t("workspace.showWorktreesUnderSource")}
	          rules={[t("workspace.affectsProjectGrouping"), t("workspace.doesNotMoveFiles")]}
	        >
          <DropdownMenuCheckboxItem checked={mergeWorktrees} onCheckedChange={(checked) => onMergeWorktreesChange(checked === true)}>
            {t("workspace.mergeWorktrees")}
          </DropdownMenuCheckboxItem>
        </MenuItemTooltip>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getAgentStatusLabel(session: AgentSession, t?: TranslateFn) {
  if (session.archived) return t ? t("workspace.archived") : "archived";
  if (session.provider === "terminal") return t ? t("chat.shell") : "shell";
  if (isAgentRunning(session)) return t ? t("workspace.agentRunning") : "agent running";
  if (session.status === "needs-review") return t ? t("workspace.needsReview") : "needs review";
  if (session.status === "error") return t ? t("workspace.agentError") : "agent error";
  if (session.status === "completed") return t ? t("workspace.agentCompleted") : "agent completed";
  return t ? t("workspace.agentIdle") : "agent idle";
}

function ConversationButton({
  conversation,
  active,
  locateHighlightKey,
  connected,
  onSelect,
  onStart,
  onStop,
  onToggleRead,
  onTogglePin,
  onMarkNeedsReview,
  onEnvironment,
  onArchive,
  onRestore,
  onExport,
  onClose,
  displayMode,
  onDisplayModeChange,
  onLocateHighlightEnd,
  menuTranscript,
}: {
  conversation: WorkbenchConversation;
  active: boolean;
  locateHighlightKey?: number;
  connected: boolean;
  onSelect: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onToggleRead: () => void;
  onTogglePin: () => void;
  onMarkNeedsReview: () => void;
  onEnvironment: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onExport?: () => void;
  onClose?: () => void;
  displayMode?: WorkbenchDisplayMode;
  onDisplayModeChange?: (mode: WorkbenchDisplayMode) => void;
  onLocateHighlightEnd?: (key: number) => void;
  menuTranscript?: Session;
}) {
  const { t } = useI18n();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const runtime = conversation.runtime;
  const transcript = conversation.transcript;
  const displayTranscript = transcript ?? menuTranscript;
  const provider = runtime?.provider ?? providerForTranscript(displayTranscript);
  const displayTitle = transcript
    ? getHistorySessionTitle(transcript, t("common.untitledConversation"))
    : runtime
      ? getSessionDisplayTitle(runtime, { shell: t("chat.shell"), newSession: t("chat.newSession") })
      : t("common.untitledConversation");
  const agentRunning = isConversationAgentRunning(conversation);
  const runtimeLabel = conversation.archived
    ? t("workspace.archived")
    : agentRunning
      ? t("workspace.agentRunning")
      : runtime
        ? getAgentStatusLabel(runtime, t)
        : t("workspace.conversation");
  const readLabel = conversation.unread ? t("workspace.unread") : t("workspace.read");
  const pinnedLabel = conversation.pinned ? t("workspace.pinned") : t("workspace.unpinned");
  const providerLabel = provider ? labelForProvider(provider) : displayTranscript?.source ?? t("workspace.conversation");
  const relativeTime = formatRelativeTime(conversation.timestamp, t);
  const needsCheck = !agentRunning && conversation.needsReview;
  const defaultToolbarContent = agentRunning ? (
    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label={runtimeLabel} />
  ) : needsCheck ? (
    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={t("workspace.needsReview")} />
  ) : (
    <span className="min-w-[3.5rem] text-right">{relativeTime}</span>
  );
  const renderLeadingIcon = () =>
    provider ? (
      <ProviderIcon provider={provider} />
    ) : (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-card-alt text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
      </span>
    );
  const handleInlineArchiveClick = () => {
    if (confirmingArchive) {
      setConfirmingArchive(false);
      onArchive();
      return;
    }
    setConfirmingArchive(true);
  };

  useEffect(() => {
    setConfirmingArchive(false);
    setActionsMenuOpen(false);
  }, [conversation.conversationId, conversation.archived]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-conversation-id={conversation.conversationId}
          className={`group relative z-0 flex h-[31px] w-full items-center overflow-hidden rounded-sm transition-colors ${
            active
              ? "bg-primary/10"
              : "hover:bg-card-alt"
          }`}
          onMouseLeave={() => setConfirmingArchive(false)}
        >
          {locateHighlightKey !== undefined ? (
            <span
              key={locateHighlightKey}
              className="conversation-locate-highlight pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-sm"
              onAnimationEnd={() => onLocateHighlightEnd?.(locateHighlightKey)}
            />
          ) : null}
          <button
            type="button"
            onClick={onSelect}
            aria-label={`${displayTitle}, ${providerLabel}, ${runtimeLabel}, ${pinnedLabel}, ${readLabel}, ${relativeTime}`}
            className="relative z-10 flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden pl-2.5 pr-2.5 text-left"
          >
            {renderLeadingIcon()}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{displayTitle}</span>
            <span
              className={`flex min-w-[4.25rem] shrink-0 items-center justify-end whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground transition-opacity ${
                confirmingArchive || actionsMenuOpen
                  ? "opacity-0"
                  : "opacity-100 group-hover:opacity-0 group-focus-within:opacity-0"
              }`}
            >
              {defaultToolbarContent}
            </span>
            <span className="sr-only">
              {runtimeLabel}, {pinnedLabel}, {readLabel}
            </span>
          </button>
          <div
            className={`absolute inset-y-0 right-0 z-10 flex w-[4.75rem] items-center justify-end gap-1 pr-[5px] transition-opacity ${
              confirmingArchive || actionsMenuOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            }`}
          >
            <DropdownMenu modal={false} open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <SidebarActionButton title={t("workspace.conversationActions")} onClick={() => undefined} active={actionsMenuOpen}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </SidebarActionButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
                <WorkspaceConversationDropdownMenuItems
                  conversation={conversation}
                  menuTranscript={menuTranscript}
                  connected={connected}
                  onSelect={onSelect}
                  onStart={onStart}
                  onStop={onStop}
                  onToggleRead={onToggleRead}
                  onTogglePin={onTogglePin}
                  onMarkNeedsReview={onMarkNeedsReview}
                  onEnvironment={onEnvironment}
                  onArchive={onArchive}
                  onRestore={onRestore}
                  onExport={onExport}
                  onClose={onClose}
                  displayMode={displayMode}
                  onDisplayModeChange={onDisplayModeChange}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            {conversation.archived ? (
              <SidebarActionButton title={t("workspace.restoreConversation")} onClick={onRestore}>
                <ArchiveRestore className="h-3.5 w-3.5" />
              </SidebarActionButton>
            ) : (
              <SidebarActionButton
                title={confirmingArchive ? t("workspace.confirmArchive") : t("workspace.archiveConversation")}
                onClick={handleInlineArchiveClick}
                active={confirmingArchive}
              >
                {confirmingArchive ? <Check className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              </SidebarActionButton>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
        <WorkspaceConversationContextMenuItems
          conversation={conversation}
          menuTranscript={menuTranscript}
          connected={connected}
          onSelect={onSelect}
          onStart={onStart}
          onStop={onStop}
          onToggleRead={onToggleRead}
          onTogglePin={onTogglePin}
          onMarkNeedsReview={onMarkNeedsReview}
          onEnvironment={onEnvironment}
          onArchive={onArchive}
          onRestore={onRestore}
          onExport={onExport}
          onClose={onClose}
          displayMode={displayMode}
          onDisplayModeChange={onDisplayModeChange}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

type RuntimeConversationMenuProps = {
  conversation: WorkbenchConversation;
  connected: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onToggleRead: () => void;
  onTogglePin: () => void;
  onMarkNeedsReview: () => void;
  onEnvironment: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onClose?: () => void;
};

type WorkspaceConversationMenuProps = RuntimeConversationMenuProps & {
  menuTranscript?: Session;
  onSelect: () => void;
  onExport?: () => void;
  displayMode?: WorkbenchDisplayMode;
  onDisplayModeChange?: (mode: WorkbenchDisplayMode) => void;
};

function getWorkspaceConversationSessionMenuProps(
  {
    conversation,
    menuTranscript,
    connected,
    onSelect,
    onStart,
    onStop,
    onToggleRead,
    onTogglePin,
    onMarkNeedsReview,
    onEnvironment,
    onArchive,
    onRestore,
    onExport,
    onClose,
    displayMode,
    onDisplayModeChange,
  }: WorkspaceConversationMenuProps,
  t: TranslateFn,
): SessionDetailMenuConfig | null {
  const transcript = conversation.transcript ?? menuTranscript;
  if (!transcript) return null;

  return {
    projectId: transcript.project_id,
    sessionId: transcript.id,
    title: getHistorySessionTitle(transcript, t("common.untitledConversation")),
    source: transcript.source,
    projectPath: transcript.project_path ?? conversation.projectPath,
    isArchivedOverride: conversation.archived,
    onToggleArchiveOverride: conversation.archived ? onRestore : onArchive,
    isPinnedOverride: conversation.pinned,
    onTogglePinOverride: onTogglePin,
    onExport,
    onClose,
    displayMode,
    onDisplayModeChange,
    onOpenConversation: onSelect,
    onEnvironment,
    onStartRuntime: onStart,
    onStopRuntime: onStop,
    runtimeConnected: connected,
    unread: conversation.unread,
    onToggleRead,
    needsReview: conversation.needsReview,
    onMarkNeedsReview,
  };
}

function WorkspaceConversationDropdownMenuItems(props: WorkspaceConversationMenuProps) {
  const { t } = useI18n();
  const sessionMenuProps = getWorkspaceConversationSessionMenuProps(props, t);

  if (sessionMenuProps) {
    return <SessionDetailDropdownMenuItems {...sessionMenuProps} />;
  }

  if (props.conversation.runtime) {
    return <RuntimeConversationDropdownMenuItems {...props} />;
  }

  return (
    <DropdownMenuItem onSelect={props.conversation.archived ? props.onRestore : props.onArchive} className="gap-2">
      {props.conversation.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      {props.conversation.archived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
    </DropdownMenuItem>
  );
}

function WorkspaceConversationContextMenuItems(props: WorkspaceConversationMenuProps) {
  const { t } = useI18n();
  const sessionMenuProps = getWorkspaceConversationSessionMenuProps(props, t);

  if (sessionMenuProps) {
    return <SessionDetailContextMenuItems {...sessionMenuProps} />;
  }

  if (props.conversation.runtime) {
    return <RuntimeConversationContextMenuItems {...props} />;
  }

  return (
    <ContextMenuItem onSelect={props.conversation.archived ? props.onRestore : props.onArchive} className="gap-2">
      {props.conversation.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      {props.conversation.archived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
    </ContextMenuItem>
  );
}

function RuntimeConversationDropdownMenuItems({
  conversation,
  connected,
  onStart,
  onStop,
  onToggleRead,
  onTogglePin,
  onMarkNeedsReview,
  onEnvironment,
  onArchive,
  onRestore,
  onClose,
}: RuntimeConversationMenuProps) {
  const { t } = useI18n();
  const startOrStop = connected ? onStop : onStart;
  const copyRuntimeSessionId = () => {
    const runtimeId = conversation.runtime?.id;
    if (!runtimeId) return;
    invoke("copy_to_clipboard", { text: runtimeId })
      .then(() => toast.success(t("session.infoCopied", { label: "Session ID" })))
      .catch((error) => toast.error(String(error)));
  };

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Eye className="h-4 w-4" />
          {t("session.view")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-80">
          <DropdownMenuItem disabled>{t("session.standardMode")}</DropdownMenuItem>
          <DropdownMenuItem disabled>{t("session.promptsOnly")}</DropdownMenuItem>
          <DropdownMenuItem disabled>{t("session.expandMessages")}</DropdownMenuItem>
          <DropdownMenuItem disabled>{t("session.markdownPreview")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="gap-2">
            <Info className="h-4 w-4" />
            {t("session.informationEllipsis")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Pin className="h-4 w-4" />
          {t("session.manage")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem disabled={conversation.archived} onSelect={onTogglePin} className="gap-2">
            {conversation.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {conversation.pinned ? t("session.unpin") : t("session.pinToTop")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={conversation.archived} onSelect={onToggleRead} className="gap-2">
            {conversation.unread ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {conversation.unread ? t("session.markAsRead") : t("session.markAsUnread")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={conversation.archived} onSelect={onMarkNeedsReview} className="gap-2">
            <AlertCircle className="h-4 w-4" />
            {conversation.needsReview ? t("workspace.needsReview") : t("workspace.markNeedsReview")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={conversation.archived ? onRestore : onArchive} className="gap-2">
            {conversation.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {conversation.archived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Settings2 className="h-4 w-4" />
          {t("workspace.advanced")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem disabled={conversation.archived} onSelect={onEnvironment} className="gap-2">
            <Settings2 className="h-4 w-4" />
            {t("session.configureRunScripts")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Copy className="h-4 w-4" />
          {t("session.copy")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem disabled className="gap-2">
            <Info className="h-4 w-4" />
            {t("session.sessionInfo")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="gap-2">
            <FolderInput className="h-4 w-4" />
            {t("session.relatedFilePaths")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="gap-2">
            <ClipboardList className="h-4 w-4" />
            {t("session.traceContext")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={copyRuntimeSessionId} className="gap-2">
            <Copy className="h-4 w-4" />
            Session ID
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="gap-2">
            <Terminal className="h-4 w-4" />
            {t("session.resumeCommand")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="gap-2">
            <FolderInput className="h-4 w-4" />
            {t("session.filePath")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <ArrowRightLeft className="h-4 w-4" />
          {t("session.resumeInRuntime")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {startOrStop ? (
            <DropdownMenuItem disabled={conversation.archived} onSelect={startOrStop} className="gap-2">
              {connected ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {connected ? t("workspace.stopRuntime") : t("workspace.startRuntime")}
            </DropdownMenuItem>
          ) : null}
          {onStart ? (
            <DropdownMenuItem disabled={conversation.archived} onSelect={onStart} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              {t("workspace.runAgain")}
            </DropdownMenuItem>
          ) : null}
          {!startOrStop && !onStart ? (
            <DropdownMenuItem disabled className="gap-2">
              <Terminal className="h-4 w-4" />
              {t("workspace.startRuntime")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem disabled className="gap-2">
        <Download className="h-4 w-4" />
        Export
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <FolderOpen className="h-4 w-4" />
          {t("session.files")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem disabled className="gap-2">
            <FolderOpen className="h-4 w-4" />
            {t("fileViewer.revealInFinder")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            {t("common.openInEditor")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {onClose ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onClose} className="gap-2">
            <X className="h-4 w-4" />
            {t("workspace.closePanel")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

function RuntimeConversationContextMenuItems({
  conversation,
  connected,
  onStart,
  onStop,
  onToggleRead,
  onTogglePin,
  onMarkNeedsReview,
  onEnvironment,
  onArchive,
  onRestore,
  onClose,
}: RuntimeConversationMenuProps) {
  const { t } = useI18n();
  const startOrStop = connected ? onStop : onStart;
  const copyRuntimeSessionId = () => {
    const runtimeId = conversation.runtime?.id;
    if (!runtimeId) return;
    invoke("copy_to_clipboard", { text: runtimeId })
      .then(() => toast.success(t("session.infoCopied", { label: "Session ID" })))
      .catch((error) => toast.error(String(error)));
  };

  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Eye className="h-4 w-4" />
          {t("session.view")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-80">
          <ContextMenuItem disabled>{t("session.standardMode")}</ContextMenuItem>
          <ContextMenuItem disabled>{t("session.promptsOnly")}</ContextMenuItem>
          <ContextMenuItem disabled>{t("session.expandMessages")}</ContextMenuItem>
          <ContextMenuItem disabled>{t("session.markdownPreview")}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled className="gap-2">
            <Info className="h-4 w-4" />
            {t("session.informationEllipsis")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Pin className="h-4 w-4" />
          {t("session.manage")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={conversation.archived} onSelect={onTogglePin} className="gap-2">
            {conversation.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {conversation.pinned ? t("session.unpin") : t("session.pinToTop")}
          </ContextMenuItem>
          <ContextMenuItem disabled={conversation.archived} onSelect={onToggleRead} className="gap-2">
            {conversation.unread ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {conversation.unread ? t("session.markAsRead") : t("session.markAsUnread")}
          </ContextMenuItem>
          <ContextMenuItem disabled={conversation.archived} onSelect={onMarkNeedsReview} className="gap-2">
            <AlertCircle className="h-4 w-4" />
            {conversation.needsReview ? t("workspace.needsReview") : t("workspace.markNeedsReview")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={conversation.archived ? onRestore : onArchive} className="gap-2">
            {conversation.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {conversation.archived ? t("workspace.unarchiveConversation") : t("workspace.archiveConversation")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Settings2 className="h-4 w-4" />
          {t("workspace.advanced")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={conversation.archived} onSelect={onEnvironment} className="gap-2">
            <Settings2 className="h-4 w-4" />
            {t("session.configureRunScripts")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Copy className="h-4 w-4" />
          {t("session.copy")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled className="gap-2">
            <Info className="h-4 w-4" />
            {t("session.sessionInfo")}
          </ContextMenuItem>
          <ContextMenuItem disabled className="gap-2">
            <FolderInput className="h-4 w-4" />
            {t("session.relatedFilePaths")}
          </ContextMenuItem>
          <ContextMenuItem disabled className="gap-2">
            <ClipboardList className="h-4 w-4" />
            {t("session.traceContext")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={copyRuntimeSessionId} className="gap-2">
            <Copy className="h-4 w-4" />
            Session ID
          </ContextMenuItem>
          <ContextMenuItem disabled className="gap-2">
            <Terminal className="h-4 w-4" />
            {t("session.resumeCommand")}
          </ContextMenuItem>
          <ContextMenuItem disabled className="gap-2">
            <FolderInput className="h-4 w-4" />
            {t("session.filePath")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <ArrowRightLeft className="h-4 w-4" />
          {t("session.resumeInRuntime")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {startOrStop ? (
            <ContextMenuItem disabled={conversation.archived} onSelect={startOrStop} className="gap-2">
              {connected ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {connected ? t("workspace.stopRuntime") : t("workspace.startRuntime")}
            </ContextMenuItem>
          ) : null}
          {onStart ? (
            <ContextMenuItem disabled={conversation.archived} onSelect={onStart} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              {t("workspace.runAgain")}
            </ContextMenuItem>
          ) : null}
          {!startOrStop && !onStart ? (
            <ContextMenuItem disabled className="gap-2">
              <Terminal className="h-4 w-4" />
              {t("workspace.startRuntime")}
            </ContextMenuItem>
          ) : null}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem disabled className="gap-2">
        <Download className="h-4 w-4" />
        Export
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <FolderOpen className="h-4 w-4" />
          {t("session.files")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled className="gap-2">
            <FolderOpen className="h-4 w-4" />
            {t("fileViewer.revealInFinder")}
          </ContextMenuItem>
          <ContextMenuItem disabled className="gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            {t("common.openInEditor")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {onClose ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onClose} className="gap-2">
            <X className="h-4 w-4" />
            {t("workspace.closePanel")}
          </ContextMenuItem>
        </>
      ) : null}
    </>
  );
}

type SidebarActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  title: string;
  active?: boolean;
  destructive?: boolean;
};

const SidebarActionButton = forwardRef<HTMLButtonElement, SidebarActionButtonProps>(
  ({ title, onClick, children, active = false, destructive = false, className = "", ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={title}
      title={title}
      onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground"
      } ${
        destructive && !active ? "hover:border-destructive/40 hover:text-destructive" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  ),
);

SidebarActionButton.displayName = "SidebarActionButton";

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function HarnessChatPane({
  session,
  cwd,
}: {
  session: AgentSession;
  cwd?: string | null;
}) {
  const toReadable = useReadableText();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messages = (session.harnessMessages ?? [])
    .filter((message) => !message.transient || isAgentRunning(session))
    .map((message, index) => harnessMessageToStandardMessage(message, index, isAgentRunning(session)));
  const handleCopyContent = useCallback((content: string) => {
    invoke("copy_to_clipboard", { text: content });
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background">
      {messages.length > 0 ? (
        <div className="border-t border-border/40">
          <StandardMessageList
            messages={messages}
            userPromptsOnly={false}
            originalChat
            markdownPreview
            expandMessages
            toReadable={toReadable}
            onCopy={handleCopyContent}
            cwd={cwd ?? undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

function DetachedState({
  session,
  onStart,
  onRestore,
}: {
  session: AgentSession;
  onStart: () => void;
  onRestore: () => void;
}) {
  const { t } = useI18n();

  if (session.archived) {
    return (
      <div className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-xl border border-border bg-card px-5 py-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-card-alt text-muted-foreground">
            <Archive className="h-5 w-5" />
          </div>
          <h3 className="font-serif text-xl font-semibold text-foreground">{t("workspace.conversationArchived")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("workspace.conversationArchivedDescription")}
          </p>
          <button
            type="button"
            onClick={onRestore}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ArchiveRestore className="h-4 w-4" />
            {t("workspace.restore")}
          </button>
        </div>
      </div>
    );
  }

  const displayCommand = session.command ? stripLovcodeHookEnvPrefix(session.command).trim() : "";

  return (
    <div className="flex h-full items-center justify-center bg-background px-6">
      <div className="max-w-md rounded-xl border border-border bg-card px-5 py-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-card-alt text-muted-foreground">
          <X className="h-5 w-5" />
        </div>
        <h3 className="font-serif text-xl font-semibold text-foreground">{t("workspace.conversationNotAttached")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("workspace.conversationNotAttachedDescription")}
        </p>
        {displayCommand && (
          <code className="mt-4 block truncate rounded-lg bg-card-alt px-3 py-2 text-left font-mono text-xs text-muted-foreground">
            {displayCommand}
          </code>
        )}
        <button
          type="button"
          onClick={onStart}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Play className="h-4 w-4" />
          {t("workspace.startRuntime")}
        </button>
      </div>
    </div>
  );
}
