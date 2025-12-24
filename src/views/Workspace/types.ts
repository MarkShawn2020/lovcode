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

/** Feature within a project */
export interface Feature {
  id: string;
  name: string;
  status: FeatureStatus;
  pinned?: boolean;
  archived?: boolean;
  archived_note?: string;
  git_branch?: string;
  chat_session_id?: string;
  panels: PanelState[];
  layout_direction?: "horizontal" | "vertical";
  created_at: number;
}

/** Project in the workspace */
export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  archived?: boolean;
  features: Feature[];
  shared_panels: PanelState[];
  active_feature_id?: string;
  created_at: number;
}

/** Complete workspace data */
export interface WorkspaceData {
  projects: WorkspaceProject[];
  active_project_id?: string;
}
