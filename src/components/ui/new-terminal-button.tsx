import { PlusIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";

export type TerminalType = "terminal" | "claude" | "codex";

export interface TerminalOption {
  type: TerminalType;
  label: string;
  command?: string;
}

export const TERMINAL_OPTIONS: TerminalOption[] = [
  { type: "terminal", label: "Terminal" },
  { type: "claude", label: "Claude Code", command: "claude" },
  { type: "codex", label: "Codex", command: "codex" },
];

export interface ProjectOption {
  id: string;
  name: string;
  path: string;
}

interface NewTerminalSplitButtonProps {
  onSelect: (command?: string) => void;
  variant?: "primary" | "icon";
  className?: string;
}

/**
 * Split button for creating new terminals with multiple shell options.
 * - Primary variant: Full button with "New Terminal" text (for empty state)
 * - Icon variant: Compact icon-only button (for inline use)
 */
export function NewTerminalSplitButton({
  onSelect,
  variant = "primary",
  className = "",
}: NewTerminalSplitButtonProps) {
  if (variant === "icon") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`p-0.5 text-muted-foreground hover:text-ink transition-colors ${className}`}
            title="New terminal"
            onClick={(e) => e.stopPropagation()}
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {TERMINAL_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.type}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(opt.command);
              }}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Primary variant - full split button
  return (
    <div className={`inline-flex rounded-lg overflow-hidden ${className}`}>
      <button
        onClick={() => onSelect()}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <PlusIcon className="w-4 h-4" />
        New Terminal
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="px-2 py-2 bg-primary text-primary-foreground hover:bg-primary/90 border-l border-primary-foreground/20 transition-colors">
            <ChevronDownIcon className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {TERMINAL_OPTIONS.map((opt) => (
            <DropdownMenuItem key={opt.type} onClick={() => onSelect(opt.command)}>
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
