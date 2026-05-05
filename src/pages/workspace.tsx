import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderOpen,
  ListFilter,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Settings2,
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildAgentCommand, labelForProvider, makeSessionTitle, prefixCommandEnv, runtimeForProvider } from "@/lib/agent/commands";
import {
  buildEnvironmentCommand,
  getCurrentEnvironmentPlatform,
  getEnvironmentScript,
  normalizeEnvironmentKey,
} from "@/lib/agent/environment";
import { useInvokeQuery, usePtyStatus, useStreamedSessions } from "@/hooks";
import { useResize } from "@/hooks/useResize";
import { SessionDetail, type SessionForkPayload } from "@/views/Chat/ProjectList";
import type {
  AgentProvider,
  AgentSession,
  AgentWorkspaceSidebarState,
  AgentWorkspaceState,
  EnvironmentAction,
  EnvironmentConfig,
  EnvironmentScope,
  Project,
  Session,
  WorkbenchConversationMeta,
} from "@/types";

interface PtyDataEvent {
  id: string;
  data: number[];
}

interface PtyExitEvent {
  id: string;
}

interface AgentWorkspaceHookConfig {
  eventsDir: string;
  scriptPath: string;
}

interface AgentHookEvent {
  sessionId: string;
  event: "UserPromptSubmit" | "Stop" | "StopFailure" | string;
  timestamp?: number;
}

interface EnvironmentDialogTarget {
  projectPath: string | null;
  sessionKey: string | null;
  sessionTitle: string | null;
}

const AGENT_OUTPUT_IDLE_MS = 3500;
const AGENT_SUBMIT_IDLE_FALLBACK_MS = 120000;
const SESSIONS_SIDEBAR_MIN_WIDTH = 300;
const SESSIONS_SIDEBAR_MAX_WIDTH = 560;
const DEFAULT_SESSIONS_SIDEBAR_WIDTH = 360;
const PROJECT_GROUP_INLINE_LIMIT = 8;
const MENU_ITEM_TOOLTIP_DELAY_MS = 650;
const LOVCODE_HOOK_ENV_RE = /^(?:LOVCODE_AGENT_SESSION_ID|LOVCODE_AGENT_HOOK_FILE)=(?:'[^']*'|"[^"]*"|\S+)\s*/;
const GENERAL_CHAT_LABEL = "General chat";
type SessionListMode = "active" | "archived";
type WorkbenchOutlineMode = "project" | "recent";
type WorkbenchDisplayFilter = "all" | "running" | "review";
type WorkbenchSortMode = "last-modified" | "created" | "name";
type PersistedSidebarState = {
  sessionListMode: SessionListMode;
  outlineMode: WorkbenchOutlineMode;
  displayFilter: WorkbenchDisplayFilter;
  sortMode: WorkbenchSortMode;
  mergeWorktrees: boolean;
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
  unread: boolean;
  needsReview: boolean;
  meta?: WorkbenchConversationMeta;
  transcript?: Session;
  runtime?: AgentSession;
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
    mergeWorktrees: true,
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
  projectEnvironments: {},
  sessionEnvironments: {},
  sidebar: getDefaultSidebarState(),
  activeSessionId: null,
});

function clampSessionsSidebarWidth(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SESSIONS_SIDEBAR_WIDTH;
  return Math.min(SESSIONS_SIDEBAR_MAX_WIDTH, Math.max(SESSIONS_SIDEBAR_MIN_WIDTH, numeric));
}

function normalizeSidebarState(sidebar?: AgentWorkspaceSidebarState | null): PersistedSidebarState {
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
    outlineMode: sidebar?.outlineMode === "project" ? "project" : "recent",
    displayFilter,
    sortMode,
    mergeWorktrees: sidebar?.mergeWorktrees === false ? false : true,
    collapsedProjectPaths,
    expandedProjectPaths,
    sessionsSidebarWidth: clampSessionsSidebarWidth(sidebar?.sessionsSidebarWidth),
    activeConversationId,
  };
}

function now() {
  return Date.now();
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

function getHistorySessionTitle(session: Session) {
  return session.title || session.summary || session.last_prompt || "Untitled conversation";
}

function getHistoryConversationId(session: Session) {
  return `history:${session.project_id}:${session.id}`;
}

function getRuntimeConversationId(session: AgentSession, transcript?: Session) {
  return transcript ? getHistoryConversationId(transcript) : `runtime:${session.id}`;
}

function getConversationTitle(row: WorkbenchConversation) {
  return row.transcript
    ? getHistorySessionTitle(row.transcript)
    : row.runtime
      ? getSessionDisplayTitle(row.runtime)
      : "Untitled conversation";
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

function formatRelativeTime(timestamp?: number | null) {
  if (!timestamp) return "No activity";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 10) return "now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDateTime(timestamp?: number | null) {
  if (!timestamp) return "No activity";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatCost(value: number) {
  if (!value) return "$0";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
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

function isAgentProvider(provider: AgentProvider) {
  return provider === "claude" || provider === "codex";
}

function usesAgentHooks(provider: AgentProvider) {
  return provider === "claude" || provider === "codex";
}

function isAgentWorking(session: AgentSession) {
  return isAgentProvider(session.provider) && session.workState === "working";
}

function hasAgentPrompt(provider: AgentProvider, prompt: string) {
  return isAgentProvider(provider) && prompt.trim().length > 0;
}

function hasReusableAgentPrompt(session: AgentSession) {
  const command = stripLovcodeHookEnvPrefix(session.command?.trim() ?? "");
  return isAgentProvider(session.provider) && Boolean(command) && command !== session.provider;
}

function getSessionDisplayTitle(session: AgentSession) {
  const providerLabel = labelForProvider(session.provider);
  const trimmed = session.title.trim();
  const prefixedTitle = `${providerLabel}: `;
  if (trimmed.startsWith(prefixedTitle)) return trimmed.slice(prefixedTitle.length).trim() || providerLabel;
  return trimmed || (session.provider === "terminal" ? "Shell" : "New session");
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

export default function AgentWorkspacePage() {
  const { data: projects = [] } = useInvokeQuery<Project[]>(["projects"], "list_projects");
  const { sessions: historySessions, initialLoading: loadingHistorySessions, streaming: historyStreaming } = useStreamedSessions();
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [plainChatWorkspacePath, setPlainChatWorkspacePath] = useState<string | null>(null);
  const [state, setState] = useState<AgentWorkspaceState>(() => emptyWorkspace());
  const [selectedHistorySession, setSelectedHistorySession] = useState<Session | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launchingIds, setLaunchingIds] = useState<Set<string>>(() => new Set());
  const [attachedPtyIds, setAttachedPtyIds] = useState<Set<string>>(() => new Set());
  const [hookEventsDir, setHookEventsDir] = useState<string | null>(null);
  const [sessionListMode, setSessionListMode] = useState<SessionListMode>("active");
  const [creatingSession, setCreatingSession] = useState(false);
  const [mainPanelClosed, setMainPanelClosed] = useState(false);
  const [selectedProjectDetailsPath, setSelectedProjectDetailsPath] = useState<string | null>(null);
  const [outlineMode, setOutlineMode] = useState<WorkbenchOutlineMode>("recent");
  const [displayFilter, setDisplayFilter] = useState<WorkbenchDisplayFilter>("all");
  const [sortMode, setSortMode] = useState<WorkbenchSortMode>("last-modified");
  const [mergeWorktrees, setMergeWorktrees] = useState(true);
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(() => new Set());
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false);
  const [environmentDefaultScope, setEnvironmentDefaultScope] = useState<EnvironmentScope>("project");
  const [environmentDialogTarget, setEnvironmentDialogTarget] = useState<EnvironmentDialogTarget | null>(null);
  const [environmentTerminal, setEnvironmentTerminal] = useState<EnvironmentTerminalSession | null>(null);
  const {
    value: sessionsSidebarWidth,
    setValue: setSessionsSidebarWidth,
    handleMouseDown: handleSessionsSidebarResize,
  } = useResize({
    direction: "horizontal",
    storageKey: "lovcode.agentWorkspace.sessionsSidebarWidth",
    defaultValue: DEFAULT_SESSIONS_SIDEBAR_WIDTH,
    min: SESSIONS_SIDEBAR_MIN_WIDTH,
    max: SESSIONS_SIDEBAR_MAX_WIDTH,
  });
  const latestStateRef = useRef(state);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentIdleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const hookLineCountsRef = useRef<Map<string, number>>(new Map());
  const restoredConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<AgentWorkspaceState>("get_agent_workspace_state"),
      invoke<string>("get_agent_workspace_file_path"),
    ])
      .then(([loadedState, path]) => {
        if (cancelled) return;
        const sidebar = normalizeSidebarState(loadedState.sidebar);
        const next = {
          ...emptyWorkspace(),
          ...loadedState,
          conversationMeta: loadedState.conversationMeta ?? {},
          projectEnvironments: loadedState.projectEnvironments ?? {},
          sessionEnvironments: loadedState.sessionEnvironments ?? {},
          sidebar,
        };
        setState(next);
        setSessionListMode(sidebar.sessionListMode);
        setOutlineMode(sidebar.outlineMode);
        setDisplayFilter(sidebar.displayFilter);
        setSortMode(sidebar.sortMode);
        setMergeWorktrees(sidebar.mergeWorktrees);
        setExpandedProjectPaths(new Set(sidebar.expandedProjectPaths));
        setSessionsSidebarWidth(sidebar.sessionsSidebarWidth);
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
        if (!cancelled) setPlainChatWorkspacePath(path);
      })
      .catch((error) => {
        console.error("Failed to prepare general chat workspace:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded || loadingHistorySessions) return;
    window.dispatchEvent(new Event("app:ready"));
  }, [loaded, loadingHistorySessions]);

  const activeSession = useMemo(
    () => {
      const selected = state.sessions.find((session) => session.id === state.activeSessionId);
      if (selected && !selected.archived) return selected;
      return state.sessions.find((session) => !session.archived) ?? null;
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
  const getWorkbenchProjectName = (path: string) => (isPlainChatWorkspace(path) ? GENERAL_CHAT_LABEL : getProjectName(path));
  const getWorkbenchProjectTitle = (path: string) => (isPlainChatWorkspace(path) ? GENERAL_CHAT_LABEL : path);
  const getComposerCwdLabel = (path?: string | null) =>
    path ? (isPlainChatWorkspace(path) ? GENERAL_CHAT_LABEL : getProjectName(path)) : GENERAL_CHAT_LABEL;
  const ensurePlainChatWorkspace = async () => {
    if (plainChatWorkspacePath) return plainChatWorkspacePath;
    const path = await invoke<string>("get_agent_plain_chat_workspace_path");
    setPlainChatWorkspacePath(path);
    return path;
  };
  useEffect(() => {
    if (!selectedHistorySession) return;
    const next = historySessions.find(
      (session) => session.id === selectedHistorySession.id && session.project_id === selectedHistorySession.project_id,
    );
    if (next) setSelectedHistorySession(next);
    else if (!historyStreaming) setSelectedHistorySession(null);
  }, [historySessions, historyStreaming, selectedHistorySession]);
  const allWorkbenchRows = useMemo(() => {
    const historyById = new Map(historySessions.map((session) => [session.id, session]));
    const conversationMeta = state.conversationMeta ?? {};
    const rowsById = new Map<string, WorkbenchConversation>();

    historySessions
      .filter((session) => Boolean(session.project_path))
      .forEach((session) => {
        const conversationId = getHistoryConversationId(session);
        const meta = conversationMeta[conversationId];
        rowsById.set(conversationId, {
          id: conversationId,
          conversationId,
          timestamp: session.last_modified * 1000,
          createdAt: session.created_at * 1000,
          projectPath: session.project_path!,
          archived: meta?.archived ?? false,
          archivedAt: meta?.archivedAt ?? null,
          unread: meta?.unread ?? false,
          needsReview: meta?.needsReview ?? false,
          meta,
          transcript: session,
        });
      });

    state.sessions.forEach((session) => {
      const linkedTranscript = session.linkedHistorySessionId ? historyById.get(session.linkedHistorySessionId) : undefined;
      const conversationId = getRuntimeConversationId(session, linkedTranscript);
      const current = rowsById.get(conversationId);
      const meta = conversationMeta[conversationId] ?? current?.meta;
      const runtimeTimestamp = session.lastActivityAt ?? session.updatedAt;
      const runtimeCreatedAt = linkedTranscript ? linkedTranscript.created_at * 1000 : session.createdAt;
      rowsById.set(conversationId, {
        id: current?.id ?? `agent:${session.id}`,
        conversationId,
        timestamp: Math.max(current?.timestamp ?? 0, runtimeTimestamp),
        createdAt: current?.createdAt ?? runtimeCreatedAt,
        projectPath: current?.projectPath ?? linkedTranscript?.project_path ?? session.cwd,
        archived: meta?.archived ?? session.archived ?? current?.archived ?? false,
        archivedAt: meta?.archivedAt ?? session.archivedAt ?? current?.archivedAt ?? null,
        unread: Boolean(session.unread || meta?.unread || current?.unread),
        needsReview: Boolean(session.status === "needs-review" || meta?.needsReview || current?.needsReview),
        meta,
        transcript: current?.transcript ?? linkedTranscript,
        runtime: session,
      });
    });

    return [...rowsById.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [historySessions, state.conversationMeta, state.sessions]);
  const workbenchRows = useMemo(() => {
    return allWorkbenchRows
      .filter((row) => (sessionListMode === "archived" ? row.archived : !row.archived))
      .filter((row) => {
        if (displayFilter === "all") return true;
        if (displayFilter === "running") return Boolean(row.runtime && (row.runtime.status === "running" || row.runtime.workState === "working"));
        return row.needsReview;
      })
      .sort((a, b) => {
        const aSort = sessionListMode === "archived" ? a.archivedAt ?? a.timestamp : a.timestamp;
        const bSort = sessionListMode === "archived" ? b.archivedAt ?? b.timestamp : b.timestamp;
        if (sortMode === "name") return compareText(getConversationTitle(a), getConversationTitle(b)) || bSort - aSort;
        if (sortMode === "created") return b.createdAt - a.createdAt || bSort - aSort || compareText(getConversationTitle(a), getConversationTitle(b));
        return bSort - aSort || compareText(getConversationTitle(a), getConversationTitle(b));
      });
  }, [allWorkbenchRows, displayFilter, sessionListMode, sortMode]);
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
        if (row.runtime) {
          if (row.runtime.status === "running" || row.runtime.workState === "working") current.running += 1;
        }
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
        if (sortMode === "name") return compareText(aName, bName) || b.lastActive - a.lastActive;
        if (sortMode === "created") return b.createdAt - a.createdAt || b.lastActive - a.lastActive || compareText(aName, bName);
        return b.lastActive - a.lastActive || compareText(aName, bName);
      });
  }, [mergeWorktrees, plainChatWorkspacePath, projectActivityByPath, projectPaths, projectStatsByPath, rowsByProjectPath, selectedCwd, sortMode, workbenchRows]);
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
      projectEnvironments: next.projectEnvironments ?? {},
      sessionEnvironments: next.sessionEnvironments ?? {},
      sidebar,
    };
  };

  const persist = async (next: AgentWorkspaceState) => {
    const nextState = normalizeWorkspaceState(next, "latest");
    setState(nextState);
    latestStateRef.current = nextState;
    setSaving(true);
    try {
      const saved = await invoke<AgentWorkspaceState>("save_agent_workspace_state", { state: nextState });
      const savedState = normalizeWorkspaceState(saved, "next");
      latestStateRef.current = savedState;
      setState(savedState);
    } finally {
      setSaving(false);
    }
  };

  const schedulePersist = (next: AgentWorkspaceState) => {
    const nextState = normalizeWorkspaceState(next, "next");
    latestStateRef.current = nextState;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSaving(true);
      invoke<AgentWorkspaceState>("save_agent_workspace_state", { state: latestStateRef.current })
        .then((saved) => {
          latestStateRef.current = normalizeWorkspaceState(saved, "next");
        })
        .finally(() => {
          setSaving(false);
        });
    }, 1000);
  };

  const updateSidebarState = (patch: Partial<AgentWorkspaceSidebarState>, options?: { immediate?: boolean }) => {
    const nextSidebar = normalizeSidebarState({
      ...(latestStateRef.current.sidebar ?? {}),
      ...patch,
    });
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

  const setPersistedMergeWorktrees = (merge: boolean) => {
    setMergeWorktrees(merge);
    updateSidebarState({ mergeWorktrees: merge });
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
          workState: "stopped" as const,
          updatedAt: timestamp,
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
    if (event.event === "UserPromptSubmit") {
      markAgentWorking(event.sessionId);
      return;
    }
    if (event.event === "Stop" || event.event === "agent-turn-complete" || event.event === "TurnComplete") {
      markAgentTurnComplete(event.sessionId);
      return;
    }
    if (event.event === "StopFailure") {
      markAgentTurnComplete(event.sessionId, true);
    }
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
      }
      setState((prev) => {
        let changed = false;
        const sessions = prev.sessions.map((session) => {
          if (session.ptyId !== event.payload.id) return session;
          changed = true;
          const isActive = session.id === prev.activeSessionId;
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
        const next = { ...prev, sessions };
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
  const selectedProjectPath = selectedHistorySession?.project_path ?? selectedCwd ?? (!creatingSession && !mainPanelClosed ? activeSession?.cwd : null);
  const selectedProjectEnvKey = normalizeEnvironmentKey(selectedProjectPath);
  const selectedSessionEnvKey = selectedHistorySession
    ? getHistoryConversationId(selectedHistorySession)
    : activeSession
      ? getAgentConversationId(activeSession)
      : null;
  const selectedEnvironmentSessionTitle = selectedHistorySession
    ? getHistorySessionTitle(selectedHistorySession)
    : activeSession
      ? getSessionDisplayTitle(activeSession)
      : null;
  const selectedProjectEnvironment = selectedProjectEnvKey
    ? state.projectEnvironments?.[selectedProjectEnvKey] ?? null
    : null;
  const selectedSessionEnvironment = selectedSessionEnvKey
    ? state.sessionEnvironments?.[selectedSessionEnvKey] ?? null
    : null;
  const environmentProjectPath = environmentDialogTarget?.projectPath ?? selectedProjectPath;
  const environmentProjectEnvKey = normalizeEnvironmentKey(environmentProjectPath);
  const environmentSessionKey = environmentDialogTarget?.sessionKey ?? selectedSessionEnvKey;
  const environmentSessionTitle = environmentDialogTarget?.sessionTitle ?? selectedEnvironmentSessionTitle;
  const environmentProjectConfig = environmentProjectEnvKey
    ? state.projectEnvironments?.[environmentProjectEnvKey] ?? null
    : null;
  const environmentSessionConfig = environmentSessionKey
    ? state.sessionEnvironments?.[environmentSessionKey] ?? null
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
  const primaryEnvironmentAction = sessionPrimaryEnvironmentAction ?? projectPrimaryEnvironmentAction;
  const primaryEnvironmentConfig = sessionPrimaryEnvironmentAction
    ? selectedSessionEnvironment
    : projectPrimaryEnvironmentAction
      ? selectedProjectEnvironment
      : null;
  const primaryEnvironmentScope: EnvironmentScope = sessionPrimaryEnvironmentAction ? "session" : "project";

  const handleEnvironmentDialogOpenChange = (open: boolean) => {
    setEnvironmentDialogOpen(open);
    if (!open) setEnvironmentDialogTarget(null);
  };

  const openEnvironmentDialog = (scope: EnvironmentScope) => {
    setEnvironmentDialogTarget(null);
    setEnvironmentDefaultScope(scope === "session" && selectedSessionEnvKey ? "session" : "project");
    setEnvironmentDialogOpen(true);
  };

  const openProjectEnvironmentDialog = (path: string) => {
    setEnvironmentDialogTarget({ projectPath: path, sessionKey: null, sessionTitle: null });
    setEnvironmentDefaultScope("project");
    setEnvironmentDialogOpen(true);
  };

  const openConversationEnvironmentDialog = (row: WorkbenchConversation) => {
    const title = row.transcript
      ? getHistorySessionTitle(row.transcript)
      : row.runtime
        ? getSessionDisplayTitle(row.runtime)
        : "Untitled conversation";
    setEnvironmentDialogTarget({
      projectPath: row.projectPath,
      sessionKey: row.conversationId,
      sessionTitle: title,
    });
    setEnvironmentDefaultScope("session");
    setEnvironmentDialogOpen(true);
  };

  const saveEnvironmentConfig = (scope: EnvironmentScope, config: EnvironmentConfig) => {
    const key = scope === "project" ? environmentProjectEnvKey : environmentSessionKey;
    if (!key) return;
    const base = latestStateRef.current;
    const next: AgentWorkspaceState =
      scope === "project"
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
      : config.name;
    const title =
      kind === "action"
        ? `${action?.name || "Action"} · ${sessionLabel}`
        : `${kind === "setup" ? "Setup" : "Cleanup"} · ${sessionLabel}`;
    const command = buildEnvironmentCommand(script, cwd, {
      CODEX_SOURCE_TREE_PATH: cwd,
      CODEX_WORKTREE_PATH: cwd,
      LOVCODE_PROJECT_PATH: cwd,
      LOVCODE_SESSION_ID: scope === "session" ? environmentSessionKey : undefined,
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
    options?: {
      cwd?: string | null;
      title?: string;
      resumeHistorySession?: Session;
      fork?: {
        parentSessionId: string;
        fromMessageId: string;
        fromTitle: string;
      };
    },
  ) => {
    setSelectedProjectDetailsPath(null);
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
    if (options?.resumeHistorySession) {
      setSelectedHistorySession(options.resumeHistorySession);
    } else {
      setSelectedHistorySession(null);
    }
    setMainPanelClosed(false);
    const timestamp = now();
    const id = crypto.randomUUID();
    const ptyId = crypto.randomUUID();
    const startsWorking = hasAgentPrompt(provider, prompt);
    let hookEnv: Record<string, string> | undefined;
    if (usesAgentHooks(provider)) {
      try {
        hookEnv = getAgentHookEnv(await ensureAgentHookConfig(provider, id), id);
      } catch (error) {
        console.error(`Failed to prepare ${labelForProvider(provider)} hooks:`, error);
      }
    }
    const session: AgentSession = {
      id,
      provider,
      runtime: runtimeForProvider(provider),
      cwd,
      command: getSessionCommand(provider, prompt, hookEnv, options?.resumeHistorySession?.id) ?? null,
      initialInput: getInitialInput(provider, prompt) ?? null,
      status: startsWorking ? "running" : "idle",
      workState: startsWorking ? "working" : "idle",
      ptyId,
      title: options?.title ?? makeSessionTitle(provider, prompt),
      linkedHistorySessionId: options?.resumeHistorySession?.id ?? null,
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
    setLaunchingIds((prev) => new Set(prev).add(id));
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
      }),
      activeSessionId: id,
    }).catch(console.error);
  };

  const relaunchSession = async (session: AgentSession) => {
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

  const markNeedsReview = (session: AgentSession) => {
    clearAgentIdleTimer(session.id);
    const timestamp = now();
    persist({
      ...state,
      conversationMeta: withConversationMeta(getAgentConversationId(session), {
        needsReview: true,
        unread: false,
      }),
      sessions: state.sessions.map((current) =>
        current.id === session.id
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
      ),
    }).catch(console.error);
  };

  const setSessionReadState = (session: AgentSession, unread: boolean) => {
    const timestamp = now();
    persist({
      ...state,
      conversationMeta: withConversationMeta(getAgentConversationId(session), {
        unread,
      }),
      sessions: state.sessions.map((current) =>
        current.id === session.id
          ? {
              ...current,
              unread,
              lastViewedAt: unread ? current.lastViewedAt ?? null : timestamp,
              updatedAt: timestamp,
            }
          : current,
      ),
    }).catch(console.error);
  };

  const archiveSession = (session: AgentSession) => {
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
      setSelectedHistorySession(null);
      setMainPanelClosed(false);
      setPersistedActiveConversation(null);
      setCreatingSession(true);
    }
  };

  const openNewSession = () => {
    setSelectedCwd(null);
    setSelectedProjectDetailsPath(null);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    setPersistedActiveConversation(null);
    setCreatingSession(true);
  };

  const openNewSessionForProject = (path: string) => {
    setSelectedCwd(path);
    setSelectedProjectDetailsPath(null);
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
    setSelectedCwd(path);
    setSelectedProjectDetailsPath(path);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    setCreatingSession(false);
    restoredConversationIdRef.current = null;
    setPersistedActiveConversation(null);
  };

  const selectProjectScope = (path: string) => {
    setSelectedCwd(path);
    setSelectedProjectDetailsPath(null);
    setSelectedHistorySession(null);
    setMainPanelClosed(false);
    const groupKey = getProjectGroupKey(path, mergeWorktrees);
    const rowsForProject = allWorkbenchRows.filter((row) => getProjectGroupKey(row.projectPath, mergeWorktrees) === groupKey && !row.archived);
    const nextConversation = rowsForProject[0];
    if (nextConversation?.transcript) {
      setSelectedHistorySession(nextConversation.transcript);
      setPersistedActiveConversation(nextConversation.conversationId);
      setCreatingSession(false);
      return;
    }
    if (nextConversation?.runtime) {
      setActiveSession(nextConversation.runtime.id);
      setCreatingSession(false);
      return;
    }
    setPersistedActiveConversation(null);
    setCreatingSession(true);
  };

  const activePtyId = activeSession?.ptyId ?? null;
  const activePtyExists = activePtyId ? Boolean(ptyStatus.get(activePtyId)) : false;
  const activePtyAttached = activePtyId ? attachedPtyIds.has(activePtyId) : false;
  const activeLaunching = activeSession ? launchingIds.has(activeSession.id) : false;
  const activeConnected = activePtyExists || activePtyAttached || activeLaunching;
  const shouldMountTerminal = Boolean(activeSession?.ptyId);
  const terminalRestoreOnly = Boolean(activeSession?.ptyId) && !activeConnected;
  const showProjectDetailsView = Boolean(selectedProjectDetailsPath) && !mainPanelClosed && !creatingSession && !selectedHistorySession;
  const showNewSessionView = !showProjectDetailsView && !selectedHistorySession && (creatingSession || mainPanelClosed || !activeSession);

  const getSessionConnected = (session: AgentSession) =>
    session.ptyId ? Boolean(ptyStatus.get(session.ptyId)) || attachedPtyIds.has(session.ptyId) || launchingIds.has(session.id) : false;
  const activeConversationCount = allWorkbenchRows.filter((row) => !row.archived).length;
  const archivedConversationCount = allWorkbenchRows.filter((row) => row.archived).length;
  const runningAgentCount = allWorkbenchRows.filter(
    (row) => row.runtime && !row.archived && (row.runtime.status === "running" || row.runtime.workState === "working"),
  ).length;
  const unreadAgentCount = allWorkbenchRows.filter((row) => !row.archived && row.unread).length;
  const sessionsHeaderTitle = sessionListMode === "archived" ? "Archived" : "Conversations";
  const sessionsHeaderSummary =
    sessionListMode === "archived"
      ? `${archivedConversationCount} archived conversations`
      : [
          `${workbenchRows.length} conversations`,
          activeConversationCount !== workbenchRows.length ? `${activeConversationCount} unarchived` : null,
          runningAgentCount > 0 ? `${runningAgentCount} running` : null,
          unreadAgentCount > 0 ? `${unreadAgentCount} unread` : null,
        ]
          .filter(Boolean)
          .join(" / ");
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
    setMainPanelClosed(false);
    if (row.transcript) {
      setPersistedActiveConversationId(row.conversationId);
      setSelectedHistorySession(row.transcript);
      setSelectedCwd(row.transcript.project_path ?? row.runtime?.cwd ?? row.projectPath);
      setCreatingSession(false);
      return;
    }
    if (row.runtime) setActiveSession(row.runtime.id);
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
    if (row.runtime) {
      setSessionReadState(row.runtime, unread);
      return;
    }
    persist({
      ...state,
      conversationMeta: withConversationMeta(row.conversationId, {
        unread,
      }),
    }).catch(console.error);
  };
  const markConversationNeedsReview = (row: WorkbenchConversation) => {
    if (row.runtime) {
      markNeedsReview(row.runtime);
      return;
    }
    persist({
      ...state,
      conversationMeta: withConversationMeta(row.conversationId, {
        needsReview: true,
        unread: false,
      }),
    }).catch(console.error);
  };
  const closeCurrentConversation = () => {
    setSelectedCwd(null);
    setSelectedProjectDetailsPath(null);
    setSelectedHistorySession(null);
    setCreatingSession(false);
    setMainPanelClosed(true);
  };
  const isConversationActive = (row: WorkbenchConversation) =>
    mainPanelClosed || selectedProjectDetailsPath
      ? false
      : row.transcript
      ? selectedHistorySession?.id === row.transcript.id && selectedHistorySession.project_id === row.transcript.project_id
      : Boolean(row.runtime && !selectedHistorySession && row.runtime.id === activeSession?.id);

  useEffect(() => {
    const activeConversationId = state.sidebar?.activeConversationId ?? null;
    if (!loaded || loadingHistorySessions) return;
    if (selectedProjectDetailsPath) return;
    if (!activeConversationId) {
      restoredConversationIdRef.current = null;
      return;
    }
    if (restoredConversationIdRef.current === activeConversationId) return;

    const row = allWorkbenchRows.find((item) => item.conversationId === activeConversationId && !item.archived);
    if (!row) return;

    restoredConversationIdRef.current = activeConversationId;
    if (!isConversationActive(row)) {
      selectConversation(row);
    }
  }, [loaded, loadingHistorySessions, state.sidebar?.activeConversationId, allWorkbenchRows, selectedProjectDetailsPath]);

  const renderWorkbenchRow = (row: (typeof workbenchRows)[number]) => (
    <ConversationButton
      key={row.id}
      conversation={row}
      active={isConversationActive(row)}
      connected={row.runtime ? getSessionConnected(row.runtime) : false}
      onSelect={() => selectConversation(row)}
      onStart={row.runtime ? () => relaunchSession(row.runtime!) : undefined}
      onStop={row.runtime ? () => stopSession(row.runtime!) : undefined}
      onToggleRead={() => setConversationReadState(row, !row.unread)}
      onMarkNeedsReview={() => markConversationNeedsReview(row)}
      onEnvironment={() => openConversationEnvironmentDialog(row)}
      onArchive={() => archiveConversation(row)}
      onRestore={() => restoreConversation(row)}
    />
  );
  const renderOverflowWorkbenchRow = (row: WorkbenchConversation) => {
    const runtime = row.runtime;
    const transcript = row.transcript;
    const provider = runtime?.provider ?? providerForTranscript(transcript);
    const displayTitle = transcript ? getHistorySessionTitle(transcript) : runtime ? getSessionDisplayTitle(runtime) : "Untitled conversation";
    const active = isConversationActive(row);
    const running = runtime && isAgentWorking(runtime);

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
  const getProjectGroupMenuSections = (projectPath: string, collapsed: boolean) => {
    const plainChat = isPlainChatWorkspace(projectPath);
    return [
      {
        title: plainChat ? GENERAL_CHAT_LABEL : "Project",
        items: [
          {
            label: plainChat ? "Open general chat" : "Open project",
            icon: plainChat ? <MessageSquare className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />,
            onSelect: () => selectProjectScope(projectPath),
          },
          ...(
            plainChat
              ? []
              : [
                  {
                    label: "View details",
                    icon: <Eye className="h-4 w-4" />,
                    onSelect: () => openProjectDetails(projectPath),
                  },
                ]
          ),
        ],
      },
      {
        title: "Conversation",
        items: [
          {
            label: "New conversation",
            icon: <Plus className="h-4 w-4" />,
            onSelect: () => openNewSessionForProject(projectPath),
          },
        ],
      },
      {
        title: "Manage",
        items: [
          ...(
            plainChat
              ? []
              : [
                  {
                    label: "Environment",
                    icon: <Settings2 className="h-4 w-4" />,
                    onSelect: () => openProjectEnvironmentDialog(projectPath),
                  },
                ]
          ),
          {
            label: collapsed ? "Expand group" : "Collapse group",
            icon: collapsed ? <FolderOpen className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />,
            onSelect: () => toggleProjectCollapsed(projectPath),
          },
        ],
      },
    ];
  };
  const renderProjectGroupMenuItems = (projectPath: string, collapsed: boolean) => (
    <>
      <ContextMenuLabel className="truncate text-xs text-muted-foreground">
        {getWorkbenchProjectName(projectPath)}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      {getProjectGroupMenuSections(projectPath, collapsed).map((section, index) => (
        <Fragment key={section.title}>
          {index > 0 && <ContextMenuSeparator />}
          <ContextMenuLabel className="text-xs text-muted-foreground">{section.title}</ContextMenuLabel>
          {section.items.map((item) => (
            <ContextMenuItem key={item.label} onSelect={item.onSelect} className="gap-2">
              {item.icon}
              {item.label}
            </ContextMenuItem>
          ))}
        </Fragment>
      ))}
    </>
  );
  const renderProjectGroupDropdownItems = (projectPath: string, collapsed: boolean) => (
    <>
      <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
        {getWorkbenchProjectName(projectPath)}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {getProjectGroupMenuSections(projectPath, collapsed).map((section, index) => (
        <Fragment key={section.title}>
          {index > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel className="text-xs text-muted-foreground">{section.title}</DropdownMenuLabel>
          {section.items.map((item) => (
            <DropdownMenuItem key={item.label} onSelect={item.onSelect} className="gap-2">
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ))}
        </Fragment>
      ))}
    </>
  );
  const continueHistorySession = (session: Session, provider: AgentProvider, prompt: string) => {
    void createSession(provider, prompt, {
      cwd: session.project_path,
      title: getHistorySessionTitle(session),
      resumeHistorySession: session,
    });
  };
  const forkHistorySession = (payload: SessionForkPayload) => {
    const title = `Fork: ${getHistorySessionTitle(payload.session)}`.slice(0, 80);
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
    void createSession(provider, prompt, {
      cwd: payload.session.project_path,
      title,
      fork: {
        parentSessionId: payload.session.id,
        fromMessageId: payload.messageId,
        fromTitle: getHistorySessionTitle(payload.session),
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      <section
        className="relative flex shrink-0 flex-col border-r border-border bg-card"
        style={{ width: sessionsSidebarWidth }}
      >
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0" title={workspacePath ?? undefined}>
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate font-serif text-lg font-semibold text-foreground">{sessionsHeaderTitle}</h1>
                {saving ? (
                  <span className="shrink-0 rounded-md bg-card-alt px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Saving
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{sessionsHeaderSummary}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={openNewSession}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border transition-colors ${
                  showNewSessionView
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-card-alt hover:text-foreground"
                }`}
                title="New conversation"
                aria-label="New conversation"
              >
                <Plus className="h-4 w-4" />
              </button>
              <WorkbenchOutlineMenu
                outlineMode={outlineMode}
                onOutlineModeChange={setPersistedOutlineMode}
                mergeWorktrees={mergeWorktrees}
                onMergeWorktreesChange={setPersistedMergeWorktrees}
                displayFilter={displayFilter}
                onDisplayFilterChange={setPersistedDisplayFilter}
                sortMode={sortMode}
                onSortModeChange={setPersistedSortMode}
              />
              <button
                type="button"
                onClick={() => openEnvironmentDialog("project")}
                disabled={!selectedProjectPath}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground disabled:opacity-40"
                title="Environment"
                aria-label="Environment"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPersistedSessionListMode(sessionListMode === "archived" ? "active" : "archived")}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors ${
                  sessionListMode === "archived"
                    ? "bg-primary/10 text-primary"
                    : "bg-background text-muted-foreground hover:bg-card-alt hover:text-foreground"
                }`}
                title={sessionListMode === "archived" ? "Show active conversations" : `Show archived conversations (${archivedConversationCount})`}
                aria-label={sessionListMode === "archived" ? "Show active conversations" : "Show archived conversations"}
              >
                {sessionListMode === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto ${
            loaded && workbenchRows.length > 0 && outlineMode === "project" ? "p-0" : "p-3"
          }`}
        >
          {!loaded ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : workbenchRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card-alt/40 px-4 py-8 text-center">
              <div className="text-sm text-muted-foreground">
                {loadingHistorySessions ? "Loading conversations..." : sessionListMode === "archived" ? "No archived conversations." : "No conversations yet."}
              </div>
              {sessionListMode !== "archived" && (
                <button
                  type="button"
                  onClick={openNewSession}
                  className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  New conversation
                </button>
              )}
            </div>
          ) : outlineMode === "recent" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1.5 text-xs font-medium text-muted-foreground">
                <span>All conversations</span>
                <span>{workbenchRows.length}</span>
              </div>
              <div className="space-y-px">
                {workbenchRows.map(renderWorkbenchRow)}
              </div>
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
                            aria-label={`${collapsed ? "Expand" : "Collapse"} ${getWorkbenchProjectName(project.path)}`}
                          >
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground">
                              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                              {getWorkbenchProjectName(project.path)}
                            </span>
                            {stats?.running ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : null}
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                                title="Project actions"
                                aria-label="Project actions"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              {renderProjectGroupDropdownItems(project.path, collapsed)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
                        {renderProjectGroupMenuItems(project.path, collapsed)}
                      </ContextMenuContent>
                    </ContextMenu>
                    {!collapsed && (
                      <div className="ml-5 space-y-px border-l border-border py-0.5 pl-1">
                        {project.rows.length > 0 ? (
                          visibleRows.map(renderWorkbenchRow)
                        ) : (
                          <button
                            type="button"
                            onClick={() => openNewSessionForProject(project.path)}
                            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={`New conversation in ${getWorkbenchProjectName(project.path)}`}
                            aria-label={`New conversation in ${getWorkbenchProjectName(project.path)}`}
                          >
                            <Plus className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">New conversation</span>
                          </button>
                        )}
                        {overflowRows.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
                                title={`${overflowRows.length} more conversations`}
                              >
                                <MoreHorizontal className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">More conversations</span>
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
          aria-label="Resize sessions sidebar"
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
          title="Drag to resize"
        />
      </section>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {showProjectDetailsView && selectedProjectDetails ? (
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
        ) : showNewSessionView ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto bg-background px-6 py-10">
            <div className="m-auto flex w-full max-w-3xl flex-col">
              <div className="mb-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!primaryEnvironmentAction || !primaryEnvironmentConfig) return;
                    runEnvironmentConfig(primaryEnvironmentScope, "action", primaryEnvironmentConfig, primaryEnvironmentAction);
                  }}
                  disabled={!primaryEnvironmentAction || !primaryEnvironmentConfig}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground disabled:opacity-40"
                >
                  <Terminal className="h-4 w-4" />
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => openEnvironmentDialog("project")}
                  disabled={!selectedProjectPath}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground disabled:opacity-40"
                >
                  <Settings2 className="h-4 w-4" />
                  Environment
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
        ) : selectedHistorySession ? (
          <SessionDetail
            session={selectedHistorySession}
            onClose={closeCurrentConversation}
            onFork={forkHistorySession}
            composerOverride={
              <AgentComposer
                cwd={selectedHistorySession.project_path}
                cwdLabel={getComposerCwdLabel(selectedHistorySession.project_path)}
                hasProjectPath={Boolean(selectedHistorySession.project_path && !isPlainChatWorkspace(selectedHistorySession.project_path))}
                pathOptions={composerPathOptions}
                variant="dock"
                placeholder="Message this conversation"
                submitLabel="Send"
                onPickFolder={pickFolder}
                onSelectCwd={selectComposerCwd}
                onCreate={(provider, prompt) => continueHistorySession(selectedHistorySession, provider, prompt)}
              />
            }
          />
        ) : activeSession ? (
          <>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ProviderIcon provider={activeSession.provider} />
                  <h2 className="truncate font-serif text-lg font-semibold text-foreground">
                    {getSessionDisplayTitle(activeSession)}
                  </h2>
                  <AgentStatusBadge session={activeSession} />
                  <TransportStatusBadge connected={activeConnected} />
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={activeSession.cwd}>
                  {activeSession.cwd}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {activeSession.archived ? (
                  <IconButton title="Restore conversation" onClick={() => restoreSession(activeSession)}>
                    <ArchiveRestore className="h-4 w-4" />
                  </IconButton>
                ) : (
                  <>
                    <IconButton
                      title={primaryEnvironmentAction ? `Run ${primaryEnvironmentAction.name || "environment action"}` : "Run environment action"}
                      disabled={!primaryEnvironmentAction || !primaryEnvironmentConfig}
                      onClick={() => {
                        if (!primaryEnvironmentAction || !primaryEnvironmentConfig) return;
                        runEnvironmentConfig(primaryEnvironmentScope, "action", primaryEnvironmentConfig, primaryEnvironmentAction);
                      }}
                    >
                      <Terminal className="h-4 w-4" />
                    </IconButton>
                    <IconButton title="Environment" onClick={() => openEnvironmentDialog("session")}>
                      <Settings2 className="h-4 w-4" />
                    </IconButton>
                    <IconButton title="Run again" onClick={() => relaunchSession(activeSession)}>
                      <RotateCcw className="h-4 w-4" />
                    </IconButton>
                    {activeConnected ? (
                      <IconButton title="Stop" onClick={() => stopSession(activeSession)}>
                        <Square className="h-4 w-4" />
                      </IconButton>
                    ) : (
                      <IconButton title="Start" onClick={() => relaunchSession(activeSession)}>
                        <Play className="h-4 w-4" />
                      </IconButton>
                    )}
	                    <IconButton title="Mark needs review" onClick={() => markNeedsReview(activeSession)}>
	                      <AlertCircle className="h-4 w-4" />
	                    </IconButton>
                    <IconButton title="Archive conversation" onClick={() => archiveSession(activeSession)}>
                      <Archive className="h-4 w-4" />
                    </IconButton>
                  </>
                )}
                <IconButton title="Close conversation" onClick={closeCurrentConversation}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
            </header>

            <div className="min-h-0 flex-1 bg-terminal">
              {shouldMountTerminal && activeSession.ptyId ? (
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
      <EnvironmentDialog
        open={environmentDialogOpen}
        onOpenChange={handleEnvironmentDialogOpenChange}
        projectPath={environmentProjectPath ?? null}
        sessionKey={environmentSessionKey}
        sessionTitle={environmentSessionTitle}
        projectConfig={environmentProjectConfig}
        sessionConfig={environmentSessionConfig}
        defaultScope={environmentDefaultScope}
        onSave={saveEnvironmentConfig}
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
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-border/70" aria-hidden="true">
      <img src={src} alt="" className="h-4 w-4 object-contain" draggable={false} />
    </span>
  );
}

function getConversationProvider(row: WorkbenchConversation) {
  return row.runtime?.provider ?? providerForTranscript(row.transcript);
}

function getConversationSourceLabel(row: WorkbenchConversation) {
  const provider = getConversationProvider(row);
  if (provider) return labelForProvider(provider);
  if (row.transcript?.source === "codex") return "Codex";
  if (row.transcript?.source === "app-code") return "Claude Code";
  if (row.transcript?.source === "app-web") return "Claude Web";
  if (row.transcript?.source === "app-cowork") return "Claude Cowork";
  if (row.transcript?.source === "cli") return "Claude CLI";
  return "History";
}

function getConversationCreatedAt(row: WorkbenchConversation) {
  return row.transcript?.created_at ? row.transcript.created_at * 1000 : row.runtime?.createdAt ?? row.timestamp;
}

function getConversationStatusLabel(row: WorkbenchConversation) {
  if (row.archived) return "archived";
  if (row.runtime) return getAgentStatusLabel(row.runtime);
  if (row.needsReview) return "needs review";
  if (row.unread) return "unread";
  return "history";
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
      const providerLabel = getConversationSourceLabel(row);
      providerCounts.set(providerLabel, (providerCounts.get(providerLabel) ?? 0) + 1);
      createdTimestamps.push(getConversationCreatedAt(row));
      if (row.archived) archived += 1;
      else active += 1;
      if (row.runtime) {
        runtime += 1;
        if (row.runtime.status === "running" || row.runtime.workState === "working") running += 1;
      }
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
  }, [conversations, project?.last_active]);

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
          <IconButton title="New conversation" onClick={onNewConversation}>
            <Plus className="h-4 w-4" />
          </IconButton>
          <IconButton title="Environment" onClick={onEnvironment}>
            <Settings2 className="h-4 w-4" />
          </IconButton>
          <IconButton title="Close details" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ProjectMetric
              label="Sessions"
              value={formatNumber(analysis.total)}
              detail={`${formatNumber(statSource.active)} active / ${formatNumber(statSource.archived)} archived`}
              icon={<MessageSquare className="h-4 w-4" />}
            />
            <ProjectMetric
              label="Runtime"
              value={formatNumber(analysis.runtime)}
              detail={`${formatNumber(statSource.running)} running`}
              icon={<Terminal className="h-4 w-4" />}
            />
            <ProjectMetric
              label="Review"
              value={formatNumber(statSource.needsReview)}
              detail={`${formatNumber(statSource.unread)} unread`}
              icon={<AlertCircle className="h-4 w-4" />}
            />
            <ProjectMetric
              label="History"
              value={formatNumber(analysis.history)}
              detail={`${formatNumber(analysis.rounds)} rounds / ${formatNumber(analysis.messages)} messages`}
              icon={<Archive className="h-4 w-4" />}
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="font-serif text-base font-semibold text-foreground">Project Information</h3>
              </div>
              <div className="grid gap-0 divide-y divide-border">
                <ProjectInfoRow label="Path" value={projectPath} mono />
                <ProjectInfoRow label="Last activity" value={formatDateTime(analysis.lastActivity)} detail={formatRelativeTime(analysis.lastActivity)} />
                <ProjectInfoRow label="First session" value={formatDateTime(analysis.firstActivity)} />
                <ProjectInfoRow label="Project index" value={project ? `${formatNumber(project.session_count)} sessions` : "Not indexed"} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="font-serif text-base font-semibold text-foreground">Session Analysis</h3>
              </div>
              <div className="space-y-4 px-4 py-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <ProjectAnalysisItem label="Last 7 days" value={formatNumber(analysis.recent)} />
                  <ProjectAnalysisItem label="Older than 30 days" value={formatNumber(analysis.stale)} />
                  <ProjectAnalysisItem label="Input tokens" value={formatNumber(analysis.inputTokens)} />
                  <ProjectAnalysisItem label="Output tokens" value={formatNumber(analysis.outputTokens)} />
                  <ProjectAnalysisItem label="Context tokens" value={formatNumber(analysis.contextTokens)} />
                  <ProjectAnalysisItem label="Cost" value={formatCost(analysis.cost)} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider Mix</div>
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
                      <span className="text-sm text-muted-foreground">No sessions</span>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="font-serif text-base font-semibold text-foreground">All Sessions</h3>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{formatNumber(analysis.total)}</span>
            </div>
            <div className="divide-y divide-border">
              {conversations.length > 0 ? (
                conversations.map((row) => {
                  const provider = getConversationProvider(row);
                  const status = getConversationStatusLabel(row);
                  const title = getConversationTitle(row);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onSelectConversation(row)}
                      disabled={row.archived}
                      className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card-alt disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
                      title={row.archived ? "Archived session" : title}
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
                          <span>{getConversationSourceLabel(row)}</span>
                          <span>/</span>
                          <span>{status}</span>
                          {row.transcript ? (
                            <>
                              <span>/</span>
                              <span>{formatNumber(row.transcript.rounds)} rounds</span>
                              <span>/</span>
                              <span>{formatNumber(row.transcript.message_count)} messages</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatRelativeTime(row.timestamp)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No sessions</div>
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
  displayFilter,
  onDisplayFilterChange,
  sortMode,
  onSortModeChange,
}: {
  outlineMode: WorkbenchOutlineMode;
  onOutlineModeChange: (mode: WorkbenchOutlineMode) => void;
  mergeWorktrees: boolean;
  onMergeWorktreesChange: (merge: boolean) => void;
  displayFilter: WorkbenchDisplayFilter;
  onDisplayFilterChange: (filter: WorkbenchDisplayFilter) => void;
  sortMode: WorkbenchSortMode;
  onSortModeChange: (mode: WorkbenchSortMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
          title="Organize conversations"
          aria-label="Organize conversations"
        >
          <ListFilter className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organize</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={outlineMode} onValueChange={(value) => onOutlineModeChange(value as WorkbenchOutlineMode)}>
          <MenuItemTooltip
            title="All conversations"
            description="Shows one flat list."
            rules={["Sort applies to individual conversations."]}
          >
            <DropdownMenuRadioItem value="recent">All conversations</DropdownMenuRadioItem>
          </MenuItemTooltip>
          <MenuItemTooltip
            title="By project"
            description="Groups conversations by project."
            rules={["Sort applies to project groups first.", "Conversations inside each project use the same sort mode."]}
          >
            <DropdownMenuRadioItem value="project">By project</DropdownMenuRadioItem>
          </MenuItemTooltip>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Sort</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sortMode} onValueChange={(value) => onSortModeChange(value as WorkbenchSortMode)}>
          <MenuItemTooltip
            title="Latest modified"
            description="Orders by most recent activity."
            rules={["All conversations: latest conversation modified time.", "By project: indexed project activity plus latest conversation activity."]}
          >
            <DropdownMenuRadioItem value="last-modified">Latest modified</DropdownMenuRadioItem>
          </MenuItemTooltip>
          <MenuItemTooltip
            title="Created"
            description="Orders by creation time."
            rules={["All conversations: conversation created time.", "By project: earliest conversation created in that project."]}
          >
            <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
          </MenuItemTooltip>
          <MenuItemTooltip
            title="Name"
            description="Orders alphabetically."
            rules={["All conversations: conversation title.", "By project: project name.", "Recent activity breaks ties."]}
          >
            <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
          </MenuItemTooltip>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Display</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={displayFilter} onValueChange={(value) => onDisplayFilterChange(value as WorkbenchDisplayFilter)}>
          <DropdownMenuRadioItem value="all">All conversations</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="running">Running</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="review">Needs review</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Advanced</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={mergeWorktrees} onCheckedChange={(checked) => onMergeWorktreesChange(checked === true)}>
          Merge worktrees
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getAgentStatusLabel(session: AgentSession) {
  if (session.archived) return "archived";
  if (session.provider === "terminal") return "shell";
  if (isAgentWorking(session)) return "agent running";
  if (session.status === "needs-review") return "needs review";
  if (session.status === "error") return "agent error";
  if (session.status === "completed") return "agent completed";
  return "agent idle";
}

function AgentStatusBadge({ session }: { session: AgentSession }) {
  const label = getAgentStatusLabel(session);
  let className = "bg-card-alt text-muted-foreground";
  if (label === "agent running") {
    className = "bg-primary/10 text-primary";
  } else if (label === "needs review") {
    className = "bg-card-alt text-foreground";
  } else if (label === "agent error") {
    className = "bg-destructive/10 text-destructive";
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
      {label === "agent running" && <LoaderCircle className="h-3 w-3 animate-spin" />}
      {label}
    </span>
  );
}

function TransportStatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className="shrink-0 rounded-md bg-card-alt px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {connected ? "runtime connected" : "runtime stopped"}
    </span>
  );
}

function ConversationButton({
  conversation,
  active,
  connected,
  onSelect,
  onStart,
  onStop,
  onToggleRead,
  onMarkNeedsReview,
  onEnvironment,
  onArchive,
  onRestore,
}: {
  conversation: WorkbenchConversation;
  active: boolean;
  connected: boolean;
  onSelect: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onToggleRead: () => void;
  onMarkNeedsReview: () => void;
  onEnvironment: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const runtime = conversation.runtime;
  const transcript = conversation.transcript;
  const provider = runtime?.provider ?? providerForTranscript(transcript);
  const displayTitle = transcript ? getHistorySessionTitle(transcript) : runtime ? getSessionDisplayTitle(runtime) : "Untitled conversation";
  const runtimeLabel = runtime ? (conversation.archived ? "archived" : getAgentStatusLabel(runtime)) : conversation.archived ? "archived" : "conversation";
  const transportLabel = runtime ? (connected ? "runtime connected" : "runtime stopped") : "no active runtime";
  const readLabel = conversation.unread ? "Unread" : "Read";
  const providerLabel = provider ? labelForProvider(provider) : transcript?.source ?? "conversation";
  const relativeTime = formatRelativeTime(conversation.timestamp);
  const statusTone = runtime && isAgentWorking(runtime)
    ? "bg-primary text-primary"
    : runtime?.status === "needs-review"
      ? "bg-primary text-primary"
      : runtime?.status === "error"
        ? "bg-destructive text-destructive"
        : "bg-muted-foreground text-muted-foreground";
  const statusIndicator = conversation.archived ? (
    <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Archived" />
  ) : runtime && isAgentWorking(runtime) ? (
    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label={runtimeLabel} />
  ) : conversation.needsReview ? (
    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Needs review" />
  ) : runtime ? (
    <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone}`} aria-label={runtimeLabel} />
  ) : null;
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
  }, [conversation.conversationId, conversation.archived]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`group relative flex h-[31px] w-full items-center rounded-lg transition-colors ${
            active
              ? "bg-primary/10"
              : "hover:bg-card-alt"
          }`}
          onMouseLeave={() => setConfirmingArchive(false)}
        >
          <button
            type="button"
            onClick={onSelect}
            aria-label={`${displayTitle}, ${providerLabel}, ${runtimeLabel}, ${transportLabel}, ${readLabel}, ${relativeTime}`}
            className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden pl-2.5 pr-1 text-left"
          >
            {renderLeadingIcon()}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{displayTitle}</span>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground">
              {conversation.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
              {statusIndicator}
              <span className="min-w-[3.5rem] text-right">{relativeTime}</span>
            </span>
            <span className="sr-only">
              {runtimeLabel}, {transportLabel}, {readLabel}
            </span>
          </button>
          <div
            className={`flex h-full w-9 shrink-0 items-center justify-center transition-opacity ${
              active || confirmingArchive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            {conversation.archived ? (
              <SidebarActionButton title="Restore conversation" onClick={onRestore}>
                <ArchiveRestore className="h-3.5 w-3.5" />
              </SidebarActionButton>
            ) : (
              <SidebarActionButton
                title={confirmingArchive ? "Confirm archive" : "Archive conversation"}
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
        <ContextMenuLabel className="truncate text-xs text-muted-foreground">{displayTitle}</ContextMenuLabel>
        <ContextMenuSeparator />
        {!conversation.archived && (
          <>
            <ContextMenuItem onSelect={onSelect} className="gap-2">
              {renderLeadingIcon()}
              Open conversation
            </ContextMenuItem>
            <ContextMenuItem onSelect={onEnvironment} className="gap-2">
              <Settings2 className="h-4 w-4" />
              Environment
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {conversation.archived ? (
          <>
            <ContextMenuItem onSelect={onEnvironment} className="gap-2">
              <Settings2 className="h-4 w-4" />
              Environment
            </ContextMenuItem>
            <ContextMenuItem onSelect={onRestore} className="gap-2">
              <ArchiveRestore className="h-4 w-4" />
              Restore conversation
            </ContextMenuItem>
          </>
        ) : (
          <>
            {runtime && onStart && onStop && (
              <ContextMenuItem onSelect={connected ? onStop : onStart} className="gap-2">
                {connected ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {connected ? "Stop runtime" : "Start runtime"}
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={onToggleRead} className="gap-2">
              {conversation.unread ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {conversation.unread ? "Mark as read" : "Mark as unread"}
            </ContextMenuItem>
            <ContextMenuItem onSelect={onMarkNeedsReview} className="gap-2">
              <AlertCircle className="h-4 w-4" />
              {conversation.needsReview ? "Needs review" : "Mark needs review"}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onArchive} className="gap-2">
              <Archive className="h-4 w-4" />
              Archive conversation
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SidebarActionButton({
  title,
  onClick,
  children,
  active = false,
  destructive = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground"
      } ${
        destructive && !active ? "hover:border-destructive/40 hover:text-destructive" : ""
      }`}
    >
      {children}
    </button>
  );
}

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

function DetachedState({
  session,
  onStart,
  onRestore,
}: {
  session: AgentSession;
  onStart: () => void;
  onRestore: () => void;
}) {
  if (session.archived) {
    return (
      <div className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-xl border border-border bg-card px-5 py-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-card-alt text-muted-foreground">
            <Archive className="h-5 w-5" />
          </div>
          <h3 className="font-serif text-xl font-semibold text-foreground">Conversation is archived</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The conversation is preserved in the workspace archive. Restore it before starting a runtime.
          </p>
          <button
            type="button"
            onClick={onRestore}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ArchiveRestore className="h-4 w-4" />
            Restore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-background px-6">
      <div className="max-w-md rounded-xl border border-border bg-card px-5 py-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-card-alt text-muted-foreground">
          <X className="h-5 w-5" />
        </div>
        <h3 className="font-serif text-xl font-semibold text-foreground">Conversation is not attached</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          The saved conversation remains in the workspace. Start it again when you want to attach a runtime.
        </p>
        {session.command && (
          <code className="mt-4 block truncate rounded-lg bg-card-alt px-3 py-2 text-left font-mono text-xs text-muted-foreground">
            {session.command}
          </code>
        )}
        <button
          type="button"
          onClick={onStart}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Play className="h-4 w-4" />
          Start runtime
        </button>
      </div>
    </div>
  );
}
