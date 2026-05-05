import { atomWithStorage } from "jotai/utils";

// SourceView (per source-id, dir paths that are expanded)
export const sourceExpandedDirsAtom = atomWithStorage<Record<string, string[]>>(
  "lovcode:source:expandedDirs",
  {}
);
