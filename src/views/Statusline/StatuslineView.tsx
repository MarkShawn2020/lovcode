import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RowsIcon, Pencil1Icon, CheckIcon, Cross1Icon, TrashIcon, ChevronDownIcon, ResetIcon } from "@radix-ui/react-icons";
import { ConfigPage, PageHeader, EmptyState, LoadingState } from "../../components/config";
import { CollapsibleCard, CodePreview } from "../../components/shared";
import { Button } from "../../components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../../components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";
import { useInvokeQuery, useQueryClient } from "../../hooks";
import type { ClaudeSettings, TemplateComponent } from "../../types";

const JSON_REFERENCE = `{
  "hook_event_name": "Status",
  "session_id": "abc123...",
  "cwd": "/current/working/directory",
  "model": {
    "id": "claude-opus-4-1",
    "display_name": "Opus"
  },
  "workspace": {
    "current_dir": "/current/directory",
    "project_dir": "/project/directory"
  },
  "version": "1.0.80",
  "cost": {
    "total_cost_usd": 0.01234,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },
  "context_window": {
    "total_input_tokens": 15234,
    "context_window_size": 200000,
    "current_usage": { ... }
  }
}`;

interface StatusLineConfig {
  type: "command";
  command: string;
  padding?: number;
}

interface StatuslineViewProps {
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function StatuslineView({ onMarketplaceSelect }: StatuslineViewProps) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useInvokeQuery<ClaudeSettings>(["settings"], "get_settings");
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState("");
  const [padding, setPadding] = useState<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const statusLine = settings?.raw && typeof settings.raw === "object"
    ? (settings.raw as Record<string, unknown>).statusLine as StatusLineConfig | undefined
    : undefined;

  const [scriptContent, setScriptContent] = useState<string | null>(null);
  const [loadingScript, setLoadingScript] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);

  // Check if previous backup exists
  useEffect(() => {
    invoke<boolean>("has_previous_statusline").then(setHasPrevious).catch(() => setHasPrevious(false));
  }, []);

  useEffect(() => {
    if (statusLine) {
      setCommand(statusLine.command || "");
      setPadding(statusLine.padding);
      // Load script content - expand ~ to home dir
      setLoadingScript(true);
      (async () => {
        try {
          const homeDir = await invoke<string>("get_home_dir");
          const scriptPath = statusLine.command.replace(/^~/, homeDir);
          const content = await invoke<string>("read_file", { path: scriptPath });
          setScriptContent(content);
        } catch {
          setScriptContent(null);
        } finally {
          setLoadingScript(false);
        }
      })();
    }
  }, [statusLine]);

  const refreshSettings = () => {
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  const handleSave = async () => {
    if (!command.trim()) return;
    setSaving(true);
    try {
      const newStatusLine: StatusLineConfig = {
        type: "command",
        command: command.trim(),
      };
      if (padding !== undefined && padding >= 0) {
        newStatusLine.padding = padding;
      }
      await invoke("update_settings_statusline", { statusline: newStatusLine });
      refreshSettings();
      setEditing(false);
    } catch (e) {
      console.error("Failed to save statusline:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await invoke("remove_settings_statusline");
      refreshSettings();
      setCommand("");
      setPadding(undefined);
      setScriptContent(null);
    } catch (e) {
      console.error("Failed to remove statusline:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    setSaving(true);
    try {
      await invoke("restore_previous_statusline");
      refreshSettings();
      setHasPrevious(false);
      // Reload script content
      const homeDir = await invoke<string>("get_home_dir");
      const scriptPath = "~/.claude/statusline.sh".replace(/^~/, homeDir);
      const content = await invoke<string>("read_file", { path: scriptPath });
      setScriptContent(content);
    } catch (e) {
      console.error("Failed to restore statusline:", e);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <LoadingState message="Loading settings..." />;

  return (
    <ConfigPage>
      <PageHeader
        title="Status Line"
        subtitle="Customize Claude Code's CLI status bar"
      />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">已安装</TabsTrigger>
          <TabsTrigger value="marketplace">市场</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          <CollapsibleCard
            storageKey="lovcode:statusline:configOpen"
            title="Current Configuration"
            subtitle={statusLine ? `Command: ${statusLine.command}` : "Not configured"}
            bodyClassName="p-4 space-y-4"
            defaultOpen
          >
            {statusLine && !editing ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20">Command</span>
                  <code className="text-xs px-2 py-1 rounded bg-muted text-ink font-mono flex-1">
                    {statusLine.command}
                  </code>
                </div>
                {statusLine.padding !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-20">Padding</span>
                    <span className="text-xs text-ink">{statusLine.padding}</span>
                  </div>
                )}
                {scriptContent !== null && (
                  <Collapsible defaultOpen>
                    <div className="rounded-lg border border-border overflow-hidden">
                      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors">
                        <span className="text-xs font-medium text-ink">Script Content</span>
                        <ChevronDownIcon className="w-4 h-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CodePreview value={scriptContent} language="shell" height={300} />
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                )}
                {loadingScript && (
                  <p className="text-xs text-muted-foreground">Loading script...</p>
                )}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil1Icon className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={handleRemove} disabled={saving}>
                    <TrashIcon className="w-4 h-4 mr-1" />
                    Remove
                  </Button>
                  {hasPrevious && (
                    <Button size="sm" variant="outline" onClick={handleRestore} disabled={saving}>
                      <ResetIcon className="w-4 h-4 mr-1" />
                      Restore Previous
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-ink">Command</label>
                  <input
                    className="w-full text-xs px-3 py-2 rounded-lg bg-canvas border border-border text-ink font-mono"
                    placeholder="~/.claude/statusline.sh"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Path to script that outputs status line text. Receives session JSON via stdin.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-ink">Padding</label>
                  <input
                    type="number"
                    min={0}
                    className="w-24 text-xs px-3 py-2 rounded-lg bg-canvas border border-border text-ink"
                    placeholder="0"
                    value={padding ?? ""}
                    onChange={(e) => setPadding(e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Set to 0 to let status line extend to edge. Leave empty for default.
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={handleSave} disabled={!command.trim() || saving}>
                    <CheckIcon className="w-4 h-4 mr-1" />
                    Save
                  </Button>
                  {statusLine && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setEditing(false);
                      setCommand(statusLine.command || "");
                      setPadding(statusLine.padding);
                    }}>
                      <Cross1Icon className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CollapsibleCard>

          <CollapsibleCard
            storageKey="lovcode:statusline:helpOpen"
            title="JSON Input Reference"
            subtitle="Data available to your statusline script"
            bodyClassName="p-4"
          >
            <CodePreview value={JSON_REFERENCE} language="json" height={280} />
            <p className="text-[10px] text-muted-foreground mt-2">
              Use <code className="bg-muted px-1 rounded">jq</code> to parse JSON in bash scripts.
            </p>
          </CollapsibleCard>

          {!statusLine && !editing && (
            <div className="text-center py-8">
              <EmptyState
                icon={RowsIcon}
                message="No status line configured"
                hint="Browse marketplace to install statusline templates"
              />
              <Button className="mt-4" onClick={() => setEditing(true)}>
                Configure Status Line
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="statuslines" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
