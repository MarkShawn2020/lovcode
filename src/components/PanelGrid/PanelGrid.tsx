import { useCallback, useEffect, useState } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { ChevronLeftIcon, ChevronRightIcon, DrawingPinFilledIcon } from "@radix-ui/react-icons";
import { SessionPanel } from "./SessionPanel";
import type { LayoutNode } from "../../views/Workspace/types";
import { NewTerminalSplitButton } from "../ui/new-terminal-button";

export interface SessionState {
  id: string;
  ptyId: string;
  title: string;
  command?: string;
}

export interface PanelState {
  id: string;
  sessions: SessionState[];
  activeSessionId: string;
  isShared: boolean;
  cwd: string;
}

export interface PanelGridProps {
  panels: PanelState[];
  layout?: LayoutNode;
  activePanelId?: string;
  onPanelFocus?: (id: string) => void;
  onPanelClose: (id: string) => void;
  /** Split a panel in the given direction (tmux-style) */
  onPanelSplit: (panelId: string, direction: "horizontal" | "vertical") => void;
  onPanelToggleShared: (id: string) => void;
  onPanelReload: (id: string) => void;
  onSessionAdd: (panelId: string) => void;
  onSessionClose: (panelId: string, sessionId: string) => void;
  onSessionSelect: (panelId: string, sessionId: string) => void;
  onSessionTitleChange: (panelId: string, sessionId: string, title: string) => void;
  /** @deprecated Use layout prop instead */
  direction?: "horizontal" | "vertical";
  /** Called when no panels exist and one should be created */
  onInitialPanelCreate?: (command?: string) => void;
}

/** Recursively render layout tree */
function LayoutRenderer({
  node,
  panels,
  activePanelId,
  onPanelFocus,
  onPanelClose,
  onPanelSplit,
  onPanelToggleShared,
  onPanelReload,
  onSessionAdd,
  onSessionClose,
  onSessionSelect,
  onSessionTitleChange,
}: {
  node: LayoutNode;
  panels: PanelState[];
  activePanelId?: string;
  onPanelFocus?: (id: string) => void;
  onPanelClose: (id: string) => void;
  onPanelSplit: (panelId: string, direction: "horizontal" | "vertical") => void;
  onPanelToggleShared: (id: string) => void;
  onPanelReload: (id: string) => void;
  onSessionAdd: (panelId: string) => void;
  onSessionClose: (panelId: string, sessionId: string) => void;
  onSessionSelect: (panelId: string, sessionId: string) => void;
  onSessionTitleChange: (panelId: string, sessionId: string, title: string) => void;
}) {
  if (node.type === "panel") {
    const panel = panels.find((p) => p.id === node.panelId);
    if (!panel) return null;
    const isActive = activePanelId === panel.id;

    return (
      <div
        className="h-full w-full flex flex-col bg-terminal border border-border overflow-hidden"
        onMouseDown={() => onPanelFocus?.(panel.id)}
      >
        <SessionPanel
          isActive={isActive}
          panel={panel}
          showSplitActions
          onPanelSplit={(dir) => onPanelSplit(panel.id, dir)}
          onPanelClose={() => onPanelClose(panel.id)}
          onPanelToggleShared={() => onPanelToggleShared(panel.id)}
          onPanelReload={() => onPanelReload(panel.id)}
          onSessionAdd={() => onSessionAdd(panel.id)}
          onSessionClose={(sessionId) => onSessionClose(panel.id, sessionId)}
          onSessionSelect={(sessionId) => onSessionSelect(panel.id, sessionId)}
          onSessionTitleChange={(sessionId, title) => onSessionTitleChange(panel.id, sessionId, title)}
        />
      </div>
    );
  }

  // Split node - render children in Allotment
  return (
    <Allotment vertical={node.direction === "vertical"} className="h-full">
      <Allotment.Pane minSize={100}>
        <LayoutRenderer
          node={node.first}
          panels={panels}
          activePanelId={activePanelId}
          onPanelFocus={onPanelFocus}
          onPanelClose={onPanelClose}
          onPanelSplit={onPanelSplit}
          onPanelToggleShared={onPanelToggleShared}
          onPanelReload={onPanelReload}
          onSessionAdd={onSessionAdd}
          onSessionClose={onSessionClose}
          onSessionSelect={onSessionSelect}
          onSessionTitleChange={onSessionTitleChange}
        />
      </Allotment.Pane>
      <Allotment.Pane minSize={100}>
        <LayoutRenderer
          node={node.second}
          panels={panels}
          activePanelId={activePanelId}
          onPanelFocus={onPanelFocus}
          onPanelClose={onPanelClose}
          onPanelSplit={onPanelSplit}
          onPanelToggleShared={onPanelToggleShared}
          onPanelReload={onPanelReload}
          onSessionAdd={onSessionAdd}
          onSessionClose={onSessionClose}
          onSessionSelect={onSessionSelect}
          onSessionTitleChange={onSessionTitleChange}
        />
      </Allotment.Pane>
    </Allotment>
  );
}

export function PanelGrid({
  panels,
  layout,
  activePanelId: controlledActivePanelId,
  onPanelFocus: controlledOnPanelFocus,
  onPanelClose,
  onPanelSplit,
  onPanelToggleShared,
  onPanelReload,
  onSessionAdd,
  onSessionClose,
  onSessionSelect,
  onSessionTitleChange,
  direction = "horizontal",
  onInitialPanelCreate,
}: PanelGridProps) {
  // Internal state for active panel (uncontrolled mode)
  const [internalActivePanelId, setInternalActivePanelId] = useState<string | undefined>(
    () => panels[0]?.id
  );

  // Use controlled or internal state
  const activePanelId = controlledActivePanelId ?? internalActivePanelId;
  const handlePanelFocus = useCallback((id: string) => {
    controlledOnPanelFocus?.(id);
    if (controlledActivePanelId === undefined) {
      setInternalActivePanelId(id);
    }
  }, [controlledOnPanelFocus, controlledActivePanelId]);


  // Auto-select first panel if current active is gone
  useEffect(() => {
    if (panels.length > 0 && !panels.find(p => p.id === activePanelId)) {
      setInternalActivePanelId(panels[0].id);
    }
  }, [panels, activePanelId]);

  if (panels.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-canvas">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">No terminals open</p>
          {onInitialPanelCreate && (
            <NewTerminalSplitButton onSelect={onInitialPanelCreate} />
          )}
        </div>
      </div>
    );
  }

  // Use tree layout if available
  if (layout) {
    return (
      <div className="h-full w-full">
        <LayoutRenderer
          node={layout}
          panels={panels}
          activePanelId={activePanelId}
          onPanelFocus={handlePanelFocus}
          onPanelClose={onPanelClose}
          onPanelSplit={onPanelSplit}
          onPanelToggleShared={onPanelToggleShared}
          onPanelReload={onPanelReload}
          onSessionAdd={onSessionAdd}
          onSessionClose={onSessionClose}
          onSessionSelect={onSessionSelect}
          onSessionTitleChange={onSessionTitleChange}
        />
      </div>
    );
  }

  // Legacy flat layout (backwards compatibility)
  return (
    <Allotment vertical={direction === "vertical"} className="h-full">
      {panels.map((panel) => {
        const isActive = activePanelId === panel.id;
        return (
          <Allotment.Pane key={panel.id} minSize={150}>
            <div
              className="h-full flex flex-col bg-terminal border border-border overflow-hidden"
              onMouseDown={() => handlePanelFocus(panel.id)}
            >
              <SessionPanel
                isActive={isActive}
                panel={panel}
                showSplitActions
                onPanelSplit={(dir) => onPanelSplit(panel.id, dir)}
                onPanelClose={() => onPanelClose(panel.id)}
                onPanelToggleShared={() => onPanelToggleShared(panel.id)}
                onPanelReload={() => onPanelReload(panel.id)}
                onSessionAdd={() => onSessionAdd(panel.id)}
                onSessionClose={(sessionId) => onSessionClose(panel.id, sessionId)}
                onSessionSelect={(sessionId) => onSessionSelect(panel.id, sessionId)}
                onSessionTitleChange={(sessionId, title) => onSessionTitleChange(panel.id, sessionId, title)}
              />
            </div>
          </Allotment.Pane>
        );
      })}
    </Allotment>
  );
}

/** Shared panels zone - fixed left area */
export interface SharedPanelZoneProps {
  panels: PanelState[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onPanelClose: (id: string) => void;
  onPanelToggleShared: (id: string) => void;
  onPanelReload: (id: string) => void;
  onSessionAdd: (panelId: string) => void;
  onSessionClose: (panelId: string, sessionId: string) => void;
  onSessionSelect: (panelId: string, sessionId: string) => void;
  onSessionTitleChange: (panelId: string, sessionId: string, title: string) => void;
}

export function SharedPanelZone({
  panels,
  collapsed,
  onCollapsedChange,
  onPanelClose,
  onPanelToggleShared,
  onPanelReload,
  onSessionAdd,
  onSessionClose,
  onSessionSelect,
  onSessionTitleChange,
}: SharedPanelZoneProps) {
  // Track which panels are expanded (by id)
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(() => new Set(panels.map(p => p.id)));

  // Auto-expand newly pinned panels
  useEffect(() => {
    const newIds = panels.filter(p => !expandedPanels.has(p.id)).map(p => p.id);
    if (newIds.length > 0) {
      setExpandedPanels(prev => new Set([...prev, ...newIds]));
    }
  }, [panels]);

  const togglePanelExpanded = useCallback((panelId: string) => {
    setExpandedPanels(prev => {
      const next = new Set(prev);
      if (next.has(panelId)) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return next;
    });
  }, []);

  if (panels.length === 0) {
    return null;
  }

  // Collapsed state - show narrow bar with expand button
  if (collapsed) {
    return (
      <div className="h-full flex flex-col bg-canvas-alt border-r border-border">
        <button
          onClick={() => onCollapsedChange(false)}
          className="p-2 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
          title="Expand shared panels"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
        <div className="flex-1 flex flex-col items-center pt-2 gap-1">
          {panels.map((panel) => (
            <div
              key={panel.id}
              className="w-1.5 h-1.5 rounded-full bg-primary"
              title={panel.sessions.find(s => s.id === panel.activeSessionId)?.title || "Shared"}
            />
          ))}
        </div>
      </div>
    );
  }

  // Count expanded panels for flex distribution
  const expandedCount = panels.filter(p => expandedPanels.has(p.id)).length;

  return (
    <div className="h-full w-full min-w-0 flex flex-col overflow-hidden">
      {/* Header - aligned with FeatureTabs height */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-card flex-shrink-0">
        <button
          onClick={() => onCollapsedChange(true)}
          className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors rounded"
          title="Collapse pinned panels"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <DrawingPinFilledIcon className="w-3.5 h-3.5 text-primary/70" />
        <span className="text-sm text-muted-foreground">
          Pinned
          {panels.length > 1 && <span className="ml-1 text-xs">({panels.length})</span>}
        </span>
      </div>

      {/* Panels */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {panels.map((panel) => {
          const isExpanded = expandedPanels.has(panel.id);
          return (
            <div
              key={panel.id}
              className={`flex flex-col bg-terminal border border-border overflow-hidden ${
                isExpanded ? (expandedCount > 0 ? "flex-1 min-h-0" : "flex-1") : "flex-shrink-0"
              }`}
            >
              <SessionPanel
                panel={panel}
                collapsible
                isExpanded={isExpanded}
                onToggleExpand={() => togglePanelExpanded(panel.id)}
                onPanelClose={() => onPanelClose(panel.id)}
                onPanelToggleShared={() => onPanelToggleShared(panel.id)}
                onPanelReload={() => onPanelReload(panel.id)}
                onSessionAdd={() => onSessionAdd(panel.id)}
                onSessionClose={(sessionId) => onSessionClose(panel.id, sessionId)}
                onSessionSelect={(sessionId) => onSessionSelect(panel.id, sessionId)}
                onSessionTitleChange={(sessionId, title) => onSessionTitleChange(panel.id, sessionId, title)}
                headerBg="bg-canvas-alt"
                titleFallback="Shared"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
