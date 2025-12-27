import { PlusIcon, ArchiveIcon, DashboardIcon, DoubleArrowLeftIcon, DoubleArrowRightIcon, CheckCircledIcon, UpdateIcon, ExclamationTriangleIcon, TimerIcon } from "@radix-ui/react-icons";
import { ProjectLogo } from "./ProjectLogo";
import { useResize } from "../../hooks/useResize";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "../../components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { WorkspaceProject, FeatureStatus } from "./types";

interface ProjectSidebarProps {
  projects: WorkspaceProject[];
  activeProjectId?: string;
  onAddProject: () => void;
  onAddFeature: (projectId: string) => Promise<{ featureId: string; featureName: string } | undefined>;
  onArchiveProject: (id: string) => void;
  onUnarchiveProject: (id: string) => void;
  onUnarchiveFeature: (projectId: string, featureId: string) => void;
  onOpenDashboard: (id: string) => void;
  onOpenFeaturePanel: (id: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  onAddProject,
  onAddFeature,
  onArchiveProject,
  onUnarchiveProject,
  onUnarchiveFeature,
  onOpenDashboard,
  onOpenFeaturePanel,
  collapsed,
  onCollapsedChange,
}: ProjectSidebarProps) {
  const { value: width, handleMouseDown } = useResize({
    direction: "horizontal",
    storageKey: "project-sidebar-width",
    defaultValue: 192,
    min: 140,
    max: 320,
  });

  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  // Collapsed state
  if (collapsed) {
    return (
      <div className="h-full flex flex-col bg-card border-r border-border w-10">
        <div className="flex-1 flex flex-col items-center pt-2 gap-1 overflow-y-auto">
          <button
            onClick={() => onCollapsedChange?.(false)}
            className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors rounded"
            title="Expand sidebar"
          >
            <DoubleArrowRightIcon className="w-3.5 h-3.5" />
          </button>
          <div className="w-6 border-t border-border my-1" />
          {activeProjects.map((project) => (
            <button
              key={project.id}
              onClick={() => onOpenDashboard(project.id)}
              className={`p-1 rounded transition-colors ${
                project.id === activeProjectId
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-ink hover:bg-card-alt"
              }`}
              title={project.name}
            >
              <ProjectLogo projectPath={project.path} size="sm" />
            </button>
          ))}
        </div>
        <div className="p-2 border-t border-border flex flex-col items-center gap-1">
          <button
            onClick={onAddProject}
            className="p-1.5 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
            title="Add project"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
          {archivedProjects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger className="p-1.5 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors">
                <ArchiveIcon className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                {archivedProjects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => onUnarchiveProject(project.id)}
                    className="cursor-pointer"
                  >
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-r border-border bg-card relative" style={{ width }}>
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize z-10 group"
      >
        <div className="absolute right-1.5 top-0 bottom-0 w-0.5 group-hover:bg-primary/50 transition-colors" />
      </div>
      {/* Header with collapse button */}
      <div className="flex items-center px-3 py-1.5 border-b border-border">
        <span className="flex-1 text-sm font-medium text-ink">Projects</span>
        <button
          onClick={() => onCollapsedChange?.(true)}
          className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors rounded"
          title="Collapse sidebar"
        >
          <DoubleArrowLeftIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {activeProjects.map((project) => {
            const isActive = project.id === activeProjectId;
            const archivedFeatures = project.features.filter((f) => f.archived);

            return (
              <div key={project.id} className="mb-0.5">
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      className={`group mx-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        isActive ? "bg-primary/10" : "hover:bg-card-alt"
                      }`}
                      onClick={() => onOpenDashboard(project.id)}
                    >
                      <div className="flex items-center gap-1.5">
                        <ProjectLogo projectPath={project.path} />
                        <span
                          className={`flex-1 text-sm truncate ${
                            isActive ? "text-primary font-medium" : "text-ink"
                          }`}
                        >
                          {project.name.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                        </span>
                        <span
                          className="p-0.5 rounded hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onAddFeature(project.id);
                          }}
                          title="New Feature"
                        >
                          <PlusIcon className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-[180px]">
                    {/* Feature Management */}
                    <ContextMenuLabel>Feature</ContextMenuLabel>
                    <ContextMenuItem
                      onClick={async () => {
                        await onAddFeature(project.id);
                      }}
                      className="gap-2 cursor-pointer"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      <span>New Feature</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => onOpenFeaturePanel(project.id)}
                      className="gap-2 cursor-pointer"
                    >
                      <DashboardIcon className="w-3.5 h-3.5" />
                      <span>Open Features</span>
                    </ContextMenuItem>
                    {archivedFeatures.length > 0 && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger className="gap-2">
                          <ArchiveIcon className="w-3.5 h-3.5" />
                          <span>Archived ({archivedFeatures.length})</span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="min-w-[160px]">
                          {archivedFeatures.map((feature) => (
                            <ContextMenuItem
                              key={feature.id}
                              onClick={() => onUnarchiveFeature(project.id, feature.id)}
                              className="gap-2 cursor-pointer"
                            >
                              <StatusIcon status={feature.status} />
                              <span className="truncate">{feature.name}</span>
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    <ContextMenuSeparator />
                    {/* Project Management */}
                    <ContextMenuLabel>Project</ContextMenuLabel>
                    <ContextMenuItem
                      onClick={() => onOpenDashboard(project.id)}
                      className="gap-2 cursor-pointer"
                    >
                      <DashboardIcon className="w-3.5 h-3.5" />
                      <span>Dashboard</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => onArchiveProject(project.id)}
                      className="gap-2 cursor-pointer"
                    >
                      <ArchiveIcon className="w-3.5 h-3.5" />
                      <span>Archive Project</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            );
          })}
      </div>

      <div className="p-2 border-t border-border flex gap-1">
        <button
          onClick={onAddProject}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Add
        </button>
        {archivedProjects.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center justify-center gap-1 px-3 py-2 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors">
              <ArchiveIcon className="w-4 h-4" />
              <span className="text-xs">{archivedProjects.length}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              {archivedProjects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => onUnarchiveProject(project.id)}
                  className="cursor-pointer"
                >
                  <span className="truncate">{project.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: FeatureStatus }) {
  switch (status) {
    case "pending":
      return <TimerIcon className="w-3.5 h-3.5 text-muted-foreground" />;
    case "running":
      return <UpdateIcon className="w-3.5 h-3.5 text-blue-500" />;
    case "completed":
      return <CheckCircledIcon className="w-3.5 h-3.5 text-green-500" />;
    case "needs-review":
      return <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" />;
  }
}
