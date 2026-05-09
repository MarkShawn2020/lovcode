import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Hash,
  ListChecks,
  Wrench,
} from "lucide-react";
import { CollapsibleContent } from "./CollapsibleContent";
import { PathAwareText } from "./PathAwareText";
import { TraceChevron, TraceMetaPill, traceCardContainerClass, traceCardTriggerClass } from "./TraceCardPrimitives";
import { usePathHits } from "./usePathHits";
import { formatTokens } from "./utils";

interface TaskNotificationCardProps {
  content: string;
  markdown: boolean;
  highlight?: string;
  cwd?: string;
  transformText?: (text: string) => string;
}

interface TaskNotification {
  taskId: string;
  toolUseId: string;
  outputFile: string;
  status: string;
  summary: string;
  result: string;
  totalTokens: number | null;
  toolUses: number | null;
  durationMs: number | null;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function fallbackTagText(source: string, tagName: string) {
  const match = source.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
  return decodeXmlEntities(match?.[1] ?? "").trim();
}

function childText(parent: Element | Document, tagName: string) {
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? "";
}

function parseInteger(text: string) {
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTaskNotification(content: string): TaskNotification {
  const fallback = (): TaskNotification => ({
    taskId: fallbackTagText(content, "task-id"),
    toolUseId: fallbackTagText(content, "tool-use-id"),
    outputFile: fallbackTagText(content, "output-file"),
    status: fallbackTagText(content, "status"),
    summary: fallbackTagText(content, "summary"),
    result: fallbackTagText(content, "result"),
    totalTokens: parseInteger(fallbackTagText(content, "total_tokens")),
    toolUses: parseInteger(fallbackTagText(content, "tool_uses")),
    durationMs: parseInteger(fallbackTagText(content, "duration_ms")),
  });

  if (typeof DOMParser === "undefined") return fallback();

  const doc = new DOMParser().parseFromString(content, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return fallback();

  const root = doc.getElementsByTagName("task-notification")[0];
  if (!root) return fallback();
  const usage = root.getElementsByTagName("usage")[0] ?? root;

  return {
    taskId: childText(root, "task-id"),
    toolUseId: childText(root, "tool-use-id"),
    outputFile: childText(root, "output-file"),
    status: childText(root, "status"),
    summary: childText(root, "summary"),
    result: fallbackTagText(content, "result") || childText(root, "result"),
    totalTokens: parseInteger(childText(usage, "total_tokens")),
    toolUses: parseInteger(childText(usage, "tool_uses")),
    durationMs: parseInteger(childText(usage, "duration_ms")),
  };
}

function agentNameFromSummary(summary: string) {
  return summary.match(/Agent\s+"([^"]+)"/)?.[1] ?? "";
}

function formatDuration(ms: number | null) {
  if (!ms) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function statusClasses(status: string) {
  if (isCompletedStatus(status)) {
    return "border-primary/30 bg-primary/10 text-primary";
  }
  if (isFailedStatus(status)) {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted text-muted-foreground";
}

function isCompletedStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "completed" || normalized === "success";
}

function isFailedStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "failed" || normalized === "error" || normalized === "cancelled";
}

function TodoCheckbox({
  checked,
  failed,
}: {
  checked: boolean;
  failed?: boolean;
}) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border ${
        failed
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : checked
            ? "border-primary/35 bg-primary/5 text-primary/70"
            : "border-border bg-card text-transparent"
      }`}
      aria-hidden="true"
    >
      {checked ? <Check className="h-3 w-3" /> : null}
    </span>
  );
}

function TodoItem({
  checked,
  failed,
  title,
  children,
  last,
}: {
  checked: boolean;
  failed?: boolean;
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
      <div className="relative flex justify-center pt-0.5">
        <TodoCheckbox checked={checked} failed={failed} />
        {!last && <span className="absolute top-6 bottom-0 w-px bg-border" aria-hidden="true" />}
      </div>
      <section className="min-w-0 pb-3">
        <div
          className={`mb-1 text-[11px] font-medium ${
            failed ? "text-destructive" : checked ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {title}
        </div>
        {children}
      </section>
    </div>
  );
}

export function TaskNotificationCard({
  content,
  markdown,
  highlight,
  cwd,
  transformText,
}: TaskNotificationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const task = useMemo(() => parseTaskNotification(content), [content]);
  const summary = transformText ? transformText(task.summary) : task.summary;
  const result = transformText ? transformText(task.result) : task.result;
  const agentName = agentNameFromSummary(summary);
  const title = agentName || summary || task.taskId || "Task";
  const duration = formatDuration(task.durationMs);
  const taskCompleted = isCompletedStatus(task.status);
  const taskFailed = isFailedStatus(task.status);
  const visibleStatus = task.status && !taskCompleted ? task.status : "";
  const hasResult = Boolean(result || task.outputFile);
  const hasUsage = Boolean(task.totalTokens || task.toolUses || duration);
  const summaryHits = usePathHits(expanded ? summary : "", cwd);
  const outputFileHits = usePathHits(expanded ? task.outputFile : "", cwd);
  const rawHits = usePathHits(expanded && rawExpanded ? content : "", cwd);

  return (
    <div className={traceCardContainerClass(expanded)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className={traceCardTriggerClass(expanded)}
      >
        <TodoCheckbox checked={taskCompleted} failed={taskFailed} />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 text-[11px] font-medium leading-5 text-muted-foreground">Task</span>
          <span className="block min-w-0 flex-1 truncate font-mono text-[13px] leading-5 text-foreground" title={summary || title}>
            {title}
          </span>
        </div>
        <div className="hidden max-w-[45%] items-center gap-1 sm:flex">
          {visibleStatus && (
            <span className={`shrink-0 rounded-lg border px-1.5 py-0.5 text-[10px] font-medium ${statusClasses(visibleStatus)}`}>
              {visibleStatus}
            </span>
          )}
          {duration && <TraceMetaPill icon={<Clock3 className="h-3 w-3" />} label={duration} />}
          {task.toolUses !== null && <TraceMetaPill icon={<Wrench className="h-3 w-3" />} label={`${task.toolUses} tools`} />}
        </div>
        <TraceChevron expanded={expanded} />
      </button>

      {expanded && (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" />
            <span>Task checklist</span>
          </div>

          <TodoItem checked={Boolean(summary || task.taskId)} title="Agent assigned">
            <div className="space-y-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <TraceMetaPill icon={<Bot className="h-3 w-3" />} label={agentName || "Agent task"} />
                {visibleStatus && (
                  <span className={`rounded-lg border px-1.5 py-0.5 text-[11px] font-medium ${statusClasses(visibleStatus)}`}>
                    {visibleStatus}
                  </span>
                )}
                {task.taskId && <TraceMetaPill icon={<Hash className="h-3 w-3" />} label={task.taskId} />}
                {task.toolUseId && <TraceMetaPill icon={<Wrench className="h-3 w-3" />} label={task.toolUseId} />}
              </div>
              {summary && (
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                  <PathAwareText text={summary} hits={summaryHits} highlight={highlight} />
                </p>
              )}
            </div>
          </TodoItem>

          {hasResult && (
            <TodoItem checked title="Result captured">
              <div className="space-y-2">
                {task.outputFile && (
                  <div className="rounded-lg border border-border bg-card px-2.5 py-2 font-mono text-xs text-muted-foreground">
                    <PathAwareText text={task.outputFile} hits={outputFileHits} highlight={highlight} />
                  </div>
                )}
                {result && (
                  <div className="rounded-lg border border-border bg-card px-2.5 py-2">
                    <CollapsibleContent
                      content={result}
                      markdown={markdown}
                      highlight={highlight}
                      cwd={cwd}
                    />
                  </div>
                )}
              </div>
            </TodoItem>
          )}

          {hasUsage && (
            <TodoItem checked title="Usage recorded">
              <div className="flex flex-wrap gap-1.5">
                {task.totalTokens !== null && (
                  <TraceMetaPill icon={<FileText className="h-3 w-3" />} label={`${formatTokens(task.totalTokens)} tokens`} />
                )}
                {task.toolUses !== null && <TraceMetaPill icon={<Wrench className="h-3 w-3" />} label={`${task.toolUses} tool uses`} />}
                {duration && <TraceMetaPill icon={<Clock3 className="h-3 w-3" />} label={duration} />}
              </div>
            </TodoItem>
          )}

          {visibleStatus && (
            <TodoItem checked={false} failed={taskFailed} title="Task status">
              <span className={`inline-flex rounded-lg border px-1.5 py-0.5 text-[11px] font-medium ${statusClasses(visibleStatus)}`}>
                {visibleStatus}
              </span>
            </TodoItem>
          )}

          <TodoItem checked={rawExpanded} title="Raw notification" last>
            <button
              type="button"
              onClick={() => setRawExpanded(!rawExpanded)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
            >
              {rawExpanded ? <TraceChevron expanded /> : <ChevronRight className="h-3 w-3" />}
              Raw notification
            </button>
            {rawExpanded && (
              <pre className="mt-1 max-h-80 overflow-auto rounded-lg border border-border bg-card px-2.5 py-2 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                <PathAwareText text={content} hits={rawHits} highlight={highlight} />
              </pre>
            )}
          </TodoItem>
        </div>
      )}
    </div>
  );
}
