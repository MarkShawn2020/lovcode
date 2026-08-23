function pathSegments(path: string) {
  return path.split(/[\\/]/).filter(Boolean);
}

export function projectLabel(projectPath: string | null | undefined, fallbackId: string) {
  const path = projectPath?.trim();
  if (!path) return fallbackId;

  const segments = pathSegments(path);
  const leaf = segments.at(-1) ?? path;
  const worktreesIndex = segments.lastIndexOf(".worktrees");

  if (worktreesIndex > 0 && worktreesIndex < segments.length - 1) {
    return `${segments[worktreesIndex - 1]}（${leaf}）`;
  }

  const externalWorktreesIndex = segments.lastIndexOf("worktrees");
  if (externalWorktreesIndex >= 0 && externalWorktreesIndex < segments.length - 1) {
    const projectName = segments.length - externalWorktreesIndex > 2
      ? segments.at(-2)
      : segments[externalWorktreesIndex - 1];
    if (projectName) return `${projectName}（${leaf}）`;
  }

  return leaf;
}
