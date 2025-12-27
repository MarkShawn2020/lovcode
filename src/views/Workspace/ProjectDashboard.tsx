import { useMemo } from "react";
import {
  CheckCircledIcon,
  UpdateIcon,
  ExclamationTriangleIcon,
  TimerIcon,
  PlusIcon,
  ArchiveIcon,
} from "@radix-ui/react-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectLogo } from "./ProjectLogo";
import { GitHistory } from "./GitHistory";
import type { WorkspaceProject, FeatureStatus } from "./types";

interface ProjectDashboardProps {
  project: WorkspaceProject;
  onFeatureClick: (featureId: string) => void;
  onFeatureStatusChange: (featureId: string, status: FeatureStatus) => void;
  onAddFeature: () => void;
  onUnarchiveFeature: (featureId: string) => void;
}

function StatCard({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className={`flex items-center gap-3 p-4 bg-card border border-border rounded-xl ${color}`}>
      <div className="p-2 bg-muted rounded-lg">{icon}</div>
      <div>
        <div className="text-2xl font-bold text-ink">{count}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function ProjectDashboard({
  project,
  onFeatureClick,
  onFeatureStatusChange,
  onAddFeature,
  onUnarchiveFeature,
}: ProjectDashboardProps) {
  const stats = useMemo(() => {
    const activeFeatures = project.features.filter((f) => !f.archived);
    return {
      pending: activeFeatures.filter((f) => f.status === "pending").length,
      running: activeFeatures.filter((f) => f.status === "running").length,
      needsReview: activeFeatures.filter((f) => f.status === "needs-review").length,
      completed: activeFeatures.filter((f) => f.status === "completed").length,
      total: activeFeatures.length,
    };
  }, [project.features]);

  const archivedFeatures = useMemo(() => {
    return project.features.filter((f) => f.archived);
  }, [project.features]);

  const recentFeatures = useMemo(() => {
    return [...project.features]
      .filter((f) => !f.archived)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 5);
  }, [project.features]);

  const activeFeatures = project.features.filter((f) => !f.archived);

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProjectLogo projectPath={project.path} size="lg" />
            <div>
              <h1 className="font-serif text-xl font-bold text-ink">
                {project.name.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
              </h1>
              <p className="text-xs text-muted-foreground truncate max-w-md">
                {project.path}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {archivedFeatures.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors">
                  <ArchiveIcon className="w-4 h-4" />
                  <span>Archived ({archivedFeatures.length})</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  {archivedFeatures.map((feature) => (
                    <DropdownMenuItem
                      key={feature.id}
                      onClick={() => onUnarchiveFeature(feature.id)}
                      className="cursor-pointer"
                    >
                      <span className="truncate">
                        {feature.seq > 0 && <span className="text-muted-foreground">#{feature.seq} </span>}
                        {feature.name}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              onClick={onAddFeature}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              New Feature
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border">
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={<TimerIcon className="w-5 h-5 text-muted-foreground" />}
            label="Pending"
            count={stats.pending}
            color=""
          />
          <StatCard
            icon={<UpdateIcon className="w-5 h-5 text-blue-500" />}
            label="Running"
            count={stats.running}
            color=""
          />
          <StatCard
            icon={<ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />}
            label="Needs Review"
            count={stats.needsReview}
            color=""
          />
          <StatCard
            icon={<CheckCircledIcon className="w-5 h-5 text-green-500" />}
            label="Completed"
            count={stats.completed}
            color=""
          />
        </div>
      </div>

      {/* Recent Activity */}
      {recentFeatures.length > 0 && (
        <div className="flex-shrink-0 px-6 py-3 border-b border-border">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">Recent Features</h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {recentFeatures.map((feature) => (
              <button
                key={feature.id}
                onClick={() => onFeatureClick(feature.id)}
                className="flex-shrink-0 px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
              >
                {feature.seq > 0 && <span className="text-muted-foreground">#{feature.seq} </span>}
                {feature.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeFeatures.length > 0 ? (
          <KanbanBoard
            features={activeFeatures}
            onFeatureClick={onFeatureClick}
            onFeatureStatusChange={onFeatureStatusChange}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-muted-foreground">No features yet</p>
          </div>
        )}
      </div>

      {/* Git History */}
      <GitHistory
        projectPath={project.path}
        features={activeFeatures}
      />
    </div>
  );
}
