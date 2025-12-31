import { useState, useRef, useCallback } from "react";
import { useAtom } from "jotai";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArchiveIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DashboardIcon,
  DrawingPinFilledIcon,
} from "@radix-ui/react-icons";
import { open } from "@tauri-apps/plugin-dialog";
import {
  workspaceDataAtom,
  collapsedProjectGroupsAtom,
  verticalTabsSidebarWidthAtom,
} from "@/store";
import { useNavigate, useFeatureCreation } from "@/hooks";
import { invoke } from "@tauri-apps/api/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ProjectLogo } from "@/views/Workspace/ProjectLogo";
import { CreateFeatureDialog } from "./CreateFeatureDialog";
import type { Feature, WorkspaceData, WorkspaceProject } from "@/views/Workspace/types";

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

export function VerticalFeatureTabs() {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const [collapsedGroups, setCollapsedGroups] = useAtom(collapsedProjectGroupsAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(verticalTabsSidebarWidthAtom);
  const navigate = useNavigate();
  const [activeDragProject, setActiveDragProject] = useState<WorkspaceProject | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

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
  const archivedProjects = workspace.projects.filter((p) => p.archived);

  const handleUnarchiveProject = async (id: string) => {
    const proj = workspace.projects.find((p) => p.id === id);
    navigate({
      type: "workspace",
      projectId: id,
      featureId: proj?.active_feature_id,
      mode: proj?.view_mode || "features",
    });

    const newProjects = workspace.projects.map((p) =>
      p.id === id ? { ...p, archived: false } : p
    );
    const newWorkspace: WorkspaceData = {
      ...workspace,
      projects: newProjects,
      active_project_id: id,
    };
    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const handleAddProject = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Directory",
      });

      if (selected && typeof selected === "string") {
        const project = await invoke<WorkspaceProject>("workspace_add_project", {
          path: selected,
        });

        navigate({ type: "workspace", projectId: project.id, mode: "dashboard" });

        const newWorkspace: WorkspaceData = {
          ...workspace,
          projects: [...workspace.projects, project],
          active_project_id: project.id,
        };
        setWorkspace(newWorkspace);
        await invoke("workspace_save", { data: newWorkspace });
      }
    } catch (err) {
      console.error("Failed to add project:", err);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    if (id.startsWith("project-")) {
      const projectId = id.replace("project-", "");
      const project = workspace.projects.find((p) => p.id === projectId);
      if (project) {
        setActiveDragProject(project);
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragProject(null);

    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId.startsWith("project-") && overId.startsWith("project-")) {
      const activeProjectId = activeId.replace("project-", "");
      const overProjectId = overId.replace("project-", "");

      const projects = [...workspace.projects];
      const activeIndex = projects.findIndex((p) => p.id === activeProjectId);
      const overIndex = projects.findIndex((p) => p.id === overProjectId);

      if (activeIndex === -1 || overIndex === -1) return;

      const [movedProject] = projects.splice(activeIndex, 1);
      projects.splice(overIndex, 0, movedProject);

      const newWorkspace: WorkspaceData = { ...workspace, projects };
      setWorkspace(newWorkspace);
      await invoke("workspace_save", { data: newWorkspace });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <aside
        className="flex flex-col border-r border-border bg-card shrink-0 relative"
        style={{ width: sidebarWidth }}
      >
        {/* Header */}
        <div className="h-[40px] shrink-0 flex items-center justify-between px-3 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">Projects</span>
          <div className="flex items-center gap-1">
            {archivedProjects.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
                >
                  <ArchiveIcon className="w-3.5 h-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {archivedProjects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => handleUnarchiveProject(project.id)}
                      className="cursor-pointer"
                    >
                      <span className="truncate">{project.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              onClick={handleAddProject}
              className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
              title="Add Project"
            >
              <PlusIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto py-2">
          <SortableContext
            items={activeProjects.map((p) => `project-${p.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {activeProjects.map((project) => (
              <SortableVerticalProjectGroup
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
          </SortableContext>
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

      <DragOverlay>
        {activeDragProject && (
          <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
            <div className="flex items-center gap-2">
              <ProjectLogo projectPath={activeDragProject.path} size="sm" />
              <span className="text-sm font-medium truncate">{activeDragProject.name}</span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface VerticalProjectGroupProps {
  project: WorkspaceProject;
  isActiveProject: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isDragging?: boolean;
  dragHandleProps?: ReturnType<typeof useSortable>["listeners"];
}

function VerticalProjectGroup({
  project,
  isActiveProject,
  isCollapsed,
  onToggleCollapse,
  isDragging,
  dragHandleProps,
}: VerticalProjectGroupProps) {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const navigate = useNavigate();
  const {
    showCreateDialog,
    setShowCreateDialog,
    nextSeq,
    openCreateDialog,
    createFeature,
  } = useFeatureCreation(project);

  const activeFeatures = project.features.filter((f) => !f.archived);
  const archivedFeatures = project.features.filter((f) => f.archived);

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

    const nonArchivedProjects = workspace.projects.filter(
      (p) => p.id !== project.id && !p.archived
    );
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
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

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

  return (
    <>
      <div className={`px-2 ${isDragging ? "opacity-50" : ""}`}>
        {/* Project Header */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
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

              {/* Project Logo - draggable */}
              <div
                className="cursor-grab active:cursor-grabbing"
                {...dragHandleProps}
              >
                <ProjectLogo projectPath={project.path} size="sm" />
              </div>

              {/* Project Name */}
              <span className="text-sm font-medium truncate flex-1" title={projectDisplayName}>
                {projectDisplayName}
              </span>

              {/* Add Feature Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openCreateDialog();
                }}
                className="p-0.5 text-muted-foreground hover:text-ink opacity-0 group-hover:opacity-100 hover:opacity-100"
                title="New Feature"
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </ContextMenuTrigger>
          {contextMenuContent}
        </ContextMenu>

        {/* Features List */}
        {!isCollapsed && activeFeatures.length > 0 && (
          <div className="ml-4 mt-1 space-y-0.5">
            {activeFeatures
              .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
              .map((feature) => (
                <VerticalFeatureItem
                  key={feature.id}
                  feature={feature}
                  projectId={project.id}
                  isActive={isActiveProject && project.active_feature_id === feature.id}
                  onSelect={() => handleSelectFeature(feature.id)}
                />
              ))}
          </div>
        )}
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

function SortableVerticalProjectGroup(
  props: Omit<VerticalProjectGroupProps, "isDragging" | "dragHandleProps">
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `project-${props.project.id}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="group">
      <VerticalProjectGroup {...props} isDragging={isDragging} dragHandleProps={listeners} />
    </div>
  );
}

interface VerticalFeatureItemProps {
  feature: Feature;
  projectId: string;
  isActive: boolean;
  onSelect: () => void;
}

function VerticalFeatureItem({ feature, isActive, onSelect }: VerticalFeatureItemProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors ${
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-ink hover:bg-card-alt"
      }`}
    >
      {feature.pinned && (
        <DrawingPinFilledIcon className="w-2.5 h-2.5 text-primary/70 flex-shrink-0" />
      )}
      <span className="text-xs truncate" title={feature.name}>
        {feature.name}
      </span>
    </button>
  );
}
