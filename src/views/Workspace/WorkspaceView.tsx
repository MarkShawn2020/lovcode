import { useState, useEffect, useCallback, useMemo } from "react";
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
  const [newFeatureName, setNewFeatureName] = useState("");
  const [isAddingFeature, setIsAddingFeature] = useState(false);

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
      // Kill all PTY sessions for this project
      const projectToRemove = workspace?.projects.find((p) => p.id === id);
      if (projectToRemove) {
        // Kill shared panels
        for (const panel of projectToRemove.shared_panels) {
          invoke("pty_kill", { id: panel.pty_id }).catch(console.error);
        }
        // Kill feature panels
        for (const feature of projectToRemove.features) {
          for (const panel of feature.panels) {
            invoke("pty_kill", { id: panel.pty_id }).catch(console.error);
          }
        }
      }

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

  // Start adding feature (show input)
  const handleStartAddFeature = useCallback(() => {
    setIsAddingFeature(true);
    setNewFeatureName("");
  }, []);

  // Confirm adding feature
  const handleConfirmAddFeature = useCallback(async () => {
    if (!activeProject || !newFeatureName.trim()) return;

    try {
      const feature = await invoke<Feature>("workspace_create_feature", {
        projectId: activeProject.id,
        name: newFeatureName.trim(),
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
    } finally {
      setIsAddingFeature(false);
      setNewFeatureName("");
    }
  }, [activeProject, workspace, saveWorkspace, newFeatureName]);

  // Cancel adding feature
  const handleCancelAddFeature = useCallback(() => {
    setIsAddingFeature(false);
    setNewFeatureName("");
  }, []);

  // Remove feature handler
  const handleRemoveFeature = useCallback(
    async (featureId: string) => {
      if (!activeProject) return;

      // Kill all PTY sessions for this feature's panels
      const featureToRemove = activeProject.features.find((f) => f.id === featureId);
      if (featureToRemove) {
        for (const panel of featureToRemove.panels) {
          invoke("pty_kill", { id: panel.pty_id }).catch(console.error);
        }
      }

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
    (direction: "horizontal" | "vertical") => {
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
              layout_direction: direction,
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
      if (!activeProject || !workspace) return;

      // Find the panel to get its pty_id before removing
      let ptyIdToKill: string | null = null;
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          ptyIdToKill = panel.pty_id;
          break;
        }
      }
      if (!ptyIdToKill) {
        const sharedPanel = activeProject.shared_panels.find((p) => p.id === panelId);
        if (sharedPanel) ptyIdToKill = sharedPanel.pty_id;
      }

      // Kill the PTY session
      if (ptyIdToKill) {
        invoke("pty_kill", { id: ptyIdToKill }).catch(console.error);
      }

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.filter((panel) => panel.id !== panelId),
          })),
          shared_panels: p.shared_panels.filter((panel) => panel.id !== panelId),
        };
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
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

  // Reload panel handler (kills old PTY and creates new one)
  const handlePanelReload = useCallback(
    (panelId: string) => {
      if (!activeProject || !workspace) return;

      // Find and kill the old PTY session
      let oldPtyId: string | null = null;
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          oldPtyId = panel.pty_id;
          break;
        }
      }
      if (!oldPtyId) {
        const sharedPanel = activeProject.shared_panels.find((p) => p.id === panelId);
        if (sharedPanel) oldPtyId = sharedPanel.pty_id;
      }
      if (oldPtyId) {
        invoke("pty_kill", { id: oldPtyId }).catch(console.error);
      }

      const newPtyId = crypto.randomUUID();

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.map((panel) =>
              panel.id === panelId ? { ...panel, pty_id: newPtyId } : panel
            ),
          })),
          shared_panels: p.shared_panels.map((panel) =>
            panel.id === panelId ? { ...panel, pty_id: newPtyId } : panel
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

  // Convert workspace panels to PanelGrid format for ALL features (to keep PTY alive)
  // Memoize to prevent unnecessary re-renders during resize
  const allFeaturePanels = useMemo(() => {
    const map = new Map<string, PanelState[]>();
    activeProject?.features.forEach((feature) => {
      map.set(
        feature.id,
        feature.panels.map((p) => ({
          id: p.id,
          ptyId: p.pty_id,
          title: p.title,
          isShared: p.is_shared,
          cwd: activeProject?.path || "",
          command: p.command ?? undefined,
        }))
      );
    });
    return map;
  }, [activeProject?.features, activeProject?.path]);

  const sharedPanels = useMemo<PanelState[]>(
    () =>
      activeProject?.shared_panels.map((p) => ({
        id: p.id,
        ptyId: p.pty_id,
        title: p.title,
        isShared: true,
        cwd: activeProject?.path || "",
        command: p.command ?? undefined,
      })) || [],
    [activeProject?.shared_panels, activeProject?.path]
  );

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
                onAddFeature={handleStartAddFeature}
                onRemoveFeature={handleRemoveFeature}
                isAddingFeature={isAddingFeature}
                newFeatureName={newFeatureName}
                onNewFeatureNameChange={setNewFeatureName}
                onConfirmAddFeature={handleConfirmAddFeature}
                onCancelAddFeature={handleCancelAddFeature}
              />

              {/* Panel area */}
              <div className="flex-1 min-h-0 h-full">
                {activeFeature ? (
                  <PanelGroup orientation="horizontal" id="workspace-main" className="h-full">
                    {/* Shared panels zone */}
                    {sharedPanels.length > 0 && (
                      <>
                        <Panel defaultSize={30} minSize={20}>
                          <SharedPanelZone
                            panels={sharedPanels}
                            onPanelClose={handlePanelClose}
                            onPanelToggleShared={handlePanelToggleShared}
                            onPanelReload={handlePanelReload}
                            onPanelTitleChange={handlePanelTitleChange}
                          />
                        </Panel>
                        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
                      </>
                    )}

                    {/* Feature panels - render ALL features but hide inactive ones to keep PTY alive */}
                    <Panel minSize={30}>
                      <div className="relative h-full">
                        {activeProject?.features.map((feature) => (
                          <div
                            key={feature.id}
                            className={`absolute inset-0 ${
                              feature.id === activeFeature.id ? "" : "invisible pointer-events-none"
                            }`}
                          >
                            <PanelGrid
                              panels={allFeaturePanels.get(feature.id) || []}
                              onPanelClose={handlePanelClose}
                              onPanelAdd={handlePanelAdd}
                              onPanelToggleShared={handlePanelToggleShared}
                              onPanelReload={handlePanelReload}
                              onPanelTitleChange={handlePanelTitleChange}
                              direction={feature.layout_direction || "horizontal"}
                              autoSaveId={feature.id}
                            />
                          </div>
                        ))}
                      </div>
                    </Panel>
                  </PanelGroup>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-muted-foreground mb-4">
                        No features yet
                      </p>
                      {isAddingFeature ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newFeatureName}
                            onChange={(e) => setNewFeatureName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleConfirmAddFeature();
                              if (e.key === "Escape") handleCancelAddFeature();
                            }}
                            placeholder="Feature name"
                            className="px-3 py-2 border border-border rounded-lg bg-card text-ink focus:outline-none focus:ring-2 focus:ring-primary"
                            autoFocus
                          />
                          <button
                            onClick={handleConfirmAddFeature}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                          >
                            Create
                          </button>
                          <button
                            onClick={handleCancelAddFeature}
                            className="px-4 py-2 text-muted-foreground hover:text-ink rounded-lg hover:bg-card-alt transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={handleStartAddFeature}
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                        >
                          Create First Feature
                        </button>
                      )}
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
