import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, FolderOpen, Terminal } from "lucide-react";
import type { AgentProvider } from "@/types/agent";
import { labelForProvider } from "@/lib/agent/commands";

const PROVIDERS: AgentProvider[] = ["claude", "codex", "terminal"];
const IME_ENTER_GUARD_MS = 160;
const AGENT_ICON_SRC: Partial<Record<AgentProvider, string>> = {
  claude: "/agent-icons/claude.png",
  codex: "/agent-icons/openai.png",
};

interface AgentComposerProps {
  cwd: string | null;
  disabled?: boolean;
  variant?: "dock" | "panel";
  autoFocus?: boolean;
  placeholder?: string;
  submitLabel?: string;
  onCancel?: () => void;
  onPickFolder?: () => void;
  onCreate: (provider: AgentProvider, prompt: string) => void;
}

export function AgentComposer({
  cwd,
  disabled = false,
  variant = "dock",
  autoFocus = false,
  placeholder,
  submitLabel,
  onCancel,
  onPickFolder,
  onCreate,
}: AgentComposerProps) {
  const [provider, setProvider] = useState<AgentProvider>("claude");
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const compositionEndAtRef = useRef(0);
  const canSubmit = Boolean(cwd) && !disabled;
  const isPanel = variant === "panel";

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
  };

  const providerPicker = (
    <div className={isPanel ? "grid grid-cols-3 gap-2" : "flex items-center gap-2 overflow-x-auto"}>
      {PROVIDERS.map((item) => {
        const active = item === provider;
        return (
          <button
            key={item}
            type="button"
            onClick={() => setProvider(item)}
            className={`inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-lg border px-2.5 text-sm font-medium transition-colors ${
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-card-alt hover:text-foreground"
            }`}
          >
            <ProviderMark provider={item} active={active} />
            <span className="truncate">{labelForProvider(item)}</span>
          </button>
        );
      })}
    </div>
  );

  if (isPanel) {
    return (
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl font-semibold text-foreground">New session</h2>
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs text-muted-foreground" title={cwd ?? undefined}>
                {cwd ?? "Select a project"}
              </span>
              {onPickFolder && (
                <button
                  type="button"
                  onClick={onPickFolder}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
                  title="Pick folder"
                  aria-label="Pick folder"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="mt-5">{providerPicker}</div>

        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-terminal px-4 py-3 shadow-sm">
          <div className="flex items-start gap-2">
            <span className="shrink-0 select-none font-mono text-sm leading-6 text-primary">$</span>
            <textarea
              ref={textareaRef}
              rows={4}
              value={prompt}
              disabled={!canSubmit}
              onChange={(event) => {
                setPrompt(event.target.value);
                const target = event.target;
                target.style.height = "auto";
                target.style.height = `${Math.max(target.scrollHeight, 96)}px`;
              }}
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
              placeholder={
                placeholder ?? (cwd
                  ? provider === "terminal"
                    ? "Open a shell in this project"
                    : `Start ${labelForProvider(provider)} with a task`
                  : "Select a project to start")
              }
              className="min-h-24 flex-1 resize-none overflow-hidden bg-transparent p-0 font-mono text-sm leading-6 text-primary-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            <CornerDownLeft className="h-4 w-4" />
            {submitLabel ?? "Start"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-background px-5 py-3">
      <div className="mb-2 flex items-center gap-2">
        {providerPicker}
        <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground" title={cwd ?? undefined}>
          {cwd ?? "Select a project"}
        </span>
      </div>

      <div className="flex items-start gap-2 overflow-hidden rounded-xl border border-border bg-terminal px-4 py-2.5 shadow-sm">
        <span className="shrink-0 select-none font-mono text-sm leading-6 text-primary">$</span>
        <textarea
          ref={textareaRef}
          rows={1}
          value={prompt}
          disabled={!canSubmit}
          onChange={(event) => {
            setPrompt(event.target.value);
            const target = event.target;
            target.style.height = "auto";
            target.style.height = `${target.scrollHeight}px`;
          }}
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
          placeholder={
            placeholder ?? (cwd
              ? provider === "terminal"
                ? "Open a shell in this project"
                : `Start ${labelForProvider(provider)} in this project`
              : "Select a project to start")
          }
          className="min-h-6 flex-1 resize-none overflow-hidden bg-transparent p-0 font-mono text-sm leading-6 text-primary-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card-alt hover:text-primary-foreground disabled:opacity-40"
          title="Start session"
          aria-label={submitLabel ?? "Start session"}
        >
          <CornerDownLeft className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
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
        active ? "bg-primary-foreground/95" : "bg-background ring-1 ring-border/70"
      }`}
    >
      <img src={src} alt="" className="h-4 w-4 object-contain" draggable={false} />
    </span>
  );
}
