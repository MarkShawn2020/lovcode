/** Feature status */
export type FeatureStatus = "pending" | "running" | "completed" | "needs-review";

/** Panel state */
export interface PanelState {
  id: string;
  pty_id: string;
  title: string;
  is_shared: boolean;
  cwd: string;
  command?: string;
}

/** Feature within a project */
export interface Feature {
  id: string;
  name: string;
  status: FeatureStatus;
  git_branch?: string;
  chat_session_id?: string;
  panels: PanelState[];
  created_at: number;
}

/** Project in the workspace */
export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
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
