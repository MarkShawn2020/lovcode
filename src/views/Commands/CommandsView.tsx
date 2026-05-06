import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInvokeQuery, useQueryClient } from "../../hooks";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Terminal, Folder, FolderTree, List } from "lucide-react";
import { CommandTrendChart } from "../../components/home";
import {
  LightningBoltIcon,
  DotsHorizontalIcon,
  CheckIcon,
} from "@radix-ui/react-icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  LoadingState,
  EmptyState,
  SearchInput,
  PageHeader,
  ConfigPage,
  useSearch,
} from "../../components/config";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";
import { useAtom } from "jotai";
import { commandsSortKeyAtom, commandsSortDirAtom, commandsShowDeprecatedAtom, commandsViewModeAtom, commandsExpandedFoldersAtom } from "../../store";
import type { LocalCommand, TemplateComponent } from "../../types";
import type { CommandSortKey, TreeNode, FolderNode } from "./types";
import { DraggableCommandItem } from "./DraggableCommandItem";
import { DroppableFolder } from "./DroppableFolder";
import { RootDropZone } from "./RootDropZone";
import { CommandItemCard } from "./CommandItemCard";
import { useI18n } from "@/i18n";

interface CommandsViewProps {
  onSelect: (cmd: LocalCommand, scrollToChangelog?: boolean) => void;
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function CommandsView({
  onSelect,
  onMarketplaceSelect,
}: CommandsViewProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: commands = [], isLoading } = useInvokeQuery<LocalCommand[]>(["commands"], "list_local_commands");
  const { data: commandStats = {} } = useInvokeQuery<Record<string, number>>(["commandStats"], "get_command_stats");
  const { data: commandWeeklyStats } = useInvokeQuery<Record<string, Record<string, number>>>(
    ["commandWeeklyStats"],
    "get_command_weekly_stats",
    { weeks: 0 }
  );
  const [sortKey, setSortKey] = useAtom(commandsSortKeyAtom);
  const [sortDir, setSortDir] = useAtom(commandsSortDirAtom);
  const [showDeprecated, setShowDeprecated] = useAtom(commandsShowDeprecatedAtom);
  const [viewMode, setViewMode] = useAtom(commandsViewModeAtom);
  const [expandedFoldersArr, setExpandedFoldersArr] = useAtom(commandsExpandedFoldersAtom);
  const expandedFolders = useMemo(() => new Set(expandedFoldersArr), [expandedFoldersArr]);
  const [deprecateDialogOpen, setDeprecateDialogOpen] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<LocalCommand | null>(null);
  const [replacementCommand, setReplacementCommand] = useState("");
  const [deprecationNote, setDeprecationNote] = useState("");
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetFolder, setMoveTargetFolder] = useState("");
  const [moveCreateDirOpen, setMoveCreateDirOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<{ cmd: LocalCommand; newPath: string; dirPath: string } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const { search, setSearch, filtered } = useSearch(commands, ["name", "description"]);

  const getUsageCount = (cmd: LocalCommand) => {
    const mainCount = commandStats[cmd.name.slice(1)] || 0;
    const aliasCount = cmd.aliases.reduce((sum, alias) => {
      const key = alias.startsWith("/") ? alias.slice(1) : alias;
      return sum + (commandStats[key] || 0);
    }, 0);
    return mainCount + aliasCount;
  };

  const refreshCommands = () => {
    queryClient.invalidateQueries({ queryKey: ["commands"] });
  };

  const handleDeprecate = async () => {
    if (!selectedCommand) return;
    try {
      await invoke("deprecate_command", {
        path: selectedCommand.path,
        replacedBy: replacementCommand || null,
        note: deprecationNote || null,
      });
      setDeprecateDialogOpen(false);
      setSelectedCommand(null);
      setReplacementCommand("");
      setDeprecationNote("");
      refreshCommands();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRestore = async (cmd: LocalCommand) => {
    try {
      await invoke("restore_command", { path: cmd.path });
      refreshCommands();
    } catch (e) {
      console.error(e);
    }
  };

  const openDeprecateDialog = (cmd: LocalCommand) => {
    setSelectedCommand(cmd);
    setDeprecateDialogOpen(true);
  };

  const openMoveDialog = (cmd: LocalCommand) => {
    setSelectedCommand(cmd);
    setMoveTargetFolder("");
    setMoveDialogOpen(true);
  };

  const getFolders = (): string[] => {
    const folders = new Set<string>();
    for (const cmd of commands) {
      const match = cmd.path.match(/\.claude\/commands\/(.+)$/);
      if (match) {
        const parts = match[1].split("/");
        if (parts.length > 1) {
          let path = "";
          for (let i = 0; i < parts.length - 1; i++) {
            path = path ? `${path}/${parts[i]}` : parts[i];
            folders.add(path);
          }
        }
      }
    }
    return Array.from(folders).sort();
  };

  const handleMove = async (cmd: LocalCommand, targetFolder: string, createDir = false) => {
    try {
      const filename = cmd.path.split("/").pop()?.replace(".md", "") || "";
      const newName = targetFolder ? `/${targetFolder}/${filename}` : `/${filename}`;
      await invoke<string>("rename_command", { path: cmd.path, newName, createDir });
      setMoveDialogOpen(false);
      setSelectedCommand(null);
      await refreshCommands();
    } catch (e) {
      const error = String(e);
      if (error.startsWith("DIR_NOT_EXIST:")) {
        const dirPath = error.slice("DIR_NOT_EXIST:".length);
        const filename = cmd.path.split("/").pop()?.replace(".md", "") || "";
        const newPath = targetFolder ? `/${targetFolder}/${filename}` : `/${filename}`;
        setPendingMove({ cmd, newPath, dirPath });
        setMoveCreateDirOpen(true);
      } else {
        console.error("Failed to move command:", e);
      }
    }
  };

  const handleConfirmMoveCreateDir = async () => {
    if (pendingMove) {
      setMoveCreateDirOpen(false);
      await invoke<string>("rename_command", {
        path: pendingMove.cmd.path,
        newName: pendingMove.newPath,
        createDir: true,
      });
      setPendingMove(null);
      setMoveDialogOpen(false);
      setSelectedCommand(null);
      await refreshCommands();
    }
  };

  const handleDragStartDnd = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEndDnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    const cmdPath = active.id as string;
    const targetFolder = over.id as string;

    const cmd = commands.find((c) => c.path === cmdPath);
    if (!cmd) return;

    const match = cmd.path.match(/\.claude\/commands\/(.+)$/);
    const currentFolder = match
      ? match[1].split("/").length > 1
        ? match[1].split("/").slice(0, -1).join("/")
        : ""
      : "";

    if (targetFolder === currentFolder) return;

    await handleMove(cmd, targetFolder);
  };

  const activeDragCmd = activeDragId ? commands.find((c) => c.path === activeDragId) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );


  const statusFiltered = filtered.filter((cmd) => {
    if (cmd.status === "active") return true;
    return showDeprecated || search.length > 0;
  });

  const sorted = [...statusFiltered].sort((a, b) => {
    if (a.status !== "active" && b.status === "active") return 1;
    if (a.status === "active" && b.status !== "active") return -1;

    if (sortKey === "usage") {
      const aCount = getUsageCount(a);
      const bCount = getUsageCount(b);
      return sortDir === "desc" ? bCount - aCount : aCount - bCount;
    } else {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "desc" ? -cmp : cmp;
    }
  });

  const toggleSort = (key: CommandSortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir(key === "usage" ? "desc" : "asc");
    }
  };

  const activeCount = commands.filter((c) => c.status === "active").length;
  const deprecatedCount = commands.filter((c) => c.status !== "active").length;

  const buildTree = (cmds: LocalCommand[]): TreeNode[] => {
    const root: Map<string, FolderNode | { type: "command"; command: LocalCommand }> = new Map();

    for (const cmd of cmds) {
      const match = cmd.path.match(/\.claude\/commands\/(.+)$/);
      const relativePath = match ? match[1] : cmd.name + ".md";
      const parts = relativePath.replace(/\.md$/, "").split("/");

      if (parts.length === 1) {
        root.set(cmd.name, { type: "command", command: cmd });
      } else {
        let currentLevel = root;
        let currentPath = "";
        for (let i = 0; i < parts.length - 1; i++) {
          const folderName = parts[i];
          currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
          let folder = currentLevel.get(folderName);
          if (!folder || folder.type !== "folder") {
            folder = { type: "folder", name: folderName, path: currentPath, childMap: new Map() };
            currentLevel.set(folderName, folder);
          }
          currentLevel = folder.childMap;
        }
        currentLevel.set(cmd.name, { type: "command", command: cmd });
      }
    }

    const convertAndSort = (
      map: Map<string, FolderNode | { type: "command"; command: LocalCommand }>
    ): TreeNode[] => {
      const nodes: TreeNode[] = [];
      for (const node of map.values()) {
        if (node.type === "folder") {
          nodes.push({
            type: "folder",
            name: node.name,
            path: node.path,
            children: convertAndSort(node.childMap),
          });
        } else {
          nodes.push(node);
        }
      }
      return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        if (a.type === "folder" && b.type === "folder") return a.name.localeCompare(b.name);
        if (a.type === "command" && b.type === "command") {
          if (sortKey === "usage") {
            const diff = getUsageCount(b.command) - getUsageCount(a.command);
            return sortDir === "desc" ? diff : -diff;
          }
          const cmp = a.command.name.localeCompare(b.command.name);
          return sortDir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    };

    return convertAndSort(root);
  };

  const tree = viewMode === "tree" ? buildTree(statusFiltered) : [];

  const toggleFolder = (path: string) => {
    setExpandedFoldersArr((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isFolder = node.type === "folder";
    const indent = depth * 24;
    const isExpanded = isFolder && expandedFolders.has(node.path);

    if (isFolder) {
      return (
        <div key={node.path} style={{ marginLeft: indent }}>
          <DroppableFolder
            folderPath={node.path}
            name={node.name}
            childCount={node.children.length}
            isExpanded={isExpanded}
            isOver={false}
            onToggle={() => toggleFolder(node.path)}
          >
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </DroppableFolder>
        </div>
      );
    }

    const cmd = node.command;
    const shortName = depth === 0 ? cmd.name : cmd.name.split("/").pop() || cmd.name;
    const isInactive = cmd.status === "deprecated" || cmd.status === "archived";
    const usageCount = getUsageCount(cmd);
    const isDragging = activeDragId === cmd.path;

    return (
      <div key={cmd.path} style={{ marginLeft: indent }}>
        <DraggableCommandItem
          cmd={cmd}
          shortName={shortName}
          usageCount={usageCount}
          isInactive={isInactive}
          isDragging={isDragging}
          onClick={() => onSelect(cmd)}
          onOpenInEditor={() => invoke("open_in_editor", { path: cmd.path })}
          onMove={() => openMoveDialog(cmd)}
          onDeprecate={() => openDeprecateDialog(cmd)}
          onRestore={() => handleRestore(cmd)}
        />
      </div>
    );
  };

  return (
    <ConfigPage>
      <PageHeader
        title={t("commands.title")}
        subtitle={t("commands.subtitle", { active: activeCount, deprecated: deprecatedCount })}
      />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">{t("common.installed")}</TabsTrigger>
          <TabsTrigger value="marketplace">{t("common.marketplace")}</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          {isLoading ? (
            <LoadingState message={t("commands.loading")} />
          ) : (
            <>
              {/* Command Trend Chart */}
              {commandWeeklyStats && Object.keys(commandWeeklyStats).length > 0 && (
                <div className="p-4 bg-card/50 rounded-xl border border-border/40">
                  <CommandTrendChart data={commandWeeklyStats} />
                </div>
              )}

              <div className="flex items-center gap-3">
                <SearchInput
                  placeholder={t("commands.searchInstalled")}
                  value={search}
                  onChange={setSearch}
                  className="flex-1 px-4 py-2 bg-card border border-border rounded-lg text-ink placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="shrink-0">
                      <DotsHorizontalIcon className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel className="text-xs">{t("commands.view")}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={viewMode}
                      onValueChange={(v) => setViewMode(v as "flat" | "tree")}
                    >
                      <DropdownMenuRadioItem value="tree">
                        <FolderTree className="w-4 h-4 mr-2" /> {t("commands.tree")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="flat">
                        <List className="w-4 h-4 mr-2" /> {t("commands.flat")}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">{t("commands.sort")}</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => toggleSort("usage")}>
                      {sortKey === "usage" && <CheckIcon className="w-4 h-4 mr-2" />}
                      {sortKey !== "usage" && <span className="w-4 mr-2" />}
                      {t("commands.usage")} {sortKey === "usage" && (sortDir === "desc" ? "↓" : "↑")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleSort("name")}>
                      {sortKey === "name" && <CheckIcon className="w-4 h-4 mr-2" />}
                      {sortKey !== "name" && <span className="w-4 mr-2" />}
                      {t("common.name")} {sortKey === "name" && (sortDir === "desc" ? "↓" : "↑")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={showDeprecated} onCheckedChange={setShowDeprecated}>
                      {t("commands.showDeprecated")}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {viewMode === "flat" && sorted.length > 0 && (
                <div className="space-y-2">
                  {sorted.map((cmd) => (
                    <CommandItemCard
                      key={cmd.path}
                      command={cmd}
                      usageCount={getUsageCount(cmd)}
                      onClick={() => onSelect(cmd)}
                      onOpenInEditor={() => invoke("open_in_editor", { path: cmd.path })}
                      onDeprecate={() => openDeprecateDialog(cmd)}
                      onRestore={() => handleRestore(cmd)}
                    />
                  ))}
                </div>
              )}
              {viewMode === "tree" && tree.length > 0 && (
                <DndContext sensors={sensors} onDragStart={handleDragStartDnd} onDragEnd={handleDragEndDnd}>
                  <div className="space-y-1">
                    {activeDragId && <RootDropZone isOver={false} />}
                    {tree.map((node) => renderTreeNode(node))}
                  </div>
                  <DragOverlay>
                    {activeDragCmd && (
                      <div className="flex items-center gap-2 py-1.5 px-2 bg-card border border-primary rounded-md shadow-lg">
                        <Terminal className="w-4 h-4 text-primary" />
                        <span className="font-mono font-medium text-primary">{activeDragCmd.name}</span>
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
              )}

              {statusFiltered.length === 0 && !search && (
                <EmptyState
                  icon={LightningBoltIcon}
                  message={t("commands.noInstalled")}
                  hint={t("commands.installHint")}
                />
              )}

              {statusFiltered.length === 0 && search && (
                <p className="text-muted-foreground text-sm">{t("commands.noMatch", { search })}</p>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="commands" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>

      <Dialog open={deprecateDialogOpen} onOpenChange={setDeprecateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("commands.deprecateTitle", { name: selectedCommand?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {t("commands.deprecateDescription")}
            </p>
            <div>
              <Label htmlFor="replacement">{t("commands.replacementCommand")}</Label>
              <Input
                id="replacement"
                placeholder="/new-command"
                value={replacementCommand}
                onChange={(e) => setReplacementCommand(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="deprecation-note">{t("commands.noteOptional")}</Label>
              <Input
                id="deprecation-note"
                placeholder={t("commands.deprecationReasonPlaceholder")}
                value={deprecationNote}
                onChange={(e) => setDeprecationNote(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeprecateDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleDeprecate} className="bg-amber-600 hover:bg-amber-700">
              {t("commands.deprecate")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("commands.moveTitle", { name: selectedCommand?.name ?? "" })}</DialogTitle>
          </DialogHeader>
          {(() => {
            const getCurrentFolder = () => {
              if (!selectedCommand) return "";
              const match = selectedCommand.path.match(/\.claude\/commands\/(.+)$/);
              if (match) {
                const parts = match[1].split("/");
                if (parts.length > 1) return parts.slice(0, -1).join("/");
              }
              return "";
            };
            const currentFolder = getCurrentFolder();
            return (
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  {t("commands.currentFolder")}{" "}
                  <code className="bg-muted px-1 rounded font-mono">
                    /{currentFolder || `(${t("commands.root")})`}
                  </code>
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  <button
                    onClick={() => setMoveTargetFolder("")}
                    disabled={currentFolder === ""}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                      currentFolder === ""
                        ? "opacity-50 cursor-not-allowed"
                        : moveTargetFolder === ""
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                    }`}
                  >
                    <Folder className="w-4 h-4" />
                    <span className="font-mono">/ ({t("commands.root")})</span>
                    {currentFolder === "" && (
                      <span className="text-xs text-muted-foreground ml-auto">({t("commands.currentBadge")})</span>
                    )}
                  </button>
                  {getFolders().map((folder) => {
                    const isCurrent = folder === currentFolder;
                    return (
                      <button
                        key={folder}
                        onClick={() => setMoveTargetFolder(folder)}
                        disabled={isCurrent}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                          isCurrent
                            ? "opacity-50 cursor-not-allowed"
                            : moveTargetFolder === folder
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                        }`}
                      >
                        <Folder className="w-4 h-4" />
                        <span className="font-mono">/{folder}</span>
                        {isCurrent && (
                          <span className="text-xs text-muted-foreground ml-auto">({t("commands.currentBadge")})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <Label htmlFor="move-new-folder">{t("commands.newFolderPath")}</Label>
                  <Input
                    id="move-new-folder"
                    placeholder="/new/folder/path"
                    value={moveTargetFolder}
                    onChange={(e) => setMoveTargetFolder(e.target.value.replace(/^\//, ""))}
                    className="mt-1 font-mono"
                  />
                </div>
              </div>
            );
          })()}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => selectedCommand && handleMove(selectedCommand, moveTargetFolder)}
              disabled={(() => {
                if (!selectedCommand) return true;
                const match = selectedCommand.path.match(/\.claude\/commands\/(.+)$/);
                const cur = match
                  ? match[1].split("/").length > 1
                    ? match[1].split("/").slice(0, -1).join("/")
                    : ""
                  : "";
                return moveTargetFolder === cur;
              })()}
            >
              {t("commands.move")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveCreateDirOpen}
        onOpenChange={(open) => {
          setMoveCreateDirOpen(open);
          if (!open) setPendingMove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("commands.createDirectoryTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            {t("commands.createDirectoryQuestion", { path: pendingMove?.dirPath ?? "" })}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMoveCreateDirOpen(false);
                setPendingMove(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleConfirmMoveCreateDir}>{t("common.create")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfigPage>
  );
}
