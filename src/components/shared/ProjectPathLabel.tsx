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
}

/** Single-line project-path label with a right-click menu aligned for folder paths. */
export function ProjectPathLabel({ path, className = "", menuItems }: ProjectPathLabelProps) {
  const { text, tooltip } = formatProjectPathLabel(path);

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 min-w-0 max-w-full cursor-default ${className}`}
          title={tooltip}
        >
          <FolderOpen className="w-3 h-3 opacity-60 shrink-0" />
          <span className="truncate min-w-0">{text}</span>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
        {menuItems ?? <ProjectPathMenuItems path={path} variant="context" />}
      </ContextMenuContent>
    </ContextMenu>
  );
}
