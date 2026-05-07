import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, CircleAlert, CircleCheck, Copy, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type Variant = "error" | "success" | "info";
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  message: string;
  variant: Variant;
  action?: ToastAction;
}

interface ToastGroup {
  key: string;
  message: string;
  variant: Variant;
  ids: number[];
  count: number;
  latestId: number;
  /** Action toasts are never merged — each instance has its own callback. */
  action?: ToastAction;
}

type Listener = (items: ToastItem[]) => void;

let counter = 0;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function dismissMany(ids: number[]) {
  const idSet = new Set(ids);
  items = items.filter((t) => !idSet.has(t.id));
  emit();
}

function dismissAll() {
  items = [];
  emit();
}

function push(message: string, variant: Variant, ttl: number | null, action?: ToastAction) {
  const id = ++counter;
  items = [...items, { id, message, variant, action }];
  emit();
  if (ttl !== null) {
    setTimeout(() => dismiss(id), ttl);
  }
  return id;
}

interface ToastOptions {
  action?: ToastAction;
  ttl?: number | null;
}

export const toast = {
  // Errors are sticky — user dismisses (often after copying).
  error: (message: string) => push(message, "error", null),
  success: (message: string, opts?: ToastOptions) =>
    push(message, "success", opts?.ttl ?? 3000, opts?.action),
  info: (message: string, opts?: ToastOptions) =>
    push(message, "info", opts?.ttl ?? 3000, opts?.action),
  dismiss,
};

const variantClasses: Record<Variant, string> = {
  error: "border-destructive/30 bg-card text-foreground",
  success: "border-primary/30 bg-card text-foreground",
  info: "border-border bg-card text-foreground",
};

const variantIconClasses: Record<Variant, string> = {
  error: "text-destructive",
  success: "text-primary",
  info: "text-muted-foreground",
};

const variantIcons = {
  error: CircleAlert,
  success: CircleCheck,
  info: Info,
} satisfies Record<Variant, typeof CircleAlert>;

function groupToasts(list: ToastItem[]): ToastGroup[] {
  const grouped = new Map<string, ToastGroup>();
  const standalone: ToastGroup[] = [];

  for (const item of list) {
    // Action toasts must stay separate so each keeps its own callback.
    if (item.action) {
      standalone.push({
        key: `action:${item.id}`,
        message: item.message,
        variant: item.variant,
        ids: [item.id],
        count: 1,
        latestId: item.id,
        action: item.action,
      });
      continue;
    }

    const key = `${item.variant}:${item.message}`;
    const group = grouped.get(key);

    if (group) {
      group.ids.push(item.id);
      group.count += 1;
      group.latestId = item.id;
    } else {
      grouped.set(key, {
        key,
        message: item.message,
        variant: item.variant,
        ids: [item.id],
        count: 1,
        latestId: item.id,
      });
    }
  }

  return [...grouped.values(), ...standalone].sort((a, b) => b.latestId - a.latestId);
}

function ToastRow({ group }: { group: ToastGroup }) {
  const [copied, setCopied] = useState(false);
  const { t, translate } = useI18n();
  const Icon = variantIcons[group.variant];
  const message = translate(group.message);
  const actionLabel = group.action ? translate(group.action.label) : "";

  const copy = () => {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(console.error);
  };
  return (
    <div
      className={cn(
        "pointer-events-auto grid w-[min(420px,calc(100vw-2rem))] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg",
        variantClasses[group.variant],
      )}
      role={group.variant === "error" ? "alert" : "status"}
    >
      <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-background", variantIconClasses[group.variant])}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 break-words whitespace-pre-wrap leading-5">{message}</span>
      <div className="flex items-center gap-1 shrink-0">
        {group.action && (
          <button
            type="button"
            className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition hover:bg-accent"
            onClick={() => {
              group.action!.onClick();
              dismissMany(group.ids);
            }}
          >
            {actionLabel}
          </button>
        )}
        {group.count > 1 ? (
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-background px-1.5 text-[11px] font-medium text-muted-foreground"
            aria-label={translate(`${group.count} 条相同通知`)}
          >
            {group.count}
          </span>
        ) : null}
        <button
          type="button"
          className="rounded-md p-0.5 text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground hover:opacity-100"
          onClick={copy}
          title={t("toast.copyNotification")}
          aria-label={t("toast.copyNotification")}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          className="rounded-md p-0.5 text-muted-foreground opacity-70 transition hover:bg-accent hover:text-foreground hover:opacity-100"
          onClick={() => dismissMany(group.ids)}
          title={group.count > 1 ? t("toast.closeGroup") : t("toast.closeNotification")}
          aria-label={group.count > 1 ? t("toast.closeGroup") : t("toast.closeNotification")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function ToastStack({
  groups,
  expanded,
  onExpandedChange,
}: {
  groups: ToastGroup[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { t } = useI18n();
  const totalCount = groups.reduce((sum, group) => sum + group.count, 0);

  if (expanded) {
    return (
      <div className="pointer-events-auto flex w-[min(420px,calc(100vw-2rem))] flex-col items-end gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-1.5 py-1 shadow-md">
          <span className="px-1.5 text-xs font-medium text-muted-foreground">{totalCount}</span>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => dismissAll()}
            title={t("toast.closeAll")}
            aria-label={t("toast.closeAll")}
          >
            <X size={14} />
          </button>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => onExpandedChange(false)}
            title={t("toast.collapse")}
            aria-label={t("toast.collapse")}
          >
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="flex max-h-[min(70vh,28rem)] flex-col gap-2 overflow-y-auto pr-1">
          {groups.map((group) => (
            <ToastRow key={group.key} group={group} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto relative w-[min(420px,calc(100vw-2rem))] pb-3 pt-8">
      <div className="absolute inset-x-6 bottom-0 top-8 rounded-xl border border-border bg-card shadow-sm" />
      <div className="absolute inset-x-3 bottom-1.5 top-6 rounded-xl border border-border bg-card shadow-md" />
      <button
        type="button"
        className="absolute right-2 top-0 z-20 inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs font-medium text-muted-foreground shadow-md transition hover:bg-accent hover:text-foreground"
        onClick={() => onExpandedChange(true)}
        title={t("toast.expand")}
        aria-label={t("toast.expand")}
        aria-expanded={false}
      >
        <span>{totalCount}</span>
        <ChevronUp size={14} />
      </button>
      <div className="relative z-10">
        <ToastRow group={groups[0]} />
      </div>
    </div>
  );
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupToasts(list), [list]);

  useEffect(() => {
    const fn: Listener = (next) => setList(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (groups.length <= 1) {
      setExpanded(false);
    }
  }, [groups.length]);

  if (groups.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2 pointer-events-none">
      {groups.length > 1 ? (
        <ToastStack groups={groups} expanded={expanded} onExpandedChange={setExpanded} />
      ) : (
        <ToastRow group={groups[0]} />
      )}
    </div>
  );
}
