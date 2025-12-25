import { atomWithStorage } from "jotai/utils";

// 当前选中的文件路径
export const selectedFileAtom = atomWithStorage<string | null>("lovcode:selectedFile", null);

// FileViewer 的查看模式
export const fileViewModeAtom = atomWithStorage<"source" | "preview" | "split">("lovcode:fileViewer:viewMode", "preview");

// 当前激活的面板 ID
export const activePanelIdAtom = atomWithStorage<string | undefined>("lovcode:activePanelId", undefined);
