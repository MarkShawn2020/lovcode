import { atomWithStorage } from "jotai/utils";

export type ComposerSubmitShortcut = "enter" | "mod-enter";

export const composerSubmitShortcutAtom = atomWithStorage<ComposerSubmitShortcut>(
  "lovcode:settings:composerSubmitShortcut",
  "enter",
);
