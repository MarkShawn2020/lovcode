export const EDITOR_TARGETS = [
  { id: "yoda", label: "Yoda" },
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
] as const;

export type EditorTargetId = (typeof EDITOR_TARGETS)[number]["id"];
