import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import { ProjectSidebar } from "./ProjectSidebar";
import { FeatureSidebar } from "./FeatureSidebar";
import { PanelGrid } from "../../components/PanelGrid";
import type { PanelState } from "../../components/PanelGrid";
import { disposeTerminal } from "../../components/Terminal";
import type { WorkspaceData, WorkspaceProject, Feature, FeatureStatus, PanelState as StoredPanelState, SessionState as StoredSessionState } from "./types";

export function WorkspaceView() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharedPanelCollapsed, setSharedPanelCollapsed] = useState(false);

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

  // Add new feature with auto-generated name
  const handleAddFeature = useCallback(async () => {
    if (!activeProject || !workspace) return;

    const counter = (activeProject.feature_counter ?? 0) + 1;
    const name = `#${counter}`;

    try {
      const feature = await invoke<Feature>("workspace_create_feature", {
        projectId: activeProject.id,
        name,
      });

      const newProjects = workspace.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              features: [...p.features, feature],
              active_feature_id: feature.id,
              feature_counter: counter,
            }
          : p
      );
      saveWorkspace({
        ...workspace,
        projects: newProjects,
      });
    } catch (err) {
      console.error("Failed to create feature:", err);
    }
  }, [activeProject, workspace, saveWorkspace]);

  // Rename feature
  const handleRenameFeature = useCallback(async (featureId: string, name: string) => {
    if (!activeProject || !workspace) return;

    try {
      await invoke("workspace_rename_feature", { featureId, name });
      const newProjects = workspace.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              features: p.features.map((f) =>
                f.id === featureId ? { ...f, name } : f
              ),
            }
          : p
      );
      saveWorkspace({ ...workspace, projects: newProjects });
    } catch (err) {
      console.error("Failed to rename feature:", err);
    }
  }, [activeProject, workspace, saveWorkspace]);

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

  // Add pinned panel handler
  const handleAddPinnedPanel = useCallback(() => {
    if (!activeProject || !workspace) return;

    const panelId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const ptyId = crypto.randomUUID();

    const newPanel: StoredPanelState = {
      id: panelId,
      sessions: [{ id: sessionId, pty_id: ptyId, title: "Pinned" }],
      active_session_id: sessionId,
      is_shared: true,
      cwd: activeProject.path,
    };

    const newProjects = workspace.projects.map((p) => {
      if (p.id !== activeProject.id) return p;
      return {
        ...p,
        shared_panels: [...(p.shared_panels || []), newPanel],
      };
    });

    saveWorkspace({
      ...workspace,
      projects: newProjects,
    });
  }, [activeProject, workspace, saveWorkspace]);

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

      // Kill all PTY sessions and dispose terminal instances
      for (const ptyId of ptyIdsToKill) {
        disposeTerminal(ptyId);
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
    },
    [activeProject, activeFeature, workspace, saveWorkspace]
  );

  // Close session handler
  const handleSessionClose = useCallback(
    (panelId: string, sessionId: string) => {
      if (!activeProject || !workspace) return;

      // Find and kill the PTY session, dispose terminal instance
      for (const feature of activeProject.features) {
        const panel = feature.panels.find((p) => p.id === panelId);
        if (panel) {
          const session = (panel.sessions || []).find((s) => s.id === sessionId);
          if (session) {
            disposeTerminal(session.pty_id);
            invoke("pty_kill", { id: session.pty_id }).catch(console.error);
          }
          break;
        }
      }
      const sharedPanel = (activeProject.shared_panels || []).find((p) => p.id === panelId);
      if (sharedPanel) {
        const session = (sharedPanel.sessions || []).find((s) => s.id === sessionId);
        if (session) {
          disposeTerminal(session.pty_id);
          invoke("pty_kill", { id: session.pty_id }).catch(console.error);
        }
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

  // Same caching pattern for shared panels
  const sharedSessionCacheRef = useRef(new Map<string, { id: string; ptyId: string; title: string; command?: string }>());

  const sharedPanels = useMemo<PanelState[]>(() => {
    const cache = sharedSessionCacheRef.current;
    const usedSessionIds = new Set<string>();

    const result = (activeProject?.shared_panels || []).map((p) => ({
      id: p.id,
      sessions: (p.sessions || []).map((s) => {
        usedSessionIds.add(s.id);
        const cached = cache.get(s.id);
        if (cached && cached.ptyId === s.pty_id) {
          cached.title = s.title;
          cached.command = s.command;
          return cached;
        }
        const session = { id: s.id, ptyId: s.pty_id, title: s.title, command: s.command };
        cache.set(s.id, session);
        return session;
      }),
      activeSessionId: p.active_session_id,
      isShared: true,
      cwd: activeProject?.path || "",
    }));

    for (const id of cache.keys()) {
      if (!usedSessionIds.has(id)) cache.delete(id);
    }

    return result;
  }, [activeProject?.shared_panels, activeProject?.path]);

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
          activeFeatureId={activeProject?.active_feature_id}
          onSelectProject={handleSelectProject}
          onSelectFeature={(projectId, featureId) => {
            if (!workspace) return;
            const newProjects = workspace.projects.map((p) =>
              p.id === projectId ? { ...p, active_feature_id: featureId } : p
            );
            saveWorkspace({
              ...workspace,
              projects: newProjects,
              active_project_id: projectId,
            });
          }}
          onAddProject={handleAddProject}
          onArchiveProject={handleArchiveProject}
          onUnarchiveProject={handleUnarchiveProject}
          onUnarchiveFeature={handleUnarchiveFeature}
        />

        {/* Main content area */}
        <div className="flex-1 flex min-w-0">
          {activeProject ? (
            <>
              {/* Feature sidebar with pinned sessions */}
              <FeatureSidebar
                projectName={activeProject.name}
                features={activeProject.features}
                activeFeatureId={activeProject.active_feature_id}
                onSelectFeature={handleSelectFeature}
                onAddFeature={handleAddFeature}
                onRenameFeature={handleRenameFeature}
                onUpdateFeatureStatus={handleUpdateFeatureStatus}
                onArchiveFeature={handleArchiveFeature}
                onPinFeature={handlePinFeature}
                pinnedPanels={sharedPanels}
                onAddPinnedPanel={handleAddPinnedPanel}
                onPanelClose={handlePanelClose}
                onPanelToggleShared={handlePanelToggleShared}
                onPanelReload={handlePanelReload}
                onSessionAdd={handleSessionAdd}
                onSessionClose={handleSessionClose}
                onSessionSelect={handleSessionSelect}
                onSessionTitleChange={handleSessionTitleChange}
                collapsed={sharedPanelCollapsed}
                onCollapsedChange={setSharedPanelCollapsed}
              />

              {/* Feature panels area */}
              <div className="flex-1 min-w-0 h-full">
                {activeFeature ? (
                  <div className="h-full relative">
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
                            onPanelClose={handlePanelClose}
                            onPanelAdd={handlePanelAdd}
                            onPanelToggleShared={handlePanelToggleShared}
                            onPanelReload={handlePanelReload}
                            onSessionAdd={handleSessionAdd}
                            onSessionClose={handleSessionClose}
                            onSessionSelect={handleSessionSelect}
                            onSessionTitleChange={handleSessionTitleChange}
                            direction={feature.layout_direction || "horizontal"}
                          />
                        </div>
                      );
                    })}
                  </div>
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
