export type AgentProvider = "terminal" | "claude" | "codex";

export type AgentRuntime =
  | "terminal-pty"
  | "claude-cli-pty"
  | "codex-cli-pty"
  | "claude-cli-json"
  | "claude-sdk"
  | "codex-app-server";

export type AgentSessionStatus = "idle" | "running" | "completed" | "needs-review" | "error";

export type AgentWorkState = "idle" | "working" | "stopped";

export type AgentHistoryLinkStatus = "pending" | "linked" | "not-found";

export interface AgentRuntimeStatus {
  provider: AgentProvider;
  command?: string | null;
  installed: boolean;
  runnable?: boolean;
  path?: string | null;
  path_source?: string | null;
  version?: string | null;
  install_route?: string | null;
}

export type EnvironmentPlatform = "default" | "macos" | "linux" | "windows";

export type EnvironmentScope = "global" | "project" | "session";

export interface EnvironmentAction {
  id: string;
  name: string;
  scripts: Partial<Record<EnvironmentPlatform, string>>;
  platformSpecific?: boolean;
}

export interface EnvironmentConfig {
  name: string;
  setupScripts: Partial<Record<EnvironmentPlatform, string>>;
  cleanupScripts: Partial<Record<EnvironmentPlatform, string>>;
  actions: EnvironmentAction[];
  updatedAt?: number | null;
}

export interface AgentSession {
  id: string;
  provider: AgentProvider;
  runtime: AgentRuntime;
  cwd: string;
  command?: string | null;
  initialInput?: string | null;
  submittedPrompt?: string | null;
  status: AgentSessionStatus;
  workState?: AgentWorkState | null;
  ptyId?: string | null;
  title: string;
  linkedHistorySessionId?: string | null;
  historyLinkStatus?: AgentHistoryLinkStatus | null;
  historyLinkLastTriedAt?: number | null;
  historyLinkLastReason?: string | null;
  forkParentSessionId?: string | null;
  forkFromMessageId?: string | null;
  forkedFromTitle?: string | null;
  archived?: boolean;
  archivedAt?: number | null;
  unread?: boolean;
  lastActivityAt?: number | null;
  lastViewedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentWorkspaceState {
  version: number;
  sessions: AgentSession[];
  conversationMeta?: Record<string, WorkbenchConversationMeta>;
  globalEnvironment?: EnvironmentConfig | null;
  projectEnvironments?: Record<string, EnvironmentConfig>;
  sessionEnvironments?: Record<string, EnvironmentConfig>;
  sidebar?: AgentWorkspaceSidebarState;
  activeSessionId?: string | null;
}

export interface AgentWorkspaceSidebarState {
  sessionListMode?: "active" | "archived";
  outlineMode?: "project" | "recent";
  displayFilter?: "all" | "running" | "review";
  sortMode?: "last-modified" | "created" | "name";
  reorderGroups?: boolean;
  mergeWorktrees?: boolean;
  showProjectNewConversation?: boolean;
  collapsedProjectPaths?: string[];
  expandedProjectPaths?: string[];
  sessionsSidebarWidth?: number | null;
  activeConversationId?: string | null;
}

export interface WorkbenchConversationMeta {
  id: string;
  archived?: boolean;
  archivedAt?: number | null;
  pinned?: boolean;
  unread?: boolean;
  needsReview?: boolean;
  displayMode?: "chat" | "pty";
}

export interface NewAgentSessionInput {
  provider: AgentProvider;
  cwd: string;
  prompt: string;
  linkedHistorySessionId?: string | null;
}
