import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { listConnectors, type ConnectorInfo } from "@/lib/api";

/**
 * RootLayout.
 *
 * Top bar (44px, draggable region):
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  •••     │  drag drag drag drag drag        │  toolbar slot      │
 *   │  72px    │  flex-1 (data-tauri-drag-region) │  inline children   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Left 72px stays empty on macOS for traffic-light controls; the middle
 * region is a full drag handle; the right side accepts any inline
 * children for breadcrumbs, source chips, settings buttons, etc.
 */
export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      <TopBar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function TopBar() {
  const { pathname } = useLocation();
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);

  useEffect(() => {
    listConnectors().then(setConnectors).catch(() => {});
  }, []);

  const ready = connectors.filter((c) => c.state === "ready").length;
  const total = connectors.length;
  const breadcrumb = breadcrumbFor(pathname);

  return (
    <header className="relative flex h-11 shrink-0 items-stretch border-b border-paper-edge/80 bg-paper/95 backdrop-blur">
      {/* macOS traffic-light reserved space. */}
      <div className="w-[72px] shrink-0" aria-hidden />

      {/* Drag region — also where breadcrumbs live. */}
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center gap-3 px-3 text-[11px] uppercase tracking-[0.18em] text-ink-soft"
      >
        <span className="font-serif normal-case tracking-normal text-[13px] font-medium text-ink">
          Lovcode
        </span>
        <span className="h-3 w-px bg-paper-edge" aria-hidden />
        <span className="truncate">{breadcrumb}</span>
      </div>

      {/* Right toolbar slot — connector status pill + open imports. */}
      <div className="flex shrink-0 items-center gap-2 pr-3">
        <ConnectorPill ready={ready} total={total} />
      </div>
    </header>
  );
}

function ConnectorPill({ ready, total }: { ready: number; total: number }) {
  const color =
    ready === 0
      ? "bg-paper-deep text-ink-soft"
      : ready < total / 2
      ? "bg-ochre/30 text-ink"
      : "bg-cinnabar/15 text-cinnabar-deep";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest tabular ${color}`}
      title={`${ready} of ${total} connectors ready`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {ready}/{total}
    </span>
  );
}

function breadcrumbFor(path: string): string {
  if (path === "/" || path === "") return "Archive · search";
  if (path.startsWith("/conversation")) return "Archive · conversation";
  if (path.startsWith("/settings")) return "Archive · settings";
  return path.slice(1);
}
