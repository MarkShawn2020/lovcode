import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ProjectPathLabel } from "./ProjectPathLabel";

interface SessionDetailHeaderProps {
  projectPath?: string | null;
  projectLabel?: ReactNode;
  projectPathMenuItems?: ReactNode;
  title: ReactNode;
  titlePrefix?: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  projectClassName?: string;
  onProjectClick?: (projectPath: string) => void;
}

export function SessionDetailHeader({
  projectPath,
  projectLabel,
  projectPathMenuItems,
  title,
  titlePrefix,
  badges,
  meta,
  actions,
  className,
  projectClassName,
  onProjectClick,
}: SessionDetailHeaderProps) {
  const hasProjectLabel = Boolean(projectPath || projectLabel);

  return (
    <header
      className={cn(
        "shrink-0 z-10 bg-background border-b border-border px-4 py-2.5 flex items-center justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0 flex flex-1 items-center gap-2 text-sm">
        {projectPath ? (
          <ProjectPathLabel
            path={projectPath}
            menuItems={projectPathMenuItems}
            onClick={onProjectClick}
            className={cn("max-w-[40%] text-muted-foreground", projectClassName)}
          />
        ) : projectLabel ? (
          <span className={cn("min-w-0 max-w-[40%] truncate text-muted-foreground", projectClassName)}>
            {projectLabel}
          </span>
        ) : null}
        {hasProjectLabel ? <span className="shrink-0 text-muted-foreground/50">/</span> : null}
        {titlePrefix}
        {title}
        {badges}
        {meta}
      </div>
      {actions ? (
        <div className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border border-border bg-card px-1 text-muted-foreground">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
