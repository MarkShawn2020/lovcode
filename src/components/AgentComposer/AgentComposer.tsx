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
import { useAtomValue } from "jotai";
import { Check, ChevronDown, Cpu, Terminal } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectPathPicker, type ProjectPathOption } from "@/components/shared/ProjectPathPicker";
import { useI18n } from "@/i18n";
import type { AgentProvider } from "@/types/agent";
import type { ClaudeSettings, MaasModel, MaasProvider, MaasRealtimeStatus, ZenmuxRealtimeModel } from "@/types";
import { labelForProvider } from "@/lib/agent/commands";
import { cn } from "@/lib/utils";
import { composerSubmitShortcutAtom, type ComposerSubmitShortcut } from "@/store";

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
  "agent-composer-picker-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border/70";

export type AgentComposerPathOption = ProjectPathOption;

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
  defaultProvider?: AgentProvider;
  providerContextKey?: string;
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
  defaultProvider = "claude",
  providerContextKey,
  onCancel,
  onPickFolder,
  onSelectCwd,
  onCreate,
}: AgentComposerProps) {
  const { t, translate } = useI18n();
  const [provider, setProvider] = useState<AgentProvider>(defaultProvider);
  const [prompt, setPrompt] = useState("");
  const [maasRegistry, setMaasRegistry] = useState<MaasProvider[]>([]);
  const [maasRealtimeStatus, setMaasRealtimeStatus] = useState<MaasRealtimeStatus | null>(null);
  const [maasRealtimeLoaded, setMaasRealtimeLoaded] = useState(false);
  const [settingsRaw, setSettingsRaw] = useState<ClaudeSettings["raw"] | undefined>(undefined);
  const [maasLoaded, setMaasLoaded] = useState(false);
  const submitShortcut = useAtomValue(composerSubmitShortcutAtom);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const compositionEndAtRef = useRef(0);
  const canSubmit = (Boolean(cwd) || allowNoProject) && !disabled;
  const isPanel = variant === "panel";
  const textareaBounds = isPanel ? TEXTAREA_BOUNDS.panel : TEXTAREA_BOUNDS.dock;
  const displayCwdLabel = cwdLabel ?? (cwd ? undefined : allowNoProject ? t("composer.generalChat") : undefined);
  const providerResetKey = providerContextKey ?? defaultProvider;
  const providerLabel = translate(labelForProvider(provider));
  const placeholderText =
    placeholder ? translate(placeholder) :
    (cwd
      ? provider === "terminal"
        ? t("composer.openShellInProject")
        : t("composer.startProviderWithTask", { provider: providerLabel })
      : !allowNoProject
      ? t("composer.selectProjectToStart")
      : provider === "terminal"
      ? t("composer.openShellWithoutProject")
      : t("composer.startProviderWithoutProject", { provider: providerLabel }));

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    setProvider(defaultProvider);
  }, [defaultProvider, providerResetKey]);

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

  useEffect(() => {
    let cancelled = false;
    invoke<MaasRealtimeStatus>("get_maas_realtime_status")
      .then((status) => {
        if (!cancelled) setMaasRealtimeStatus(status);
      })
      .catch(() => {
        if (!cancelled) setMaasRealtimeStatus(null);
      })
      .finally(() => {
        if (!cancelled) setMaasRealtimeLoaded(true);
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

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Process" || isImeConfirming(event)) return;
    if (!shouldSubmitFromKeyDown(event, submitShortcut)) return;
    event.preventDefault();
    submit();
  };

  const panelProviderPicker = (
    <CliPicker
      provider={provider}
      onProviderChange={handleProviderChange}
      className="w-full max-w-full"
    />
  );
  const panelModelPicker = (
    <ModelPicker
      agentProvider={provider}
      registry={maasRegistry}
      settingsRaw={settingsRaw}
      loaded={maasLoaded}
      realtimeStatus={maasRealtimeStatus}
      realtimeStatusLoaded={maasRealtimeLoaded}
      onSettingsRawChange={setSettingsRaw}
      className="w-full max-w-full"
    />
  );

  if (isPanel) {
    return (
      <div className="agent-composer-panel w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-primary/5">
        <div className="agent-composer-panel-titlebar border-b border-border bg-card-alt/35 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-serif text-2xl font-semibold text-foreground">{t("composer.newSession")}</h2>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("common.cancel")}
              </button>
            )}
          </div>
        </div>

        <div className="agent-composer-panel-body p-5">
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
              onKeyDown={handlePromptKeyDown}
            />
          </ComposerInputFrame>

          <div className="agent-composer-panel-controls mt-4">
            <div className="agent-composer-panel-picker-grid">
              <ProjectPathPicker
                cwd={cwd}
                label={displayCwdLabel}
                hasProjectPath={hasProjectPath}
                pathOptions={pathOptions}
                allowNoProject={allowNoProject}
                onPickFolder={onPickFolder}
                onSelectCwd={onSelectCwd}
                compact
                className="agent-composer-panel-project w-full max-w-full"
              />
              {panelProviderPicker}
              {panelModelPicker}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-background px-5 py-3">
      <div className="mx-auto flex w-full flex-col gap-2">
        <ComposerInputFrame compact>
          <CompactCliPicker provider={provider} onProviderChange={handleProviderChange} />
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
            onKeyDown={handlePromptKeyDown}
          />
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

function shouldSubmitFromKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  shortcut: ComposerSubmitShortcut,
) {
  if (event.key !== "Enter" || event.altKey) return false;
  if (shortcut === "mod-enter") {
    return (event.metaKey || event.ctrlKey) && !event.shiftKey;
  }
  return !event.shiftKey && !event.metaKey && !event.ctrlKey;
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
  const { t, translate } = useI18n();

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
          aria-label={t("composer.switchCli")}
        >
          <PickerTriggerContent icon={<ProviderMark provider={provider} active />} label={translate(labelForProvider(provider))} hasMenu />
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
              <span className="min-w-0 flex-1 truncate">{translate(labelForProvider(item))}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CompactCliPicker({
  provider,
  onProviderChange,
}: {
  provider: AgentProvider;
  onProviderChange: (provider: AgentProvider) => void;
}) {
  const { t, translate } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border bg-card-alt px-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("composer.runtimeTitle", { provider: translate(labelForProvider(provider)) })}
          aria-label={t("composer.switchRuntime")}
        >
          <ProviderMark provider={provider} active />
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-56 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("common.runtime")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={provider}
          onValueChange={(value) => {
            onProviderChange(value as AgentProvider);
          }}
        >
          {PROVIDERS.map((item) => (
            <DropdownMenuRadioItem key={item} value={item} className="gap-2 rounded-lg py-2 pr-2">
              <ProviderMark provider={item} active={item === provider} />
              <span className="min-w-0 flex-1 truncate">{translate(labelForProvider(item))}</span>
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
  realtimeStatus,
  realtimeStatusLoaded,
  onSettingsRawChange,
  className,
}: {
  agentProvider: AgentProvider;
  registry: MaasProvider[];
  settingsRaw: ClaudeSettings["raw"] | undefined;
  loaded: boolean;
  realtimeStatus: MaasRealtimeStatus | null;
  realtimeStatusLoaded: boolean;
  onSettingsRawChange?: (raw: ClaudeSettings["raw"]) => void;
  className?: string;
}) {
  const { t, translate } = useI18n();
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [switchingModelKey, setSwitchingModelKey] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const runtimeId = getMaasRuntimeForAgent(agentProvider);
  const enabledProviderKeys = getConfiguredActiveProviderKeysByRuntime(settingsRaw);
  const activeProviderKeys = getActiveProviderKeysByRuntime(settingsRaw, registry);
  const activeProviderKey = runtimeId ? activeProviderKeys[runtimeId] ?? null : null;
  const activeProvider = activeProviderKey ? registry.find((item) => item.key === activeProviderKey) ?? null : null;
  const activeModelName = activeProvider && runtimeId ? getActiveModelNameForRuntime(settingsRaw, activeProvider, runtimeId) : null;
  const activeModel = activeProvider && activeModelName ? findModelByName(activeProvider.models, activeModelName) : null;
  const triggerLabel =
    agentProvider === "terminal"
      ? t("composer.noModel")
      : !loaded
      ? t("composer.loadingModel")
      : activeProvider && activeModelName
      ? activeModel?.displayName || activeModelName
      : t("composer.modelUnset");

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
  const providerConnectivity = selectedProvider ? getProviderConnectivity(selectedProvider) : null;
  const externalStatus =
    selectedProvider && selectedModel
      ? getExternalModelStatus({
          provider: selectedProvider,
          model: selectedModel,
          runtimeId,
          realtimeStatus,
          realtimeStatusLoaded,
        })
      : null;
  const switchUnavailableReason =
    selectedProvider && runtimeId ? getModelSwitchUnavailableReason(selectedProvider, runtimeId) : null;
  const selectedSwitchingKey =
    selectedProvider && selectedModel ? getModelSwitchKey(selectedProvider, selectedModel.modelName) : null;
  const selectedModelSwitching = Boolean(selectedSwitchingKey && switchingModelKey === selectedSwitchingKey);
  const canSwitchSelectedModel = Boolean(
    runtimeId &&
      selectedProvider &&
      selectedModel &&
      !selectedModelActive &&
      !switchUnavailableReason &&
      !switchingModelKey,
  );
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

  const switchActiveModel = async (provider: MaasProvider, modelName: string) => {
    if (!runtimeId) return;
    const trimmedModelName = modelName.trim();
    if (!trimmedModelName) return;

    const unavailableReason = getModelSwitchUnavailableReason(provider, runtimeId);
    if (unavailableReason) {
      setSwitchError(unavailableReason);
      return;
    }

    const switchKey = getModelSwitchKey(provider, trimmedModelName);
    setSwitchingModelKey(switchKey);
    setSwitchError(null);

    try {
      if (runtimeId === "codex") {
        await invoke("update_codex_maas_provider", {
          provider,
          model: trimmedModelName,
        });
      } else {
        if (activeProviderKey && activeProviderKey !== provider.key) {
          await invoke("snapshot_provider_context", {
            providerKey: activeProviderKey,
            envKeys: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_SONNET_MODEL"],
          }).catch(() => {
            /* best-effort */
          });
        }

        if (isOAuthProvider(provider)) {
          await invoke("update_settings_env", { envKey: "CLAUDE_CODE_USE_OAUTH", envValue: "1" });
          await invoke("update_settings_env", {
            envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL",
            envValue: trimmedModelName,
          });
          await invoke("delete_settings_env", { envKey: "ANTHROPIC_AUTH_TOKEN" }).catch(() => {});
          await invoke("delete_settings_env", { envKey: "ANTHROPIC_BASE_URL" }).catch(() => {});
        } else {
          await invoke("update_settings_env", {
            envKey: "ANTHROPIC_BASE_URL",
            envValue: provider.baseUrl.trim(),
          });
          await invoke("update_settings_env", {
            envKey: "ANTHROPIC_AUTH_TOKEN",
            envValue: provider.authToken.trim(),
          });
          await invoke("update_settings_env", {
            envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL",
            envValue: trimmedModelName,
          });
          await invoke("delete_settings_env", { envKey: "CLAUDE_CODE_USE_OAUTH" }).catch(() => {});
        }
      }

      const latestSettings = await invoke<ClaudeSettings>("get_settings").catch(() => null);
      const latestRaw = latestSettings?.raw ?? settingsRaw ?? null;
      const currentLovcodeSettings = getLovcodeSettings(latestRaw);
      const nextActiveProviders = {
        ...getActiveProviderKeysByRuntime(latestRaw, registry),
        [runtimeId]: provider.key,
      };
      const legacyActiveProvider =
        typeof currentLovcodeSettings.activeProvider === "string"
          ? currentLovcodeSettings.activeProvider
          : nextActiveProviders["claude-code"];
      const nextLovcodeSettings = {
        ...currentLovcodeSettings,
        activeProvider: runtimeId === "claude-code" ? provider.key : legacyActiveProvider,
        activeProviders: nextActiveProviders,
        activeModels: {
          ...getActiveModelNamesByRuntime(latestRaw),
          [runtimeId]: trimmedModelName,
        },
      };

      await invoke("update_settings_field", {
        field: "lovcode",
        value: nextLovcodeSettings,
      });

      const nextRaw = withLovcodeSettings(latestRaw, nextLovcodeSettings);
      onSettingsRawChange?.(nextRaw);
      setSelectedProviderKey(provider.key);
      setSelectedModelName(trimmedModelName);
    } catch (error) {
      setSwitchError(getErrorMessage(error));
    } finally {
      setSwitchingModelKey(null);
    }
  };

  useEffect(() => {
    setSelectedProviderKey(runtimeId && loaded ? defaultSelectedProviderKey : null);
    setSelectedModelName(null);
    setModelQuery("");
    setSwitchError(null);
  }, [runtimeId, loaded, defaultSelectedProviderKey]);

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (!open) return;
        invoke<ClaudeSettings>("get_settings")
          .then((settings) => onSettingsRawChange?.(settings.raw))
          .catch(() => {
            /* best-effort refresh */
          });
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            PICKER_TRIGGER_BASE_CLASS,
            PICKER_TRIGGER_SIZE_CLASS.compact,
            className,
          )}
          aria-label={t("composer.viewConfiguredModels")}
        >
          <PickerTriggerContent icon={<Cpu className="h-3.5 w-3.5" />} label={triggerLabel} hasMenu />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={16}
        sideOffset={8}
        className="flex max-h-[calc(var(--radix-dropdown-menu-content-available-height,80vh)-0.75rem)] w-[min(42rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl p-0"
      >
        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-card-alt/25 px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{t("composer.maasModels")}</div>
            <div className="text-xs text-muted-foreground">
              {runtimeId ? MAAS_RUNTIME_LABELS[runtimeId] : t("composer.configuredModels")}
            </div>
          </div>
          {runtimeId && loaded && providers.length > 0 && selectedProvider && (
            <ProviderMenuSub
              providers={providers}
              selectedProvider={selectedProvider}
              activeProviderKeys={enabledProviderKeys}
              onSelectProvider={(providerKey) => {
                setSelectedProviderKey(providerKey);
                setSelectedModelName(null);
                setModelQuery("");
              }}
            />
          )}
        </div>
        {!runtimeId ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">{t("composer.terminalNoMaas")}</div>
        ) : !loaded ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">{t("composer.loadingProviders")}</div>
        ) : providers.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">{t("composer.noProviders")}</div>
        ) : (
          <div className="grid h-[min(24rem,calc(var(--radix-dropdown-menu-content-available-height,80vh)-3.75rem))] min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden sm:grid-cols-[17rem_minmax(0,1fr)]">
              <div className="flex min-h-0 min-w-0 flex-col p-2">
                {selectedProvider ? (
                  <>
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
                        {t("common.models")}
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
                        placeholder={t("composer.searchModels")}
                        spellCheck={false}
                        className="mb-2 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/75 focus:ring-2 focus:ring-ring"
                      />
                    )}

                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                      {selectedProvider.models.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-card-alt/60 px-3 py-6 text-center text-sm text-muted-foreground">
                          {t("composer.noModelsConfigured")}
                        </div>
                      ) : visibleModels.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-card-alt/60 px-3 py-6 text-center text-sm text-muted-foreground">
                          {t("composer.noModelsMatch", { query: modelQuery })}
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
                    {t("composer.selectProvider")}
                  </div>
                )}
              </div>

              <div className="min-h-0 overflow-hidden border-t border-border bg-card-alt/25 p-2 sm:border-l sm:border-t-0">
                {selectedProvider && selectedModel ? (
                  <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card p-3">
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
                          {t("common.details")}
                        </span>
                        {selectedModelSwitching ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            {t("composer.switching")}
                          </span>
                        ) : selectedModelActive ? (
                          <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                            {t("common.active")}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-sm font-semibold text-foreground">
                        {getModelDisplayLabel(selectedModel)}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11px] leading-4 text-muted-foreground">
                        {selectedModel.modelName}
                      </div>
                      {providerConnectivity && (
                        <div
                          className={cn(
                            "mt-3 rounded-lg border px-2.5 py-2",
                            providerConnectivity.verified
                              ? "border-primary/25 bg-primary/5"
                              : "border-border bg-card-alt/60",
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                providerConnectivity.verified ? "bg-primary" : "bg-muted-foreground/40",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                              {translate(providerConnectivity.label)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            {translate(providerConnectivity.detail)}
                          </div>
                        </div>
                      )}
                      {externalStatus && <ExternalStatusCard status={externalStatus} />}
                      <div className="mt-3 space-y-2 text-xs">
                        <ModelDetailRow label={t("common.provider")} value={selectedProvider.label || selectedProvider.key} />
                        <ModelDetailRow label={t("composer.modelVendor")} value={selectedModelVendorName ?? t("composer.notSpecified")} />
                        <ModelDetailRow
                          label={t("feature.context")}
                          value={selectedModel.contextWindow ? formatTokenCount(selectedModel.contextWindow) : t("composer.notSpecified")}
                        />
                        {Boolean(selectedModel.inputModalities?.length || selectedModel.outputModalities?.length) && (
                          <ModelDetailRow
                            label={t("composer.modalities")}
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
                    <div className="mt-3 shrink-0 space-y-2">
                      <button
                        type="button"
                        disabled={!canSwitchSelectedModel}
                        onClick={() => {
                          void switchActiveModel(selectedProvider, selectedModel.modelName);
                        }}
                        className="inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {selectedModelSwitching
                          ? t("composer.switchingEllipsis")
                          : selectedModelActive
                          ? t("composer.activeModel")
                          : t("composer.useThisModel")}
                      </button>
                      {switchUnavailableReason && (
                        <p className="text-xs leading-5 text-muted-foreground">{translate(switchUnavailableReason)}</p>
                      )}
                      {switchError && (
                        <p className="text-xs leading-5 text-destructive" role="alert">
                          {switchError}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                    {t("composer.selectModel")}
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
  activeProviderKeys,
  onSelectProvider,
}: {
  providers: MaasProvider[];
  selectedProvider: MaasProvider;
  activeProviderKeys: Partial<Record<MaasRuntimeId, string>>;
  onSelectProvider: (providerKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const selectedProviderActiveRuntimeIds = getProviderActiveRuntimeIds(
    selectedProvider.key,
    activeProviderKeys,
  );

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger className="h-8 max-w-[13rem] cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground focus:bg-card data-[state=open]:bg-card [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-muted-foreground">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            selectedProviderActiveRuntimeIds.length > 0 ? "bg-primary" : "bg-muted-foreground/35",
          )}
        />
        <span className="min-w-0 truncate">{selectedProvider.label || selectedProvider.key}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={8} alignOffset={-4} className="w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">{t("common.provider")}</DropdownMenuLabel>
        {providers.map((provider) => {
          const selected = provider.key === selectedProvider.key;
          const activeRuntimeIds = getProviderActiveRuntimeIds(provider.key, activeProviderKeys);
          const active = activeRuntimeIds.length > 0;
          const activeRuntimeLabel = formatRuntimeLabels(activeRuntimeIds);
          return (
            <DropdownMenuItem
              key={provider.key}
              onSelect={(event) => {
                event.preventDefault();
                onSelectProvider(provider.key);
                setOpen(false);
              }}
              className={cn(
                "relative cursor-pointer gap-2 overflow-hidden rounded-lg border border-transparent py-2 pl-3 pr-2",
                active
                  ? "border-primary/30 bg-primary/10 shadow-sm ring-1 ring-primary/10"
                  : selected
                  ? "bg-card-alt/80"
                  : "",
              )}
              aria-current={active ? "true" : undefined}
            >
              {active && <span className="absolute inset-y-1 left-0 w-1 rounded-r-full bg-primary" />}
              <MenuCheck active={selected} />
              <span className="grid min-w-0 flex-1">
                <span className={cn("truncate text-sm text-foreground", active ? "font-semibold" : "font-medium")}>
                  {provider.label || provider.key}
                </span>
                <span className={cn("truncate text-xs", active ? "font-medium text-primary" : "text-muted-foreground")}>
                  {active
                    ? `Active for ${activeRuntimeLabel}`
                    : provider.models.length === 1
                    ? t("composer.modelCountOne")
                    : t("composer.modelCount", { count: provider.models.length })}
                </span>
              </span>
              {active && (
                <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {t("common.active")}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

type ExternalModelStatusTone = "good" | "neutral" | "warn";

interface ExternalModelStatus {
  source: string;
  label: string;
  detail: string;
  tone: ExternalModelStatusTone;
  rows: Array<{ label: string; value: string }>;
}

function ExternalStatusCard({ status }: { status: ExternalModelStatus }) {
  const { translate } = useI18n();

  return (
    <div
      className={cn(
        "mt-2 rounded-lg border px-2.5 py-2",
        status.tone === "good"
          ? "border-primary/25 bg-primary/5"
          : status.tone === "warn"
          ? "border-destructive/25 bg-destructive/5"
          : "border-border bg-card-alt/60",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            status.tone === "good"
              ? "bg-primary"
              : status.tone === "warn"
              ? "bg-destructive"
              : "bg-muted-foreground/40",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {translate(status.label)}
        </span>
        <span className="shrink-0 text-[10px] font-medium uppercase leading-4 text-muted-foreground">
          {status.source}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{translate(status.detail)}</div>
      {status.rows.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border/70 pt-2 text-[11px]">
          {status.rows.map((row) => (
            <ModelDetailRow key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelDetailRow({ label, value }: { label: string; value: string }) {
  const { translate } = useI18n();

  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{translate(label)}</span>
      <span className="min-w-0 truncate text-foreground">
        {translate(value)}
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
      <span className="agent-composer-picker-label grid min-w-0 flex-1">
        {eyebrow && <span className="text-[10px] font-medium uppercase leading-3 text-muted-foreground">{eyebrow}</span>}
        <span className={cn("truncate text-sm font-medium leading-5 text-foreground", labelClassName)}>{label}</span>
      </span>
      {hasMenu && <ChevronDown className="agent-composer-picker-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
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

function MenuCheck({ active }: { active: boolean }) {
  return active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className="h-4 w-4 shrink-0" />;
}

function getProviderActiveRuntimeIds(
  providerKey: string,
  activeProviderKeys: Partial<Record<MaasRuntimeId, string>>,
): MaasRuntimeId[] {
  return (Object.keys(MAAS_RUNTIME_LABELS) as MaasRuntimeId[]).filter(
    (runtimeId) => activeProviderKeys[runtimeId] === providerKey,
  );
}

function formatRuntimeLabels(runtimeIds: MaasRuntimeId[]): string {
  return runtimeIds.map((runtimeId) => MAAS_RUNTIME_LABELS[runtimeId]).join(", ");
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
  registry: MaasProvider[] = [],
): Partial<Record<MaasRuntimeId, string>> {
  const result = getConfiguredActiveProviderKeysByRuntime(raw);
  const claudeCodeProvider = inferClaudeCodeProviderKeyFromSettings(raw, registry);
  if (claudeCodeProvider) result["claude-code"] = claudeCodeProvider;
  return result;
}

function getConfiguredActiveProviderKeysByRuntime(
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

function inferClaudeCodeProviderKeyFromSettings(
  raw: ClaudeSettings["raw"] | undefined,
  registry: MaasProvider[],
): string | null {
  if (!registry.length) return null;

  if (isSettingsEnvTruthy(raw, "CLAUDE_CODE_USE_OAUTH")) {
    return registry.some((provider) => provider.key === "anthropic-subscription")
      ? "anthropic-subscription"
      : null;
  }

  const baseUrl = normalizeBaseUrl(getSettingsEnvValue(raw, "ANTHROPIC_BASE_URL"));
  if (!baseUrl) return null;

  return (
    registry.find((provider) => normalizeBaseUrl(provider.baseUrl) === baseUrl)?.key ??
    null
  );
}

function isSettingsEnvTruthy(raw: ClaudeSettings["raw"] | undefined, key: string): boolean {
  const value = getSettingsEnvValue(raw, key);
  if (!value) return false;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function normalizeBaseUrl(value?: string | null): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function getActiveModelNamesByRuntime(
  raw: ClaudeSettings["raw"] | undefined,
): Partial<Record<MaasRuntimeId, string>> {
  const lovcode = getLovcodeSettings(raw);
  const activeModels =
    lovcode.activeModels && typeof lovcode.activeModels === "object" && !Array.isArray(lovcode.activeModels)
      ? (lovcode.activeModels as Record<string, unknown>)
      : {};
  const result: Partial<Record<MaasRuntimeId, string>> = {};

  for (const runtimeId of Object.keys(MAAS_RUNTIME_LABELS) as MaasRuntimeId[]) {
    const value = activeModels[runtimeId];
    if (typeof value === "string" && value) result[runtimeId] = value;
  }

  const claudeModel = getSettingsEnvValue(raw, "ANTHROPIC_DEFAULT_SONNET_MODEL");
  if (claudeModel) result["claude-code"] = claudeModel;
  return result;
}

function getActiveModelNameForRuntime(
  raw: ClaudeSettings["raw"] | undefined,
  provider: MaasProvider,
  runtimeId: MaasRuntimeId,
): string {
  return getActiveModelNamesByRuntime(raw)[runtimeId] ?? pickDefaultModelForRuntime(provider, runtimeId);
}

function getSettingsEnvValue(raw: ClaudeSettings["raw"] | undefined, key: string): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const env = raw.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function withLovcodeSettings(
  raw: ClaudeSettings["raw"] | undefined,
  lovcode: Record<string, unknown>,
): ClaudeSettings["raw"] {
  return {
    ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}),
    lovcode,
  };
}

function isOAuthProvider(provider: MaasProvider): boolean {
  return provider.key === "anthropic-subscription";
}

function getModelSwitchUnavailableReason(provider: MaasProvider, runtimeId: MaasRuntimeId): string | null {
  if (runtimeId === "codex" && isOAuthProvider(provider)) {
    return "Codex cannot use Claude Code OAuth.";
  }

  if (!isOAuthProvider(provider)) {
    if (!provider.baseUrl.trim()) return `${MAAS_RUNTIME_LABELS[runtimeId]} requires a provider Base URL.`;
    if (!provider.authToken.trim()) return `${MAAS_RUNTIME_LABELS[runtimeId]} requires a provider token.`;
  }

  return null;
}

function getModelSwitchKey(provider: MaasProvider, modelName: string): string {
  return `${provider.key}:${modelName}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Failed to switch model");
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

function getExternalModelStatus({
  provider,
  model,
  runtimeId,
  realtimeStatus,
  realtimeStatusLoaded,
}: {
  provider: MaasProvider;
  model: MaasModel;
  runtimeId: MaasRuntimeId | null;
  realtimeStatus: MaasRealtimeStatus | null;
  realtimeStatusLoaded: boolean;
}): ExternalModelStatus | null {
  if (isZenmuxProvider(provider)) {
    return getZenmuxExternalStatus(provider, model, realtimeStatus, realtimeStatusLoaded);
  }

  if (isClaudeStatusProvider(provider, model)) {
    return getClaudeExternalStatus(provider, runtimeId, realtimeStatus, realtimeStatusLoaded);
  }

  return null;
}

function getClaudeExternalStatus(
  provider: MaasProvider,
  runtimeId: MaasRuntimeId | null,
  realtimeStatus: MaasRealtimeStatus | null,
  realtimeStatusLoaded: boolean,
): ExternalModelStatus {
  if (!realtimeStatusLoaded) {
    return {
      source: "Claude",
      label: "Checking external status",
      detail: "Fetching official Claude status data",
      tone: "neutral",
      rows: [],
    };
  }

  if (!realtimeStatus?.claude) {
    return {
      source: "Claude",
      label: "Status unavailable",
      detail: realtimeStatus?.claudeError ?? "Official status feed could not be reached",
      tone: "warn",
      rows: [],
    };
  }

  const claude = realtimeStatus.claude;
  const targetComponentName = provider.key === "anthropic-subscription" ? "Claude Code" : "Claude API";
  const component =
    claude.components.find((item) => item.name === "Claude API (api.anthropic.com)" && targetComponentName === "Claude API") ??
    claude.components.find((item) => item.name === targetComponentName) ??
    claude.components.find((item) => item.name.toLowerCase().includes(targetComponentName.toLowerCase())) ??
    null;
  const relatedIncidents = claude.incidents.filter((incident) => {
    if (!component || incident.affectedComponents.length === 0) return true;
    return incident.affectedComponents.some((name) => name === component.name);
  });
  const activeIncident = relatedIncidents.find((incident) => incident.status !== "resolved");
  const latestIncident = relatedIncidents[0] ?? null;
  const componentStatus = component?.status ?? claude.indicator ?? "unknown";
  const healthy =
    !activeIncident &&
    (componentStatus === "operational" || componentStatus === "none" || claude.indicator === "none");
  const updatedAt = component?.updatedAt ?? claude.updatedAt ?? realtimeStatus.fetchedAt;

  return {
    source: "Claude",
    label: activeIncident ? formatStatusText(activeIncident.status) : formatStatusText(componentStatus),
    detail: activeIncident
      ? activeIncident.name
      : latestIncident
      ? `Latest incident: ${latestIncident.name}`
      : `Updated ${formatDateTime(updatedAt)}`,
    tone: healthy ? "good" : "warn",
    rows: [
      { label: "Component", value: component?.name ?? targetComponentName },
      { label: "Page", value: claude.description ?? claude.pageName },
      { label: "Updated", value: formatDateTime(updatedAt) },
      { label: "Incidents", value: `${relatedIncidents.length} recent` },
      ...(runtimeId ? [{ label: "Runtime", value: MAAS_RUNTIME_LABELS[runtimeId] }] : []),
    ],
  };
}

function getZenmuxExternalStatus(
  provider: MaasProvider,
  model: MaasModel,
  realtimeStatus: MaasRealtimeStatus | null,
  realtimeStatusLoaded: boolean,
): ExternalModelStatus {
  if (!realtimeStatusLoaded) {
    return {
      source: "ZenMux",
      label: "Checking external status",
      detail: "Fetching live ZenMux model catalog",
      tone: "neutral",
      rows: [],
    };
  }

  if (!realtimeStatus?.zenmux) {
    return {
      source: "ZenMux",
      label: "Catalog unavailable",
      detail: realtimeStatus?.zenmuxError ?? "ZenMux public model feed could not be reached",
      tone: "warn",
      rows: [],
    };
  }

  const catalogModel = findZenmuxRealtimeModel(realtimeStatus.zenmux.models, model);
  if (!catalogModel) {
    return {
      source: "ZenMux",
      label: "No live catalog match",
      detail: "Current model id was not found in ZenMux public models API",
      tone: "warn",
      rows: [
        { label: "Provider", value: provider.label || provider.key },
        { label: "Catalog", value: `${realtimeStatus.zenmux.models.length} models` },
        { label: "Fetched", value: formatDateTime(realtimeStatus.zenmux.fetchedAt) },
      ],
    };
  }

  const modalities = [
    ...catalogModel.inputModalities,
    ...catalogModel.outputModalities,
  ].join(", ");
  const pricing = [catalogModel.promptPrice, catalogModel.completionPrice]
    .filter(Boolean)
    .join(" / ");

  return {
    source: "ZenMux",
    label: "Live catalog match",
    detail: catalogModel.displayName || catalogModel.id,
    tone: "good",
    rows: [
      { label: "Provider", value: provider.label || provider.key },
      { label: "Model", value: catalogModel.id },
      { label: "Vendor", value: catalogModel.ownedBy ?? "Not reported" },
      {
        label: "Context",
        value: catalogModel.contextLength ? formatTokenCount(catalogModel.contextLength) : "Not reported",
      },
      ...(modalities ? [{ label: "Modalities", value: modalities }] : []),
      ...(pricing ? [{ label: "Pricing", value: pricing }] : []),
      { label: "Fetched", value: formatDateTime(realtimeStatus.zenmux.fetchedAt) },
    ],
  };
}

function isZenmuxProvider(provider: MaasProvider): boolean {
  return provider.key === "zenmux" || provider.baseUrl.toLowerCase().includes("zenmux.ai");
}

function isClaudeStatusProvider(provider: MaasProvider, model: MaasModel): boolean {
  return (
    provider.key === "native" ||
    provider.key === "anthropic-subscription" ||
    provider.baseUrl.toLowerCase().includes("anthropic.com") ||
    model.vendor === "anthropic" ||
    /(?:^|\/)claude-/i.test(model.modelName)
  );
}

function findZenmuxRealtimeModel(
  models: ZenmuxRealtimeModel[],
  selectedModel: MaasModel,
): ZenmuxRealtimeModel | null {
  const selectedCandidates = [
    selectedModel.modelName,
    selectedModel.id,
    selectedModel.displayName,
  ].map(normalizeModelIdentifier);
  const exact = models.find((model) => selectedCandidates.includes(normalizeModelIdentifier(model.id)));
  if (exact) return exact;

  return (
    models.find((model) => {
      const modelId = normalizeModelIdentifier(model.id);
      return selectedCandidates.some((candidate) => candidate && getModelTail(candidate) === getModelTail(modelId));
    }) ?? null
  );
}

function normalizeModelIdentifier(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
}

function getModelTail(value: string): string {
  return value.split("/").filter(Boolean).pop() ?? value;
}

function formatStatusText(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) return "Status available";
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function getProviderConnectivity(provider: MaasProvider): {
  label: string;
  detail: string;
  verified: boolean;
} {
  const lastVerifiedAt = provider.lastVerifiedAt ? formatDateTime(provider.lastVerifiedAt) : null;

  if (provider.lastVerifiedTokenHash === "oauth") {
    return {
      label: lastVerifiedAt ? "OAuth connected" : "OAuth provider",
      detail: lastVerifiedAt ? `Verified ${lastVerifiedAt}` : "Claude Code subscription provider",
      verified: Boolean(lastVerifiedAt),
    };
  }

  const token = provider.authToken.trim();
  if (!token) {
    return {
      label: "No token",
      detail: "Add an API key in MaaS Registry",
      verified: false,
    };
  }

  if (!provider.lastVerifiedAt || !provider.lastVerifiedTokenHash) {
    return {
      label: "Not verified",
      detail: "Test this provider in MaaS Registry",
      verified: false,
    };
  }

  if (tokenFingerprint(token) !== provider.lastVerifiedTokenHash) {
    return {
      label: "Token changed",
      detail: "Verify this provider again",
      verified: false,
    };
  }

  return {
    label: "Provider verified",
    detail: `Last checked ${lastVerifiedAt ?? provider.lastVerifiedAt}`,
    verified: true,
  };
}

function tokenFingerprint(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  let hash = 5381;
  for (let i = 0; i < trimmed.length; i++) {
    hash = ((hash << 5) + hash + trimmed.charCodeAt(i)) | 0;
  }
  return `${trimmed.length}:${(hash >>> 0).toString(16)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
