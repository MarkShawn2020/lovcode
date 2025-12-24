import { useCallback, useEffect } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Cross2Icon, PlusIcon, RowsIcon, ColumnsIcon, PinLeftIcon, DotsVerticalIcon, ReloadIcon } from "@radix-ui/react-icons";
import { TerminalPane } from "../Terminal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

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
  onPanelClose: (id: string) => void;
  onPanelAdd: (direction: "horizontal" | "vertical") => void;
  onPanelToggleShared: (id: string) => void;
  onPanelReload: (id: string) => void;
  onSessionAdd: (panelId: string) => void;
  onSessionClose: (panelId: string, sessionId: string) => void;
  onSessionSelect: (panelId: string, sessionId: string) => void;
  onSessionTitleChange: (panelId: string, sessionId: string, title: string) => void;
  direction?: "horizontal" | "vertical";
}

export function PanelGrid({
  panels,
  onPanelClose,
  onPanelAdd,
  onPanelToggleShared,
  onPanelReload,
  onSessionAdd,
  onSessionClose,
  onSessionSelect,
  onSessionTitleChange,
  direction = "horizontal",
}: PanelGridProps) {
  const handleTitleChange = useCallback(
    (panelId: string, sessionId: string) => (title: string) => {
      onSessionTitleChange(panelId, sessionId, title);
    },
    [onSessionTitleChange]
  );

  // Auto-create terminal when empty
  useEffect(() => {
    if (panels.length === 0) {
      onPanelAdd("horizontal");
    }
  }, [panels.length, onPanelAdd]);

  if (panels.length === 0) {
    return null;
  }

  return (
    <Allotment
      vertical={direction === "vertical"}
      className="h-full"
    >
      {panels.map((panel) => (
        <Allotment.Pane key={panel.id} minSize={150}>
          <div className="h-full flex flex-col bg-terminal border border-border rounded-lg overflow-hidden">
              {/* Panel header with session tabs */}
              <Tabs
                value={panel.activeSessionId}
                onValueChange={(sessionId) => onSessionSelect(panel.id, sessionId)}
                className="flex flex-col h-full gap-0"
              >
                <div className="flex items-center bg-muted border-b border-border">
                  <TabsList className="flex-1 h-8 p-0 rounded-none justify-start gap-0">
                    {panel.sessions.map((session) => (
                      <TabsTrigger
                        key={session.id}
                        value={session.id}
                        className="relative h-8 px-3 text-xs rounded-none border-r border-border data-[state=active]:bg-card data-[state=active]:shadow-none group"
                      >
                        <span className="truncate max-w-20 pr-4">{session.title || "Terminal"}</span>
                        {panel.sessions.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSessionClose(panel.id, session.id);
                            }}
                            className="absolute right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-card-alt transition-opacity"
                          >
                            <Cross2Icon className="w-3 h-3" />
                          </button>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="flex items-center px-1 flex-shrink-0">
                    <button
                      onClick={() => onSessionAdd(panel.id)}
                      className="p-1 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                      title="New tab"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors">
                          <DotsVerticalIcon className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onSessionAdd(panel.id)}>
                          <PlusIcon className="w-4 h-4 mr-2" />
                          New tab
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onPanelReload(panel.id)}>
                          <ReloadIcon className="w-4 h-4 mr-2" />
                          Reload
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onPanelToggleShared(panel.id)}>
                          <PinLeftIcon className="w-4 h-4 mr-2" />
                          {panel.isShared ? "Unpin" : "Pin to shared"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onPanelAdd("horizontal")}>
                          <ColumnsIcon className="w-4 h-4 mr-2" />
                          Split horizontal
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onPanelAdd("vertical")}>
                          <RowsIcon className="w-4 h-4 mr-2" />
                          Split vertical
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onPanelClose(panel.id)}
                          className="text-red-500 focus:text-red-500"
                        >
                          <Cross2Icon className="w-4 h-4 mr-2" />
                          Close panel
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {/* Terminal content for each session */}
                <div className="flex-1 min-h-0 relative">
                  {panel.sessions.map((session) => (
                    <TabsContent
                      key={session.id}
                      value={session.id}
                      className="absolute inset-0 m-0 data-[state=inactive]:hidden"
                    >
                      <TerminalPane
                        ptyId={session.ptyId}
                        cwd={panel.cwd}
                        command={session.command}
                        onTitleChange={handleTitleChange(panel.id, session.id)}
                      />
                    </TabsContent>
                  ))}
                </div>
              </Tabs>
            </div>
        </Allotment.Pane>
      ))}
    </Allotment>
  );
}

/** Shared panels zone - fixed left area */
export interface SharedPanelZoneProps {
  panels: PanelState[];
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
  onPanelClose,
  onPanelToggleShared,
  onPanelReload,
  onSessionAdd,
  onSessionClose,
  onSessionSelect,
  onSessionTitleChange,
}: SharedPanelZoneProps) {
  const handleTitleChange = useCallback(
    (panelId: string, sessionId: string) => (title: string) => {
      onSessionTitleChange(panelId, sessionId, title);
    },
    [onSessionTitleChange]
  );

  if (panels.length === 0) {
    return null;
  }

  return (
    <div className="h-full w-full min-w-0 flex flex-col gap-1 p-1 overflow-hidden">
      {panels.map((panel) => (
        <div
          key={panel.id}
          className="flex-1 min-h-0 flex flex-col bg-terminal border border-border overflow-hidden"
        >
          <Tabs
            value={panel.activeSessionId}
            onValueChange={(sessionId) => onSessionSelect(panel.id, sessionId)}
            className="flex flex-col h-full gap-0"
          >
            <div className="flex items-center bg-canvas-alt border-b border-border">
              <PinLeftIcon className="w-3.5 h-3.5 text-primary ml-2" />
              <TabsList className="flex-1 h-8 p-0 rounded-none justify-start gap-0">
                {panel.sessions.map((session) => (
                  <TabsTrigger
                    key={session.id}
                    value={session.id}
                    className="relative h-8 px-3 text-xs rounded-none border-r border-border data-[state=active]:bg-card data-[state=active]:shadow-none group"
                  >
                    <span className="truncate max-w-20 pr-4">{session.title || "Shared"}</span>
                    {panel.sessions.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSessionClose(panel.id, session.id);
                        }}
                        className="absolute right-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-card-alt transition-opacity"
                      >
                        <Cross2Icon className="w-3 h-3" />
                      </button>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="flex items-center px-1 flex-shrink-0">
                <button
                  onClick={() => onSessionAdd(panel.id)}
                  className="p-1 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                  title="New tab"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors">
                      <DotsVerticalIcon className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onSessionAdd(panel.id)}>
                      <PlusIcon className="w-4 h-4 mr-2" />
                      New tab
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPanelReload(panel.id)}>
                      <ReloadIcon className="w-4 h-4 mr-2" />
                      Reload
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPanelToggleShared(panel.id)}>
                      <PinLeftIcon className="w-4 h-4 mr-2" />
                      Unpin
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onPanelClose(panel.id)}
                      className="text-red-500 focus:text-red-500"
                    >
                      <Cross2Icon className="w-4 h-4 mr-2" />
                      Close panel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex-1 min-h-0 relative">
              {panel.sessions.map((session) => (
                <TabsContent
                  key={session.id}
                  value={session.id}
                  className="absolute inset-0 m-0 data-[state=inactive]:hidden"
                >
                  <TerminalPane
                    ptyId={session.ptyId}
                    cwd={panel.cwd}
                    command={session.command}
                    onTitleChange={handleTitleChange(panel.id, session.id)}
                  />
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </div>
      ))}
    </div>
  );
}
