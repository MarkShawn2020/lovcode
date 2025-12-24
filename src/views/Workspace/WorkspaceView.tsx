import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";

import { ProjectSidebar } from "./ProjectSidebar";
import { FeatureTabs } from "./FeatureTabs";
import { PanelGrid, SharedPanelZone } from "../../components/PanelGrid";
import type { PanelState } from "../../components/PanelGrid";
import type { WorkspaceData, WorkspaceProject, Feature } from "./types";

export function WorkspaceView() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);

  // Load workspace data and reset running features (PTY sessions don't survive restarts)
  useEffect(() => {
    invoke<WorkspaceData>("workspace_load")
      .then((data) => {
        // Reset any "running" features to "pending" since PTY processes are lost on restart
        const hasRunningFeatures = data.projects.some((p) =>
          p.features.some((f) => f.status === "running")
        );

        if (hasRunningFeatures) {
          const resetData: WorkspaceData = {
            ...data,
            projects: data.projects.map((p) => ({
              ...p,
              features: p.features.map((f) =>
                f.status === "running" ? { ...f, status: "pending" as const } : f
              ),
            })),
          };
          setWorkspace(resetData);
          // Auto-save the reset state
          invoke("workspace_save", { data: resetData }).catch(console.error);
        } else {
          setWorkspace(data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Listen for feature-complete events
  useEffect(() => {
    const unlisten = listen<{ project_id: string; feature_id: string; feature_name: string }>(
      "feature-complete",
      (event) => {
        const { project_id, feature_id } = event.payload;
        // Update feature status to needs-review
        setWorkspace((prev) => {
          if (!prev) return prev;
          const newProjects = prev.projects.map((p) => {
            if (p.id !== project_id) return p;
            return {
              ...p,
              features: p.features.map((f) =>
                f.id === feature_id ? { ...f, status: "needs-review" as const } : f
              ),
            };
          });
          return { ...prev, projects: newProjects };
        });
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Save workspace when it changes
  const saveWorkspace = useCallback(async (data: WorkspaceData) => {
    setWorkspace(data);
    try {
      await invoke("workspace_save", { data });
    } catch (err) {
      console.error("Failed to save workspace:", err);
    }
  }, []);

  // Get active project
  const activeProject = workspace?.projects.find(
    (p) => p.id === workspace.active_project_id
  );

  // Get active feature
  const activeFeature = activeProject?.features.find(
    (f) => f.id === activeProject.active_feature_id
  );

  // Add project handler
  const handleAddProject = useCallback(async () => {
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

        if (workspace) {
          saveWorkspace({
            ...workspace,
            projects: [...workspace.projects, project],
            active_project_id: project.id,
          });
        }
      }
    } catch (err) {
      console.error("Failed to add project:", err);
    }
  }, [workspace, saveWorkspace]);

  // Remove project handler
  const handleRemoveProject = useCallback(
    async (id: string) => {
      try {
        await invoke("workspace_remove_project", { id });
        if (workspace) {
          const newProjects = workspace.projects.filter((p) => p.id !== id);
          saveWorkspace({
            ...workspace,
            projects: newProjects,
            active_project_id:
              workspace.active_project_id === id
                ? newProjects[0]?.id
                : workspace.active_project_id,
          });
        }
      } catch (err) {
        console.error("Failed to remove project:", err);
      }
    },
    [workspace, saveWorkspace]
  );

  // Select project handler
  const handleSelectProject = useCallback(
    (id: string) => {
      if (workspace) {
        saveWorkspace({
          ...workspace,
          active_project_id: id,
        });
      }
    },
    [workspace, saveWorkspace]
  );

  // Add feature handler
  const handleAddFeature = useCallback(async () => {
    if (!activeProject) return;

    const name = prompt("Enter feature name:");
    if (!name) return;

    try {
      const feature = await invoke<Feature>("workspace_create_feature", {
        projectId: activeProject.id,
        name,
      });

      if (workspace) {
        const newProjects = workspace.projects.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                features: [...p.features, feature],
                active_feature_id: feature.id,
              }
            : p
        );
        saveWorkspace({
          ...workspace,
          projects: newProjects,
        });
      }
    } catch (err) {
      console.error("Failed to create feature:", err);
    }
  }, [activeProject, workspace, saveWorkspace]);

  // Remove feature handler
  const handleRemoveFeature = useCallback(
    async (featureId: string) => {
      if (!activeProject) return;

      try {
        await invoke("workspace_delete_feature", {
          projectId: activeProject.id,
          featureId,
        });

        if (workspace) {
          const newProjects = workspace.projects.map((p) => {
            if (p.id !== activeProject.id) return p;
            const newFeatures = p.features.filter((f) => f.id !== featureId);
            return {
              ...p,
              features: newFeatures,
              active_feature_id:
                p.active_feature_id === featureId
                  ? newFeatures[0]?.id
                  : p.active_feature_id,
            };
          });
          saveWorkspace({
            ...workspace,
            projects: newProjects,
          });
        }
      } catch (err) {
        console.error("Failed to delete feature:", err);
      }
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Select feature handler
  const handleSelectFeature = useCallback(
    (featureId: string) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) =>
        p.id === activeProject.id
          ? { ...p, active_feature_id: featureId }
          : p
      );
      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Add panel handler
  const handlePanelAdd = useCallback(
    (_direction: "horizontal" | "vertical") => {
      if (!activeProject || !activeFeature || !workspace) return;

      const panelId = crypto.randomUUID();
      const ptyId = crypto.randomUUID();

      const newPanel: PanelState = {
        id: panelId,
        ptyId,
        title: "Terminal",
        isShared: false,
        cwd: activeProject.path,
      };

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => {
            if (f.id !== activeFeature.id) return f;
            return {
              ...f,
              panels: [...f.panels, { ...newPanel, is_shared: false, pty_id: ptyId }],
            };
          }),
        };
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, activeFeature, workspace, saveWorkspace]
  );

  // Close panel handler
  const handlePanelClose = useCallback(
    (panelId: string) => {
      if (!activeProject || !activeFeature || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => {
            if (f.id !== activeFeature.id) return f;
            return {
              ...f,
              panels: f.panels.filter((panel) => panel.id !== panelId),
            };
          }),
          shared_panels: p.shared_panels.filter((panel) => panel.id !== panelId),
        };
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, activeFeature, workspace, saveWorkspace]
  );

  // Toggle panel shared handler
  const handlePanelToggleShared = useCallback(
    (panelId: string) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;

        // Check if panel is in shared
        const sharedIndex = p.shared_panels.findIndex((panel) => panel.id === panelId);
        if (sharedIndex !== -1) {
          // Move from shared to active feature
          const panel = p.shared_panels[sharedIndex];
          const newSharedPanels = p.shared_panels.filter((_, i) => i !== sharedIndex);
          const newFeatures = p.features.map((f) => {
            if (f.id !== p.active_feature_id) return f;
            return {
              ...f,
              panels: [...f.panels, { ...panel, is_shared: false }],
            };
          });
          return { ...p, shared_panels: newSharedPanels, features: newFeatures };
        }

        // Check if panel is in a feature
        for (const feature of p.features) {
          const panelIndex = feature.panels.findIndex((panel) => panel.id === panelId);
          if (panelIndex !== -1) {
            const panel = feature.panels[panelIndex];
            const newFeatures = p.features.map((f) => {
              if (f.id !== feature.id) return f;
              return {
                ...f,
                panels: f.panels.filter((_, i) => i !== panelIndex),
              };
            });
            return {
              ...p,
              features: newFeatures,
              shared_panels: [...p.shared_panels, { ...panel, is_shared: true }],
            };
          }
        }

        return p;
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Panel title change handler
  const handlePanelTitleChange = useCallback(
    (panelId: string, title: string) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.map((panel) =>
              panel.id === panelId ? { ...panel, title } : panel
            ),
          })),
          shared_panels: p.shared_panels.map((panel) =>
            panel.id === panelId ? { ...panel, title } : panel
          ),
        };
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Convert workspace panels to PanelGrid format
  const featurePanels: PanelState[] =
    activeFeature?.panels.map((p) => ({
      id: p.id,
      ptyId: p.pty_id,
      title: p.title,
      isShared: p.is_shared,
      cwd: activeProject?.path || "",
    })) || [];

  const sharedPanels: PanelState[] =
    activeProject?.shared_panels.map((p) => ({
      id: p.id,
      ptyId: p.pty_id,
      title: p.title,
      isShared: true,
      cwd: activeProject?.path || "",
    })) || [];

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas">
        <p className="text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-canvas">
      <div className="flex-1 flex min-h-0">
        {/* Project sidebar */}
        <ProjectSidebar
          projects={workspace?.projects || []}
          activeProjectId={workspace?.active_project_id}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeProject ? (
            <>
              {/* Feature tabs */}
              <FeatureTabs
                features={activeProject.features}
                activeFeatureId={activeProject.active_feature_id}
                onSelectFeature={handleSelectFeature}
                onAddFeature={handleAddFeature}
                onRemoveFeature={handleRemoveFeature}
              />

              {/* Panel area */}
              <div className="flex-1 min-h-0">
                {activeFeature ? (
                  <PanelGroup orientation="horizontal" id="workspace-main">
                    {/* Shared panels zone */}
                    {sharedPanels.length > 0 && (
                      <>
                        <Panel defaultSize={30} minSize={15}>
                          <SharedPanelZone
                            panels={sharedPanels}
                            onPanelClose={handlePanelClose}
                            onPanelToggleShared={handlePanelToggleShared}
                            onPanelTitleChange={handlePanelTitleChange}
                          />
                        </Panel>
                        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
                      </>
                    )}

                    {/* Feature panels */}
                    <Panel minSize={30}>
                      <PanelGrid
                        panels={featurePanels}
                        onPanelClose={handlePanelClose}
                        onPanelAdd={handlePanelAdd}
                        onPanelToggleShared={handlePanelToggleShared}
                        onPanelTitleChange={handlePanelTitleChange}
                        autoSaveId={activeFeature.id}
                      />
                    </Panel>
                  </PanelGroup>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-muted-foreground mb-4">
                        No features yet
                      </p>
                      <button
                        onClick={handleAddFeature}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                      >
                        Create First Feature
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <h2 className="font-serif text-2xl font-bold text-ink mb-2">
                  Welcome to Workspace
                </h2>
                <p className="text-muted-foreground mb-6">
                  Add a project to start parallel vibe coding
                </p>
                <button
                  onClick={handleAddProject}
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Add Your First Project
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
