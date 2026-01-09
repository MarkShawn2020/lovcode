import { useState, useRef, useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  DotsVerticalIcon,
} from "@radix-ui/react-icons";
import {
  workspaceDataAtom,
  collapsedProjectGroupsAtom,
  verticalTabsSidebarWidthAtom,
  dashboardSessionsVisibleAtom,
} from "@/store";
import { useNavigate, useInvokeQuery } from "@/hooks";
import { invoke } from "@tauri-apps/api/core";
import type { Session, Message } from "@/types";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectLogo } from "@/views/Workspace/ProjectLogo";
import { SessionDropdownMenuItems } from "@/components/shared/SessionMenuItems";
import { NewTerminalSplitButton } from "@/components/ui/new-terminal-button";
import type { WorkspaceData, WorkspaceProject } from "@/views/Workspace/types";
import { useReadableText, restoreSlashCommand } from "@/views/Chat/utils";

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

export function VerticalFeatureTabs() {
  const [workspace] = useAtom(workspaceDataAtom);
  const [collapsedGroups, setCollapsedGroups] = useAtom(collapsedProjectGroupsAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(verticalTabsSidebarWidthAtom);
  const [, setSidebarVisible] = useAtom(dashboardSessionsVisibleAtom);
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

      {/* Hide Sidebar Button */}
      <div className="shrink-0 border-t border-border p-2">
        <button
          onClick={() => setSidebarVisible(false)}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-ink hover:bg-muted rounded-lg transition-colors"
          title="Hide sidebar"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
          <span>Hide</span>
        </button>
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
  const toReadable = useReadableText();

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
    let savedWorkspace: WorkspaceData | null = null;

    setWorkspace((currentWorkspace) => {
      if (!currentWorkspace) return currentWorkspace;

      const currentProject = currentWorkspace.projects.find((p) => p.id === project.id);
      if (!currentProject) return currentWorkspace;

      const title = toReadable(session.summary) || "Untitled";
      const command = `claude --resume "${session.id}"`;
      const panels = currentProject.panels || [];
      const panelId = panels[0]?.id;

      if (!panelId) {
        // No panel exists, create one
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

        savedWorkspace = {
          ...currentWorkspace,
          projects: currentWorkspace.projects.map((p) =>
            p.id === project.id
              ? { ...p, panels: [newPanel], layout: { type: "panel" as const, panelId: newPanelId }, view_mode: "terminal" as const }
              : p
          ),
          active_project_id: project.id,
        };
        return savedWorkspace;
      } else {
        // Add a new session tab to the first panel
        const ptySessionId = crypto.randomUUID();
        const ptyId = crypto.randomUUID();

        savedWorkspace = {
          ...currentWorkspace,
          projects: currentWorkspace.projects.map((p) =>
            p.id === project.id
              ? {
                  ...p,
                  panels: p.panels.map((panel) =>
                    panel.id === panelId
                      ? { ...panel, sessions: [...panel.sessions, { id: ptySessionId, pty_id: ptyId, title, command }], active_session_id: ptySessionId }
                      : panel
                  ),
                  view_mode: "terminal" as const,
                }
              : p
          ),
          active_project_id: project.id,
        };
        return savedWorkspace;
      }
    });

    if (savedWorkspace) {
      await invoke("workspace_save", { data: savedWorkspace });
      navigate({ type: "workspace", projectId: project.id, mode: "terminal" });
    }
  };

  const handleNewTerminal = async (command?: string) => {
    let savedWorkspace: WorkspaceData | null = null;

    setWorkspace((currentWorkspace) => {
      if (!currentWorkspace) return currentWorkspace;

      const currentProject = currentWorkspace.projects.find((p) => p.id === project.id);
      if (!currentProject) return currentWorkspace;

      const panels = currentProject.panels || [];
      const panelId = panels[0]?.id;
      const title = command === "claude" ? "Claude Code" : command === "codex" ? "Codex" : "Terminal";

      if (!panelId) {
        // No panel exists, create one
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

        savedWorkspace = {
          ...currentWorkspace,
          projects: currentWorkspace.projects.map((p) =>
            p.id === project.id
              ? { ...p, panels: [newPanel], layout: { type: "panel" as const, panelId: newPanelId }, view_mode: "terminal" as const }
              : p
          ),
          active_project_id: project.id,
        };
        return savedWorkspace;
      } else {
        // Add a new session tab to the first panel
        const ptySessionId = crypto.randomUUID();
        const ptyId = crypto.randomUUID();

        savedWorkspace = {
          ...currentWorkspace,
          projects: currentWorkspace.projects.map((p) =>
            p.id === project.id
              ? {
                  ...p,
                  panels: p.panels.map((panel) =>
                    panel.id === panelId
                      ? { ...panel, sessions: [...panel.sessions, { id: ptySessionId, pty_id: ptyId, title, command }], active_session_id: ptySessionId }
                      : panel
                  ),
                  view_mode: "terminal" as const,
                }
              : p
          ),
          active_project_id: project.id,
        };
        return savedWorkspace;
      }
    });

    if (savedWorkspace) {
      await invoke("workspace_save", { data: savedWorkspace });
      navigate({ type: "workspace", projectId: project.id, mode: "terminal" });
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
  const [userPrompts, setUserPrompts] = useState<string[] | null>(null);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const toReadable = useReadableText();

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

  // Lazy-load user prompts when tooltip opens
  const handleTooltipOpen = async (open: boolean) => {
    setIsTooltipOpen(open);
    if (open && userPrompts === null) {
      try {
        const messages = await invoke<Message[]>("get_session_messages", {
          projectId: session.project_id,
          sessionId: session.id,
        });
        const prompts = messages
          .filter((m) => m.role === "user")
          .map((m) => {
            // Convert first, then truncate (order matters for regex matching)
            const text = restoreSlashCommand(m.content.trim());
            return text.length > 100 ? text.slice(0, 100) + "..." : text;
          });
        setUserPrompts(prompts);
      } catch {
        setUserPrompts([]);
      }
    }
  };

  return (
    <div className="flex items-center gap-0.5 group">
      <Tooltip open={isTooltipOpen} onOpenChange={handleTooltipOpen}>
        <TooltipTrigger asChild>
          <button
            onClick={onResume}
            className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors text-muted-foreground hover:text-ink hover:bg-card-alt min-w-0"
          >
            <span className="text-xs truncate flex-1">
              {toReadable(session.summary) || "Untitled"}
            </span>
            <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              {formatDate(session.last_modified)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[300px] p-2 bg-card text-ink border border-border">
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              User Prompts ({userPrompts?.length ?? "..."})
            </div>
            {userPrompts === null ? (
              <div className="text-xs text-muted-foreground">Loading...</div>
            ) : userPrompts.length === 0 ? (
              <div className="text-xs text-muted-foreground">No prompts</div>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {userPrompts.map((prompt, i) => (
                  <div
                    key={i}
                    className="text-xs text-ink/80 bg-muted/50 rounded px-1.5 py-1 truncate"
                  >
                    {prompt}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
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
