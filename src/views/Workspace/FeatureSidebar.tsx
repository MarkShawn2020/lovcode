import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAtom } from "jotai";
import { featureSidebarExpandedPanelsAtom, featureSidebarPinnedExpandedAtom, featureSidebarFilesExpandedAtom } from "../../store";
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
import { useResize } from "../../hooks/useResize";
import { usePtyStatus } from "../../hooks/usePtyStatus";
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
  selectedFile?: string | null;
  // Feature rename
  onFeatureRename?: (name: string) => void;
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
  selectedFile,
  onFeatureRename,
}: FeatureSidebarProps) {
  const [expandedPanelsArr, setExpandedPanelsArr] = useAtom(featureSidebarExpandedPanelsAtom);
  const expandedPanels = useMemo(() => new Set(expandedPanelsArr), [expandedPanelsArr]);
  const setExpandedPanels = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setExpandedPanelsArr(prev => {
        const prevSet = new Set(prev);
        const next = typeof updater === "function" ? updater(prevSet) : updater;
        return Array.from(next);
      });
    },
    [setExpandedPanelsArr]
  );
  const [pinnedExpanded, setPinnedExpanded] = useAtom(featureSidebarPinnedExpandedAtom);
  const [filesExpanded, setFilesExpanded] = useAtom(featureSidebarFilesExpandedAtom);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const sectionsRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Resize hooks
  const { value: width, handleMouseDown } = useResize({
    direction: "horizontal",
    storageKey: "feature-sidebar-width",
    defaultValue: 256,
    min: 180,
    max: 480,
  });

  const { value: pinnedRatio, handleMouseDown: handleVerticalResize } = useResize({
    direction: "vertical",
    storageKey: "feature-sidebar-pinned-ratio",
    defaultValue: 0.5,
    min: 0.2,
    max: 0.8,
    containerRef: sectionsRef,
  });


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

  const handleStartRename = useCallback(() => {
    if (!featureName || !onFeatureRename) return;
    setRenameValue(featureName);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [featureName, onFeatureRename]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== featureName) {
      onFeatureRename?.(trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, featureName, onFeatureRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setIsRenaming(false);
    }
  }, [handleRenameSubmit]);

  // Calculate total sessions count
  const totalSessionsCount = pinnedPanels.reduce((sum, p) => sum + p.sessions.length, 0);

  // Collect all ptyIds from pinned sessions
  const allPtyIds = useMemo(() => {
    return pinnedPanels.flatMap((p) => p.sessions.map((s) => s.ptyId));
  }, [pinnedPanels]);

  // Track PTY running status
  const ptyStatusMap = usePtyStatus(allPtyIds);

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
          {/* Pinned section with status dots */}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => {
                onCollapsedChange(false);
                setPinnedExpanded(true);
              }}
              title={`${totalSessionsCount} sessions`}
              className="hover:bg-card-alt rounded p-0.5 transition-colors"
            >
              <DrawingPinFilledIcon className="w-3 h-3 text-primary/70" />
            </button>
            {/* Status dots for each session - clickable to expand and focus */}
            <div className="flex flex-col items-center gap-1">
              {pinnedPanels.flatMap((panel) =>
                panel.sessions.map((session) => {
                  const isRunning = ptyStatusMap.get(session.ptyId) ?? true;
                  return (
                    <button
                      key={session.id}
                      onClick={() => {
                        onCollapsedChange(false);
                        setPinnedExpanded(true);
                        onPanelFocus?.(panel.id);
                        onSessionSelect(panel.id, session.id);
                      }}
                      title={`${session.title || "Terminal"}: ${isRunning ? "running" : "stopped"}`}
                      className={`w-2 h-2 rounded-full hover:ring-2 hover:ring-primary/50 transition-all ${
                        isRunning ? "bg-green-500" : "bg-muted-foreground/40"
                      }`}
                    />
                  );
                })
              )}
            </div>
          </div>
          {/* Add button */}
          <button
            onClick={() => {
              onCollapsedChange(false);
              setPinnedExpanded(true);
              onAddPinnedPanel();
            }}
            className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors rounded"
            title="New pinned session"
          >
            <PlusIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              onCollapsedChange(false);
              setFilesExpanded(true);
            }}
            title="Files"
            className="hover:bg-card-alt rounded p-0.5 transition-colors"
          >
            <FileIcon className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      </div>
    );
  }

  const expandedCount = pinnedPanels.filter(p => expandedPanels.has(p.id)).length;

  return (
      <div
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
          {isRenaming ? (
            <span className="flex-1 flex items-center text-sm font-medium text-ink px-1 min-w-0">
              <span className="shrink-0">{projectName} - </span>
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={handleRenameKeyDown}
                className="flex-1 bg-card border border-border rounded outline-none focus:border-primary min-w-0 px-1"
              />
            </span>
          ) : (
            <span
              className="flex-1 text-sm font-medium text-ink px-1 truncate"
              onDoubleClick={handleStartRename}
              title={featureName && onFeatureRename ? "Double-click to rename" : undefined}
            >
              {title}
            </span>
          )}
        </div>

        {/* Sections container */}
        <div ref={sectionsRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Pinned sessions */}
          <div
            className="flex flex-col border-t border-border overflow-hidden flex-shrink-0"
            style={pinnedExpanded && pinnedPanels.length > 0 && filesExpanded ? { height: `${pinnedRatio * 100}%` } : pinnedExpanded && pinnedPanels.length > 0 ? { flex: 1 } : undefined}
          >
            <SectionHeader
              title="Pinned Sessions"
              count={totalSessionsCount}
              expanded={pinnedExpanded}
              onToggle={() => setPinnedExpanded(!pinnedExpanded)}
              onAdd={() => {
                setPinnedExpanded(true);
                onAddPinnedPanel();
              }}
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

          {/* Resize handle between sections */}
          {pinnedExpanded && pinnedPanels.length > 0 && filesExpanded && (
            <div
              onMouseDown={handleVerticalResize}
              className="h-1 cursor-row-resize flex-shrink-0 group relative"
            >
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 group-hover:bg-primary/50 transition-colors" />
            </div>
          )}

          {/* Files */}
          <div
            className="flex flex-col border-t border-border overflow-hidden flex-shrink-0"
            style={pinnedExpanded && pinnedPanels.length > 0 && filesExpanded ? { height: `${(1 - pinnedRatio) * 100}%` } : filesExpanded ? { flex: 1 } : undefined}
          >
            <SectionHeader
              title="Files"
              expanded={filesExpanded}
              onToggle={() => setFilesExpanded(!filesExpanded)}
            />
            {filesExpanded && (
              <div className="flex-1 min-h-0 overflow-auto">
                <FileTree rootPath={projectPath} onFileClick={onFileClick} selectedFile={selectedFile} />
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
        {count !== undefined && (
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
