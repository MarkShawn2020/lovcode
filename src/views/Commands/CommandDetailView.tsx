import { useState, useEffect, useRef } from "react";
import { invoke } from "@/lib/tauri";
import {
  ResetIcon,
  ArchiveIcon,
  ExclamationTriangleIcon,
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
import { ConfigPage, DetailHeader, DetailCard, ContentCard } from "../../components/config";
import type { LocalCommand } from "../../types";

interface CommandDetailViewProps {
  command: LocalCommand;
  onBack: () => void;
  onCommandUpdated?: () => void;
  onRenamed?: (newPath: string) => void;
  scrollToChangelog?: boolean;
}

export function CommandDetailView({
  command,
  onBack,
  onCommandUpdated,
  onRenamed,
  scrollToChangelog: shouldScrollToChangelog,
}: CommandDetailViewProps) {
  const [loading, setLoading] = useState(false);
  const [deprecateDialogOpen, setDeprecateDialogOpen] = useState(false);
  const [replacementCommand, setReplacementCommand] = useState("");
  const [deprecationNote, setDeprecationNote] = useState("");
  const [createDirDialogOpen, setCreateDirDialogOpen] = useState(false);
  const [pendingRename, setPendingRename] = useState<{ newName: string; dirPath: string } | null>(
    null
  );
  const changelogRef = useRef<HTMLDivElement>(null);
  const [editingAliases, setEditingAliases] = useState(false);
  const [localAliases, setLocalAliases] = useState(command.aliases);
  const [aliasesInput, setAliasesInput] = useState(command.aliases.join(", "));

  useEffect(() => {
    setLocalAliases(command.aliases);
    setAliasesInput(command.aliases.join(", "));
  }, [command.aliases]);

  const isDeprecated = command.status === "deprecated";
  const isArchived = command.status === "archived";
  const isInactive = isDeprecated || isArchived;

  const scrollToChangelog = () => {
    changelogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (shouldScrollToChangelog && command.changelog) {
      setTimeout(scrollToChangelog, 100);
    }
  }, [shouldScrollToChangelog, command.changelog]);

  const handleDeprecate = async () => {
    setLoading(true);
    try {
      await invoke("deprecate_command", {
        path: command.path,
        replacedBy: replacementCommand || null,
        note: deprecationNote || null,
      });
      setDeprecateDialogOpen(false);
      onCommandUpdated?.();
      onBack();
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    try {
      await invoke("restore_command", { path: command.path });
      onCommandUpdated?.();
      onBack();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAliases = async () => {
    const aliases = aliasesInput
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    try {
      await invoke("update_command_aliases", { path: command.path, aliases });
      setLocalAliases(aliases);
      setEditingAliases(false);
      onCommandUpdated?.();
    } catch (e) {
      console.error("Failed to update aliases:", e);
    }
  };

  const defaultAliasPlaceholder = (() => {
    const parts = command.name.split("/").filter(Boolean);
    if (parts.length <= 1) return "";
    const lastParts = parts.slice(-2);
    return "/" + lastParts.join("-");
  })();

  const handleAliasKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveAliases();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = aliasesInput.trimEnd();
      if (!trimmed && defaultAliasPlaceholder) {
        setAliasesInput(defaultAliasPlaceholder + ", ");
      } else if (trimmed && !trimmed.endsWith(",")) {
        setAliasesInput(trimmed + ", ");
      }
    }
  };

  const handleRename = async (newName: string, createDir = false) => {
    try {
      const newPath = await invoke<string>("rename_command", {
        path: command.path,
        newName,
        createDir,
      });
      onRenamed?.(newPath);
    } catch (e) {
      const error = String(e);
      if (error.startsWith("DIR_NOT_EXIST:")) {
        const dirPath = error.slice("DIR_NOT_EXIST:".length);
        setPendingRename({ newName, dirPath });
        setCreateDirDialogOpen(true);
      } else {
        console.error("Failed to rename command:", e);
      }
    }
  };

  const handleConfirmCreateDir = async () => {
    if (pendingRename) {
      setCreateDirDialogOpen(false);
      await handleRename(pendingRename.newName, true);
      setPendingRename(null);
    }
  };

  return (
    <ConfigPage>
      <DetailHeader
        title={command.name}
        description={command.description}
        backLabel="Commands"
        onBack={onBack}
        path={command.path}
        onOpenPath={(p) => invoke("open_in_editor", { path: p })}
        badge={command.version ? `v${command.version.replace(/^["']|["']$/g, "")}` : null}
        statusBadge={
          isDeprecated
            ? { label: "deprecated", variant: "warning" as const }
            : isArchived
              ? { label: "archived", variant: "muted" as const }
              : null
        }
        menuItems={
          isInactive
            ? [{ label: "Restore", onClick: handleRestore, icon: ResetIcon, disabled: loading }]
            : [
                {
                  label: "Deprecate",
                  onClick: () => setDeprecateDialogOpen(true),
                  icon: ArchiveIcon,
                  variant: "danger" as const,
                },
              ]
        }
        hasChangelog={!!command.changelog}
        onChangelogClick={scrollToChangelog}
        onRename={isInactive ? undefined : handleRename}
      />

      {isDeprecated && command.deprecated_by && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
          <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-600">
            This command is deprecated. Use{" "}
            <span className="font-mono font-medium">{command.deprecated_by}</span> instead.
          </p>
        </div>
      )}

      {isArchived && (
        <div className="mb-4 p-3 rounded-lg bg-card-alt border border-border flex items-center gap-2">
          <ArchiveIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            This is an archived version. It is not loaded by Claude Code.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {command.argument_hint && (
          <DetailCard label="Arguments">
            <p className="font-mono text-ink">{command.argument_hint}</p>
          </DetailCard>
        )}
        {command.allowed_tools && (
          <DetailCard label="Allowed Tools">
            <p className="font-mono text-sm text-ink">{command.allowed_tools}</p>
          </DetailCard>
        )}
        <DetailCard
          label="Aliases"
          action={
            editingAliases ? (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingAliases(false);
                    setAliasesInput(localAliases.join(", "));
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAliases}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingAliases(true)}
                className="text-xs text-muted-foreground hover:text-primary"
              >
                Edit
              </button>
            )
          }
        >
          {editingAliases ? (
            <Input
              value={aliasesInput}
              onChange={(e) => setAliasesInput(e.target.value)}
              onKeyDown={handleAliasKeyDown}
              placeholder={defaultAliasPlaceholder || "/old-name"}
              className="font-mono text-sm"
              autoFocus
            />
          ) : localAliases.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {localAliases.map((alias, i) => (
                <span
                  key={i}
                  className="font-mono text-sm px-2 py-0.5 rounded bg-primary/10 text-primary"
                >
                  {alias}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No aliases. Add previous command names to aggregate usage stats.
            </p>
          )}
        </DetailCard>
        {command.frontmatter && (
          <DetailCard label="Frontmatter">
            <pre className="font-mono text-sm text-ink whitespace-pre-wrap bg-card-alt p-3 rounded-lg overflow-x-auto">
              {command.frontmatter}
            </pre>
          </DetailCard>
        )}
        <ContentCard label="Content" content={command.content} />
        {command.changelog && (
          <div ref={changelogRef}>
            <ContentCard label="Changelog" content={command.changelog} />
          </div>
        )}
      </div>

      <Dialog open={deprecateDialogOpen} onOpenChange={setDeprecateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deprecate {command.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              This will move the file to <code>~/.claude/.commands/archived/</code>, outside the
              commands directory so Claude Code won't load it.
            </p>
            <div>
              <Label htmlFor="replacement">Replacement command (optional)</Label>
              <Input
                id="replacement"
                placeholder="/new-command"
                value={replacementCommand}
                onChange={(e) => setReplacementCommand(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="deprecation-note">Note (optional)</Label>
              <Input
                id="deprecation-note"
                placeholder="Reason for deprecation..."
                value={deprecationNote}
                onChange={(e) => setDeprecationNote(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeprecateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleDeprecate}
              disabled={loading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Deprecate
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createDirDialogOpen}
        onOpenChange={(open) => {
          setCreateDirDialogOpen(open);
          if (!open) setPendingRename(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Directory?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            The directory <code className="bg-card-alt px-1 rounded">{pendingRename?.dirPath}</code>{" "}
            does not exist. Create it?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCreateDirDialogOpen(false);
                setPendingRename(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmCreateDir}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfigPage>
  );
}
