import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function traceCardContainerClass(expanded: boolean) {
  return expanded
    ? "my-1 overflow-hidden rounded-lg border border-border bg-card-alt/70"
    : "my-0.5 overflow-hidden rounded-lg border border-transparent bg-transparent transition-colors hover:border-border/60 hover:bg-card-alt/40";
}

export function traceCardTriggerClass(expanded: boolean) {
  return `flex w-full min-w-0 items-center gap-1.5 text-left hover:bg-card-alt/60 ${
    expanded ? "px-3 py-2" : "px-1.5 py-1"
  }`;
}

export function TraceIconSlot({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
      {children}
    </span>
  );
}

export function TraceMetaPill({ icon, label }: { icon: ReactNode; label: string }) {
  if (!label) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

export function TraceChevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  );
}
