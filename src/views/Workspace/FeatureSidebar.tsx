import { useState, useCallback, useEffect, useRef } from "react";
import {
  PlusIcon,
  DrawingPinFilledIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  FileIcon,
} from "@radix-ui/react-icons";
import { SessionPanel } from "../../components/PanelGrid/SessionPanel";
import { FileTree } from "../../components/FileTree/FileTree";
import type { PanelState } from "../../components/PanelGrid";

interface FeatureSidebarProps {
  // Project & Feature
  projectName: string;
  projectPath: string;
  featureName?: string;
  // Pinned panels
  pinnedPanels: PanelState[];
  onAddPinnedPanel: () => void;
  onPanelClose: (id: string) => void;
  onPanelToggleShared: (id: string) => void;
  onPanelReload: (id: string) => void;
  onSessionAdd: (panelId: string) => void;
  onSessionClose: (panelId: string, sessionId: string) => void;
  onSessionSelect: (panelId: string, sessionId: string) => void;
  onSessionTitleChange: (panelId: string, sessionId: string, title: string) => void;
  // Sidebar state
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  // Global focus
  activePanelId?: string;
  onPanelFocus?: (id: string) => void;
  // File actions
  onFileClick?: (path: string) => void;
}

export function FeatureSidebar({
  projectName,
  projectPath,
  featureName,
  pinnedPanels,
  onAddPinnedPanel,
  onPanelClose,
  onPanelToggleShared,
  onPanelReload,
  onSessionAdd,
  onSessionClose,
  onSessionSelect,
  onSessionTitleChange,
  collapsed,
  onCollapsedChange,
  activePanelId,
  onPanelFocus,
  onFileClick,
}: FeatureSidebarProps) {
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(() => new Set(pinnedPanels.map(p => p.id)));
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("feature-sidebar-width");
    return saved ? Number(saved) : 256;
  });
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Persist width
  useEffect(() => {
    localStorage.setItem("feature-sidebar-width", String(width));
  }, [width]);

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const startX = e.clientX;
    const startWidth = width;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + delta, 180), 480);
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [width]);

  // Auto-expand newly pinned panels
  useEffect(() => {
    const newIds = pinnedPanels.filter(p => !expandedPanels.has(p.id)).map(p => p.id);
    if (newIds.length > 0) {
      setExpandedPanels(prev => new Set([...prev, ...newIds]));
    }
  }, [pinnedPanels]);

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

  const title = featureName ? `${projectName} - ${featureName}` : projectName;

  // Collapsed state
  if (collapsed) {
    return (
      <div className="h-full flex flex-col bg-canvas-alt border-r border-border w-8">
        <button
          onClick={() => onCollapsedChange(false)}
          className="p-2 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
          title="Expand sidebar"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
        <div className="flex-1 flex flex-col items-center pt-2 gap-2">
          {pinnedPanels.map((panel) => (
            <span
              key={panel.id}
              title={panel.sessions.find(s => s.id === panel.activeSessionId)?.title || "Pinned"}
            >
              <DrawingPinFilledIcon className="w-3 h-3 text-primary/70" />
            </span>
          ))}
          <span title="Files">
            <FileIcon className="w-3 h-3 text-muted-foreground" />
          </span>
        </div>
      </div>
    );
  }

  const expandedCount = pinnedPanels.filter(p => expandedPanels.has(p.id)).length;

  return (
      <div
        ref={sidebarRef}
        className="h-full flex flex-col bg-canvas-alt border-r border-border min-w-0 relative"
        style={{ width }}
      >
        {/* Resize handle - wider hit area, thin visual line */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize z-10 group"
        >
          <div className="absolute right-1.5 top-0 bottom-0 w-0.5 group-hover:bg-primary/50 transition-colors" />
        </div>
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border flex-shrink-0">
          <button
            onClick={() => onCollapsedChange(true)}
            className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors rounded"
            title="Collapse sidebar"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <span className="flex-1 text-sm font-medium text-ink px-1 truncate">{title}</span>
        </div>

        {/* Sections container */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Pinned sessions */}
          <div className={`flex flex-col border-t border-border ${pinnedExpanded && pinnedPanels.length > 0 ? "flex-1 min-h-0" : "flex-shrink-0"}`}>
            <SectionHeader
              title="Pinned Sessions"
              count={pinnedPanels.length > 1 ? pinnedPanels.length : undefined}
              expanded={pinnedExpanded}
              onToggle={() => setPinnedExpanded(!pinnedExpanded)}
              onAdd={onAddPinnedPanel}
            />
            {pinnedExpanded && pinnedPanels.length > 0 && <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {pinnedPanels.map((panel) => {
                const isExpanded = expandedPanels.has(panel.id);
                const isActive = activePanelId === panel.id;
                return (
                  <div
                    key={panel.id}
                    className={`flex flex-col bg-terminal border border-border overflow-hidden ${
                      isExpanded ? (expandedCount > 0 ? "flex-1 min-h-0" : "flex-1") : "flex-shrink-0"
                    }`}
                    onMouseDown={() => onPanelFocus?.(panel.id)}
                  >
                    <SessionPanel
                      isActive={isActive}
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
                      titleFallback="Pinned"
                    />
                  </div>
                );
              })}
            </div>}
          </div>

          {/* Files */}
          <div className={`flex flex-col border-t border-border ${filesExpanded ? "flex-1 min-h-0" : "flex-shrink-0"}`}>
            <SectionHeader
              title="Files"
              expanded={filesExpanded}
              onToggle={() => setFilesExpanded(!filesExpanded)}
            />
            {filesExpanded && (
              <div className="flex-1 min-h-0 overflow-auto">
                <FileTree rootPath={projectPath} onFileClick={onFileClick} />
              </div>
            )}
          </div>
        </div>
      </div>
  );
}

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
  onAdd,
}: {
  title: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center px-3 py-1.5 flex-shrink-0">
      <div
        className="flex items-center flex-1 gap-1 cursor-pointer hover:bg-card-alt transition-colors rounded -ml-1 pl-1"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className="text-xs text-muted-foreground/60">({count})</span>
        )}
      </div>
      {onAdd && (
        <button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="p-0.5 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors rounded"
          title={`New ${title.toLowerCase().slice(0, -1)}`}
        >
          <PlusIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
