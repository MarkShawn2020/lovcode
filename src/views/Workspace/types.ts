/** Feature status */
export type FeatureStatus = "pending" | "running" | "completed" | "needs-review";

/** Session within a panel (a terminal tab) */
export interface SessionState {
  id: string;
  pty_id: string;
  title: string;
  command?: string;
  /** Text to send to terminal after it's ready (for interactive input) */
  initial_input?: string;
}

/** Panel state (container for multiple session tabs) */
export interface PanelState {
  id: string;
  sessions: SessionState[];
  active_session_id: string;
  is_shared: boolean;
  cwd: string;
}

/** Layout tree node - either a panel leaf or a split container */
export type LayoutNode =
  | { type: "panel"; panelId: string }
  | { type: "split"; direction: "horizontal" | "vertical"; first: LayoutNode; second: LayoutNode };

/** Feature within a project */
export interface Feature {
  id: string;
  /** Immutable sequence number (like database auto-increment ID) */
  seq: number;
  name: string;
  /** Optional description (markdown) - e.g., background, goals */
  description?: string;
  status: FeatureStatus;
  pinned?: boolean;
  archived?: boolean;
  archived_note?: string;
  git_branch?: string;
  chat_session_id?: string;
  panels: PanelState[];
  /** @deprecated Use layout instead */
  layout_direction?: "horizontal" | "vertical";
  /** Tree-based layout for tmux-style splits */
  layout?: LayoutNode;
  created_at: number;
}

/** Project view mode */
export type ProjectViewMode = "terminal" | "dashboard";

/** Project in the workspace */
export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  archived?: boolean;
  /** Terminal panels directly on project */
  panels: PanelState[];
  /** Tree-based layout for tmux-style splits */
  layout?: LayoutNode;
  /** @deprecated Use panels instead - kept for backward compatibility */
  features: Feature[];
  /** @deprecated Merged into panels */
  shared_panels: PanelState[];
  /** @deprecated */
  active_feature_id?: string;
  /** @deprecated */
  feature_counter?: number;
  view_mode?: ProjectViewMode;
  created_at: number;
}

/** Complete workspace data */
export interface WorkspaceData {
  projects: WorkspaceProject[];
  active_project_id?: string;
  /** Global feature counter across all projects */
  feature_counter?: number;
}

// ============================================================================
// Git Types
// ============================================================================

/** Git commit info */
export interface CommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  timestamp: number;
  author: string;
  feat_name?: string;
}

/** Git note for commit association */
export interface CommitNote {
  feat_id: string;
  feat_name?: string;
  override_assoc?: boolean;
}

// ============================================================================
// Diagnostics Types
// ============================================================================

/** Detected tech stack */
export interface TechStack {
  runtime: string; // node, python, rust, unknown
  package_manager?: string;
  orm?: string;
  frameworks: string[];
}

/** Leaked secret info */
export interface LeakedSecret {
  file: string;
  line: number;
  key_name: string;
  preview: string;
}

/** Environment check result */
export interface EnvCheckResult {
  missing_keys: string[];
  leaked_secrets: LeakedSecret[];
  env_example_exists: boolean;
  env_exists: boolean;
}

/** File line count */
export interface FileLineCount {
  file: string;
  lines: number;
}
