import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { WorkspaceData } from "@/views/Workspace/types";

// Primary feature for main nav (not affected by secondary nav like settings/marketplace from profile menu)
export const primaryFeatureAtom = atomWithStorage<string | null>("lovcode:primaryFeature", null);

// Workspace data (shared between App.tsx and WorkspaceView)
export const workspaceDataAtom = atom<WorkspaceData | null>(null);
export const workspaceLoadingAtom = atom<boolean>(true);
export const collapsedProjectGroupsAtom = atomWithStorage<string[]>("collapsed-project-groups", []);

// FeatureSidebar
export const featureSidebarExpandedPanelsAtom = atomWithStorage<string[]>("feature-sidebar-expanded-panels", []);
export const featureSidebarPinnedExpandedAtom = atomWithStorage("feature-sidebar-pinned-expanded", true);
export const featureSidebarFilesExpandedAtom = atomWithStorage("feature-sidebar-files-expanded", false);
