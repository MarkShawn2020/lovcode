import { useCallback } from "react";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { Cross2Icon, PlusIcon, RowsIcon, ColumnsIcon, PinLeftIcon } from "@radix-ui/react-icons";
import { TerminalPane } from "../Terminal";

export interface PanelState {
  id: string;
  ptyId: string;
  title: string;
  isShared: boolean;
  cwd: string;
}

export interface PanelGridProps {
  /** List of panels to render */
  panels: PanelState[];
  /** Callback when a panel is closed */
  onPanelClose: (id: string) => void;
  /** Callback when a new panel is requested */
  onPanelAdd: (direction: "horizontal" | "vertical") => void;
  /** Callback when panel shared state is toggled */
  onPanelToggleShared: (id: string) => void;
  /** Callback when panel title changes */
  onPanelTitleChange: (id: string, title: string) => void;
  /** Layout direction */
  direction?: "horizontal" | "vertical";
  /** Auto save ID for persisting layout */
  autoSaveId?: string;
}

export function PanelGrid({
  panels,
  onPanelClose,
  onPanelAdd,
  onPanelToggleShared,
  onPanelTitleChange,
  direction = "horizontal",
  autoSaveId,
}: PanelGridProps) {
  const handleTitleChange = useCallback(
    (panelId: string) => (title: string) => {
      onPanelTitleChange(panelId, title);
    },
    [onPanelTitleChange]
  );

  if (panels.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-canvas">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No terminals open</p>
          <button
            onClick={() => onPanelAdd("horizontal")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            New Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <PanelGroup
      orientation={direction}
      id={autoSaveId}
      className="h-full"
    >
      {panels.map((panel, index) => (
        <div key={panel.id} className="contents">
          {index > 0 && (
            <PanelResizeHandle
              className={`${
                direction === "horizontal" ? "w-1" : "h-1"
              } bg-border hover:bg-primary/50 transition-colors`}
            />
          )}
          <Panel minSize={10} defaultSize={100 / panels.length}>
            <div className="h-full flex flex-col bg-[#1a1a1a] border border-border rounded-lg overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border">
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {panel.title || "Terminal"}
                </span>
                <div className="flex items-center gap-1">
                  {/* Toggle shared */}
                  <button
                    onClick={() => onPanelToggleShared(panel.id)}
                    className={`p-1 rounded hover:bg-card-alt transition-colors ${
                      panel.isShared ? "text-primary" : "text-muted-foreground"
                    }`}
                    title={panel.isShared ? "Unpin from shared" : "Pin to shared"}
                  >
                    <PinLeftIcon className="w-3.5 h-3.5" />
                  </button>
                  {/* Split horizontal */}
                  <button
                    onClick={() => onPanelAdd("horizontal")}
                    className="p-1 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                    title="Split horizontally"
                  >
                    <ColumnsIcon className="w-3.5 h-3.5" />
                  </button>
                  {/* Split vertical */}
                  <button
                    onClick={() => onPanelAdd("vertical")}
                    className="p-1 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                    title="Split vertically"
                  >
                    <RowsIcon className="w-3.5 h-3.5" />
                  </button>
                  {/* Close */}
                  <button
                    onClick={() => onPanelClose(panel.id)}
                    className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-card-alt transition-colors"
                    title="Close terminal"
                  >
                    <Cross2Icon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {/* Terminal */}
              <div className="flex-1 min-h-0">
                <TerminalPane
                  ptyId={panel.ptyId}
                  cwd={panel.cwd}
                  onTitleChange={handleTitleChange(panel.id)}
                />
              </div>
            </div>
          </Panel>
        </div>
      ))}
    </PanelGroup>
  );
}

/** Shared panels zone - fixed left area */
export interface SharedPanelZoneProps {
  panels: PanelState[];
  onPanelClose: (id: string) => void;
  onPanelToggleShared: (id: string) => void;
  onPanelTitleChange: (id: string, title: string) => void;
}

export function SharedPanelZone({
  panels,
  onPanelClose,
  onPanelToggleShared,
  onPanelTitleChange,
}: SharedPanelZoneProps) {
  const handleTitleChange = useCallback(
    (panelId: string) => (title: string) => {
      onPanelTitleChange(panelId, title);
    },
    [onPanelTitleChange]
  );

  if (panels.length === 0) {
    return null;
  }

  return (
    <div className="h-full flex flex-col gap-1 p-1">
      {panels.map((panel) => (
        <div
          key={panel.id}
          className="flex-1 min-h-0 flex flex-col bg-[#1a1a1a] border border-border rounded-lg overflow-hidden"
        >
          {/* Panel header */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border">
            <PinLeftIcon className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs text-muted-foreground truncate flex-1">
              {panel.title || "Shared"}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPanelToggleShared(panel.id)}
                className="p-1 rounded text-primary hover:bg-card-alt transition-colors"
                title="Unpin from shared"
              >
                <PinLeftIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onPanelClose(panel.id)}
                className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-card-alt transition-colors"
                title="Close terminal"
              >
                <Cross2Icon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {/* Terminal */}
          <div className="flex-1 min-h-0">
            <TerminalPane
              ptyId={panel.ptyId}
              cwd={panel.cwd}
              onTitleChange={handleTitleChange(panel.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
