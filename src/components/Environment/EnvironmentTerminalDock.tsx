import { useEffect, useRef, useState, type PointerEvent } from "react";
import { invoke } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { PanelBottomClose, Square, Terminal, X } from "lucide-react";
import { TerminalPane } from "@/components/Terminal";
import { useI18n } from "@/i18n";

export interface EnvironmentTerminalSession {
  ptyId: string;
  cwd: string;
  command: string;
  title: string;
  subtitle: string;
  hidden: boolean;
  running: boolean;
}

interface PtyExitEvent {
  id: string;
}

interface EnvironmentTerminalDockProps {
  session: EnvironmentTerminalSession | null;
  onHide: () => void;
  onShow: () => void;
  onExit: () => void;
  onClose: () => void;
}

const TERMINAL_HEIGHT_DEFAULT = 300;
const TERMINAL_HEIGHT_MIN = 160;

export function EnvironmentTerminalDock({
  session,
  onHide,
  onShow,
  onExit,
  onClose,
}: EnvironmentTerminalDockProps) {
  const { t } = useI18n();
  const [height, setHeight] = useState(TERMINAL_HEIGHT_DEFAULT);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (!session) return;
    const unlisten = listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id === session.ptyId) onExit();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onExit, session]);

  if (!session) return null;

  const stop = () => {
    invoke("pty_kill", { id: session.ptyId }).catch(() => {});
    onExit();
  };

  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = { startY: event.clientY, startHeight: height };
  };

  const onResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const maxHeight = Math.max(TERMINAL_HEIGHT_MIN, Math.floor(window.innerHeight * 0.72));
    const nextHeight = Math.min(
      maxHeight,
      Math.max(TERMINAL_HEIGHT_MIN, dragState.startHeight + (dragState.startY - event.clientY)),
    );
    setHeight(nextHeight);
  };

  const onResizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    dragStateRef.current = null;
  };

  if (session.hidden) {
    return (
      <button
        type="button"
        onClick={onShow}
        className="absolute bottom-4 right-5 z-30 inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-card-alt"
        title={t("environment.showTerminal")}
      >
        <Terminal className="h-4 w-4 text-primary" />
        {session.running ? t("environment.running") : t("environment.terminal")}
      </button>
    );
  }

  return (
    <div className="absolute inset-x-4 bottom-4 z-30 overflow-hidden rounded-xl border border-border bg-terminal shadow-lg">
      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize transition-colors hover:bg-primary/40 active:bg-primary/60"
        title={t("environment.dragToResize")}
      />
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{session.title}</div>
            <div className="truncate font-mono text-xs text-muted-foreground" title={session.subtitle}>
              {session.subtitle}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {session.running && (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
              title={t("environment.stop")}
              aria-label={t("environment.stop")}
            >
              <Square className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onHide}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
            title={t("environment.hideTerminal")}
            aria-label={t("environment.hideTerminal")}
          >
            <PanelBottomClose className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
            title={t("environment.closeTerminal")}
            aria-label={t("environment.closeTerminal")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div style={{ height }}>
        <TerminalPane
          ptyId={session.ptyId}
          cwd={session.cwd}
          command={session.command}
          visible
          autoFocus
          fallbackToShellOnCommandExit={false}
          restoreOnly={!session.running}
          onExit={onExit}
        />
      </div>
    </div>
  );
}
