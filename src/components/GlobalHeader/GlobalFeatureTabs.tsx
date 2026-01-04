import { useState } from "react";
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
import { sortableKeyboardCoordinates, SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { ArchiveIcon, PlusIcon } from "@radix-ui/react-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { workspaceDataAtom, collapsedProjectGroupsAtom } from "@/store";
import { useNavigate } from "@/hooks";
import { invoke } from "@tauri-apps/api/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeatureTabGroup, SortableFeatureTabGroup } from "./FeatureTabGroup";
import { FeatureTab } from "./FeatureTab";
import type { Feature, WorkspaceData, WorkspaceProject } from "@/views/Workspace/types";

type DragItem =
  | { type: "feature"; feature: Feature; projectId: string }
  | { type: "project"; project: WorkspaceProject };

export function GlobalFeatureTabs() {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const [collapsedGroups] = useAtom(collapsedProjectGroupsAtom);
  const navigate = useNavigate();
  const [activeDragItem, setActiveDragItem] = useState<DragItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!workspace) return null;

  const activeProjects = workspace.projects.filter(p => !p.archived);
  const archivedProjects = workspace.projects.filter(p => p.archived);

  const handleUnarchiveProject = async (id: string) => {
    const proj = workspace.projects.find(p => p.id === id);
    navigate({ type: "workspace", projectId: id, featureId: proj?.active_feature_id, mode: proj?.view_mode || "terminal" });

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

    // Check if it's a project drag
    if (id.startsWith("project-")) {
      const projectId = id.replace("project-", "");
      const project = workspace.projects.find(p => p.id === projectId);
      if (project) {
        setActiveDragItem({ type: "project", project });
      }
      return;
    }

    // Otherwise it's a feature drag
    for (const project of workspace.projects) {
      const feature = project.features.find(f => f.id === id);
      if (feature) {
        setActiveDragItem({ type: "feature", feature, projectId: project.id });
        break;
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragItem(null);

    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Handle project reordering
    if (activeId.startsWith("project-") && overId.startsWith("project-")) {
      const activeProjectId = activeId.replace("project-", "");
      const overProjectId = overId.replace("project-", "");

      const projects = [...workspace.projects];
      const activeIndex = projects.findIndex(p => p.id === activeProjectId);
      const overIndex = projects.findIndex(p => p.id === overProjectId);

      if (activeIndex === -1 || overIndex === -1) return;

      const [movedProject] = projects.splice(activeIndex, 1);
      projects.splice(overIndex, 0, movedProject);

      const newWorkspace: WorkspaceData = { ...workspace, projects };
      setWorkspace(newWorkspace);
      await invoke("workspace_save", { data: newWorkspace });
      return;
    }

    // Handle feature reordering (only within same project)
    if (!activeId.startsWith("project-") && !overId.startsWith("project-")) {
      let activeProjectId: string | null = null;
      for (const project of workspace.projects) {
        if (project.features.some(f => f.id === activeId)) {
          activeProjectId = project.id;
          break;
        }
      }

      if (!activeProjectId) return;

      let overProjectId: string | null = null;
      for (const project of workspace.projects) {
        if (project.features.some(f => f.id === overId)) {
          overProjectId = project.id;
          break;
        }
      }

      if (activeProjectId !== overProjectId) return;

      const newProjects = workspace.projects.map(p => {
        if (p.id !== activeProjectId) return p;

        const features = [...p.features];
        const activeIndex = features.findIndex(f => f.id === activeId);
        const overIndex = features.findIndex(f => f.id === overId);

        if (activeIndex === -1 || overIndex === -1) return p;

        const [movedFeature] = features.splice(activeIndex, 1);
        features.splice(overIndex, 0, movedFeature);

        return { ...p, features };
      });

      const newWorkspace: WorkspaceData = { ...workspace, projects: newProjects };
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
      <SortableContext
        items={activeProjects.map(p => `project-${p.id}`)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex items-center gap-1 overflow-x-auto max-w-[calc(100vw-500px)] scrollbar-thin">
          {activeProjects.map((project) => {
            const activeFeatures = project.features.filter(f => !f.archived);

            return (
              <SortableFeatureTabGroup
                key={project.id}
                project={project}
                features={activeFeatures}
                isActiveProject={project.id === workspace.active_project_id}
                isCollapsed={collapsedGroups.includes(project.id)}
              />
            );
          })}

          {/* Archived Projects Dropdown */}
          {archivedProjects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                onPointerDown={(e) => e.stopPropagation()}
                className="p-1.5 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors flex-shrink-0"
              >
                <ArchiveIcon className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[160px]">
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

          {/* Add Project Button */}
          <button
            onClick={handleAddProject}
            className="p-1.5 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors flex-shrink-0"
            title="Add Project"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
      </SortableContext>
      <DragOverlay>
        {activeDragItem?.type === "feature" && (
          <FeatureTab
            feature={activeDragItem.feature}
            projectId={activeDragItem.projectId}
            isActive={false}
            onSelect={() => {}}
            isDragging
          />
        )}
        {activeDragItem?.type === "project" && (
          <FeatureTabGroup
            project={activeDragItem.project}
            features={activeDragItem.project.features.filter(f => !f.archived)}
            isActiveProject={false}
            isCollapsed={collapsedGroups.includes(activeDragItem.project.id)}
            isDragging
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
