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
import { Check, ChevronDown, FolderOpen, MessageSquare, SendHorizontal, Terminal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentProvider } from "@/types/agent";
import { labelForProvider } from "@/lib/agent/commands";
import { cn } from "@/lib/utils";

const PROVIDERS: AgentProvider[] = ["claude", "codex", "terminal"];
const IME_ENTER_GUARD_MS = 160;
const TEXTAREA_BOUNDS = {
  panel: { min: 112, max: 280 },
  dock: { min: 28, max: 152 },
};
const AGENT_ICON_SRC: Partial<Record<AgentProvider, string>> = {
  claude: "/agent-icons/claude.png",
  codex: "/agent-icons/openai.png",
};

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
              <ProjectPathPill
                cwd={cwd}
                label={displayCwdLabel}
                hasProjectPath={hasProjectPath}
                pathOptions={pathOptions}
                allowNoProject={allowNoProject}
                onPickFolder={onPickFolder}
                onSelectCwd={onSelectCwd}
                className="mt-2 max-w-full"
              />
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
            {providerPicker}
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
            className="max-w-[48%] shrink-0 bg-card"
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
            "inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-card-alt/60 px-3 text-left text-sm font-medium text-foreground shadow-sm transition-[background-color,border-color,box-shadow] hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label="Switch CLI"
          title="Switch CLI"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ProviderMark provider={provider} active />
            <span className="truncate">{labelForProvider(provider)}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
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
  const currentKey = normalizePathForCompare(cwd);
  const baseClassName = cn(
    "inline-flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    compact ? "h-8 px-2.5" : "h-11 px-3",
    hasPath ? "text-foreground" : "text-muted-foreground",
    hasMenu ? "hover:bg-card hover:text-foreground" : "",
    className,
  );
  const content = (
    <>
      <span className={cn("flex shrink-0 items-center justify-center rounded-md bg-card-alt text-muted-foreground", compact ? "h-5 w-5" : "h-7 w-7")}>
        {hasPath ? <FolderOpen className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
      </span>
      <span className="grid min-w-0 flex-1">
        {!compact && (
          <span className="text-[10px] font-medium uppercase leading-3 text-muted-foreground">
            {hasPath ? "Project" : "No project"}
          </span>
        )}
        <span className="truncate font-mono text-xs leading-4">{displayLabel}</span>
      </span>
      {hasMenu && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </>
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
      <DropdownMenuContent align="start" sideOffset={6} className="max-h-[min(420px,80vh)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-1.5">
        {allowNoProject && (
          <DropdownMenuItem onSelect={() => onSelectCwd?.(null)} className={cn("gap-2 rounded-lg py-2", !hasPath ? "bg-primary/10" : "")}>
            <MenuCheck active={!hasPath} />
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="grid min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">General chat</span>
              <span className="truncate text-xs text-muted-foreground">No project folder</span>
            </span>
          </DropdownMenuItem>
        )}

        {pathOptions.length > 0 && (
          <>
            {allowNoProject && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">Recent paths</DropdownMenuLabel>
            {pathOptions.map((option) => {
              const optionKey = normalizePathForCompare(option.path);
              const active = Boolean(currentKey && optionKey === currentKey);
              const optionLabel = option.label ?? getPathName(option.path);
              const optionDetail = option.detail ?? option.path;
              return (
                <DropdownMenuItem
                  key={option.path}
                  onSelect={() => onSelectCwd?.(option.path)}
                  className={cn("gap-2 rounded-lg py-2", active ? "bg-primary/10" : "")}
                >
                  <MenuCheck active={active} />
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-medium text-foreground">{optionLabel}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground" title={option.path}>
                      {optionDetail}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {onPickFolder && (
          <>
            {(allowNoProject || pathOptions.length > 0) && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onPickFolder()} className="gap-2 rounded-lg py-2">
              <span className="h-4 w-4 shrink-0" />
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Choose other folder...</span>
            </DropdownMenuItem>
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
