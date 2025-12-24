import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PlusIcon, CheckCircledIcon, UpdateIcon, ExclamationTriangleIcon, TimerIcon, ArchiveIcon, HomeIcon, DashboardIcon, CubeIcon } from "@radix-ui/react-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from "../../components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { WorkspaceProject, FeatureStatus, Feature } from "./types";

function ProjectLogo({ projectPath }: { projectPath: string }) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);

  useEffect(() => {
    invoke<string | null>("get_project_logo", { projectPath })
      .then(setLogoSrc)
      .catch(() => setLogoSrc(null));
  }, [projectPath]);

  if (!logoSrc) {
    return <CubeIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
  }

  return (
    <img
      src={logoSrc}
      alt="Project logo"
      className="w-5 h-5 rounded object-contain flex-shrink-0"
    />
  );
}

type ViewMode = "projects" | "features";

interface ProjectSidebarProps {
  projects: WorkspaceProject[];
  activeProjectId?: string;
  activeFeatureId?: string;
  onSelectProject: (id: string) => void;
  onSelectFeature: (projectId: string, featureId: string) => void;
  onAddProject: () => void;
  onArchiveProject: (id: string) => void;
  onUnarchiveProject: (id: string) => void;
  onUnarchiveFeature: (projectId: string, featureId: string) => void;
  onOpenProjectHome: (id: string) => void;
  onOpenFeaturePanel: (id: string) => void;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  activeFeatureId,
  onSelectProject,
  onSelectFeature,
  onAddProject,
  onArchiveProject,
  onUnarchiveProject,
  onUnarchiveFeature,
  onOpenProjectHome,
  onOpenFeaturePanel,
}: ProjectSidebarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("projects");

  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  // Flat list of all features with project info
  const allFeatures = activeProjects.flatMap((project) =>
    project.features
      .filter((f) => !f.archived)
      .map((feature) => ({ ...feature, projectId: project.id, projectName: project.name }))
  );

  return (
    <div className="w-48 flex flex-col border-r border-border bg-card">
      {/* Header with view mode toggle */}
      <div className="p-2 border-b border-border">
        <div className="flex bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("projects")}
            className={`flex-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "projects"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            Projects
          </button>
          <button
            onClick={() => setViewMode("features")}
            className={`flex-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
              viewMode === "features"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            Features
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {viewMode === "projects" ? (
          // Projects view
          activeProjects.map((project) => {
            const isActive = project.id === activeProjectId;
            const statusCounts = getStatusCounts(project);
            const archivedFeatures = project.features.filter((f) => f.archived);

            return (
              <ContextMenu key={project.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={`group mx-2 mb-1 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      isActive ? "bg-primary/10" : "hover:bg-card-alt"
                    }`}
                    onClick={() => onSelectProject(project.id)}
                  >
                    <div className="flex items-center gap-2">
                      <ProjectLogo projectPath={project.path} />
                      <span
                        className={`text-sm truncate ${
                          isActive ? "text-primary font-medium" : "text-ink"
                        }`}
                      >
                        {project.name.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                      </span>
                    </div>
                    {/* Status indicators */}
                    <div className="flex items-center gap-2 mt-1 ml-6">
                      {statusCounts.running > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-blue-500">
                          <UpdateIcon className="w-3 h-3 animate-spin" />
                          {statusCounts.running}
                        </span>
                      )}
                      {statusCounts.needsReview > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-amber-500">
                          <ExclamationTriangleIcon className="w-3 h-3" />
                          {statusCounts.needsReview}
                        </span>
                      )}
                      {statusCounts.completed > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-green-500">
                          <CheckCircledIcon className="w-3 h-3" />
                          {statusCounts.completed}
                        </span>
                      )}
                      {archivedFeatures.length > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <ArchiveIcon className="w-3 h-3" />
                          {archivedFeatures.length}
                        </span>
                      )}
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[160px]">
                  <ContextMenuItem
                    onClick={() => onOpenFeaturePanel(project.id)}
                    className="gap-2 cursor-pointer"
                  >
                    <DashboardIcon className="w-3.5 h-3.5" />
                    <span>Open Features</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => onOpenProjectHome(project.id)}
                    className="gap-2 cursor-pointer"
                  >
                    <HomeIcon className="w-3.5 h-3.5" />
                    <span>Project Home</span>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {archivedFeatures.length > 0 && (
                    <>
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
                      <ContextMenuSeparator />
                    </>
                  )}
                  <ContextMenuItem
                    onClick={() => onArchiveProject(project.id)}
                    className="gap-2 cursor-pointer"
                  >
                    <ArchiveIcon className="w-3.5 h-3.5" />
                    <span>Archive Project</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        ) : (
          // Features view - flat list
          allFeatures.map((feature) => {
            const isActive = feature.projectId === activeProjectId && feature.id === activeFeatureId;
            return (
              <div
                key={`${feature.projectId}-${feature.id}`}
                className={`mx-2 mb-1 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  isActive ? "bg-primary/10" : "hover:bg-card-alt"
                }`}
                onClick={() => onSelectFeature(feature.projectId, feature.id)}
              >
                <div className="flex items-center gap-1.5">
                  <StatusIcon status={feature.status} />
                  <span
                    className={`text-sm truncate ${
                      isActive ? "text-primary font-medium" : "text-ink"
                    }`}
                  >
                    {feature.name}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground truncate block mt-0.5">
                  {feature.projectName}
                </span>
              </div>
            );
          })
        )}
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

function getStatusCounts(project: WorkspaceProject) {
  const counts = { pending: 0, running: 0, completed: 0, needsReview: 0 };
  for (const feature of project.features) {
    if (feature.archived) continue;
    switch (feature.status) {
      case "pending":
        counts.pending++;
        break;
      case "running":
        counts.running++;
        break;
      case "completed":
        counts.completed++;
        break;
      case "needs-review":
        counts.needsReview++;
        break;
    }
  }
  return counts;
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
