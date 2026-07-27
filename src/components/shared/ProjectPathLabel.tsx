import type { ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { ProjectPathMenuItems } from "./ProjectPathMenuItems";

/** Strip Claude worktree suffix (`.../.claude/worktrees/<slug>`) from a path.
 *  Returns {origin, worktreeName} when detected, otherwise {origin: path, worktreeName: null}. */
export function parseWorktreePath(path: string): { origin: string; worktreeName: string | null } {
  const m = path.match(/^(.*?)\/\.claude\/worktrees\/([^/]+)\/?$/);
  if (!m) return { origin: path, worktreeName: null };
  return { origin: m[1], worktreeName: m[2] };
}

/** Display label for a project path: just the origin `basename` (worktree suffix stripped). */
export function formatProjectPathLabel(path: string): { text: string; tooltip: string } {
  const { origin } = parseWorktreePath(path);
  const parts = origin.split("/").filter(Boolean);
  const text = parts[parts.length - 1] ?? origin;
  return { text, tooltip: path };
}

interface ProjectPathLabelProps {
  path: string;
  className?: string;
  menuItems?: ReactNode;
  onClick?: (path: string) => void;
}

/** Single-line project-path label with a right-click menu aligned for folder paths. */
export function ProjectPathLabel({ path, className = "", menuItems, onClick }: ProjectPathLabelProps) {
  const { text, tooltip } = formatProjectPathLabel(path);
  const content = onClick ? (
    <button
      type="button"
      className={`inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 text-left transition-colors hover:text-foreground ${className}`}
      title={tooltip}
      onClick={() => onClick(path)}
    >
      <FolderOpen className="h-3 w-3 shrink-0 opacity-60" />
      <span className="min-w-0 truncate">{text}</span>
    </button>
  ) : (
    <span
      className={`inline-flex min-w-0 max-w-full cursor-default items-center gap-1 ${className}`}
      title={tooltip}
    >
      <FolderOpen className="h-3 w-3 shrink-0 opacity-60" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        {content}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
        {menuItems ?? <ProjectPathMenuItems path={path} variant="context" />}
      </ContextMenuContent>
    </ContextMenu>
  );
}
