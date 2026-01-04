import { useState } from "react";
import { useAtom } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { workspaceDataAtom } from "@/store";
import { useNavigate } from "@/hooks";
import type { WorkspaceProject, Feature, WorkspaceData } from "@/views/Workspace/types";

export function useFeatureCreation(project: WorkspaceProject) {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [nextSeq, setNextSeq] = useState(0);

  const openCreateDialog = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!workspace) return;
    setNextSeq((workspace.feature_counter ?? 0) + 1);
    setShowCreateDialog(true);
  };

  const createFeature = async (name: string, description: string) => {
    if (!workspace) return;

    try {
      const feature = await invoke<Feature>("workspace_create_feature", {
        projectId: project.id,
        name,
        description: description || undefined,
      });

      navigate({ type: "workspace", projectId: project.id, featureId: feature.id, mode: "terminal" });

      const newProjects = workspace.projects.map((p) =>
        p.id === project.id
          ? {
              ...p,
              features: [...p.features, feature],
              active_feature_id: feature.id,
              view_mode: "terminal" as const,
            }
          : p
      );

      const newWorkspace: WorkspaceData = {
        ...workspace,
        projects: newProjects,
        active_project_id: project.id,
        feature_counter: feature.seq,
      };

      setWorkspace(newWorkspace);
      await invoke("workspace_save", { data: newWorkspace });
    } catch (err) {
      console.error("Failed to create feature:", err);
    }
  };

  return {
    showCreateDialog,
    setShowCreateDialog,
    nextSeq,
    openCreateDialog,
    createFeature,
  };
}
