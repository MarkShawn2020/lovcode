/** Feature status */
export type FeatureStatus = "pending" | "running" | "completed" | "needs-review";

/** Session within a panel (a terminal tab) */
export interface SessionState {
  id: string;
  pty_id: string;
  title: string;
  command?: string;
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
export type ProjectViewMode = "features" | "home" | "dashboard";

/** Project in the workspace */
export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  archived?: boolean;
  features: Feature[];
  shared_panels: PanelState[];
  active_feature_id?: string;
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
