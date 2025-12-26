import { Cross2Icon, PlusIcon, RowsIcon, ColumnsIcon, PinLeftIcon, DotsVerticalIcon, ReloadIcon, ChevronRightIcon, ChevronDownIcon, DrawingPinIcon, ClipboardCopyIcon, CheckIcon } from "@radix-ui/react-icons";
import { TerminalPane, setAutoCopyOnSelect, getAutoCopyOnSelect } from "../Terminal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PanelState } from "./PanelGrid";

/** Editable tab title - double click to rename */
function EditableTabTitle({
  title,
  fallback,
  onRename,
}: {
  title: string;
  fallback: string;
  onRename: (newTitle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    else setValue(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleConfirm}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleConfirm();
          if (e.key === "Escape") { setValue(title); setEditing(false); }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-20 px-0.5 text-xs bg-card border border-primary rounded outline-none"
        autoFocus
      />
    );
  }

  return (
    <span
      className="truncate min-w-0"
      onDoubleClick={(e) => { e.stopPropagation(); setValue(title); setEditing(true); }}
    >
      {title || fallback}
    </span>
  );
}

export interface SessionPanelProps {
  panel: PanelState;
  /** Whether this panel has global focus */
  isActive?: boolean;
  /** Show expand/collapse toggle */
  collapsible?: boolean;
  /** Current expanded state (only used if collapsible) */
  isExpanded?: boolean;
  /** Callback when expand/collapse toggled */
  onToggleExpand?: () => void;
  /** Show split horizontal/vertical actions in menu */
  showSplitActions?: boolean;
  /** Split this panel (tmux-style) */
  onPanelSplit?: (direction: "horizontal" | "vertical") => void;
  onPanelClose: () => void;
  onPanelToggleShared: () => void;
  onPanelReload: () => void;
  onSessionAdd: () => void;
  onSessionClose: (sessionId: string) => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionTitleChange: (sessionId: string, title: string) => void;
  /** Header background style */
  headerBg?: string;
  /** Fallback title for tabs */
  titleFallback?: string;
}

export const SessionPanel = memo(function SessionPanel({
  panel,
  isActive = false,
  collapsible = false,
  isExpanded = true,
  onToggleExpand,
  showSplitActions = false,
  onPanelSplit,
  onPanelClose,
  onPanelToggleShared,
  onPanelReload,
  onSessionAdd,
  onSessionClose,
  onSessionSelect,
  onSessionTitleChange,
  headerBg = "bg-muted",
  titleFallback = "Terminal",
}: SessionPanelProps) {
  const [autoCopyEnabled, setAutoCopyEnabled] = useState(getAutoCopyOnSelect);

  const handleTitleChange = useCallback(
    (sessionId: string) => (title: string) => {
      onSessionTitleChange(sessionId, title);
    },
    [onSessionTitleChange]
  );

  const handleToggleAutoCopy = useCallback(() => {
    const newValue = !autoCopyEnabled;
    setAutoCopyEnabled(newValue);
    setAutoCopyOnSelect(newValue);
  }, [autoCopyEnabled]);

  return (
    <Tabs
      value={panel.activeSessionId}
      onValueChange={onSessionSelect}
      className="flex flex-col h-full gap-0"
    >
      <div className={`flex items-center gap-2 px-2 py-1.5 ${headerBg} border-b border-border flex-shrink-0`}>
        <TabsList className="flex-1 h-auto p-0 bg-transparent justify-start gap-3">
          {panel.sessions.map((session) => (
            <TabsTrigger
              key={session.id}
              value={session.id}
              className={`relative h-auto px-0 py-1 text-xs border-b-2 border-transparent rounded-none bg-transparent shadow-none text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-ink ${isActive ? "data-[state=active]:border-primary" : "data-[state=active]:border-muted-foreground"} group`}
            >
              <EditableTabTitle
                title={session.title}
                fallback={titleFallback}
                onRename={handleTitleChange(session.id)}
              />
              {panel.sessions.length > 1 && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onSessionClose(session.id);
                  }}
                  className="absolute right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-card-alt transition-opacity cursor-pointer"
                >
                  <Cross2Icon className="w-3 h-3" />
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center px-1 flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors">
                <DotsVerticalIcon className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onSessionAdd}>
                <PlusIcon className="w-4 h-4 mr-2" />
                New tab
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPanelReload}>
                <ReloadIcon className="w-4 h-4 mr-2" />
                Reload
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleAutoCopy}>
                {autoCopyEnabled ? (
                  <CheckIcon className="w-4 h-4 mr-2" />
                ) : (
                  <ClipboardCopyIcon className="w-4 h-4 mr-2" />
                )}
                Auto copy on select
              </DropdownMenuItem>
              {collapsible && onToggleExpand && (
                <DropdownMenuItem onClick={onToggleExpand}>
                  {isExpanded ? (
                    <>
                      <ChevronDownIcon className="w-4 h-4 mr-2" />
                      Collapse
                    </>
                  ) : (
                    <>
                      <ChevronRightIcon className="w-4 h-4 mr-2" />
                      Expand
                    </>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onPanelToggleShared}>
                {panel.isShared ? (
                  <>
                    <DrawingPinIcon className="w-4 h-4 mr-2" />
                    Unpin
                  </>
                ) : (
                  <>
                    <PinLeftIcon className="w-4 h-4 mr-2" />
                    Pin to shared
                  </>
                )}
              </DropdownMenuItem>
              {showSplitActions && onPanelSplit && (
                <>
                  <DropdownMenuItem onClick={() => onPanelSplit("horizontal")}>
                    <ColumnsIcon className="w-4 h-4 mr-2" />
                    Split horizontal
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onPanelSplit("vertical")}>
                    <RowsIcon className="w-4 h-4 mr-2" />
                    Split vertical
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onPanelClose}
                className="text-red-500 focus:text-red-500"
              >
                <Cross2Icon className="w-4 h-4 mr-2" />
                Close panel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Terminal content - forceMount keeps PTY alive when tab is inactive */}
      {isExpanded && (
        <div className="flex-1 min-h-0 relative">
          {panel.sessions.map((session) => (
            <TabsContent
              key={session.id}
              value={session.id}
              forceMount
              className="absolute inset-0 m-0 data-[state=inactive]:hidden"
            >
              <TerminalPane
                ptyId={session.ptyId}
                cwd={panel.cwd}
                command={session.command}
                autoFocus={session.id === panel.activeSessionId && isActive}
                onTitleChange={handleTitleChange(session.id)}
                onExit={() => onSessionClose(session.id)}
              />
            </TabsContent>
          ))}
        </div>
      )}
    </Tabs>
  );
});
