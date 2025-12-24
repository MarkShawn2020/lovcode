import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";

import { ProjectSidebar } from "./ProjectSidebar";
import { FeatureTabs } from "./FeatureTabs";
import { PanelGrid, SharedPanelZone } from "../../components/PanelGrid";
import type { PanelState } from "../../components/PanelGrid";
import type { WorkspaceData, WorkspaceProject, Feature, FeatureStatus, PanelState as StoredPanelState, SessionState as StoredSessionState } from "./types";

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

  // Archive project handler (hide but keep data)
  const handleArchiveProject = useCallback(
    (id: string) => {
      if (!workspace) return;

      const nonArchivedProjects = workspace.projects.filter((p) => p.id !== id && !p.archived);
      const newProjects = workspace.projects.map((p) =>
        p.id === id ? { ...p, archived: true } : p
      );
      saveWorkspace({
        ...workspace,
        projects: newProjects,
        active_project_id:
          workspace.active_project_id === id
            ? nonArchivedProjects[0]?.id
            : workspace.active_project_id,
      });
    },
    [workspace, saveWorkspace]
  );

  // Unarchive project handler
  const handleUnarchiveProject = useCallback(
    (id: string) => {
      if (!workspace) return;

      const newProjects = workspace.projects.map((p) =>
        p.id === id ? { ...p, archived: false } : p
      );
      saveWorkspace({
        ...workspace,
        projects: newProjects,
        active_project_id: id,
      });
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

  // Update feature status handler (completed = auto archive)
  const handleUpdateFeatureStatus = useCallback(
    (featureId: string, status: FeatureStatus, note?: string) => {
      if (!activeProject || !workspace) return;

      const shouldArchive = status === "completed";
      const nonArchivedFeatures = activeProject.features.filter(
        (f) => f.id !== featureId && !f.archived
      );

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) =>
            f.id === featureId
              ? {
                  ...f,
                  status,
                  archived: shouldArchive ? true : f.archived,
                  archived_note: shouldArchive ? note : f.archived_note,
                }
              : f
          ),
          active_feature_id:
            shouldArchive && p.active_feature_id === featureId
              ? nonArchivedFeatures[0]?.id
              : p.active_feature_id,
        };
      });
      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Archive feature handler (cancel without completing)
  const handleArchiveFeature = useCallback(
    (featureId: string, note?: string) => {
      if (!activeProject || !workspace) return;

      const nonArchivedFeatures = activeProject.features.filter(
        (f) => f.id !== featureId && !f.archived
      );

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) =>
            f.id === featureId ? { ...f, archived: true, archived_note: note } : f
          ),
          active_feature_id:
            p.active_feature_id === featureId
              ? nonArchivedFeatures[0]?.id
              : p.active_feature_id,
        };
      });
      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Unarchive feature handler (restore to tabs)
  const handleUnarchiveFeature = useCallback(
    (projectId: string, featureId: string) => {
      if (!workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          features: p.features.map((f) =>
            f.id === featureId ? { ...f, archived: false } : f
          ),
          active_feature_id: featureId,
        };
      });
      saveWorkspace({
        ...workspace,
        projects: newProjects,
        active_project_id: projectId,
      });
    },
    [workspace, saveWorkspace]
  );

  // Pin/unpin feature handler
  const handlePinFeature = useCallback(
    (featureId: string, pinned: boolean) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) =>
            f.id === featureId ? { ...f, pinned } : f
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

  // Add panel handler
  const handlePanelAdd = useCallback(
    (direction: "horizontal" | "vertical") => {
      if (!activeProject || !activeFeature || !workspace) return;

      const panelId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const ptyId = crypto.randomUUID();

      const newPanel: StoredPanelState = {
        id: panelId,
        sessions: [{ id: sessionId, pty_id: ptyId, title: "Terminal" }],
        active_session_id: sessionId,
        is_shared: false,
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
              panels: [...f.panels, newPanel],
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

      // Find the panel to get all its session pty_ids before removing
      const ptyIdsToKill: string[] = [];
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          ptyIdsToKill.push(...(panel.sessions || []).map((s) => s.pty_id));
          break;
        }
      }
      if (ptyIdsToKill.length === 0) {
        const sharedPanel = (activeProject.shared_panels || []).find((p) => p.id === panelId);
        if (sharedPanel) {
          ptyIdsToKill.push(...(sharedPanel.sessions || []).map((s) => s.pty_id));
        }
      }

      // Kill all PTY sessions
      for (const ptyId of ptyIdsToKill) {
        invoke("pty_kill", { id: ptyId }).catch(console.error);
      }

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.filter((panel) => panel.id !== panelId),
          })),
          shared_panels: (p.shared_panels || []).filter((panel) => panel.id !== panelId),
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
        const sharedPanels = p.shared_panels || [];
        const sharedIndex = sharedPanels.findIndex((panel) => panel.id === panelId);
        if (sharedIndex !== -1) {
          // Move from shared to active feature
          const panel = sharedPanels[sharedIndex];
          const newSharedPanels = sharedPanels.filter((_, i) => i !== sharedIndex);
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

  // Reload panel handler (kills active session's PTY and creates new one)
  const handlePanelReload = useCallback(
    (panelId: string) => {
      if (!activeProject || !workspace) return;

      // Find the panel and its active session
      let activeSessionId: string | null = null;
      let oldPtyId: string | null = null;
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          activeSessionId = panel.active_session_id;
          const activeSession = (panel.sessions || []).find((s) => s.id === activeSessionId);
          if (activeSession) oldPtyId = activeSession.pty_id;
          break;
        }
      }
      if (!oldPtyId) {
        const sharedPanel = (activeProject.shared_panels || []).find((p) => p.id === panelId);
        if (sharedPanel) {
          activeSessionId = sharedPanel.active_session_id;
          const activeSession = (sharedPanel.sessions || []).find((s) => s.id === activeSessionId);
          if (activeSession) oldPtyId = activeSession.pty_id;
        }
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
              panel.id === panelId
                ? {
                    ...panel,
                    sessions: (panel.sessions || []).map((s) =>
                      s.id === activeSessionId ? { ...s, pty_id: newPtyId } : s
                    ),
                  }
                : panel
            ),
          })),
          shared_panels: (p.shared_panels || []).map((panel) =>
            panel.id === panelId
              ? {
                  ...panel,
                  sessions: (panel.sessions || []).map((s) =>
                    s.id === activeSessionId ? { ...s, pty_id: newPtyId } : s
                  ),
                }
              : panel
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

  // Add session to panel handler
  const handleSessionAdd = useCallback(
    (panelId: string) => {
      if (!activeProject || !workspace) return;

      const sessionId = crypto.randomUUID();
      const ptyId = crypto.randomUUID();
      const newSession: StoredSessionState = { id: sessionId, pty_id: ptyId, title: "Terminal" };

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.map((panel) =>
              panel.id === panelId
                ? { ...panel, sessions: [...(panel.sessions || []), newSession], active_session_id: sessionId }
                : panel
            ),
          })),
          shared_panels: (p.shared_panels || []).map((panel) =>
            panel.id === panelId
              ? { ...panel, sessions: [...(panel.sessions || []), newSession], active_session_id: sessionId }
              : panel
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

  // Close session handler
  const handleSessionClose = useCallback(
    (panelId: string, sessionId: string) => {
      if (!activeProject || !workspace) return;

      // Find and kill the PTY session
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          const session = (panel.sessions || []).find((s) => s.id === sessionId);
          if (session) invoke("pty_kill", { id: session.pty_id }).catch(console.error);
          break;
        }
      }
      const sharedPanel = (activeProject.shared_panels || []).find((p) => p.id === panelId);
      if (sharedPanel) {
        const session = (sharedPanel.sessions || []).find((s) => s.id === sessionId);
        if (session) invoke("pty_kill", { id: session.pty_id }).catch(console.error);
      }

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.map((panel) => {
              if (panel.id !== panelId) return panel;
              const newSessions = (panel.sessions || []).filter((s) => s.id !== sessionId);
              const newActiveId = panel.active_session_id === sessionId
                ? newSessions[0]?.id || ""
                : panel.active_session_id;
              return { ...panel, sessions: newSessions, active_session_id: newActiveId };
            }),
          })),
          shared_panels: (p.shared_panels || []).map((panel) => {
            if (panel.id !== panelId) return panel;
            const newSessions = (panel.sessions || []).filter((s) => s.id !== sessionId);
            const newActiveId = panel.active_session_id === sessionId
              ? newSessions[0]?.id || ""
              : panel.active_session_id;
            return { ...panel, sessions: newSessions, active_session_id: newActiveId };
          }),
        };
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Select session handler
  const handleSessionSelect = useCallback(
    (panelId: string, sessionId: string) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.map((panel) =>
              panel.id === panelId ? { ...panel, active_session_id: sessionId } : panel
            ),
          })),
          shared_panels: (p.shared_panels || []).map((panel) =>
            panel.id === panelId ? { ...panel, active_session_id: sessionId } : panel
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

  // Session title change handler
  const handleSessionTitleChange = useCallback(
    (panelId: string, sessionId: string, title: string) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.map((panel) =>
              panel.id === panelId
                ? {
                    ...panel,
                    sessions: (panel.sessions || []).map((s) =>
                      s.id === sessionId ? { ...s, title } : s
                    ),
                  }
                : panel
            ),
          })),
          shared_panels: (p.shared_panels || []).map((panel) =>
            panel.id === panelId
              ? {
                  ...panel,
                  sessions: (panel.sessions || []).map((s) =>
                    s.id === sessionId ? { ...s, title } : s
                  ),
                }
              : panel
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
          sessions: (p.sessions || []).map((s) => ({
            id: s.id,
            ptyId: s.pty_id,
            title: s.title,
            command: s.command,
          })),
          activeSessionId: p.active_session_id,
          isShared: p.is_shared,
          cwd: activeProject?.path || "",
        }))
      );
    });
    return map;
  }, [activeProject?.features, activeProject?.path]);

  const sharedPanels = useMemo<PanelState[]>(
    () =>
      (activeProject?.shared_panels || []).map((p) => ({
        id: p.id,
        sessions: (p.sessions || []).map((s) => ({
          id: s.id,
          ptyId: s.pty_id,
          title: s.title,
          command: s.command,
        })),
        activeSessionId: p.active_session_id,
        isShared: true,
        cwd: activeProject?.path || "",
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
          onArchiveProject={handleArchiveProject}
          onUnarchiveProject={handleUnarchiveProject}
          onUnarchiveFeature={handleUnarchiveFeature}
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
                onUpdateFeatureStatus={handleUpdateFeatureStatus}
                onArchiveFeature={handleArchiveFeature}
                onPinFeature={handlePinFeature}
                isAddingFeature={isAddingFeature}
                newFeatureName={newFeatureName}
                onNewFeatureNameChange={setNewFeatureName}
                onConfirmAddFeature={handleConfirmAddFeature}
                onCancelAddFeature={handleCancelAddFeature}
              />

              {/* Panel area */}
              <div className="flex-1 min-h-0 h-full">
                {activeFeature ? (
                  <PanelGroup orientation="horizontal" id={`workspace-${activeProject.id}`} className="h-full">
                    {/* Shared panels zone */}
                    {sharedPanels.length > 0 && (
                      <>
                        <Panel defaultSize={30} minSize={20}>
                          <SharedPanelZone
                            panels={sharedPanels}
                            onPanelClose={handlePanelClose}
                            onPanelToggleShared={handlePanelToggleShared}
                            onPanelReload={handlePanelReload}
                            onSessionAdd={handleSessionAdd}
                            onSessionClose={handleSessionClose}
                            onSessionSelect={handleSessionSelect}
                            onSessionTitleChange={handleSessionTitleChange}
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
                              onSessionAdd={handleSessionAdd}
                              onSessionClose={handleSessionClose}
                              onSessionSelect={handleSessionSelect}
                              onSessionTitleChange={handleSessionTitleChange}
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
