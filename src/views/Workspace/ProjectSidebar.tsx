import { useState, useEffect, useRef, useCallback } from "react";
import { PlusIcon, CheckCircledIcon, UpdateIcon, ExclamationTriangleIcon, TimerIcon, ArchiveIcon, DashboardIcon, ChevronRightIcon, ChevronDownIcon, DrawingPinFilledIcon, DrawingPinIcon, TrashIcon, Pencil1Icon } from "@radix-ui/react-icons";
import { ProjectLogo } from "./ProjectLogo";
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
  activeFeatureId?: string;
  onSelectFeature: (projectId: string, featureId: string) => void;
  onAddProject: () => void;
  onAddFeature: (projectId: string) => Promise<{ featureId: string; featureName: string } | undefined>;
  onArchiveProject: (id: string) => void;
  onUnarchiveProject: (id: string) => void;
  onUnarchiveFeature: (projectId: string, featureId: string) => void;
  onOpenDashboard: (id: string) => void;
  onOpenFeaturePanel: (id: string) => void;
  onRenameFeature?: (projectId: string, featureId: string, name: string) => void;
  onArchiveFeature?: (projectId: string, featureId: string) => void;
  onDeleteFeature?: (projectId: string, featureId: string) => void;
  onPinFeature?: (projectId: string, featureId: string, pinned: boolean) => void;
  onChangeFeatureStatus?: (projectId: string, featureId: string, status: FeatureStatus) => void;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  activeFeatureId,
  onSelectFeature,
  onAddProject,
  onAddFeature,
  onArchiveProject,
  onUnarchiveProject,
  onUnarchiveFeature,
  onOpenDashboard,
  onOpenFeaturePanel,
  onRenameFeature,
  onArchiveFeature,
  onDeleteFeature,
  onPinFeature,
  onChangeFeatureStatus,
}: ProjectSidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() =>
    new Set(activeProjectId ? [activeProjectId] : [])
  );
  const [renamingFeatureId, setRenamingFeatureId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameJustStartedRef = useRef(false);
  const pendingRenameRef = useRef<{ featureId: string; featureName: string } | null>(null);
  const isComposingRef = useRef(false);

  // Auto-expand active project
  useEffect(() => {
    if (activeProjectId && !expandedProjects.has(activeProjectId)) {
      setExpandedProjects(prev => new Set([...prev, activeProjectId]));
    }
  }, [activeProjectId]);

  // Handle pending rename when new feature appears in projects
  useEffect(() => {
    if (!pendingRenameRef.current) return;
    const { featureId, featureName } = pendingRenameRef.current;
    // Check if the feature now exists in projects
    const featureExists = projects.some(p => p.features.some(f => f.id === featureId));
    if (featureExists) {
      pendingRenameRef.current = null;
      renameJustStartedRef.current = true;
      setRenameValue(featureName);
      setRenamingFeatureId(featureId);
    }
  }, [projects]);

  // Auto-focus rename input when entering rename mode
  useEffect(() => {
    if (renamingFeatureId) {
      requestAnimationFrame(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          renameInputRef.current.select();
        }
        renameJustStartedRef.current = false;
      });
    }
  }, [renamingFeatureId]);

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const handleStartRename = useCallback((featureId: string, currentName: string) => {
    if (!onRenameFeature) return;
    renameJustStartedRef.current = true;
    setRenameValue(currentName);
    setRenamingFeatureId(featureId);
  }, [onRenameFeature]);

  const handleRenameSubmit = useCallback((projectId: string, featureId: string, originalName: string) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== originalName) {
      onRenameFeature?.(projectId, featureId, trimmed);
    }
    setRenamingFeatureId(null);
  }, [renameValue, onRenameFeature]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, projectId: string, featureId: string, originalName: string) => {
    if (e.key === "Enter" && !isComposingRef.current) {
      handleRenameSubmit(projectId, featureId, originalName);
    } else if (e.key === "Escape") {
      setRenamingFeatureId(null);
    }
  }, [handleRenameSubmit]);

  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  return (
    <div className="w-48 flex flex-col border-r border-border bg-card">
      <div className="flex-1 overflow-y-auto py-2">
        {activeProjects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isExpanded = expandedProjects.has(project.id);
            const activeFeatures = project.features.filter((f) => !f.archived);
            const archivedFeatures = project.features.filter((f) => f.archived);

            const hasFeatures = activeFeatures.length > 0;

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
                        <span className="flex items-center -mr-1">
                          <span
                            className="p-0.5 rounded hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const result = await onAddFeature(project.id);
                              if (result) {
                                setExpandedProjects(prev => new Set([...prev, project.id]));
                                pendingRenameRef.current = result;
                              }
                            }}
                            title="New Feature"
                          >
                            <PlusIcon className="w-3.5 h-3.5" />
                          </span>
                          <span
                            className={`p-0.5 rounded hover:bg-muted ${hasFeatures ? "text-muted-foreground" : "text-muted-foreground/30"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasFeatures) toggleProjectExpanded(project.id);
                          }}
                        >
                            {isExpanded && hasFeatures ? (
                              <ChevronDownIcon className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRightIcon className="w-3.5 h-3.5" />
                            )}
                          </span>
                        </span>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-[180px]">
                    {/* Feature Management */}
                    <ContextMenuLabel>Feature</ContextMenuLabel>
                    <ContextMenuItem
                      onClick={async () => {
                        const result = await onAddFeature(project.id);
                        if (result) {
                          setExpandedProjects(prev => new Set([...prev, project.id]));
                          pendingRenameRef.current = result;
                        }
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
                {/* Nested features - aligned with project name (after logo) */}
                {isExpanded && activeFeatures.length > 0 && (
                  <div className="mt-0.5">
                    {activeFeatures
                      .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
                      .map((feature) => {
                        const isFeatureActive = isActive && feature.id === activeFeatureId;
                        return (
                          <ContextMenu key={feature.id}>
                            <ContextMenuTrigger asChild>
                              <div
                                className={`flex items-center gap-1.5 ml-[30px] mr-2 px-2 py-1 rounded cursor-pointer transition-colors ${
                                  isFeatureActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:text-ink hover:bg-card-alt"
                                }`}
                                onClick={() => onSelectFeature(project.id, feature.id)}
                              >
                                {feature.pinned && <DrawingPinFilledIcon className="w-3 h-3 text-primary/70 flex-shrink-0" />}
                                <StatusIcon status={feature.status} />
                                {feature.seq > 0 && <span className="text-xs text-muted-foreground/60">#{feature.seq}</span>}
                                {renamingFeatureId === feature.id ? (
                                  <input
                                    ref={renameInputRef}
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={() => {
                                      if (renameJustStartedRef.current) return;
                                      handleRenameSubmit(project.id, feature.id, feature.name);
                                    }}
                                    onKeyDown={(e) => handleRenameKeyDown(e, project.id, feature.id, feature.name)}
                                    onCompositionStart={() => { isComposingRef.current = true; }}
                                    onCompositionEnd={() => { isComposingRef.current = false; }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-1 text-sm bg-card border border-border rounded outline-none focus:border-primary min-w-0 px-1"
                                  />
                                ) : (
                                  <span
                                    className="text-sm truncate"
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      handleStartRename(feature.id, feature.name);
                                    }}
                                    title={onRenameFeature ? "Double-click to rename" : undefined}
                                  >
                                    {feature.name}
                                  </span>
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="min-w-[140px]">
                              <ContextMenuItem
                                onClick={() => handleStartRename(feature.id, feature.name)}
                                disabled={!onRenameFeature}
                                className="gap-2 cursor-pointer"
                              >
                                <Pencil1Icon className="w-3.5 h-3.5" />
                                Rename
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => onPinFeature?.(project.id, feature.id, !feature.pinned)}
                                disabled={!onPinFeature}
                                className="gap-2 cursor-pointer"
                              >
                                {feature.pinned ? (
                                  <>
                                    <DrawingPinIcon className="w-3.5 h-3.5" />
                                    Unpin
                                  </>
                                ) : (
                                  <>
                                    <DrawingPinFilledIcon className="w-3.5 h-3.5" />
                                    Pin
                                  </>
                                )}
                              </ContextMenuItem>
                              <ContextMenuSub>
                                <ContextMenuSubTrigger className="gap-2">
                                  <StatusIcon status={feature.status} />
                                  Status
                                </ContextMenuSubTrigger>
                                <ContextMenuSubContent className="min-w-[120px]">
                                  <ContextMenuItem
                                    onClick={() => onChangeFeatureStatus?.(project.id, feature.id, "pending")}
                                    disabled={!onChangeFeatureStatus || feature.status === "pending"}
                                    className="gap-2 cursor-pointer"
                                  >
                                    <TimerIcon className="w-3.5 h-3.5 text-muted-foreground" />
                                    Pending
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onClick={() => onChangeFeatureStatus?.(project.id, feature.id, "running")}
                                    disabled={!onChangeFeatureStatus || feature.status === "running"}
                                    className="gap-2 cursor-pointer"
                                  >
                                    <UpdateIcon className="w-3.5 h-3.5 text-blue-500" />
                                    Running
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onClick={() => onChangeFeatureStatus?.(project.id, feature.id, "completed")}
                                    disabled={!onChangeFeatureStatus || feature.status === "completed"}
                                    className="gap-2 cursor-pointer"
                                  >
                                    <CheckCircledIcon className="w-3.5 h-3.5 text-green-500" />
                                    Completed
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onClick={() => onChangeFeatureStatus?.(project.id, feature.id, "needs-review")}
                                    disabled={!onChangeFeatureStatus || feature.status === "needs-review"}
                                    className="gap-2 cursor-pointer"
                                  >
                                    <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" />
                                    Needs Review
                                  </ContextMenuItem>
                                </ContextMenuSubContent>
                              </ContextMenuSub>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => onArchiveFeature?.(project.id, feature.id)}
                                disabled={!onArchiveFeature}
                                className="gap-2 cursor-pointer"
                              >
                                <ArchiveIcon className="w-3.5 h-3.5" />
                                Archive
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => onDeleteFeature?.(project.id, feature.id)}
                                disabled={!onDeleteFeature}
                                className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                                Delete
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                  </div>
                )}
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
