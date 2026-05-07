import { atomWithStorage } from "jotai/utils";
import type { TemplateCategory } from "@/types";

// 全局侧边栏折叠状态
export const sidebarCollapsedAtom = atomWithStorage("lovcode:layoutSidebarCollapsed", false);

// Marketplace 分类
export const marketplaceCategoryAtom = atomWithStorage<TemplateCategory>("lovcode:marketplaceCategory", "commands");

// 路径缩短显示
export const shortenPathsAtom = atomWithStorage("lovcode:shortenPaths", true);
