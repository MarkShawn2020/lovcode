import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Play, Plus, Save, Trash2, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ENVIRONMENT_PLATFORMS,
  ensureEnvironmentConfig,
  getCurrentEnvironmentPlatform,
  getEnvironmentScript,
  getProjectName,
  hasEnvironmentScript,
} from "@/lib/agent/environment";
import type {
  EnvironmentAction,
  EnvironmentConfig,
  EnvironmentPlatform,
  EnvironmentScope,
} from "@/types/agent";

export type EnvironmentRunKind = "setup" | "cleanup" | "action";

interface EnvironmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string | null;
  sessionKey: string | null;
  sessionTitle?: string | null;
  projectConfig?: EnvironmentConfig | null;
  sessionConfig?: EnvironmentConfig | null;
  defaultScope: EnvironmentScope;
  onSave: (scope: EnvironmentScope, config: EnvironmentConfig) => void;
  onRun: (
    scope: EnvironmentScope,
    kind: EnvironmentRunKind,
    config: EnvironmentConfig,
    action?: EnvironmentAction,
  ) => void;
}

export function EnvironmentDialog({
  open,
  onOpenChange,
  projectPath,
  sessionKey,
  sessionTitle,
  projectConfig,
  sessionConfig,
  defaultScope,
  onSave,
  onRun,
}: EnvironmentDialogProps) {
  const currentPlatform = useMemo(() => getCurrentEnvironmentPlatform(), []);
  const [scope, setScope] = useState<EnvironmentScope>("project");
  const [draft, setDraft] = useState<EnvironmentConfig | null>(null);
  const [setupPlatform, setSetupPlatform] = useState<EnvironmentPlatform>(currentPlatform);
  const [cleanupPlatform, setCleanupPlatform] = useState<EnvironmentPlatform>(currentPlatform);
  const [actionPlatforms, setActionPlatforms] = useState<Record<string, EnvironmentPlatform>>({});

  const projectName = getProjectName(projectPath);
  const activeConfig = scope === "session" ? sessionConfig : projectConfig;
  const activeName = scope === "session" ? sessionTitle || projectName : projectName;
  const sessionEnabled = Boolean(sessionKey);

  useEffect(() => {
    if (!open) return;
    setScope(defaultScope === "session" && sessionEnabled ? "session" : "project");
  }, [defaultScope, open, sessionEnabled]);

  useEffect(() => {
    if (!open) return;
    const next = ensureEnvironmentConfig(activeConfig, activeName);
    setDraft(next);
    setSetupPlatform(currentPlatform);
    setCleanupPlatform(currentPlatform);
    setActionPlatforms(
      Object.fromEntries(next.actions.map((action) => [action.id, currentPlatform])),
    );
  }, [activeConfig, activeName, currentPlatform, open, scope]);

  const updateDraft = (updater: (config: EnvironmentConfig) => EnvironmentConfig) => {
    setDraft((current) => updater(current ?? ensureEnvironmentConfig(activeConfig, activeName)));
  };

  const saveDraft = (nextDraft = draft) => {
    if (!nextDraft || !projectPath) return;
    const next = { ...nextDraft, updatedAt: Date.now() };
    setDraft(next);
    onSave(scope, next);
  };

  const runDraft = (kind: EnvironmentRunKind, action?: EnvironmentAction) => {
    if (!draft || !projectPath) return;
    const next = { ...draft, updatedAt: Date.now() };
    setDraft(next);
    onSave(scope, next);
    onRun(scope, kind, next, action);
    onOpenChange(false);
  };

  const addAction = () => {
    updateDraft((config) => {
      const action: EnvironmentAction = {
        id: crypto.randomUUID(),
        name: "Run",
        scripts: { default: "" },
        platformSpecific: false,
      };
      setActionPlatforms((prev) => ({ ...prev, [action.id]: currentPlatform }));
      return { ...config, actions: [...config.actions, action] };
    });
  };

  if (!projectPath || !draft) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Environment</DialogTitle>
            <DialogDescription>Select a project before editing environment settings.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const setupRunnable = hasEnvironmentScript(draft.setupScripts, currentPlatform);
  const cleanupRunnable = hasEnvironmentScript(draft.cleanupScripts, currentPlatform);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="font-serif text-2xl">Environment</DialogTitle>
              <DialogDescription className="mt-2">
                {scope === "session" ? "Session runtime" : "Project runtime"}
              </DialogDescription>
            </div>
            <div className="inline-flex rounded-lg bg-card-alt p-1">
              <ScopeButton active={scope === "project"} onClick={() => setScope("project")}>
                Project
              </ScopeButton>
              <ScopeButton
                active={scope === "session"}
                disabled={!sessionEnabled}
                onClick={() => setScope("session")}
              >
                Session
              </ScopeButton>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 px-6 py-5">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card-alt text-muted-foreground">
                <FolderOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{projectName}</div>
                <div className="truncate font-mono text-xs text-muted-foreground" title={projectPath}>
                  {projectPath}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="environment-name">Name</Label>
            <Input
              id="environment-name"
              value={draft.name}
              onChange={(event) => updateDraft((config) => ({ ...config, name: event.target.value }))}
            />
          </div>

          <ScriptBlock
            title="Setup script"
            scripts={draft.setupScripts}
            activePlatform={setupPlatform}
            currentPlatform={currentPlatform}
            onPlatformChange={setSetupPlatform}
            onChange={(platform, value) =>
              updateDraft((config) => ({
                ...config,
                setupScripts: { ...config.setupScripts, [platform]: value },
              }))
            }
            onRun={() => runDraft("setup")}
            canRun={setupRunnable}
            placeholder={`cd "$CODEX_WORKTREE_PATH"\npnpm install`}
          />

          <ScriptBlock
            title="Cleanup script"
            scripts={draft.cleanupScripts}
            activePlatform={cleanupPlatform}
            currentPlatform={currentPlatform}
            onPlatformChange={setCleanupPlatform}
            onChange={(platform, value) =>
              updateDraft((config) => ({
                ...config,
                cleanupScripts: { ...config.cleanupScripts, [platform]: value },
              }))
            }
            onRun={() => runDraft("cleanup")}
            canRun={cleanupRunnable}
            placeholder={`docker compose down --remove-orphans\nrm -rf .cache/tmp`}
          />

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-serif text-lg font-semibold text-foreground">Actions</h3>
                <div className="mt-1 text-sm text-muted-foreground">Commands shown in the runtime header.</div>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={addAction} className="gap-2">
                <Plus className="h-4 w-4" />
                Add action
              </Button>
            </div>

            <div className="space-y-3">
              {draft.actions.map((action) => {
                const actionPlatform = actionPlatforms[action.id] ?? currentPlatform;
                const scriptPlatform = action.platformSpecific ? actionPlatform : "default";
                const runnable = action.platformSpecific
                  ? hasEnvironmentScript(action.scripts, currentPlatform)
                  : Boolean(action.scripts.default?.trim());

                return (
                  <div key={action.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!runnable}
                        onClick={() => runDraft("action", action)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card-alt text-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
                        title={`Run ${action.name || "action"}`}
                        aria-label={`Run ${action.name || "action"}`}
                      >
                        <Play className="h-4 w-4" />
                      </button>
                      <Input
                        value={action.name}
                        onChange={(event) =>
                          updateDraft((config) => ({
                            ...config,
                            actions: config.actions.map((item) =>
                              item.id === action.id ? { ...item, name: event.target.value } : item,
                            ),
                          }))
                        }
                        aria-label="Action name"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft((config) => ({
                            ...config,
                            actions: config.actions.filter((item) => item.id !== action.id),
                          }))
                        }
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-destructive"
                        title="Delete action"
                        aria-label="Delete action"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={Boolean(action.platformSpecific)}
                        onCheckedChange={(checked) =>
                          updateDraft((config) => ({
                            ...config,
                            actions: config.actions.map((item) =>
                              item.id === action.id ? { ...item, platformSpecific: checked } : item,
                            ),
                          }))
                        }
                      />
                      <span>Platform specific</span>
                    </div>

                    {action.platformSpecific && (
                      <PlatformTabs
                        activePlatform={actionPlatform}
                        currentPlatform={currentPlatform}
                        onPlatformChange={(platform) =>
                          setActionPlatforms((prev) => ({ ...prev, [action.id]: platform }))
                        }
                        className="mt-3"
                      />
                    )}

                    <textarea
                      value={action.scripts[scriptPlatform] ?? ""}
                      onChange={(event) =>
                        updateDraft((config) => ({
                          ...config,
                          actions: config.actions.map((item) =>
                            item.id === action.id
                              ? {
                                  ...item,
                                  scripts: { ...item.scripts, [scriptPlatform]: event.target.value },
                                }
                              : item,
                          ),
                        }))
                      }
                      placeholder="pnpm dev"
                      className="mt-3 min-h-28 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                    />
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Wrench className="h-3.5 w-3.5" />
              <code>CODEX_WORKTREE_PATH</code>
              <code>CODEX_SOURCE_TREE_PATH</code>
              <code>LOVCODE_PROJECT_PATH</code>
            </div>
            <Button type="button" onClick={() => saveDraft()} className="gap-2">
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-40",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ScriptBlock({
  title,
  scripts,
  activePlatform,
  currentPlatform,
  onPlatformChange,
  onChange,
  onRun,
  canRun,
  placeholder,
}: {
  title: string;
  scripts: Partial<Record<EnvironmentPlatform, string>>;
  activePlatform: EnvironmentPlatform;
  currentPlatform: EnvironmentPlatform;
  onPlatformChange: (platform: EnvironmentPlatform) => void;
  onChange: (platform: EnvironmentPlatform, value: string) => void;
  onRun: () => void;
  canRun: boolean;
  placeholder: string;
}) {
  const selectedScript = scripts[activePlatform] ?? "";
  const currentScript = getEnvironmentScript(scripts, currentPlatform);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-semibold text-foreground">{title}</h3>
          <div className="mt-1 text-sm text-muted-foreground">
            {currentScript ? `${ENVIRONMENT_PLATFORMS.find((item) => item.key === currentPlatform)?.label ?? "Current"} script ready` : "No script for this platform"}
          </div>
        </div>
        <button
          type="button"
          disabled={!canRun}
          onClick={onRun}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-card-alt disabled:opacity-40"
        >
          <Play className="h-4 w-4" />
          Run
        </button>
      </div>
      <PlatformTabs
        activePlatform={activePlatform}
        currentPlatform={currentPlatform}
        onPlatformChange={onPlatformChange}
      />
      <textarea
        value={selectedScript}
        onChange={(event) => onChange(activePlatform, event.target.value)}
        placeholder={placeholder}
        className="min-h-40 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
      />
    </section>
  );
}

function PlatformTabs({
  activePlatform,
  currentPlatform,
  onPlatformChange,
  className,
}: {
  activePlatform: EnvironmentPlatform;
  currentPlatform: EnvironmentPlatform;
  onPlatformChange: (platform: EnvironmentPlatform) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {ENVIRONMENT_PLATFORMS.map((platform) => (
        <button
          key={platform.key}
          type="button"
          onClick={() => onPlatformChange(platform.key)}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors",
            activePlatform === platform.key
              ? "bg-primary text-primary-foreground"
              : "bg-card-alt text-muted-foreground hover:text-foreground",
          )}
        >
          {platform.label}
          {platform.key === currentPlatform && (
            <span className={cn("h-1.5 w-1.5 rounded-full", activePlatform === platform.key ? "bg-primary-foreground" : "bg-primary")} />
          )}
        </button>
      ))}
    </div>
  );
}
