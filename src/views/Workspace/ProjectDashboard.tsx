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
import { CreateFeatureDialog } from "@/components/GlobalHeader/CreateFeatureDialog";
import { useFeatureCreation } from "@/hooks";
import { KanbanBoard } from "./KanbanBoard";
import { ProjectLogo } from "./ProjectLogo";
import { GitHistory } from "./GitHistory";
import { ProjectDiagnostics } from "./ProjectDiagnostics";
import { LogoManager } from "./LogoManager";
import type { WorkspaceProject, FeatureStatus } from "./types";

interface ProjectDashboardProps {
  project: WorkspaceProject;
  onFeatureClick: (featureId: string) => void;
  onFeatureStatusChange: (featureId: string, status: FeatureStatus) => void;
  onUnarchiveFeature: (featureId: string) => void;
}

function BentoCard({
  title,
  children,
  className = "",
  action,
  subtitle,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className={`bg-card border border-border rounded-2xl overflow-hidden flex flex-col ${className}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</h3>
          {subtitle}
        </div>
        {action}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export function ProjectDashboard({
  project,
  onFeatureClick,
  onFeatureStatusChange,
  onUnarchiveFeature,
}: ProjectDashboardProps) {
  const {
    showCreateDialog,
    setShowCreateDialog,
    nextSeq,
    openCreateDialog,
    createFeature,
  } = useFeatureCreation(project);

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
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-muted/30">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 bg-card border-b border-border">
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
                <DropdownMenuTrigger className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-muted rounded-lg transition-colors">
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
          </div>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="flex-1 min-h-0 p-4 overflow-y-auto">
        <div className="grid grid-cols-12 gap-4 h-full" style={{ minHeight: '600px' }}>
          {/* Recent Features - spans full width */}
          {recentFeatures.length > 0 && (
            <div className="col-span-12 bg-card border border-border rounded-2xl px-4 py-3">
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

          {/* Main content area - Kanban on left, sidebar on right */}
          <div className="col-span-8 row-span-2">
            <BentoCard
              title="Features"
              className="h-full"
              subtitle={
                <div className="flex items-center gap-2 text-[10px]">
                  {stats.pending > 0 && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <TimerIcon className="w-3 h-3" />{stats.pending}
                    </span>
                  )}
                  {stats.running > 0 && (
                    <span className="flex items-center gap-1 text-blue-500">
                      <UpdateIcon className="w-3 h-3" />{stats.running}
                    </span>
                  )}
                  {stats.needsReview > 0 && (
                    <span className="flex items-center gap-1 text-amber-500">
                      <ExclamationTriangleIcon className="w-3 h-3" />{stats.needsReview}
                    </span>
                  )}
                  {stats.completed > 0 && (
                    <span className="flex items-center gap-1 text-green-500">
                      <CheckCircledIcon className="w-3 h-3" />{stats.completed}
                    </span>
                  )}
                </div>
              }
              action={
                <button
                  onClick={openCreateDialog}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  New Feature
                </button>
              }
            >
              {activeFeatures.length > 0 ? (
                <KanbanBoard
                  features={activeFeatures}
                  onFeatureClick={onFeatureClick}
                  onFeatureStatusChange={onFeatureStatusChange}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-muted-foreground text-sm">No features yet</p>
                </div>
              )}
            </BentoCard>
          </div>

          {/* Right sidebar - stacked cards */}
          <div className="col-span-4 row-span-2 flex flex-col gap-4">
            {/* Logo Manager */}
            <BentoCard title="Logo" className="flex-shrink-0">
              <LogoManager projectPath={project.path} embedded />
            </BentoCard>

            {/* Diagnostics */}
            <BentoCard title="Diagnostics" className="flex-1 min-h-0 max-h-[200px]">
              <div className="overflow-y-auto h-full">
                <ProjectDiagnostics projectPath={project.path} embedded />
              </div>
            </BentoCard>

            {/* Git History */}
            <BentoCard title="Git History" className="flex-1 min-h-0 max-h-[200px]">
              <div className="overflow-y-auto h-full">
                <GitHistory
                  projectPath={project.path}
                  features={activeFeatures}
                  embedded
                />
              </div>
            </BentoCard>
          </div>
        </div>
      </div>

      <CreateFeatureDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        seq={nextSeq}
        onSubmit={createFeature}
      />
    </div>
  );
}
