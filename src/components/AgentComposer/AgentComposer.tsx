import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Check, ChevronDown, Cpu, FolderOpen, MessageSquare, SendHorizontal, Terminal } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentProvider } from "@/types/agent";
import type { ClaudeSettings, MaasModel, MaasProvider } from "@/types";
import { labelForProvider } from "@/lib/agent/commands";
import { cn } from "@/lib/utils";

const PROVIDERS: AgentProvider[] = ["claude", "codex", "terminal"];
const MAAS_RUNTIME_LABELS = {
  "claude-code": "Claude Code",
  codex: "Codex",
} as const;
type MaasRuntimeId = keyof typeof MAAS_RUNTIME_LABELS;
const IME_ENTER_GUARD_MS = 160;
const TEXTAREA_BOUNDS = {
  panel: { min: 112, max: 280 },
  dock: { min: 28, max: 152 },
};
const AGENT_ICON_SRC: Partial<Record<AgentProvider, string>> = {
  claude: "/agent-icons/claude.png",
  codex: "/agent-icons/openai.png",
};
const PICKER_TRIGGER_BASE_CLASS =
  "inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card-alt/60 px-3 text-left shadow-sm transition-[background-color,border-color,box-shadow] hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PICKER_TRIGGER_SIZE_CLASS = {
  compact: "h-9",
  default: "h-11",
};
const PICKER_ICON_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border/70";

export interface AgentComposerPathOption {
  path: string;
  label?: string;
  detail?: string;
}

interface AgentComposerProps {
  cwd: string | null;
  cwdLabel?: string;
  hasProjectPath?: boolean;
  pathOptions?: AgentComposerPathOption[];
  allowNoProject?: boolean;
  disabled?: boolean;
  variant?: "dock" | "panel";
  autoFocus?: boolean;
  placeholder?: string;
  submitLabel?: string;
  onCancel?: () => void;
  onPickFolder?: () => void;
  onSelectCwd?: (path: string | null) => void;
  onCreate: (provider: AgentProvider, prompt: string) => void;
}

export function AgentComposer({
  cwd,
  cwdLabel,
  hasProjectPath,
  pathOptions = [],
  allowNoProject = false,
  disabled = false,
  variant = "dock",
  autoFocus = false,
  placeholder,
  submitLabel,
  onCancel,
  onPickFolder,
  onSelectCwd,
  onCreate,
}: AgentComposerProps) {
  const [provider, setProvider] = useState<AgentProvider>("claude");
  const [prompt, setPrompt] = useState("");
  const [maasRegistry, setMaasRegistry] = useState<MaasProvider[]>([]);
  const [settingsRaw, setSettingsRaw] = useState<ClaudeSettings["raw"] | undefined>(undefined);
  const [maasLoaded, setMaasLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const compositionEndAtRef = useRef(0);
  const canSubmit = (Boolean(cwd) || allowNoProject) && !disabled;
  const isPanel = variant === "panel";
  const textareaBounds = isPanel ? TEXTAREA_BOUNDS.panel : TEXTAREA_BOUNDS.dock;
  const submitTitle = submitLabel ?? (isPanel ? "Start" : "Start session");
  const displayCwdLabel = cwdLabel ?? (cwd ? undefined : allowNoProject ? "General chat" : undefined);
  const placeholderText =
    placeholder ??
    (cwd
      ? provider === "terminal"
        ? "Open a shell in this project"
        : `Start ${labelForProvider(provider)} with a task`
      : !allowNoProject
      ? "Select a project to start"
      : provider === "terminal"
      ? "Open a shell without a project"
      : `Start ${labelForProvider(provider)} without a project`);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<MaasProvider[]>("get_maas_registry"),
      invoke<ClaudeSettings>("get_settings"),
    ])
      .then(([registry, settings]) => {
        if (cancelled) return;
        setMaasRegistry(registry);
        setSettingsRaw(settings.raw);
      })
      .catch(() => {
        if (cancelled) return;
        setMaasRegistry([]);
        setSettingsRaw(undefined);
      })
      .finally(() => {
        if (!cancelled) setMaasLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isImeConfirming = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    return (
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      composingRef.current ||
      Date.now() - compositionEndAtRef.current < IME_ENTER_GUARD_MS
    );
  };

  const submit = () => {
    if (!canSubmit) return;
    onCreate(provider, prompt);
    setPrompt("");
    requestAnimationFrame(() => {
      if (textareaRef.current) resizeTextarea(textareaRef.current, textareaBounds.min, textareaBounds.max);
    });
  };

  const focusPrompt = () => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleProviderChange = (item: AgentProvider) => {
    setProvider(item);
    focusPrompt();
  };

  const handlePromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(event.target.value);
    resizeTextarea(event.target, textareaBounds.min, textareaBounds.max);
  };

  const providerPicker = (
    <CliPicker
      provider={provider}
      onProviderChange={handleProviderChange}
      className="w-[11.5rem] max-w-full"
    />
  );
  const modelPicker = (
    <ModelPicker
      agentProvider={provider}
      registry={maasRegistry}
      settingsRaw={settingsRaw}
      loaded={maasLoaded}
      className="w-[13rem] max-w-full"
    />
  );

  if (isPanel) {
    return (
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-primary/5">
        <div className="border-b border-border bg-card-alt/35 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-serif text-2xl font-semibold text-foreground">New session</h2>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="p-5">
          <ComposerInputFrame>
            <PromptTextarea
              ref={textareaRef}
              rows={4}
              value={prompt}
              disabled={!canSubmit}
              minClassName="min-h-28"
              placeholder={placeholderText}
              onChange={handlePromptChange}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                compositionEndAtRef.current = Date.now();
                requestAnimationFrame(() => {
                  composingRef.current = false;
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Process" || isImeConfirming(event)) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </ComposerInputFrame>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ProjectPathPill
                cwd={cwd}
                label={displayCwdLabel}
                hasProjectPath={hasProjectPath}
                pathOptions={pathOptions}
                allowNoProject={allowNoProject}
                onPickFolder={onPickFolder}
                onSelectCwd={onSelectCwd}
                compact
                className="w-[11.5rem] max-w-full shrink-0"
              />
              {providerPicker}
              {modelPicker}
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <SendHorizontal className="h-4 w-4" />
              {submitTitle}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-background px-5 py-3">
      <div className="mx-auto flex w-full flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">{providerPicker}</div>
          <ProjectPathPill
            cwd={cwd}
            label={displayCwdLabel}
            hasProjectPath={hasProjectPath}
            pathOptions={pathOptions}
            allowNoProject={allowNoProject}
            onPickFolder={onPickFolder}
            onSelectCwd={onSelectCwd}
            compact
            className="w-[13rem] max-w-[48%] shrink-0"
          />
        </div>

        <ComposerInputFrame compact>
          <PromptPrefix provider={provider} />
          <PromptTextarea
            ref={textareaRef}
            rows={1}
            value={prompt}
            disabled={!canSubmit}
            minClassName="min-h-7"
            placeholder={placeholderText}
            onChange={handlePromptChange}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              compositionEndAtRef.current = Date.now();
              requestAnimationFrame(() => {
                composingRef.current = false;
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Process" || isImeConfirming(event)) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
              prompt.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border bg-background text-muted-foreground hover:bg-card-alt hover:text-foreground",
            )}
            title={submitTitle}
            aria-label={submitTitle}
          >
            <SendHorizontal className="h-3.5 w-3.5" />
          </button>
        </ComposerInputFrame>
      </div>
    </div>
  );
}

function resizeTextarea(target: HTMLTextAreaElement, minHeight: number, maxHeight: number) {
  target.style.height = "auto";
  const nextHeight = Math.min(Math.max(target.scrollHeight, minHeight), maxHeight);
  target.style.height = `${nextHeight}px`;
  target.style.overflowY = target.scrollHeight > maxHeight ? "auto" : "hidden";
}

function CliPicker({
  provider,
  onProviderChange,
  className,
}: {
  provider: AgentProvider;
  onProviderChange: (provider: AgentProvider) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            PICKER_TRIGGER_BASE_CLASS,
            PICKER_TRIGGER_SIZE_CLASS.compact,
            className,
          )}
          aria-label="Switch CLI"
          title="Switch CLI"
        >
          <PickerTriggerContent icon={<ProviderMark provider={provider} active />} label={labelForProvider(provider)} hasMenu />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-56 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">CLI</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={provider}
          onValueChange={(value) => {
            onProviderChange(value as AgentProvider);
          }}
        >
          {PROVIDERS.map((item) => (
            <DropdownMenuRadioItem key={item} value={item} className="gap-2 rounded-lg py-2 pr-2">
              <ProviderMark provider={item} active={item === provider} />
              <span className="min-w-0 flex-1 truncate">{labelForProvider(item)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelPicker({
  agentProvider,
  registry,
  settingsRaw,
  loaded,
  className,
}: {
  agentProvider: AgentProvider;
  registry: MaasProvider[];
  settingsRaw: ClaudeSettings["raw"] | undefined;
  loaded: boolean;
  className?: string;
}) {
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const runtimeId = getMaasRuntimeForAgent(agentProvider);
  const activeProviderKeys = getActiveProviderKeysByRuntime(settingsRaw);
  const activeProviderKey = runtimeId ? activeProviderKeys[runtimeId] ?? null : null;
  const activeProvider = activeProviderKey ? registry.find((item) => item.key === activeProviderKey) ?? null : null;
  const activeModelName = activeProvider && runtimeId ? pickDefaultModelForRuntime(activeProvider, runtimeId) : null;
  const activeModel = activeProvider && activeModelName ? findModelByName(activeProvider.models, activeModelName) : null;
  const triggerLabel =
    agentProvider === "terminal"
      ? "No model"
      : !loaded
      ? "Loading model"
      : activeProvider && activeModelName
      ? activeModel?.displayName || activeModelName
      : "Model unset";

  const providers = [...registry].sort((a, b) => {
    if (a.key === activeProviderKey) return -1;
    if (b.key === activeProviderKey) return 1;
    return (a.label || a.key).localeCompare(b.label || b.key);
  });
  const defaultSelectedProviderKey =
    activeProviderKey && providers.some((item) => item.key === activeProviderKey)
      ? activeProviderKey
      : providers[0]?.key ?? null;
  const effectiveSelectedProviderKey = selectedProviderKey ?? defaultSelectedProviderKey;
  const selectedProvider = effectiveSelectedProviderKey
    ? providers.find((item) => item.key === effectiveSelectedProviderKey) ?? null
    : null;
  const selectedProviderActive = Boolean(selectedProvider && selectedProvider.key === activeProviderKey);
  const selectedProviderModelName = selectedProviderActive ? activeModelName : null;
  const selectedModels = selectedProvider
    ? selectedProvider.models
        .slice()
        .sort((a, b) => getModelDisplayLabel(a).localeCompare(getModelDisplayLabel(b)))
    : [];
  const defaultSelectedModelName =
    selectedProviderModelName && selectedModels.some((model) => model.modelName === selectedProviderModelName)
      ? selectedProviderModelName
      : selectedModels[0]?.modelName ?? null;
  const effectiveSelectedModelName =
    selectedModelName && selectedModels.some((model) => model.modelName === selectedModelName)
      ? selectedModelName
      : defaultSelectedModelName;
  const selectedModel = effectiveSelectedModelName
    ? selectedModels.find((model) => model.modelName === effectiveSelectedModelName) ?? null
    : null;
  const selectedModelActive = Boolean(
    selectedProviderModelName && selectedModel?.modelName === selectedProviderModelName,
  );
  const selectedModelVendorName =
    selectedProvider && selectedModel ? getModelVendorName(selectedProvider, selectedModel) : null;
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const visibleModels =
    selectedProvider && normalizedModelQuery
      ? selectedModels.filter((model) => {
          const vendorName = getModelVendorName(selectedProvider, model) ?? "";
          return (
            model.id.toLowerCase().includes(normalizedModelQuery) ||
            getModelDisplayLabel(model).toLowerCase().includes(normalizedModelQuery) ||
            model.modelName.toLowerCase().includes(normalizedModelQuery) ||
            vendorName.toLowerCase().includes(normalizedModelQuery)
          );
        })
      : selectedModels;

  useEffect(() => {
    setSelectedProviderKey(runtimeId && loaded ? defaultSelectedProviderKey : null);
    setSelectedModelName(null);
    setModelQuery("");
  }, [runtimeId, loaded, defaultSelectedProviderKey]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            PICKER_TRIGGER_BASE_CLASS,
            PICKER_TRIGGER_SIZE_CLASS.compact,
            className,
          )}
          aria-label="View configured models"
          title={triggerLabel}
        >
          <PickerTriggerContent icon={<Cpu className="h-3.5 w-3.5" />} label={triggerLabel} hasMenu />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[min(38rem,calc(100vw-2rem))] rounded-xl p-0">
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card-alt/25 px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">MaaS models</div>
            <div className="text-xs text-muted-foreground">
              {runtimeId ? MAAS_RUNTIME_LABELS[runtimeId] : "Configured models"}
            </div>
          </div>
          {runtimeId && loaded && providers.length > 0 && selectedProvider && (
            <ProviderMenuSub
              providers={providers}
              selectedProvider={selectedProvider}
              activeProviderKey={activeProviderKey}
              onSelectProvider={(providerKey) => {
                setSelectedProviderKey(providerKey);
                setSelectedModelName(null);
                setModelQuery("");
              }}
            />
          )}
        </div>
        {!runtimeId ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">Terminal sessions do not use a MaaS model.</div>
        ) : !loaded ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">Loading configured providers...</div>
        ) : providers.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">No MaaS providers configured.</div>
        ) : (
          <div className="grid max-h-[calc(min(420px,80vh)-3rem)] min-h-[17rem] grid-cols-1 sm:grid-cols-[13.75rem_minmax(0,1fr)]">
              <div className="min-w-0 p-2">
                {selectedProvider ? (
                  <>
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
                        Models
                      </span>
                      <span className="shrink-0 rounded-md border border-border bg-card-alt px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {selectedProvider.models.length}
                      </span>
                    </div>

                    {selectedProvider.models.length > 4 && (
                      <input
                        type="text"
                        value={modelQuery}
                        onChange={(event) => setModelQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (!["Escape", "Enter", "Tab"].includes(event.key)) event.stopPropagation();
                        }}
                        placeholder="Search models..."
                        spellCheck={false}
                        className="mb-2 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/75 focus:ring-2 focus:ring-ring"
                      />
                    )}

                    <div className="max-h-[calc(min(420px,80vh)-9rem)] space-y-1 overflow-y-auto pr-1">
                      {selectedProvider.models.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-card-alt/60 px-3 py-6 text-center text-sm text-muted-foreground">
                          No models configured
                        </div>
                      ) : visibleModels.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-card-alt/60 px-3 py-6 text-center text-sm text-muted-foreground">
                          No models match "{modelQuery}"
                        </div>
                      ) : (
                        visibleModels.map((model) => {
                          const active = Boolean(selectedProviderModelName && model.modelName === selectedProviderModelName);
                          const selected = model.modelName === selectedModel?.modelName;
                          return (
                            <button
                              key={`${selectedProvider.key}:${model.id}:${model.modelName}`}
                              type="button"
                              onClick={() => setSelectedModelName(model.modelName)}
                              className={cn(
                                "w-full rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selected
                                  ? "border-primary/35 bg-primary/10"
                                  : active
                                  ? "border-primary/25 bg-card"
                                  : "border-border bg-card-alt/55 hover:bg-card",
                              )}
                              aria-pressed={selected}
                              title={model.modelName}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <MenuCheck active={active} />
                                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                                  {getModelDisplayLabel(model)}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
                    Select a provider
                  </div>
                )}
              </div>

              <div className="min-h-0 border-t border-border bg-card-alt/25 p-2 sm:border-l sm:border-t-0">
                {selectedProvider && selectedModel ? (
                  <div className="h-full rounded-xl border border-border bg-card p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
                        Details
                      </span>
                      {selectedModelActive && (
                        <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="truncate text-sm font-semibold text-foreground">
                      {getModelDisplayLabel(selectedModel)}
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] leading-4 text-muted-foreground">
                      {selectedModel.modelName}
                    </div>
                    <div className="mt-3 space-y-2 text-xs">
                      <ModelDetailRow label="Provider" value={selectedProvider.label || selectedProvider.key} />
                      <ModelDetailRow label="Vendor" value={selectedModelVendorName ?? "Not specified"} />
                      <ModelDetailRow
                        label="Context"
                        value={selectedModel.contextWindow ? formatTokenCount(selectedModel.contextWindow) : "Not specified"}
                      />
                      {Boolean(selectedModel.inputModalities?.length || selectedModel.outputModalities?.length) && (
                        <ModelDetailRow
                          label="Modalities"
                          value={[
                            ...(selectedModel.inputModalities ?? []),
                            ...(selectedModel.outputModalities ?? []),
                          ].join(", ")}
                        />
                      )}
                    </div>
                    {selectedModel.description && (
                      <p className="mt-3 line-clamp-4 text-xs leading-5 text-muted-foreground">
                        {selectedModel.description}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full min-h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                    Select a model
                  </div>
                )}
              </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderMenuSub({
  providers,
  selectedProvider,
  activeProviderKey,
  onSelectProvider,
}: {
  providers: MaasProvider[];
  selectedProvider: MaasProvider;
  activeProviderKey: string | null;
  onSelectProvider: (providerKey: string) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="h-8 max-w-[13rem] cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground focus:bg-card data-[state=open]:bg-card [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-muted-foreground">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            selectedProvider.key === activeProviderKey ? "bg-primary" : "bg-muted-foreground/35",
          )}
        />
        <span className="min-w-0 truncate">{selectedProvider.label || selectedProvider.key}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={8} alignOffset={-4} className="w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">Provider</DropdownMenuLabel>
        {providers.map((provider) => {
          const selected = provider.key === selectedProvider.key;
          const active = provider.key === activeProviderKey;
          return (
            <DropdownMenuItem
              key={provider.key}
              onSelect={(event) => {
                event.preventDefault();
                onSelectProvider(provider.key);
              }}
              className={cn("cursor-pointer gap-2 rounded-lg py-2", selected ? "bg-primary/10" : "")}
            >
              <MenuCheck active={selected} />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium text-foreground">
                  {provider.label || provider.key}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {provider.models.length} model{provider.models.length === 1 ? "" : "s"}
                </span>
              </span>
              {active && (
                <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  Active
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ModelDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

function PickerTriggerContent({
  icon,
  label,
  eyebrow,
  hasMenu,
  labelClassName,
}: {
  icon: ReactNode;
  label: string;
  eyebrow?: string;
  hasMenu?: boolean;
  labelClassName?: string;
}) {
  return (
    <>
      <span className={PICKER_ICON_CLASS}>{icon}</span>
      <span className="grid min-w-0 flex-1">
        {eyebrow && <span className="text-[10px] font-medium uppercase leading-3 text-muted-foreground">{eyebrow}</span>}
        <span className={cn("truncate text-sm font-medium leading-5 text-foreground", labelClassName)}>{label}</span>
      </span>
      {hasMenu && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </>
  );
}

function ComposerInputFrame({
  children,
  compact = false,
  className,
}: {
  children: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 overflow-hidden rounded-xl border border-input bg-background shadow-sm transition-[background-color,border-color,box-shadow] focus-within:border-primary/50 focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/10",
        compact ? "px-3 py-2.5" : "px-3.5 py-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

const PromptTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { minClassName: string }
>(({ className, minClassName, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex-1 resize-none overflow-hidden bg-transparent p-0 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/75 disabled:opacity-50",
      minClassName,
      className,
    )}
    {...props}
  />
));
PromptTextarea.displayName = "PromptTextarea";

function PromptPrefix({ provider }: { provider: AgentProvider }) {
  if (provider === "terminal") {
    return (
      <span className="mt-0.5 flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-lg bg-card-alt font-mono text-sm font-medium text-primary">
        $
      </span>
    );
  }

  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card-alt">
      <ProviderMark provider={provider} active={false} />
    </span>
  );
}

function ProjectPathPill({
  cwd,
  label,
  hasProjectPath,
  pathOptions = [],
  allowNoProject = false,
  onPickFolder,
  onSelectCwd,
  compact = false,
  className,
}: {
  cwd: string | null;
  label?: string;
  hasProjectPath?: boolean;
  pathOptions?: AgentComposerPathOption[];
  allowNoProject?: boolean;
  onPickFolder?: () => void;
  onSelectCwd?: (path: string | null) => void;
  compact?: boolean;
  className?: string;
}) {
  const displayLabel = label ?? (cwd ? getPathName(cwd) : allowNoProject ? "General chat" : "Select a project");
  const hasPath = hasProjectPath ?? Boolean(cwd);
  const title = hasPath ? cwd ?? displayLabel : displayLabel;
  const hasMenu = Boolean(onSelectCwd || onPickFolder || pathOptions.length > 0 || allowNoProject);
  const hasItemsAfterGeneral = Boolean(onPickFolder || pathOptions.length > 0);
  const currentKey = normalizePathForCompare(cwd);
  const baseClassName = cn(
    PICKER_TRIGGER_BASE_CLASS,
    compact ? PICKER_TRIGGER_SIZE_CLASS.compact : PICKER_TRIGGER_SIZE_CLASS.default,
    hasPath ? "text-foreground" : "text-muted-foreground",
    className,
  );
  const content = (
    <PickerTriggerContent
      icon={hasPath ? <FolderOpen className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
      label={displayLabel}
      eyebrow={compact ? undefined : hasPath ? "Project" : "No project"}
      hasMenu={hasMenu}
      labelClassName="font-mono text-xs"
    />
  );

  if (!hasMenu) {
    return (
      <span className={baseClassName} title={title}>
        {content}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={baseClassName}
          title={title}
          aria-label={hasPath ? "Change project folder" : "Choose conversation scope"}
        >
          {content}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[min(28rem,calc(100vw-2rem))] rounded-xl p-1.5">
        {allowNoProject && (
          <DropdownMenuItem onSelect={() => onSelectCwd?.(null)} className={cn("gap-2 rounded-lg py-2", !hasPath ? "bg-primary/10" : "")}>
            <MenuCheck active={!hasPath} />
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">General chat</span>
          </DropdownMenuItem>
        )}

        {allowNoProject && hasItemsAfterGeneral && <DropdownMenuSeparator />}

        {onPickFolder && (
          <DropdownMenuItem onSelect={() => onPickFolder()} className="gap-2 rounded-lg py-2">
            <span className="h-4 w-4 shrink-0" />
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Choose other folder...</span>
          </DropdownMenuItem>
        )}

        {pathOptions.length > 0 && (
          <>
            {onPickFolder && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">Recent paths</DropdownMenuLabel>
            <div className="max-h-[min(320px,calc(80vh-8rem))] overflow-y-auto pr-1">
              {pathOptions.map((option) => {
                const optionKey = normalizePathForCompare(option.path);
                const active = Boolean(currentKey && optionKey === currentKey);
                const optionDetail = option.detail ?? option.path;
                return (
                  <DropdownMenuItem
                    key={option.path}
                    onSelect={() => onSelectCwd?.(option.path)}
                    className={cn("gap-2 rounded-lg py-2", active ? "bg-primary/10" : "")}
                  >
                    <MenuCheck active={active} />
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={option.path}>
                      {optionDetail}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuCheck({ active }: { active: boolean }) {
  return active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className="h-4 w-4 shrink-0" />;
}

function normalizePathForCompare(path?: string | null) {
  return path ? path.replace(/[/\\]+$/, "") : "";
}

function getPathName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function getMaasRuntimeForAgent(provider: AgentProvider): MaasRuntimeId | null {
  if (provider === "claude") return "claude-code";
  if (provider === "codex") return "codex";
  return null;
}

function getLovcodeSettings(raw: ClaudeSettings["raw"] | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const lovcode = raw.lovcode;
  return lovcode && typeof lovcode === "object" && !Array.isArray(lovcode)
    ? (lovcode as Record<string, unknown>)
    : {};
}

function getActiveProviderKeysByRuntime(
  raw: ClaudeSettings["raw"] | undefined,
): Partial<Record<MaasRuntimeId, string>> {
  const lovcode = getLovcodeSettings(raw);
  const activeProviders =
    lovcode.activeProviders && typeof lovcode.activeProviders === "object" && !Array.isArray(lovcode.activeProviders)
      ? (lovcode.activeProviders as Record<string, unknown>)
      : {};
  const result: Partial<Record<MaasRuntimeId, string>> = {};
  for (const runtimeId of Object.keys(MAAS_RUNTIME_LABELS) as MaasRuntimeId[]) {
    const value = activeProviders[runtimeId];
    if (typeof value === "string" && value) result[runtimeId] = value;
  }
  const legacy = lovcode.activeProvider;
  if (typeof legacy === "string" && legacy && !result["claude-code"]) result["claude-code"] = legacy;
  return result;
}

function pickDefaultModelForRuntime(provider: MaasProvider, runtimeId: MaasRuntimeId): string {
  return runtimeId === "codex" ? pickCodexModel(provider) : pickClaudeModel(provider);
}

function pickClaudeModel(provider: MaasProvider): string {
  const models = provider.models.filter((model) => model.modelName.trim());
  const isAnthropic = (model: MaasModel) =>
    model.vendor === "anthropic" || /(?:^|\/)claude-/i.test(model.modelName);
  const anthropic = models.filter(isAnthropic);
  const sonnet = anthropic.find((model) => /sonnet/i.test(model.modelName));
  if (sonnet) return sonnet.modelName.trim();
  if (anthropic[0]) return anthropic[0].modelName.trim();
  return provider.baseUrl.includes("zenmux") || provider.models.some((model) => model.modelName.includes("/"))
    ? "anthropic/claude-sonnet-4.6"
    : "claude-sonnet-4-5";
}

function pickCodexModel(provider: MaasProvider): string {
  const models = provider.models.filter((model) => model.modelName.trim());
  const openaiLike = models.find((model) => {
    const modelName = model.modelName.trim();
    return model.vendor === "openai" || /(?:^|\/)(?:gpt-|o[1345](?:-|$)|codex)/i.test(modelName);
  });
  return openaiLike?.modelName.trim() ?? pickClaudeModel(provider);
}

function getModelDisplayLabel(model: MaasModel): string {
  return model.displayName || model.id || model.modelName;
}

function getModelVendorName(provider: MaasProvider, model: MaasModel): string | null {
  if (!model.vendor) return null;
  return provider.vendors?.find((vendor) => vendor.id === model.vendor)?.name ?? model.vendor;
}

function formatTokenCount(count: number): string {
  return `${count.toLocaleString()} tokens`;
}

function findModelByName(models: MaasModel[], modelName: string): MaasModel | null {
  return models.find((model) => model.modelName === modelName || model.id === modelName) ?? null;
}

function ProviderMark({ provider, active }: { provider: AgentProvider; active: boolean }) {
  if (provider === "terminal") {
    return <Terminal className="h-4 w-4 shrink-0" />;
  }

  const src = AGENT_ICON_SRC[provider];
  if (!src) return null;

  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
        active ? "bg-primary/10 ring-1 ring-primary/25" : "bg-background ring-1 ring-border/70"
      }`}
    >
      <img src={src} alt="" className="h-4 w-4 object-contain" draggable={false} />
    </span>
  );
}
