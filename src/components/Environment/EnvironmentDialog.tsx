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
import { ProjectPathPicker, type ProjectPathOption } from "@/components/shared/ProjectPathPicker";
import { useI18n } from "@/i18n";
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

export interface EnvironmentEditorProps {
  projectPath: string | null;
  sessionKey: string | null;
  sessionTitle?: string | null;
  globalConfig?: EnvironmentConfig | null;
  projectConfig?: EnvironmentConfig | null;
  sessionConfig?: EnvironmentConfig | null;
  projectOptions?: ProjectPathOption[];
  defaultScope: EnvironmentScope;
  onSave: (scope: EnvironmentScope, config: EnvironmentConfig) => void;
  onPickProjectFolder?: () => void;
  onProjectPathChange?: (path: string) => void;
  onRun?: (
    scope: EnvironmentScope,
    kind: EnvironmentRunKind,
    config: EnvironmentConfig,
    action?: EnvironmentAction,
  ) => void;
  active?: boolean;
  onRequestClose?: () => void;
  embedded?: boolean;
  showRunControls?: boolean;
  showScopeControls?: boolean;
}

interface EnvironmentDialogProps extends EnvironmentEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRun: NonNullable<EnvironmentEditorProps["onRun"]>;
}

export function EnvironmentDialog({
  open,
  onOpenChange,
  projectPath,
  sessionKey,
  sessionTitle,
  globalConfig,
  projectConfig,
  sessionConfig,
  projectOptions,
  defaultScope,
  onSave,
  onPickProjectFolder,
  onProjectPathChange,
  onRun,
}: EnvironmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col !overflow-hidden p-0">
        <EnvironmentEditor
          active={open}
          projectPath={projectPath}
          sessionKey={sessionKey}
          sessionTitle={sessionTitle}
          globalConfig={globalConfig}
          projectConfig={projectConfig}
          sessionConfig={sessionConfig}
          projectOptions={projectOptions}
          defaultScope={defaultScope}
          onSave={onSave}
          onPickProjectFolder={onPickProjectFolder}
          onProjectPathChange={onProjectPathChange}
          onRun={onRun}
          onRequestClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function EnvironmentEditor({
  projectPath,
  sessionTitle,
  globalConfig,
  projectConfig,
  sessionConfig,
  projectOptions = [],
  defaultScope,
  onSave,
  onPickProjectFolder,
  onProjectPathChange,
  onRun,
  active = true,
  onRequestClose,
  embedded = false,
  showRunControls = true,
  showScopeControls = true,
}: EnvironmentEditorProps) {
  const { t } = useI18n();
  const currentPlatform = useMemo(() => getCurrentEnvironmentPlatform(), []);
  const [scope, setScope] = useState<EnvironmentScope>(defaultScope);
  const [draft, setDraft] = useState<EnvironmentConfig | null>(null);
  const [setupPlatform, setSetupPlatform] = useState<EnvironmentPlatform>(currentPlatform);
  const [cleanupPlatform, setCleanupPlatform] = useState<EnvironmentPlatform>(currentPlatform);
  const [actionPlatforms, setActionPlatforms] = useState<Record<string, EnvironmentPlatform>>({});

  const projectName = getProjectName(projectPath);
  const activeConfig =
    scope === "global" ? globalConfig : scope === "session" ? sessionConfig : projectConfig;
  const activeName =
    scope === "global"
      ? t("environment.globalRuntime")
      : scope === "session"
        ? sessionTitle || t("environment.projectSessions", { project: projectName })
        : projectName;
  const scopeDescription =
    scope === "global"
      ? t("environment.globalRuntime")
      : scope === "session"
      ? t("environment.sessionRuntime")
      : t("environment.projectRuntime");
  const canRunInScope = Boolean(projectPath);
  const canChooseProject = Boolean(onProjectPathChange && projectOptions.length > 0) || Boolean(onPickProjectFolder);
  const canSave = scope === "global" || Boolean(projectPath);

  useEffect(() => {
    if (!active) return;
    setScope(defaultScope);
  }, [active, defaultScope]);

  useEffect(() => {
    if (!active) return;
    const next = ensureEnvironmentConfig(activeConfig, activeName);
    setDraft(next);
    setSetupPlatform(currentPlatform);
    setCleanupPlatform(currentPlatform);
    setActionPlatforms(
      Object.fromEntries(next.actions.map((action) => [action.id, currentPlatform])),
    );
  }, [active, activeConfig, activeName, currentPlatform, scope]);

  const updateDraft = (updater: (config: EnvironmentConfig) => EnvironmentConfig) => {
    setDraft((current) => updater(current ?? ensureEnvironmentConfig(activeConfig, activeName)));
  };

  const saveDraft = (nextDraft = draft) => {
    if (!nextDraft || (scope !== "global" && !projectPath)) return;
    const next = { ...nextDraft, updatedAt: Date.now() };
    setDraft(next);
    onSave(scope, next);
  };

  const runDraft = (kind: EnvironmentRunKind, action?: EnvironmentAction) => {
    if (!draft || !projectPath) return;
    const next = { ...draft, updatedAt: Date.now() };
    setDraft(next);
    onSave(scope, next);
    onRun?.(scope, kind, next, action);
    onRequestClose?.();
  };

  const addAction = () => {
    updateDraft((config) => {
      const action: EnvironmentAction = {
        id: crypto.randomUUID(),
        name: t("environment.run"),
        scripts: { default: "" },
        platformSpecific: false,
      };
      setActionPlatforms((prev) => ({ ...prev, [action.id]: currentPlatform }));
      return { ...config, actions: [...config.actions, action] };
    });
  };

  if (!draft) {
    return (
      <div className={embedded ? "rounded-xl border border-dashed border-border bg-background px-4 py-8" : "px-6 py-5"}>
        <DialogHeader>
          <DialogTitle className="font-serif">{t("common.environment")}</DialogTitle>
          <DialogDescription>{t("environment.loadingSettings")}</DialogDescription>
        </DialogHeader>
      </div>
    );
  }

  if (scope !== "global" && !projectPath && !canChooseProject) {
    return (
      <div className={embedded ? "rounded-xl border border-dashed border-border bg-background px-4 py-8" : "px-6 py-5"}>
        <DialogHeader>
          <DialogTitle className="font-serif">{t("common.environment")}</DialogTitle>
          <DialogDescription>{t("environment.selectProjectBeforeEditing")}</DialogDescription>
        </DialogHeader>
      </div>
    );
  }

  const setupRunnable = hasEnvironmentScript(draft.setupScripts, currentPlatform);
  const cleanupRunnable = hasEnvironmentScript(draft.cleanupScripts, currentPlatform);

  return (
    <div className={cn(embedded ? "min-h-0" : "flex max-h-[88vh] min-h-0 flex-col")}>
        <DialogHeader className={`border-b border-border ${embedded ? "px-0 pb-4" : "px-6 py-5"}`}>
          <div className={`flex items-start justify-between gap-4 ${embedded ? "" : "pr-8"}`}>
            <div className="min-w-0">
              <DialogTitle className="font-serif text-2xl">{t("common.environment")}</DialogTitle>
              <DialogDescription className="mt-2">
                {scopeDescription}
              </DialogDescription>
            </div>
            {showScopeControls ? (
              <div className="inline-flex rounded-lg bg-card-alt p-1">
                <ScopeButton active={scope === "global"} onClick={() => setScope("global")}>
                  {t("common.global")}
                </ScopeButton>
                <ScopeButton
                  active={scope === "project"}
                  disabled={!projectPath && !canChooseProject}
                  onClick={() => setScope("project")}
                >
                  {t("common.project")}
                </ScopeButton>
                <ScopeButton
                  active={scope === "session"}
                  disabled={!projectPath && !canChooseProject}
                  onClick={() => setScope("session")}
                >
                  {t("common.session")}
                </ScopeButton>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <div className={`space-y-4 ${embedded ? "py-4" : "min-h-0 flex-1 overflow-y-auto px-5 py-4"}`}>
          <div className="grid gap-4 rounded-xl border border-border bg-card px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-end">
            {scope === "global" ? (
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card-alt text-muted-foreground">
                  <Wrench className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{t("environment.globalEnvironment")}</div>
                  <div className="truncate font-mono text-xs leading-5 text-muted-foreground">
                    {t("environment.globalFallback")}
                  </div>
                </div>
              </div>
            ) : (
              <ProjectPathPicker
                cwd={projectPath}
                label={projectPath ? projectName : undefined}
                hasProjectPath={Boolean(projectPath)}
                pathOptions={onProjectPathChange ? projectOptions : []}
                emptyLabel={t("environment.selectProject")}
                emptyEyebrow={t("common.project")}
                emptyIcon={<FolderOpen className="h-3.5 w-3.5" />}
                onPickFolder={onPickProjectFolder}
                onSelectCwd={
                  onProjectPathChange
                    ? (path) => {
                        if (path) onProjectPathChange(path);
                      }
                    : undefined
                }
                className="h-11 w-full border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:ring-0"
              />
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="environment-name" className="text-xs text-muted-foreground">
                {t("common.name")}
              </Label>
              <Input
                id="environment-name"
                value={draft.name}
                onChange={(event) => updateDraft((config) => ({ ...config, name: event.target.value }))}
                className="h-9"
              />
            </div>
          </div>

          <ScriptBlock
            title={t("environment.setup")}
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
            canRun={showRunControls && Boolean(onRun) && canRunInScope && setupRunnable}
            showRunControls={showRunControls}
            placeholder={`cd "$CODEX_WORKTREE_PATH"\npnpm install`}
          />

          <ScriptBlock
            title={t("environment.cleanup")}
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
            canRun={showRunControls && Boolean(onRun) && canRunInScope && cleanupRunnable}
            showRunControls={showRunControls}
            placeholder={`docker compose down --remove-orphans\nrm -rf .cache/tmp`}
          />

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div>
                <h3 className="font-serif text-base font-semibold text-foreground">{t("environment.actions")}</h3>
                <div className="mt-0.5 text-xs text-muted-foreground">{t("environment.runtimeHeaderCommands")}</div>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={addAction} className="h-8 gap-1.5 rounded-lg px-2.5 text-xs">
                <Plus className="h-3.5 w-3.5" />
                {t("common.add")}
              </Button>
            </div>

            <div>
              {draft.actions.map((action) => {
                const actionPlatform = actionPlatforms[action.id] ?? currentPlatform;
                const scriptPlatform = action.platformSpecific ? actionPlatform : "default";
                const runnable = action.platformSpecific
                  ? hasEnvironmentScript(action.scripts, currentPlatform)
                  : Boolean(action.scripts.default?.trim());

                return (
                  <div key={action.id} className="border-t border-border px-3 py-3 first:border-t-0">
                    <div className="flex items-center gap-2">
                      {showRunControls && (
                        <button
                          type="button"
                          disabled={!onRun || !canRunInScope || !runnable}
                          onClick={() => runDraft("action", action)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card-alt text-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
                          title={t("environment.runAction", { name: action.name || t("environment.actionFallback") })}
                          aria-label={t("environment.runAction", { name: action.name || t("environment.actionFallback") })}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
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
                        aria-label={t("environment.actionName")}
                        className="h-8"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateDraft((config) => ({
                            ...config,
                            actions: config.actions.filter((item) => item.id !== action.id),
                          }))
                        }
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-destructive"
                        title={t("environment.deleteAction")}
                        aria-label={t("environment.deleteAction")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
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
                      <span>{t("environment.platformSpecific")}</span>
                    </div>

                    {action.platformSpecific && (
                      <PlatformTabs
                        activePlatform={actionPlatform}
                        currentPlatform={currentPlatform}
                        onPlatformChange={(platform) =>
                          setActionPlatforms((prev) => ({ ...prev, [action.id]: platform }))
                        }
                        className="mt-2"
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
                      className="mt-2 min-h-20 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                    />
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <DialogFooter className={`border-t border-border ${embedded ? "px-0 pt-4" : "px-6 py-4"}`}>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              className="text-xs text-muted-foreground"
              title={t("environment.scriptsContextTitle")}
            >
              {t("environment.scriptsRunSelectedContext")}
            </p>
            <Button type="button" disabled={!canSave} onClick={() => saveDraft()} className="gap-2">
              <Save className="h-4 w-4" />
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
    </div>
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
  showRunControls = true,
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
  showRunControls?: boolean;
  placeholder: string;
}) {
  const { t } = useI18n();
  const selectedScript = scripts[activePlatform] ?? "";
  const currentScript = getEnvironmentScript(scripts, currentPlatform);

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h3 className="font-serif text-base font-semibold text-foreground">{title}</h3>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {currentScript
              ? t("environment.platformReady", {
                  platform: ENVIRONMENT_PLATFORMS.find((item) => item.key === currentPlatform)?.label ?? t("common.current"),
                })
              : t("environment.noCurrentPlatformScript")}
          </div>
        </div>
        {showRunControls && (
          <button
            type="button"
            disabled={!canRun}
            onClick={onRun}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-card-alt disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            {t("environment.run")}
          </button>
        )}
      </div>
      <div className="space-y-2 px-3 py-3">
        <PlatformTabs
          activePlatform={activePlatform}
          currentPlatform={currentPlatform}
          onPlatformChange={onPlatformChange}
        />
        <textarea
          value={selectedScript}
          onChange={(event) => onChange(activePlatform, event.target.value)}
          placeholder={placeholder}
          className="min-h-28 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
      </div>
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
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {ENVIRONMENT_PLATFORMS.map((platform) => (
        <button
          key={platform.key}
          type="button"
          onClick={() => onPlatformChange(platform.key)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors",
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
