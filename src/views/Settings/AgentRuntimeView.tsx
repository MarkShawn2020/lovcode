import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, Loader2, Locate, Search, Settings2 } from "lucide-react";
import { PageHeader, ConfigPage } from "../../components/config";
import { Button } from "../../components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../components/ui/accordion";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { toast } from "../../components/ui/toast";
import { useInvokeQuery, useQueryClient } from "../../hooks";
import { useI18n } from "../../i18n";
import { normalizeClaudeCodeModelName } from "../../lib/agent/models";
import { patchSettings } from "../../lib/settingsApi";
import { invoke } from "../../lib/tauri";
import { cn } from "../../lib/utils";
import type { ClaudeSettings, MaasModel, MaasProvider, MaasRuntimeConfigStatus } from "../../types";
import type { AgentRuntimeStatus } from "../../types/agent";
import { agentRuntimeStatusKey, type AgentRuntimeSettingsSection } from "./AgentCliRuntimeCard";
import { AGENT_CLI_RUNTIME_OPTIONS, type CliRuntime } from "./agentCliRuntimeConfig";
import { ClaudeCodeVersionSection } from "./ClaudeCodeVersionSection";
import { CodexCliVersionSection } from "./CodexCliVersionSection";

type MaasRuntimeId = "claude-code" | "codex";

const CLAUDE_CODE_MAAS_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "CLAUDE_CODE_USE_OAUTH",
];
const MODEL_OPTION_CLASS_NAME =
  "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MAAS_APPLY_TIMEOUT_MS = 8_000;

export function AgentRuntimeView() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const runtimeParam = searchParams.get("runtime");
  const selectedRuntime: CliRuntime | undefined =
    runtimeParam === "claude" || runtimeParam === "codex" ? runtimeParam : undefined;

  const handleRuntimeChange = (value: string | string[]) => {
    const runtime = Array.isArray(value) ? value[0] : value;
    const nextParams = new URLSearchParams(searchParams);
    if (runtime === "claude" || runtime === "codex") {
      nextParams.set("runtime", runtime);
    } else {
      nextParams.delete("runtime");
    }
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <ConfigPage>
      <PageHeader title={t("agentRuntime.title")} subtitle={t("agentRuntime.subtitle")} />
      <Accordion
        type="single"
        collapsible
        value={selectedRuntime}
        onValueChange={handleRuntimeChange}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        {AGENT_CLI_RUNTIME_OPTIONS.map((option) => {
          const maasSection: AgentRuntimeSettingsSection = {
            value: "maas-config",
            title: t("agentRuntime.maasConfig"),
            description: t(
              option.id === "codex"
                ? "agentRuntime.maasConfigCodexDescription"
                : "agentRuntime.maasConfigClaudeDescription",
            ),
            children: <AgentRuntimeMaasConfig runtime={option.id} />,
          };

          return (
            <AccordionItem key={option.id} value={option.id}>
              <AccordionTrigger className="hover:bg-card-alt">
                <CliRuntimeAccordionHeader option={option} />
              </AccordionTrigger>
              <AccordionContent className="bg-background/40 p-2">
                {option.id === "codex" ? (
                  <CodexCliVersionSection settingsSections={[maasSection]} />
                ) : (
                  <ClaudeCodeVersionSection settingsSections={[maasSection]} />
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </ConfigPage>
  );
}

function AgentRuntimeMaasConfig({ runtime }: { runtime: CliRuntime }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const runtimeId = getMaasRuntimeId(runtime);
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenDirty, setTokenDirty] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: registry = [], isLoading: registryLoading } = useInvokeQuery<MaasProvider[]>(
    ["maas_registry"],
    "get_maas_registry",
  );
  const { data: settings } = useInvokeQuery<ClaudeSettings>(["settings"], "get_settings");
  const { data: runtimeConfigStatus, isFetching } = useInvokeQuery<MaasRuntimeConfigStatus>(
    ["maas_runtime_config_status"],
    "get_maas_runtime_config_status",
    undefined,
    { refetchOnMount: "always" },
  );
  const availableProviders = useMemo(
    () => registry.filter((provider) => isProviderRuntimeAvailable(provider, runtimeId)),
    [registry, runtimeId],
  );
  const activeProviderKey =
    runtimeConfigStatus?.activeProviders[runtimeId] ?? getActiveProviderKeysByRuntime(settings?.raw)[runtimeId];
  const activeModel =
    runtimeConfigStatus?.activeModels[runtimeId] ?? getActiveModelNamesByRuntime(settings?.raw)[runtimeId];
  const activeProvider = activeProviderKey
    ? registry.find((provider) => provider.key === activeProviderKey) ?? null
    : null;
  const selectedProvider = useMemo(
    () => availableProviders.find((provider) => provider.key === selectedProviderKey) ?? null,
    [availableProviders, selectedProviderKey],
  );
  const modelCandidates = useMemo(
    () => (selectedProvider ? getRuntimeModelCandidates(selectedProvider, runtimeId) : []),
    [runtimeId, selectedProvider],
  );
  const providerLabel = activeProvider
    ? getProviderLabel(activeProvider)
    : activeProviderKey ?? "";
  const validationError = selectedProvider
    ? getRuntimeConfigUnavailableReason(selectedProvider, runtimeId, tokenInput.trim(), t)
    : null;
  const canApply = Boolean(selectedProvider && modelName.trim() && !validationError && !submitting);
  const maskedSavedToken =
    selectedProvider && !isOAuthProvider(selectedProvider)
      ? maskTokenMiddle(selectedProvider.authToken)
      : "";
  const tokenDisplayValue = tokenDirty ? tokenInput : maskTokenMiddle(tokenInput);

  useEffect(() => {
    if (selectedProviderKey && availableProviders.some((provider) => provider.key === selectedProviderKey)) return;
    if (activeProviderKey && availableProviders.some((provider) => provider.key === activeProviderKey)) {
      setSelectedProviderKey(activeProviderKey);
      return;
    }
    setSelectedProviderKey(availableProviders[0]?.key ?? "");
  }, [activeProviderKey, availableProviders, selectedProviderKey]);

  useEffect(() => {
    setTokenDirty(false);
    setActionError(null);
  }, [selectedProviderKey]);

  useEffect(() => {
    if (!configOpen || tokenDirty) return;
    setTokenInput(selectedProvider && !isOAuthProvider(selectedProvider) ? selectedProvider.authToken : "");
  }, [configOpen, selectedProvider, tokenDirty]);

  useEffect(() => {
    if (!selectedProvider) {
      setModelName("");
      return;
    }
    const nextModel =
      selectedProvider.key === activeProviderKey && activeModel
        ? activeModel
        : pickDefaultModelForRuntime(selectedProvider, runtimeId);
    setModelName(nextModel);
  }, [activeModel, activeProviderKey, runtimeId, selectedProvider]);

  const refreshRuntimeConfig = () => {
    void queryClient.invalidateQueries({ queryKey: ["maas_registry"] });
    void queryClient.invalidateQueries({ queryKey: ["maas_runtime_config_status"] });
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  const handleApply = async () => {
    if (!selectedProvider) return;
    const trimmedModelName = getRuntimeModelName(runtimeId, modelName);
    if (!trimmedModelName) {
      setActionError(t("agentRuntime.maasModelRequired"));
      return;
    }
    const token = tokenInput.trim();
    const hasTokenOverride = Boolean(
      tokenDirty &&
      token &&
      !isOAuthProvider(selectedProvider) &&
      token !== maskedSavedToken,
    );
    const providerForApply = hasTokenOverride
      ? { ...selectedProvider, authToken: token }
      : selectedProvider;
    const error = getRuntimeConfigUnavailableReason(providerForApply, runtimeId, "", t);
    if (error) {
      setActionError(error);
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await withTimeout(
        applyMaasProviderToRuntime({
          runtimeId,
          provider: providerForApply,
          modelName: trimmedModelName,
          activeProviderKey,
          settings,
          runtimeConfigStatus,
          tokenOverrideProvided: hasTokenOverride,
        }),
        MAAS_APPLY_TIMEOUT_MS,
        t("agentRuntime.maasConfigApplyTimeout"),
      );
      setTokenDirty(false);
      setTokenInput(isOAuthProvider(providerForApply) ? "" : providerForApply.authToken);
      refreshRuntimeConfig();
      toast.success(
        t(runtimeId === "codex" ? "agentRuntime.maasConfigAppliedCodex" : "agentRuntime.maasConfigApplied"),
      );
      setConfigOpen(false);
    } catch (error) {
      setActionError(t("agentRuntime.maasConfigApplyFailed", { message: formatError(error) }));
    } finally {
      setSubmitting(false);
    }
  };

  if (registryLoading) {
    return (
      <div className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("maas.loading")}
      </div>
    );
  }

  const currentRuntimeLabel = activeProviderKey
    ? [providerLabel, activeModel].filter(Boolean).join(" · ")
    : t("agentRuntime.notConfigured");

  return (
    <Popover className="block min-w-0" open={configOpen} onOpenChange={setConfigOpen}>
      <PopoverTrigger
        className="inline-flex h-8 w-full min-w-0 items-center justify-start gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {isFetching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{currentRuntimeLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(32rem,calc(100vw-2rem))] !overflow-hidden p-2"
      >
        <div className="space-y-2">
          {availableProviders.length === 0 ? (
            <div className="space-y-2">
              <p className="rounded-lg border border-dashed border-border bg-card-alt/60 px-3 py-6 text-center text-xs text-muted-foreground">
                {t("agentRuntime.noMaasProviders")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate("/settings/maas")}
                className="h-8 w-full gap-1.5"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t("agentRuntime.openMaasRegistry")}
              </Button>
            </div>
          ) : (
            <>
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)]">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`${runtimeId}-maas-provider`} className="text-xs text-muted-foreground">
                    {t("agentRuntime.maasProvider")}
                  </Label>
                  <Select value={selectedProviderKey} onValueChange={setSelectedProviderKey} disabled={submitting}>
                    <SelectTrigger
                      id={`${runtimeId}-maas-provider`}
                      size="sm"
                      className="w-full min-w-0 bg-background"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProviders.map((provider) => (
                        <SelectItem key={provider.key} value={provider.key}>
                          {getProviderLabel(provider)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`${runtimeId}-maas-model`} className="text-xs text-muted-foreground">
                    {t("agentRuntime.maasModel")}
                  </Label>
                  <ModelSearchPicker
                    id={`${runtimeId}-maas-model`}
                    value={modelName}
                    onValueChange={setModelName}
                    placeholder={selectedProvider ? pickDefaultModelForRuntime(selectedProvider, runtimeId) : ""}
                    disabled={submitting || !selectedProvider}
                    candidates={modelCandidates}
                    runtimeId={runtimeId}
                  />
                </div>
              </div>

              <div className="min-w-0 space-y-1">
                <Label htmlFor={`${runtimeId}-maas-token`} className="text-xs text-muted-foreground">
                  {t("agentRuntime.maasToken")}
                </Label>
                <Input
                  id={`${runtimeId}-maas-token`}
                  type="text"
                  value={tokenDisplayValue}
                  onChange={(event) => {
                    setTokenDirty(true);
                    setTokenInput(event.target.value);
                  }}
                  onFocus={(event) => {
                    if (!tokenDirty && tokenInput) event.currentTarget.select();
                  }}
                  onMouseUp={(event) => {
                    if (!tokenDirty && tokenInput) event.preventDefault();
                  }}
                  placeholder={
                    selectedProvider && isOAuthProvider(selectedProvider)
                      ? t("agentRuntime.maasOAuthToken")
                      : selectedProvider?.authToken
                        ? t("agentRuntime.maasTokenSaved")
                        : "sk-..."
                  }
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={submitting || !selectedProvider || Boolean(selectedProvider && isOAuthProvider(selectedProvider))}
                  className="h-8 min-w-0 bg-background font-mono text-xs"
                />
              </div>

              {(validationError || actionError) && (
                <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                  {actionError ?? validationError}
                </p>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/settings/maas")}
                  className="h-8 gap-1.5 px-2.5"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {t("agentRuntime.openMaasRegistry")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleApply()}
                  disabled={!canApply}
                  className="h-8 min-w-24 gap-1.5 px-2.5"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {t("agentRuntime.maasApply")}
                </Button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getMaasRuntimeId(runtime: CliRuntime): MaasRuntimeId {
  return runtime === "codex" ? "codex" : "claude-code";
}

function getProviderLabel(provider: MaasProvider): string {
  return provider.label.trim() || provider.key;
}

function isOAuthProvider(provider: MaasProvider): boolean {
  return provider.key === "anthropic-subscription";
}

function isProviderRuntimeAvailable(provider: MaasProvider, runtimeId: MaasRuntimeId): boolean {
  if (runtimeId === "claude-code") return true;
  return !isOAuthProvider(provider);
}

function getRuntimeConfigUnavailableReason(
  provider: MaasProvider,
  runtimeId: MaasRuntimeId,
  tokenOverride: string,
  t: ReturnType<typeof useI18n>["t"],
): string | null {
  if (!isProviderRuntimeAvailable(provider, runtimeId)) {
    return t("agentRuntime.maasProviderUnsupported");
  }
  if (isOAuthProvider(provider)) return null;
  if (!provider.baseUrl.trim()) {
    return t("agentRuntime.maasProviderBaseUrlRequired");
  }
  if (!(tokenOverride || provider.authToken).trim()) {
    return t("agentRuntime.maasProviderTokenRequired");
  }
  return null;
}

function getRuntimeModelName(runtimeId: MaasRuntimeId, modelName: string): string {
  return runtimeId === "claude-code" ? normalizeClaudeCodeModelName(modelName) : modelName.trim();
}

function maskTokenMiddle(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "*".repeat(Math.min(trimmed.length, 6));
  const prefixLength = trimmed.length <= 12 ? 3 : 6;
  const suffixLength = trimmed.length <= 12 ? 3 : 4;
  return `${trimmed.slice(0, prefixLength)}${"*".repeat(6)}${trimmed.slice(-suffixLength)}`;
}

function ModelOptionMark({ selected }: { selected: boolean }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      {selected && <Check className="h-3.5 w-3.5 text-primary" />}
    </span>
  );
}

function ModelSearchPicker({
  id,
  value,
  onValueChange,
  placeholder,
  disabled,
  candidates,
  runtimeId,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  candidates: MaasModel[];
  runtimeId: MaasRuntimeId;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);
  const pendingLocateRef = useRef(false);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCandidates = useMemo(() => {
    if (!normalizedQuery) return candidates;
    return candidates.filter((model) =>
      modelMatchesSearch(model, getRuntimeModelName(runtimeId, model.modelName), normalizedQuery),
    );
  }, [candidates, normalizedQuery, runtimeId]);
  const selectedValue = value.trim();
  const selectedCandidate = candidates.find(
    (model) => getRuntimeModelName(runtimeId, model.modelName) === selectedValue,
  );
  const selectedVisible = visibleCandidates.some(
    (model) => getRuntimeModelName(runtimeId, model.modelName) === selectedValue,
  );
  const customValue = getRuntimeModelName(runtimeId, query);
  const normalizedCustomValue = customValue.toLowerCase();
  const hasExactCustomMatch = candidates.some(
    (model) => getRuntimeModelName(runtimeId, model.modelName).toLowerCase() === normalizedCustomValue,
  );
  const canUseCustom = Boolean(customValue && !hasExactCustomMatch);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || !pendingLocateRef.current || !selectedValue || !selectedVisible) return;
    const frameId = window.requestAnimationFrame(() => {
      selectedOptionRef.current?.scrollIntoView({ block: "center" });
      pendingLocateRef.current = false;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [open, selectedValue, selectedVisible, visibleCandidates]);

  const selectValue = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
    setQuery("");
  };

  const locateSelectedModel = () => {
    if (!selectedCandidate) return;
    pendingLocateRef.current = true;
    if (!selectedVisible) {
      setQuery("");
      return;
    }
    window.requestAnimationFrame(() => {
      selectedOptionRef.current?.scrollIntoView({ block: "center" });
      pendingLocateRef.current = false;
    });
  };

  return (
    <Popover className="block w-full" open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        className={cn(
          "inline-flex h-8 w-full min-w-0 items-center justify-start gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          !selectedValue && "text-muted-foreground",
        )}
        disabled={disabled}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {selectedValue || placeholder || t("agentRuntime.maasModel")}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] !overflow-hidden p-1.5"
      >
        <div className="flex max-h-[min(23rem,calc(100vh-2rem))] min-h-0 flex-col gap-1.5 overflow-hidden">
          <div className="shrink-0 space-y-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canUseCustom) {
                    event.preventDefault();
                    selectValue(customValue);
                  }
                }}
                placeholder={t("composer.searchModels")}
                autoFocus
                spellCheck={false}
                className="h-8 pl-8 font-mono text-xs"
              />
            </div>

            <div
              className={cn(
                MODEL_OPTION_CLASS_NAME,
                selectedCandidate
                  ? "bg-primary/10"
                  : "bg-card-alt/45",
              )}
            >
              <ModelOptionMark selected={Boolean(selectedValue)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {selectedCandidate
                    ? getModelCandidateLabel(selectedCandidate, selectedValue)
                    : selectedValue || t("agentRuntime.notConfigured")}
                </span>
                {selectedValue && (!selectedCandidate || getModelCandidateLabel(selectedCandidate, selectedValue) !== selectedValue) && (
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {selectedValue}
                  </span>
                )}
              </span>
              {selectedValue && (
                <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {t("common.current")}
                </span>
              )}
              <button
                type="button"
                onClick={locateSelectedModel}
                disabled={!selectedCandidate}
                aria-label={t("agentRuntime.maasLocateCurrentModel")}
                title={selectedCandidate ? t("agentRuntime.maasLocateCurrentModel") : undefined}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Locate className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t border-border/70 bg-background/35 pr-1 pt-1.5">
            {visibleCandidates.map((model) => {
              const candidateValue = getRuntimeModelName(runtimeId, model.modelName);
              const label = getModelCandidateLabel(model, candidateValue);
              const selected = selectedValue === candidateValue;
              return (
                <button
                  ref={selected ? selectedOptionRef : undefined}
                  key={`${model.id}:${candidateValue}`}
                  type="button"
                  onClick={() => selectValue(candidateValue)}
                  className={cn(
                    MODEL_OPTION_CLASS_NAME,
                    selected
                      ? "bg-primary/10"
                      : "hover:bg-card-alt/70",
                  )}
                >
                  <ModelOptionMark selected={selected} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{label}</span>
                    {label !== candidateValue && (
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                        {candidateValue}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}

            {canUseCustom && (
              <button
                type="button"
                onClick={() => selectValue(customValue)}
                className={cn(MODEL_OPTION_CLASS_NAME, "hover:bg-card-alt/70")}
              >
                <ModelOptionMark selected={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {t("agentRuntime.maasUseCustomModel", { model: customValue })}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                    {customValue}
                  </span>
                </span>
              </button>
            )}

            {visibleCandidates.length === 0 && !canUseCustom && (
              <p className="rounded-lg border border-dashed border-border bg-card-alt/60 px-3 py-6 text-center text-xs text-muted-foreground">
                {normalizedQuery
                  ? t("composer.noModelsMatch", { query })
                  : t("composer.noModelsConfigured")}
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getRuntimeModelCandidates(provider: MaasProvider, runtimeId: MaasRuntimeId): MaasModel[] {
  const models = provider.models.filter((model) => model.modelName.trim());
  return dedupeModelCandidates(models, runtimeId);
}

function dedupeModelCandidates(models: MaasModel[], runtimeId: MaasRuntimeId): MaasModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const value = getRuntimeModelName(runtimeId, model.modelName);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function isClaudeRuntimeModel(model: MaasModel): boolean {
  return model.vendor === "anthropic" || /(?:^|\/)claude-/i.test(model.modelName);
}

function getModelCandidateLabel(model: MaasModel, value: string): string {
  const displayName = model.displayName.trim();
  if (displayName && displayName !== value) return displayName;
  const id = model.id.trim();
  return id && id !== value ? id : value;
}

function modelMatchesSearch(model: MaasModel, value: string, query: string): boolean {
  return [
    value,
    model.displayName,
    model.id,
    model.vendor,
    model.description,
  ].some((field) => field?.toLowerCase().includes(query));
}

function pickDefaultModelForRuntime(provider: MaasProvider, runtimeId: MaasRuntimeId): string {
  return runtimeId === "codex" ? pickCodexModel(provider) : pickClaudeModel(provider);
}

function pickClaudeModel(provider: MaasProvider): string {
  const anthropic = getRuntimeModelCandidates(provider, "claude-code").filter((model) => isClaudeRuntimeModel(model));
  const sonnet = anthropic.find((model) => /sonnet/i.test(model.modelName));
  if (sonnet) return getRuntimeModelName("claude-code", sonnet.modelName);
  if (anthropic[0]) return getRuntimeModelName("claude-code", anthropic[0].modelName);
  const firstCandidate = getRuntimeModelCandidates(provider, "claude-code")[0];
  if (firstCandidate) return getRuntimeModelName("claude-code", firstCandidate.modelName);
  return provider.baseUrl.includes("zenmux") || provider.models.some((model) => model.modelName.includes("/"))
    ? "anthropic/claude-sonnet-4.6"
    : "claude-sonnet-4-6";
}

function pickCodexModel(provider: MaasProvider): string {
  const models = getRuntimeModelCandidates(provider, "codex");
  const openaiLike = models.find((model) => {
    const modelName = model.modelName.trim();
    return model.vendor === "openai" || /(?:^|\/)(?:gpt-|o[1345](?:-|$)|codex)/i.test(modelName);
  });
  return openaiLike
    ? getRuntimeModelName("codex", openaiLike.modelName)
    : getRuntimeModelName("codex", models[0]?.modelName ?? "openai/gpt-5.2-codex");
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
  for (const runtimeId of ["claude-code", "codex"] satisfies MaasRuntimeId[]) {
    const value = activeProviders[runtimeId];
    if (typeof value === "string" && value) result[runtimeId] = value;
  }
  const legacyActiveProvider = lovcode.activeProvider;
  if (typeof legacyActiveProvider === "string" && legacyActiveProvider && !result["claude-code"]) {
    result["claude-code"] = legacyActiveProvider;
  }
  return result;
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
  for (const runtimeId of ["claude-code", "codex"] satisfies MaasRuntimeId[]) {
    const value = activeModels[runtimeId];
    if (typeof value === "string" && value) result[runtimeId] = value;
  }
  return result;
}

function getSavedMaasRuntimeIds(lovcodeSettings: Record<string, unknown>): MaasRuntimeId[] {
  const saved = lovcodeSettings.maasEnableRuntimes;
  const runtimeIds = ["claude-code", "codex"] satisfies MaasRuntimeId[];
  if (!Array.isArray(saved)) return runtimeIds;
  return saved.filter((id): id is MaasRuntimeId => runtimeIds.includes(id as MaasRuntimeId));
}

async function applyMaasProviderToRuntime({
  runtimeId,
  provider,
  modelName,
  activeProviderKey,
  settings,
  runtimeConfigStatus,
  tokenOverrideProvided,
}: {
  runtimeId: MaasRuntimeId;
  provider: MaasProvider;
  modelName: string;
  activeProviderKey?: string;
  settings?: ClaudeSettings;
  runtimeConfigStatus?: MaasRuntimeConfigStatus;
  tokenOverrideProvided: boolean;
}) {
  if (!isOAuthProvider(provider)) {
    await invoke("upsert_maas_provider", { provider });
  }

  const latestSettings = await invoke<ClaudeSettings>("get_settings").catch(() => settings);
  const latestRaw = latestSettings?.raw ?? settings?.raw;
  const latestRuntimeConfigStatus = await invoke<MaasRuntimeConfigStatus>(
    "get_maas_runtime_config_status",
  ).catch(() => runtimeConfigStatus);
  const currentLovcodeSettings = getLovcodeSettings(latestRaw);
  const latestActiveProviderKeys: Partial<Record<MaasRuntimeId, string>> = {
    ...getActiveProviderKeysByRuntime(latestRaw),
    ...(latestRuntimeConfigStatus?.activeProviders ?? {}),
  };
  const previousProviderKey = latestActiveProviderKeys[runtimeId] ?? activeProviderKey;

  if (runtimeId === "codex") {
    if (previousProviderKey && previousProviderKey !== provider.key) {
      await invoke("snapshot_codex_maas_provider", {
        providerKey: previousProviderKey,
      }).catch(() => {
        /* best-effort */
      });
    }

    await invoke("update_codex_maas_provider", {
      provider,
      model: modelName,
    });
  } else {
    if (previousProviderKey && previousProviderKey !== provider.key) {
      await invoke("snapshot_provider_context", {
        providerKey: previousProviderKey,
        envKeys: CLAUDE_CODE_MAAS_ENV_KEYS,
      }).catch(() => {
        /* best-effort */
      });
    }

    const restored =
      tokenOverrideProvided || isOAuthProvider(provider)
        ? false
        : await invoke<boolean>("restore_provider_context", {
            providerKey: provider.key,
            envKeys: CLAUDE_CODE_MAAS_ENV_KEYS,
          }).catch(() => false);

    if (restored) {
      await patchSettings({
        type: "setEnv",
        envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL",
        envValue: modelName,
      });
    } else if (isOAuthProvider(provider)) {
      await patchSettings([
        { type: "setEnv", envKey: "CLAUDE_CODE_USE_OAUTH", envValue: "1" },
        { type: "setEnv", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", envValue: modelName },
        { type: "deleteEnv", envKey: "ANTHROPIC_AUTH_TOKEN" },
        { type: "deleteEnv", envKey: "ANTHROPIC_BASE_URL" },
      ]);
    } else {
      await patchSettings([
        { type: "setEnv", envKey: "ANTHROPIC_BASE_URL", envValue: provider.baseUrl.trim() },
        { type: "setEnv", envKey: "ANTHROPIC_AUTH_TOKEN", envValue: provider.authToken.trim() },
        { type: "setEnv", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", envValue: modelName },
        { type: "deleteEnv", envKey: "CLAUDE_CODE_USE_OAUTH" },
      ]);
    }
  }

  const nextActiveProviders = {
    ...latestActiveProviderKeys,
    [runtimeId]: provider.key,
  };
  const legacyActiveProvider =
    typeof currentLovcodeSettings.activeProvider === "string"
      ? currentLovcodeSettings.activeProvider
      : nextActiveProviders["claude-code"];
  const maasEnableRuntimes = getSavedMaasRuntimeIds(currentLovcodeSettings);
  const nextMaasEnableRuntimes = maasEnableRuntimes.includes(runtimeId)
    ? maasEnableRuntimes
    : [...maasEnableRuntimes, runtimeId];
  const nextLovcodeSettings = {
    ...currentLovcodeSettings,
    activeProvider: runtimeId === "claude-code" ? provider.key : legacyActiveProvider,
    activeProviders: nextActiveProviders,
    activeModels: {
      ...getActiveModelNamesByRuntime(latestRaw),
      [runtimeId]: modelName,
    },
    maasEnableRuntimes: nextMaasEnableRuntimes,
  };

  await patchSettings({ type: "setField", field: "lovcode", value: nextLovcodeSettings });
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function CliRuntimeAccordionHeader({
  option,
}: {
  option: (typeof AGENT_CLI_RUNTIME_OPTIONS)[number];
}) {
  const { t } = useI18n();
  const {
    data: status,
    isLoading,
    isFetching,
  } = useInvokeQuery<AgentRuntimeStatus>(
    agentRuntimeStatusKey(option.id),
    "get_agent_runtime_status",
    { provider: option.id },
  );
  const checking = isLoading || isFetching;
  const installed = status?.installed === true;
  const missing = status?.installed === false;
  const blocked = status?.runnable === false;
  const versionLabel = checking
    ? t("agentRuntime.checking")
    : status?.version
      ? `v${status.version}`
      : t("common.unknown");
  const statusLabel = checking
    ? t("agentRuntime.checking")
    : installed && !blocked
      ? t("agentRuntime.ready")
      : missing
        ? t("agentRuntime.missing")
        : blocked
          ? t("agentRuntime.blocked")
          : t("common.unknown");

  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background"
      >
        <img src={option.iconSrc} alt="" className="h-5 w-5 object-contain" draggable={false} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{option.label}</span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
          {option.packageName} · {versionLabel}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
          installed && !blocked
            ? "border-primary/30 bg-primary/10 text-primary"
            : missing || blocked
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-background text-muted-foreground",
        )}
      >
        {statusLabel}
      </span>
    </span>
  );
}
