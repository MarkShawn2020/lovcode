import { useState, useEffect } from "react";
import { useAtom } from "jotai";
import { PlusIcon, ArchiveIcon, DashboardIcon } from "@radix-ui/react-icons";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { workspaceDataAtom, collapsedProjectGroupsAtom } from "@/store";
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
import { ProjectLogo } from "@/views/Workspace/ProjectLogo";
import { SortableFeatureTab } from "./FeatureTab";
import type { WorkspaceProject, Feature, WorkspaceData } from "@/views/Workspace/types";

interface FeatureTabGroupProps {
  project: WorkspaceProject;
  features: Feature[];
  isActiveProject: boolean;
  isCollapsed: boolean;
}

export function FeatureTabGroup({
  project,
  features,
  isActiveProject,
  isCollapsed,
}: FeatureTabGroupProps) {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const [collapsedGroups, setCollapsedGroups] = useAtom(collapsedProjectGroupsAtom);
  const [hasLogo, setHasLogo] = useState(true); // Default true to hide name initially

  useEffect(() => {
    invoke<string | null>("get_project_logo", { projectPath: project.path })
      .then((logo) => setHasLogo(!!logo))
      .catch(() => setHasLogo(false));
  }, [project.path]);

  const archivedFeatures = project.features.filter(f => f.archived);

  const toggleCollapsed = () => {
    if (isCollapsed) {
      setCollapsedGroups(collapsedGroups.filter(id => id !== project.id));
    } else {
      setCollapsedGroups([...collapsedGroups, project.id]);
    }
  };

  const handleSelectProject = async () => {
    if (!workspace || workspace.active_project_id === project.id) return;

    const newWorkspace: WorkspaceData = {
      ...workspace,
      active_project_id: project.id,
    };
    setWorkspace(newWorkspace);
    await invoke("workspace_save", { data: newWorkspace });
  };

  const handleOpenDashboard = async () => {
    if (!workspace) return;

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

  const handleAddFeature = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!workspace) return;

    const counter = (project.feature_counter ?? 0) + 1;
    const name = `#${counter}`;

    try {
      const feature = await invoke<Feature>("workspace_create_feature", {
        projectId: project.id,
        name,
      });

      const newProjects = workspace.projects.map((p) =>
        p.id === project.id
          ? {
              ...p,
              features: [...p.features, { ...feature, seq: counter }],
              active_feature_id: feature.id,
              feature_counter: counter,
              view_mode: "features" as const,
            }
          : p
      );

      const newWorkspace: WorkspaceData = {
        ...workspace,
        projects: newProjects,
        active_project_id: project.id,
      };

      setWorkspace(newWorkspace);
      await invoke("workspace_save", { data: newWorkspace });
    } catch (err) {
      console.error("Failed to create feature:", err);
    }
  };

  const handleSelectFeature = async (featureId: string) => {
    if (!workspace) return;

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
      <ContextMenuItem onClick={() => handleAddFeature()} className="gap-2 cursor-pointer">
        <PlusIcon className="w-3.5 h-3.5" />
        <span>New Feature</span>
      </ContextMenuItem>
      <ContextMenuItem onClick={handleOpenDashboard} className="gap-2 cursor-pointer">
        <DashboardIcon className="w-3.5 h-3.5" />
        <span>Dashboard</span>
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
      <div className="flex items-center">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              onClick={features.length > 0 ? toggleCollapsed : handleSelectProject}
              onPointerDown={(e) => e.stopPropagation()}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors ${
                isActiveProject ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-ink hover:bg-card-alt"
              }`}
              title={projectDisplayName}
            >
              <ProjectLogo projectPath={project.path} size="sm" />
              {!hasLogo && (
                <span className="text-xs font-medium truncate max-w-[80px]">{projectDisplayName}</span>
              )}
              {features.length > 0 && (
                <span className="text-xs text-muted-foreground">({features.length})</span>
              )}
            </button>
          </ContextMenuTrigger>
          {contextMenuContent}
        </ContextMenu>
        <div className="h-4 border-l border-border mx-1" />
      </div>
    );
  }

  // Expanded view: project header + tabs with underline indicator
  return (
    <div className="flex items-center">
      <div
        className={`relative flex items-center gap-0.5 px-1 pb-1 after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:rounded-full ${
          isActiveProject ? "after:bg-primary" : "after:bg-border"
        }`}
      >
        {/* Project header with context menu */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              onClick={features.length > 0 ? toggleCollapsed : handleSelectProject}
              onPointerDown={(e) => e.stopPropagation()}
              className={`flex items-center px-1 py-1 rounded transition-colors ${
                isActiveProject ? "text-primary" : "text-muted-foreground hover:text-ink"
              }`}
              title={projectDisplayName}
            >
              <ProjectLogo projectPath={project.path} size="sm" />
            </button>
          </ContextMenuTrigger>
          {contextMenuContent}
        </ContextMenu>

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

        {/* Add button - only show for active project */}
        {isActiveProject && (
          <button
            onClick={handleAddFeature}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
            title="New Feature"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Separator between project groups */}
      <div className="h-4 border-l border-border mx-1" />
    </div>
  );
}
