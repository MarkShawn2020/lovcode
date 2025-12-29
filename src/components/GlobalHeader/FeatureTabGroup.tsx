import { useAtom } from "jotai";
import { PlusIcon, ArchiveIcon, DashboardIcon } from "@radix-ui/react-icons";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { workspaceDataAtom, collapsedProjectGroupsAtom } from "@/store";
import { useNavigate, useFeatureCreation } from "@/hooks";
import { invoke } from "@tauri-apps/api/core";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectLogo } from "@/views/Workspace/ProjectLogo";
import { SortableFeatureTab } from "./FeatureTab";
import { CreateFeatureDialog } from "./CreateFeatureDialog";
import type { WorkspaceProject, Feature, WorkspaceData } from "@/views/Workspace/types";

interface FeatureTabGroupProps {
  project: WorkspaceProject;
  features: Feature[];
  isActiveProject: boolean;
  isCollapsed: boolean;
  isDragging?: boolean;
  dragHandleProps?: ReturnType<typeof useSortable>["listeners"];
}

export function FeatureTabGroup({
  project,
  features,
  isActiveProject,
  isCollapsed,
  isDragging,
  dragHandleProps,
}: FeatureTabGroupProps) {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const [collapsedGroups, setCollapsedGroups] = useAtom(collapsedProjectGroupsAtom);
  const navigate = useNavigate();
  const {
    showCreateDialog,
    setShowCreateDialog,
    nextSeq,
    openCreateDialog,
    createFeature,
  } = useFeatureCreation(project);

  const archivedFeatures = project.features.filter(f => f.archived);

  const toggleCollapsed = () => {
    if (isCollapsed) {
      // Expand this project, collapse all others
      const otherProjectIds = workspace?.projects
        .filter(p => p.id !== project.id && !p.archived)
        .map(p => p.id) ?? [];
      setCollapsedGroups(otherProjectIds);
    } else {
      setCollapsedGroups([...collapsedGroups, project.id]);
    }
  };

  const handleSelectProject = async () => {
    if (!workspace) return;

    const activeFeatureId = project.active_feature_id;
    const mode = project.view_mode || "features";
    navigate({ type: "workspace", projectId: project.id, featureId: activeFeatureId, mode });

    if (workspace.active_project_id === project.id) return;

    const newWorkspace: WorkspaceData = {
      ...workspace,
      active_project_id: project.id,
    };
    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const handleOpenDashboard = async () => {
    if (!workspace) return;

    navigate({ type: "workspace", projectId: project.id, mode: "dashboard" });

    const newProjects = workspace.projects.map((p) =>
      p.id === project.id ? { ...p, view_mode: "dashboard" as const } : p
    );
    const newWorkspace: WorkspaceData = {
      ...workspace,
      projects: newProjects,
      active_project_id: project.id,
    };
    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const handleArchiveProject = async () => {
    if (!workspace) return;

    const nonArchivedProjects = workspace.projects.filter((p) => p.id !== project.id && !p.archived);
    const newProjects = workspace.projects.map((p) =>
      p.id === project.id ? { ...p, archived: true } : p
    );
    const newWorkspace: WorkspaceData = {
      ...workspace,
      projects: newProjects,
      active_project_id:
        workspace.active_project_id === project.id
          ? nonArchivedProjects[0]?.id
          : workspace.active_project_id,
    };
    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const handleUnarchiveFeature = async (featureId: string) => {
    if (!workspace) return;

    navigate({ type: "workspace", projectId: project.id, featureId, mode: "features" });

    const newProjects = workspace.projects.map((p) => {
      if (p.id !== project.id) return p;
      return {
        ...p,
        features: p.features.map((f) =>
          f.id === featureId ? { ...f, archived: false } : f
        ),
        active_feature_id: featureId,
        view_mode: "features" as const,
      };
    });
    const newWorkspace: WorkspaceData = {
      ...workspace,
      projects: newProjects,
      active_project_id: project.id,
    };
    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const handleSelectFeature = async (featureId: string) => {
    if (!workspace) return;

    navigate({ type: "workspace", projectId: project.id, featureId, mode: "features" });

    const newProjects = workspace.projects.map((p) =>
      p.id === project.id
        ? { ...p, active_feature_id: featureId, view_mode: "features" as const }
        : p
    );

    const newWorkspace: WorkspaceData = {
      ...workspace,
      projects: newProjects,
      active_project_id: project.id,
    };

    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const projectDisplayName = project.name
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const contextMenuContent = (
    <ContextMenuContent className="min-w-[160px]">
      <ContextMenuItem onClick={handleOpenDashboard} className="gap-2 cursor-pointer">
        <DashboardIcon className="w-3.5 h-3.5" />
        <span>Dashboard</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => openCreateDialog()} className="gap-2 cursor-pointer">
        <PlusIcon className="w-3.5 h-3.5" />
        <span>New Feature</span>
      </ContextMenuItem>
      {archivedFeatures.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <ArchiveIcon className="w-3.5 h-3.5" />
            <span>Archived ({archivedFeatures.length})</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[140px]">
            {archivedFeatures.map((feature) => (
              <ContextMenuItem
                key={feature.id}
                onClick={() => handleUnarchiveFeature(feature.id)}
                className="cursor-pointer"
              >
                <span className="truncate">{feature.name}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={handleArchiveProject} className="gap-2 cursor-pointer">
        <ArchiveIcon className="w-3.5 h-3.5" />
        <span>Archive Project</span>
      </ContextMenuItem>
    </ContextMenuContent>
  );

  if (isCollapsed) {
    // Collapsed view: just project name with count
    return (
      <>
        <div className={`flex items-center flex-shrink-0 ${isDragging ? "opacity-50" : ""}`}>
          <Tooltip delayDuration={100}>
            <ContextMenu>
              <TooltipTrigger asChild>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={features.length > 0 ? toggleCollapsed : handleSelectProject}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${
                      isDragging
                        ? "bg-primary/20 shadow-lg"
                        : isActiveProject
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-ink hover:bg-card-alt"
                    }`}
                    {...dragHandleProps}
                  >
                    <ProjectLogo projectPath={project.path} size="sm" />
                  </button>
                </ContextMenuTrigger>
              </TooltipTrigger>
              {contextMenuContent}
            </ContextMenu>
            <TooltipContent side="bottom" className="text-xs">
              {projectDisplayName}
            </TooltipContent>
          </Tooltip>
          <div className="h-4 border-l border-border mx-1" />
        </div>
        <CreateFeatureDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          seq={nextSeq}
          onSubmit={createFeature}
        />
      </>
    );
  }

  // Expanded view: project header + tabs with underline indicator
  return (
    <>
      <div className={`flex items-center flex-shrink-0 ${isDragging ? "opacity-50" : ""}`}>
        <div
          className={`relative flex items-center gap-0.5 px-1 pb-1 after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:rounded-full ${
            isDragging
              ? "bg-primary/10 rounded-lg after:bg-primary"
              : isActiveProject
                ? "after:bg-primary"
                : "after:bg-border"
          }`}
        >
          {/* Project header with context menu */}
          <Tooltip delayDuration={100}>
            <ContextMenu>
              <TooltipTrigger asChild>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={features.length > 0 ? toggleCollapsed : handleSelectProject}
                    className={`flex items-center px-1 py-1 rounded transition-colors flex-shrink-0 cursor-grab active:cursor-grabbing ${
                      isActiveProject ? "text-primary" : "text-muted-foreground hover:text-ink"
                    }`}
                    {...dragHandleProps}
                  >
                    <ProjectLogo projectPath={project.path} size="sm" />
                  </button>
                </ContextMenuTrigger>
              </TooltipTrigger>
              {contextMenuContent}
            </ContextMenu>
            <TooltipContent side="bottom" className="text-xs">
              {projectDisplayName}
            </TooltipContent>
          </Tooltip>

          {/* Feature tabs */}
          {features.length > 0 && (
            <SortableContext
              items={features.map(f => f.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-center gap-0.5">
                {features
                  .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
                  .map((feature) => (
                    <SortableFeatureTab
                      key={feature.id}
                      feature={feature}
                      projectId={project.id}
                      isActive={isActiveProject && project.active_feature_id === feature.id}
                      onSelect={() => handleSelectFeature(feature.id)}
                    />
                  ))}
              </div>
            </SortableContext>
          )}

          {/* Add button */}
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                onClick={openCreateDialog}
                onPointerDown={(e) => e.stopPropagation()}
                className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              New Feature
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Separator between project groups */}
        <div className="h-4 border-l border-border mx-1" />
      </div>
      <CreateFeatureDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        seq={nextSeq}
        onSubmit={createFeature}
      />
    </>
  );
}

// Sortable wrapper for drag-and-drop project groups
export function SortableFeatureTabGroup(props: Omit<FeatureTabGroupProps, "isDragging" | "dragHandleProps">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `project-${props.project.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex-shrink-0">
      <FeatureTabGroup {...props} isDragging={isDragging} dragHandleProps={listeners} />
    </div>
  );
}
