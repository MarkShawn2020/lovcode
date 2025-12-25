import { atomWithStorage } from "jotai/utils";

// FileTree 展开的目录路径集合
export const expandedPathsAtom = atomWithStorage<string[]>("lovcode:fileTree:expandedPaths", []);
