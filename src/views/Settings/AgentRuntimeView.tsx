import { useSearchParams } from "react-router-dom";
import { PageHeader, ConfigPage } from "../../components/config";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../components/ui/accordion";
import { useInvokeQuery } from "../../hooks";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import type { AgentRuntimeStatus } from "../../types/agent";
import { agentRuntimeStatusKey } from "./AgentCliRuntimeCard";
import { AGENT_CLI_RUNTIME_OPTIONS, type CliRuntime } from "./agentCliRuntimeConfig";
import { ClaudeCodeVersionSection } from "./ClaudeCodeVersionSection";
import { CodexCliVersionSection } from "./CodexCliVersionSection";

export function AgentRuntimeView() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRuntime: CliRuntime = searchParams.get("runtime") === "codex" ? "codex" : "claude";

  const handleRuntimeChange = (value: string | string[]) => {
    const runtime = Array.isArray(value) ? value[0] : value;
    if (runtime !== "claude" && runtime !== "codex") return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("runtime", runtime);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <ConfigPage>
      <PageHeader title={t("agentRuntime.title")} subtitle={t("agentRuntime.subtitle")} />
      <Accordion
        type="single"
        value={selectedRuntime}
        onValueChange={handleRuntimeChange}
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        {AGENT_CLI_RUNTIME_OPTIONS.map((option) => (
          <AccordionItem key={option.id} value={option.id}>
            <AccordionTrigger className="hover:bg-card-alt">
              <CliRuntimeAccordionHeader option={option} />
            </AccordionTrigger>
            <AccordionContent className="bg-background/40 p-2">
              {option.id === "codex" ? <CodexCliVersionSection /> : <ClaudeCodeVersionSection />}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </ConfigPage>
  );
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
