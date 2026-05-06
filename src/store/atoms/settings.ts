import { atomWithStorage } from "jotai/utils";

export type ComposerSubmitShortcut = "enter" | "mod-enter";

// When true, register CmdOrCtrl+K as a system-level shortcut so the chat
// search modal can be opened even while the app is in the background.
export const globalChatSearchHotkeyAtom = atomWithStorage<boolean>(
  "lovcode:settings:globalChatSearchHotkey",
  false,
);

export const composerSubmitShortcutAtom = atomWithStorage<ComposerSubmitShortcut>(
  "lovcode:settings:composerSubmitShortcut",
  "enter",
);
