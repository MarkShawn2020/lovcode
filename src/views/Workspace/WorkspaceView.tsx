import { useEffect, useCallback, useMemo, useRef } from "react";
import { useAtom } from "jotai";
import { activePanelIdAtom, workspaceDataAtom, workspaceLoadingAtom, viewAtom } from "@/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { ProjectHomeView } from "./ProjectHomeView";
import { ProjectDashboard } from "./ProjectDashboard";
import { PanelGrid } from "../../components/PanelGrid";
import type { PanelState } from "../../components/PanelGrid";
import { disposeTerminal } from "../../components/Terminal";
import type { WorkspaceData, WorkspaceProject, Feature, FeatureStatus, PanelState as StoredPanelState, SessionState as StoredSessionState, LayoutNode } from "./types";

export function WorkspaceView() {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const [loading, setLoading] = useAtom(workspaceLoadingAtom);
  const [activePanelId, setActivePanelId] = useAtom(activePanelIdAtom);
  const [view] = useAtom(viewAtom);

  // Sync workspace state from View params (for back/forward navigation)
  useEffect(() => {
    if (view.type !== "workspace" || !workspace) return;

    const { projectId, featureId, mode } = view;
    if (!projectId && !featureId && !mode) return;

    // Check if we need to update
    const currentProject = workspace.projects.find(p => p.id === workspace.active_project_id);
    const needsUpdate =
      (projectId && workspace.active_project_id !== projectId) ||
      (featureId && currentProject?.active_feature_id !== featureId) ||
      (mode && currentProject?.view_mode !== mode);

    if (!needsUpdate) return;

    const newProjects = workspace.projects.map(p => {
      if (projectId && p.id === projectId) {
        return {
          ...p,
          ...(featureId && { active_feature_id: featureId }),
          ...(mode && { view_mode: mode }),
        };
      }
      return p;
    });

    const newWorkspace = {
      ...workspace,
      projects: newProjects,
      ...(projectId && { active_project_id: projectId }),
    };

    setWorkspace(newWorkspace);
    invoke("workspace_save", { data: newWorkspace }).catch(console.error);
  }, [view, workspace]);

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


  // Add new feature with auto-generated name
  const handleAddFeature = useCallback(async (projectId?: string) => {
    if (!workspace) return;
    const targetProject = projectId
      ? workspace.projects.find(p => p.id === projectId)
      : activeProject;
    if (!targetProject) return;

    // Generate name based on global counter (backend will assign actual seq)
    const counter = (workspace.feature_counter ?? 0) + 1;
    const name = `#${counter}`;

    try {
      // Backend handles seq and feature_counter atomically (global)
      const feature = await invoke<Feature>("workspace_create_feature", {
        projectId: targetProject.id,
        name,
      });

      const newProjects = workspace.projects.map((p) =>
        p.id === targetProject.id
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
        active_project_id: targetProject.id,
        feature_counter: feature.seq,
      });
      return { featureId: feature.id, featureName: feature.name };
    } catch (err) {
      console.error("Failed to create feature:", err);
      return undefined;
    }
  }, [activeProject, workspace, saveWorkspace]);

  // Update feature status from dashboard (no auto-archive)
  const handleDashboardFeatureStatusChange = useCallback(
    (featureId: string, status: FeatureStatus) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) =>
            f.id === featureId ? { ...f, status } : f
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

  // Select feature from dashboard and switch to features view
  const handleDashboardFeatureClick = useCallback(
    (featureId: string) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) =>
        p.id === activeProject.id
          ? { ...p, active_feature_id: featureId, view_mode: "features" as const }
          : p
      );
      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Unarchive feature from dashboard
  const handleUnarchiveFeature = useCallback(
    (featureId: string) => {
      if (!activeProject || !workspace) return;

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) =>
            f.id === featureId ? { ...f, archived: false } : f
          ),
          active_feature_id: featureId,
          view_mode: "features" as const,
        };
      });
      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace]
  );

  // Layout tree utilities
  const splitLayoutNode = useCallback(
    (node: LayoutNode, targetPanelId: string, direction: "horizontal" | "vertical", newPanelId: string): LayoutNode => {
      if (node.type === "panel") {
        if (node.panelId === targetPanelId) {
          // Found the target - replace with split node
          return {
            type: "split",
            direction,
            first: node,
            second: { type: "panel", panelId: newPanelId },
          };
        }
        return node;
      }
      // Recurse into split node
      return {
        ...node,
        first: splitLayoutNode(node.first, targetPanelId, direction, newPanelId),
        second: splitLayoutNode(node.second, targetPanelId, direction, newPanelId),
      };
    },
    []
  );

  const removeFromLayout = useCallback(
    (node: LayoutNode, targetPanelId: string): LayoutNode | null => {
      if (node.type === "panel") {
        return node.panelId === targetPanelId ? null : node;
      }
      const first = removeFromLayout(node.first, targetPanelId);
      const second = removeFromLayout(node.second, targetPanelId);
      if (!first && !second) return null;
      if (!first) return second;
      if (!second) return first;
      return { ...node, first, second };
    },
    []
  );

  // Split panel handler (tmux-style)
  const handlePanelSplit = useCallback(
    (targetPanelId: string, direction: "horizontal" | "vertical") => {
      if (!activeProject || !activeFeature || !workspace) return;

      const panelId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const ptyId = crypto.randomUUID();

      const newPanel: StoredPanelState = {
        id: panelId,
        sessions: [{ id: sessionId, pty_id: ptyId, title: `${activeFeature.name} - ${activeFeature.panels.length + 1}` }],
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

            // Get or create layout tree
            let currentLayout = f.layout;
            if (!currentLayout) {
              // Migrate from flat panels to tree layout
              if (f.panels.length === 0) {
                currentLayout = { type: "panel", panelId: targetPanelId };
              } else if (f.panels.length === 1) {
                currentLayout = { type: "panel", panelId: f.panels[0].id };
              } else {
                // Build initial layout from existing panels using legacy direction
                const dir = f.layout_direction || "horizontal";
                currentLayout = f.panels.slice(1).reduce<LayoutNode>(
                  (acc, panel) => ({
                    type: "split",
                    direction: dir,
                    first: acc,
                    second: { type: "panel", panelId: panel.id },
                  }),
                  { type: "panel", panelId: f.panels[0].id }
                );
              }
            }

            // Split the target panel
            const newLayout = splitLayoutNode(currentLayout, targetPanelId, direction, panelId);

            return {
              ...f,
              panels: [...f.panels, newPanel],
              layout: newLayout,
            };
          }),
        };
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });

      // Focus the new panel
      setActivePanelId(panelId);
    },
    [activeProject, activeFeature, workspace, saveWorkspace, splitLayoutNode, setActivePanelId]
  );

  // Create initial panel (when feature has no panels)
  const handleInitialPanelCreate = useCallback(() => {
    if (!activeProject || !activeFeature || !workspace) return;

    const panelId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const ptyId = crypto.randomUUID();

    const newPanel: StoredPanelState = {
      id: panelId,
      sessions: [{ id: sessionId, pty_id: ptyId, title: `${activeFeature.name} - 1` }],
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
          const layout: LayoutNode = { type: "panel", panelId };
          return {
            ...f,
            panels: [newPanel],
            layout,
          };
        }),
      };
    });

    saveWorkspace({
      ...workspace,
      projects: newProjects,
    });

    // Focus the new panel
    setActivePanelId(panelId);
  }, [activeProject, activeFeature, workspace, saveWorkspace, setActivePanelId]);

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

      // Kill all PTY sessions, dispose terminal instances, and purge scrollback
      for (const ptyId of ptyIdsToKill) {
        disposeTerminal(ptyId);
        invoke("pty_kill", { id: ptyId }).catch(console.error);
        invoke("pty_purge_scrollback", { id: ptyId }).catch(console.error);
      }

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => {
            const newPanels = f.panels.filter((panel) => panel.id !== panelId);
            // Update layout tree
            const newLayout = f.layout ? removeFromLayout(f.layout, panelId) : undefined;
            return {
              ...f,
              panels: newPanels,
              layout: newLayout ?? undefined,
            };
          }),
          shared_panels: (p.shared_panels || []).filter((panel) => panel.id !== panelId),
        };
      });

      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    },
    [activeProject, workspace, saveWorkspace, removeFromLayout]
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
            // If feature has existing panels, merge sessions into the first one
            if (f.panels.length > 0) {
              const [firstPanel, ...restPanels] = f.panels;
              return {
                ...f,
                panels: [
                  {
                    ...firstPanel,
                    sessions: [...firstPanel.sessions, ...panel.sessions],
                    active_session_id: panel.sessions[0]?.id ?? firstPanel.active_session_id,
                  },
                  ...restPanels,
                ],
              };
            }
            // Otherwise create new panel
            return {
              ...f,
              panels: [{ ...panel, is_shared: false }],
            };
          });
          return { ...p, shared_panels: newSharedPanels, features: newFeatures };
        }

        // Check if panel is in a feature - only pin active session, not entire panel
        for (const feature of p.features) {
          const panelIndex = feature.panels.findIndex((panel) => panel.id === panelId);
          if (panelIndex !== -1) {
            const panel = feature.panels[panelIndex];
            const activeSessionId = panel.active_session_id;
            const activeSession = panel.sessions.find((s) => s.id === activeSessionId) || panel.sessions[0];

            if (!activeSession) return p;

            // Create new shared panel with only the active session
            const newSharedPanel = {
              id: crypto.randomUUID(),
              cwd: panel.cwd,
              sessions: [activeSession],
              active_session_id: activeSession.id,
              is_shared: true,
            };

            const newFeatures = p.features.map((f) => {
              if (f.id !== feature.id) return f;
              const remainingSessions = panel.sessions.filter((s) => s.id !== activeSession.id);
              // If no sessions left, remove the panel
              if (remainingSessions.length === 0) {
                return {
                  ...f,
                  panels: f.panels.filter((_, i) => i !== panelIndex),
                };
              }
              // Otherwise keep panel with remaining sessions
              return {
                ...f,
                panels: f.panels.map((pl, i) =>
                  i !== panelIndex
                    ? pl
                    : {
                        ...pl,
                        sessions: remainingSessions,
                        active_session_id: remainingSessions[0].id,
                      }
                ),
              };
            });
            return {
              ...p,
              features: newFeatures,
              shared_panels: [...p.shared_panels, newSharedPanel],
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
        disposeTerminal(oldPtyId);
        invoke("pty_kill", { id: oldPtyId }).catch(console.error);
        // Purge old scrollback since we're creating a new ptyId
        invoke("pty_purge_scrollback", { id: oldPtyId }).catch(console.error);
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

      // Find the target panel to get existing session count
      let existingCount = 0;
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          existingCount = panel.sessions?.length || 0;
          break;
        }
      }
      if (existingCount === 0) {
        const sharedPanel = (activeProject.shared_panels || []).find((p) => p.id === panelId);
        if (sharedPanel) {
          existingCount = sharedPanel.sessions?.length || 0;
        }
      }

      const sessionId = crypto.randomUUID();
      const ptyId = crypto.randomUUID();
      const baseTitle = activeFeature?.name || "Terminal";
      const title = `${baseTitle} - ${existingCount + 1}`;
      const newSession: StoredSessionState = { id: sessionId, pty_id: ptyId, title };

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

      // Focus the panel with new session
      setActivePanelId(panelId);
    },
    [activeProject, activeFeature, workspace, saveWorkspace, setActivePanelId]
  );

  // Close session handler
  const handleSessionClose = useCallback(
    (panelId: string, sessionId: string) => {
      if (!activeProject || !workspace) return;

      // Find and kill the PTY session, dispose terminal instance, purge scrollback
      let ptyIdToPurge: string | null = null;
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          const session = (panel.sessions || []).find((s) => s.id === sessionId);
          if (session) {
            ptyIdToPurge = session.pty_id;
            disposeTerminal(session.pty_id);
            invoke("pty_kill", { id: session.pty_id }).catch(console.error);
          }
          break;
        }
      }
      if (!ptyIdToPurge) {
        const sharedPanel = (activeProject.shared_panels || []).find((p) => p.id === panelId);
        if (sharedPanel) {
          const session = (sharedPanel.sessions || []).find((s) => s.id === sessionId);
          if (session) {
            ptyIdToPurge = session.pty_id;
            disposeTerminal(session.pty_id);
            invoke("pty_kill", { id: session.pty_id }).catch(console.error);
          }
        }
      }
      // Purge scrollback file since this session is being closed
      if (ptyIdToPurge) {
        invoke("pty_purge_scrollback", { id: ptyIdToPurge }).catch(console.error);
      }

      // Helper: ensure at least one session exists after close
      const ensureSessions = (sessions: StoredSessionState[], closedId: string, featureName?: string): StoredSessionState[] => {
        const remaining = sessions.filter((s) => s.id !== closedId);
        if (remaining.length > 0) return remaining;
        // Create a fresh session when last one closes
        return [{ id: crypto.randomUUID(), pty_id: crypto.randomUUID(), title: featureName || "Terminal" }];
      };

      const newProjects = workspace.projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        return {
          ...p,
          features: p.features.map((f) => ({
            ...f,
            panels: f.panels.map((panel) => {
              if (panel.id !== panelId) return panel;
              const newSessions = ensureSessions(panel.sessions || [], sessionId, f.name);
              const newActiveId = panel.active_session_id === sessionId
                ? newSessions[0]?.id || ""
                : panel.active_session_id;
              return { ...panel, sessions: newSessions, active_session_id: newActiveId };
            }),
          })),
          shared_panels: (p.shared_panels || []).map((panel) => {
            if (panel.id !== panelId) return panel;
            const newSessions = ensureSessions(panel.sessions || [], sessionId);
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

      // Keep focus on the panel where session was closed
      setActivePanelId(panelId);
    },
    [activeProject, workspace, saveWorkspace, setActivePanelId]
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
  // Use refs to cache session objects and prevent unnecessary remounts
  const sessionCacheRef = useRef(new Map<string, { id: string; ptyId: string; title: string; command?: string }>());

  const allFeaturePanels = useMemo(() => {
    const map = new Map<string, PanelState[]>();
    const cache = sessionCacheRef.current;
    const usedSessionIds = new Set<string>();

    activeProject?.features.forEach((feature) => {
      map.set(
        feature.id,
        feature.panels.map((p) => ({
          id: p.id,
          sessions: (p.sessions || []).map((s) => {
            usedSessionIds.add(s.id);
            // Reuse cached session object if only ptyId matches (prevents remount)
            const cached = cache.get(s.id);
            if (cached && cached.ptyId === s.pty_id) {
              // Update mutable fields without creating new object
              cached.title = s.title;
              cached.command = s.command;
              return cached;
            }
            // Create and cache new session object
            const session = { id: s.id, ptyId: s.pty_id, title: s.title, command: s.command };
            cache.set(s.id, session);
            return session;
          }),
          activeSessionId: p.active_session_id,
          isShared: p.is_shared,
          cwd: activeProject?.path || "",
        }))
      );
    });

    // Clean up stale cache entries
    for (const id of cache.keys()) {
      if (!usedSessionIds.has(id)) cache.delete(id);
    }

    return map;
  }, [activeProject?.features, activeProject?.path]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas">
        <p className="text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-canvas">
      {activeProject ? (
        activeProject.view_mode === "dashboard" ? (
          <ProjectDashboard
            project={activeProject}
            onFeatureClick={handleDashboardFeatureClick}
            onFeatureStatusChange={handleDashboardFeatureStatusChange}
            onAddFeature={() => handleAddFeature(activeProject.id)}
            onUnarchiveFeature={handleUnarchiveFeature}
          />
        ) : activeProject.view_mode === "home" ? (
          <ProjectHomeView
            projectPath={activeProject.path}
            projectName={activeProject.name}
          />
        ) : activeFeature ? (
          <div className="flex-1 min-h-0 relative">
            {/* Render ALL features but hide inactive ones to keep PTY alive */}
            {activeProject?.features.map((feature) => {
              const isActive = feature.id === activeFeature.id;
              const featurePanels = allFeaturePanels.get(feature.id) || [];
              if (!isActive && featurePanels.length === 0) return null;
              return (
                <div
                  key={feature.id}
                  className={`absolute inset-0 ${
                    isActive ? "" : "invisible pointer-events-none"
                  }`}
                >
                  <PanelGrid
                    panels={featurePanels}
                    layout={feature.layout}
                    activePanelId={activePanelId}
                    onPanelFocus={setActivePanelId}
                    onPanelClose={handlePanelClose}
                    onPanelSplit={handlePanelSplit}
                    onPanelToggleShared={handlePanelToggleShared}
                    onPanelReload={handlePanelReload}
                    onSessionAdd={handleSessionAdd}
                    onSessionClose={handleSessionClose}
                    onSessionSelect={handleSessionSelect}
                    onSessionTitleChange={handleSessionTitleChange}
                    onInitialPanelCreate={handleInitialPanelCreate}
                    direction={feature.layout_direction || "horizontal"}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">No features yet</p>
              <button
                onClick={() => handleAddFeature(activeProject?.id)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Create First Feature
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="flex-1 flex items-center justify-center">
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
  );
}
