import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { View } from "@/types";

// 当前选中的文件路径
export const selectedFileAtom = atomWithStorage<string | null>("lovcode:selectedFile", null);

// FileViewer 的查看模式
export const fileViewModeAtom = atomWithStorage<"source" | "preview" | "split">("lovcode:fileViewer:viewMode", "preview");

// 当前激活的面板 ID
export const activePanelIdAtom = atomWithStorage<string | undefined>("lovcode:activePanelId", undefined);

// 合并的导航状态 atom（解决 stale closure 问题）
interface NavigationState {
  history: View[];
  index: number;
}

export const navigationStateAtom = atomWithStorage<NavigationState>("lovcode:navigationState", {
  history: [{ type: "home" }],
  index: 0,
});

// 派生 atoms（保持兼容性）
// 使用 get/set 格式确保是 writable atom，避免 "not writable atom" 错误
export const viewAtom = atom(
  (get) => {
    const state = get(navigationStateAtom);
    return state.history[state.index] ?? { type: "home" };
  },
  (get, set, newView: View) => {
    const state = get(navigationStateAtom);
    const newHistory = state.history.slice(0, state.index + 1);
    newHistory.push(newView);
    let newIndex = state.index + 1;
    if (newHistory.length > 50) {
      newHistory.shift();
      newIndex = 49;
    }
    set(navigationStateAtom, { history: newHistory, index: newIndex });
  }
);

export const viewHistoryAtom = atom(
  (get) => get(navigationStateAtom).history,
  (_get, _set, _newHistory: View[]) => {
    // Read-only in practice, but provides setter to avoid "not writable atom" error
  }
);

export const historyIndexAtom = atom(
  (get) => get(navigationStateAtom).index,
  (get, set, newIndex: number) => {
    const state = get(navigationStateAtom);
    if (newIndex >= 0 && newIndex < state.history.length) {
      set(navigationStateAtom, { ...state, index: newIndex });
    }
  }
);
