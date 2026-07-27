export interface WorkspaceConversationRouteSelection {
  projectId?: string | null;
  projectPath?: string | null;
  sessionId: string;
}

const CONVERSATION_TARGET_PARAMS = ["messageId", "lineNumber", "roundIndex", "q"] as const;

export function updateWorkspaceConversationRoute(
  current: URLSearchParams,
  selection: WorkspaceConversationRouteSelection,
) {
  const next = new URLSearchParams(current);

  if (selection.projectId) next.set("projectId", selection.projectId);
  else next.delete("projectId");

  if (selection.projectPath) next.set("projectPath", selection.projectPath);
  else next.delete("projectPath");

  next.set("sessionId", selection.sessionId);
  CONVERSATION_TARGET_PARAMS.forEach((param) => next.delete(param));
  return next;
}
