import { PlusIcon, Cross2Icon, CheckCircledIcon, UpdateIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import type { WorkspaceProject } from "./types";

interface ProjectSidebarProps {
  projects: WorkspaceProject[];
  activeProjectId?: string;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onRemoveProject: (id: string) => void;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  onRemoveProject,
}: ProjectSidebarProps) {
  return (
    <div className="w-48 flex flex-col border-r border-border bg-card">
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-ink">Projects</h2>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          const statusCounts = getStatusCounts(project);

          return (
            <div
              key={project.id}
              className={`group mx-2 mb-1 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                isActive ? "bg-primary/10" : "hover:bg-card-alt"
              }`}
              onClick={() => onSelectProject(project.id)}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-sm truncate flex-1 ${
                    isActive ? "text-primary font-medium" : "text-ink"
                  }`}
                >
                  {project.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveProject(project.id);
                  }}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 hover:bg-card-alt transition-all"
                  title="Remove project"
                >
                  <Cross2Icon className="w-3 h-3" />
                </button>
              </div>
              {/* Status indicators */}
              <div className="flex items-center gap-2 mt-1">
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
                <span className="text-xs text-muted-foreground">
                  {project.features.length} features
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-2 border-t border-border">
        <button
          onClick={onAddProject}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Add Project
        </button>
      </div>
    </div>
  );
}

function getStatusCounts(project: WorkspaceProject) {
  const counts = { pending: 0, running: 0, completed: 0, needsReview: 0 };
  for (const feature of project.features) {
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
