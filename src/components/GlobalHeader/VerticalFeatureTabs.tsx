import { useState, useRef, useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChatBubbleIcon,
  DotsVerticalIcon,
} from "@radix-ui/react-icons";
import {
  workspaceDataAtom,
  collapsedProjectGroupsAtom,
  verticalTabsSidebarWidthAtom,
} from "@/store";
import { useNavigate, useInvokeQuery } from "@/hooks";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectLogo } from "@/views/Workspace/ProjectLogo";
import { SessionDropdownMenuItems } from "@/components/shared/SessionMenuItems";
import { NewTerminalSplitButton } from "@/components/ui/new-terminal-button";
import type { WorkspaceData, WorkspaceProject } from "@/views/Workspace/types";

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

export function VerticalFeatureTabs() {
  const [workspace] = useAtom(workspaceDataAtom);
  const [collapsedGroups, setCollapsedGroups] = useAtom(collapsedProjectGroupsAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(verticalTabsSidebarWidthAtom);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [sidebarWidth, setSidebarWidth]);

  if (!workspace) return null;

  const activeProjects = workspace.projects.filter((p) => !p.archived);

  return (
    <aside
      className="flex flex-col border-r border-border bg-card shrink-0 relative"
      style={{ width: sidebarWidth }}
    >
      {/* Projects List */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="space-y-1">
          {activeProjects.map((project) => (
            <ProjectSessionsGroup
              key={project.id}
              project={project}
              isActiveProject={project.id === workspace.active_project_id}
              isCollapsed={collapsedGroups.includes(project.id)}
              onToggleCollapse={() => {
                if (collapsedGroups.includes(project.id)) {
                  setCollapsedGroups(collapsedGroups.filter((id) => id !== project.id));
                } else {
                  setCollapsedGroups([...collapsedGroups, project.id]);
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* Resize Handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors ${
          isResizing ? "bg-primary/50" : ""
        }`}
      />
    </aside>
  );
}

// ============================================================================
// Sessions Mode Components
// ============================================================================

interface ProjectSessionsGroupProps {
  project: WorkspaceProject;
  isActiveProject: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

function ProjectSessionsGroup({
  project,
  isActiveProject,
  isCollapsed,
  onToggleCollapse,
}: ProjectSessionsGroupProps) {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const navigate = useNavigate();

  // Fetch all CC sessions, then filter by project path
  const { data: allSessions = [], isLoading } = useInvokeQuery<Session[]>(
    ["sessions"],
    "list_all_sessions"
  );

  // Filter to sessions matching this project's path
  const filteredSessions = useMemo(() => {
    // Normalize paths for comparison (remove trailing slashes)
    const normalizePath = (p: string) => p.replace(/\/+$/, "");
    const projectPathNorm = normalizePath(project.path);

    return allSessions
      .filter((s) => {
        if (!s.project_path) return false;
        return normalizePath(s.project_path) === projectPathNorm && s.message_count > 0;
      })
      .sort((a, b) => b.last_modified - a.last_modified)
      .slice(0, 20); // Limit to recent 20
  }, [allSessions, project.path]);

  const handleSelectProject = async () => {
    if (!workspace) return;

    // Always navigate to dashboard when clicking project name
    navigate({ type: "workspace", projectId: project.id, mode: "dashboard" });

    const newWorkspace: WorkspaceData = {
      ...workspace,
      active_project_id: project.id,
      projects: workspace.projects.map((p) =>
        p.id === project.id ? { ...p, view_mode: "dashboard" as const } : p
      ),
    };
    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const handleResumeSession = async (session: Session) => {
    // Use functional update to avoid race conditions with stale closure values
    let savedWorkspace: WorkspaceData | null = null;

    setWorkspace((currentWorkspace) => {
      if (!currentWorkspace) return currentWorkspace;

      // Find current project from latest state
      const currentProject = currentWorkspace.projects.find((p) => p.id === project.id);
      if (!currentProject) return currentWorkspace;

      // Find or create a feature to add the session terminal
      const targetFeature = currentProject.features.find((f) => !f.archived);

      // If no active feature, just set active project
      if (!targetFeature) {
        savedWorkspace = {
          ...currentWorkspace,
          active_project_id: project.id,
        };
        return savedWorkspace;
      }

      // Create a new terminal session with claude --resume command
      const panelId = targetFeature.panels[0]?.id;
      const title = session.summary || "Untitled";
      const command = `claude --resume "${session.id}"`;

      if (!panelId) {
        // No panel exists, create one with the resume command
        const newPanelId = crypto.randomUUID();
        const ptySessionId = crypto.randomUUID();
        const ptyId = crypto.randomUUID();

        const newPanel = {
          id: newPanelId,
          sessions: [{ id: ptySessionId, pty_id: ptyId, title, command }],
          active_session_id: ptySessionId,
          is_shared: false,
          cwd: project.path,
        };

        const newProjects = currentWorkspace.projects.map((p) => {
          if (p.id !== project.id) return p;
          return {
            ...p,
            features: p.features.map((f) => {
              if (f.id !== targetFeature.id) return f;
              return {
                ...f,
                panels: [...f.panels, newPanel],
                layout: { type: "panel" as const, panelId: newPanelId },
              };
            }),
            active_feature_id: targetFeature.id,
            view_mode: "features" as const,
          };
        });

        savedWorkspace = {
          ...currentWorkspace,
          projects: newProjects,
          active_project_id: project.id,
        };
        return savedWorkspace;
      } else {
        // Add a new session tab to the first panel
        const ptySessionId = crypto.randomUUID();
        const ptyId = crypto.randomUUID();

        const newProjects = currentWorkspace.projects.map((p) => {
          if (p.id !== project.id) return p;
          return {
            ...p,
            features: p.features.map((f) => {
              if (f.id !== targetFeature.id) return f;
              return {
                ...f,
                panels: f.panels.map((panel) => {
                  if (panel.id !== panelId) return panel;
                  return {
                    ...panel,
                    sessions: [
                      ...(panel.sessions || []),
                      { id: ptySessionId, pty_id: ptyId, title, command },
                    ],
                    active_session_id: ptySessionId,
                  };
                }),
              };
            }),
            active_feature_id: targetFeature.id,
            view_mode: "features" as const,
          };
        });

        savedWorkspace = {
          ...currentWorkspace,
          projects: newProjects,
          active_project_id: project.id,
        };
        return savedWorkspace;
      }
    });

    // Save after state update - use the captured workspace from functional update
    if (savedWorkspace) {
      await invoke("workspace_save", { data: savedWorkspace });
      navigate({ type: "workspace", projectId: project.id, mode: "features" });
    }
  };

  const handleNewTerminal = async (command?: string) => {
    let savedWorkspace: WorkspaceData | null = null;

    setWorkspace((currentWorkspace) => {
      if (!currentWorkspace) return currentWorkspace;

      const currentProject = currentWorkspace.projects.find((p) => p.id === project.id);
      if (!currentProject) return currentWorkspace;

      const targetFeature = currentProject.features.find((f) => !f.archived);

      if (!targetFeature) {
        savedWorkspace = {
          ...currentWorkspace,
          active_project_id: project.id,
        };
        return savedWorkspace;
      }

      const panelId = targetFeature.panels[0]?.id;
      const title = command === "claude" ? "Claude Code" : command === "codex" ? "Codex" : "Terminal";

      if (!panelId) {
        const newPanelId = crypto.randomUUID();
        const ptySessionId = crypto.randomUUID();
        const ptyId = crypto.randomUUID();

        const newPanel = {
          id: newPanelId,
          sessions: [{ id: ptySessionId, pty_id: ptyId, title, command }],
          active_session_id: ptySessionId,
          is_shared: false,
          cwd: project.path,
        };

        const newProjects = currentWorkspace.projects.map((p) => {
          if (p.id !== project.id) return p;
          return {
            ...p,
            features: p.features.map((f) => {
              if (f.id !== targetFeature.id) return f;
              return {
                ...f,
                panels: [...f.panels, newPanel],
                layout: { type: "panel" as const, panelId: newPanelId },
              };
            }),
            active_feature_id: targetFeature.id,
            view_mode: "features" as const,
          };
        });

        savedWorkspace = {
          ...currentWorkspace,
          projects: newProjects,
          active_project_id: project.id,
        };
        return savedWorkspace;
      } else {
        const ptySessionId = crypto.randomUUID();
        const ptyId = crypto.randomUUID();

        const newProjects = currentWorkspace.projects.map((p) => {
          if (p.id !== project.id) return p;
          return {
            ...p,
            features: p.features.map((f) => {
              if (f.id !== targetFeature.id) return f;
              return {
                ...f,
                panels: f.panels.map((panel) => {
                  if (panel.id !== panelId) return panel;
                  return {
                    ...panel,
                    sessions: [
                      ...(panel.sessions || []),
                      { id: ptySessionId, pty_id: ptyId, title, command },
                    ],
                    active_session_id: ptySessionId,
                  };
                }),
              };
            }),
            active_feature_id: targetFeature.id,
            view_mode: "features" as const,
          };
        });

        savedWorkspace = {
          ...currentWorkspace,
          projects: newProjects,
          active_project_id: project.id,
        };
        return savedWorkspace;
      }
    });

    if (savedWorkspace) {
      await invoke("workspace_save", { data: savedWorkspace });
      navigate({ type: "workspace", projectId: project.id, mode: "features" });
    }
  };

  const projectDisplayName = project.name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="px-2">
      {/* Project Header */}
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isActiveProject
            ? "bg-primary/10 text-primary"
            : "text-ink hover:bg-card-alt"
        }`}
        onClick={handleSelectProject}
      >
        {/* Collapse Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="p-0.5 text-muted-foreground hover:text-ink"
        >
          {isCollapsed ? (
            <ChevronRightIcon className="w-3.5 h-3.5" />
          ) : (
            <ChevronDownIcon className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Project Logo */}
        <ProjectLogo projectPath={project.path} size="sm" />

        {/* Project Name */}
        <span className="text-sm font-medium truncate flex-1" title={projectDisplayName}>
          {projectDisplayName}
        </span>

        {/* Session Count */}
        <span className="text-xs text-muted-foreground">
          {isLoading ? "..." : filteredSessions.length}
        </span>

        {/* New Terminal Button */}
        <NewTerminalSplitButton
          variant="icon"
          onSelect={handleNewTerminal}
          className="opacity-0 group-hover:opacity-100"
        />
      </div>

      {/* Sessions List */}
      {!isCollapsed && (
        <div className="ml-4 mt-1 space-y-0.5">
          {isLoading ? (
            <div className="text-xs text-muted-foreground px-2 py-1">Loading...</div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-1">No sessions</div>
          ) : (
            filteredSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onResume={() => handleResumeSession(session)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface SessionItemProps {
  session: Session;
  onResume: () => void;
}

function SessionItem({ session, onResume }: SessionItemProps) {
  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  return (
    <div className="flex items-center gap-0.5 group">
      <button
        onClick={onResume}
        className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors text-muted-foreground hover:text-ink hover:bg-card-alt min-w-0"
        title={`Resume: ${session.summary || "Untitled"}`}
      >
        <ChatBubbleIcon className="w-2.5 h-2.5 flex-shrink-0" />
        <span className="text-xs truncate flex-1">
          {session.summary || "Untitled"}
        </span>
        <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {formatDate(session.last_modified)}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-0.5 rounded text-muted-foreground hover:text-ink hover:bg-card-alt opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <DotsVerticalIcon className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground font-mono border-b border-border mb-1">
            #{session.id.slice(0, 8)}
          </div>
          <SessionDropdownMenuItems
            projectId={session.project_id}
            sessionId={session.id}
            onResume={onResume}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
