import { useRef, useEffect } from "react";

export interface CommandItem {
  name: string;
  description: string | null;
  path: string;
}

interface SlashCommandMenuProps {
  commands: CommandItem[];
  filter: string;
  selectedIndex: number;
  onSelect: (command: CommandItem) => void;
}

export function SlashCommandMenu({
  commands,
  filter,
  selectedIndex,
  onSelect,
}: SlashCommandMenuProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Filter and sort commands (case-insensitive)
  const filtered = commands
    .filter((cmd) => {
      const search = filter.toLowerCase();
      return (
        cmd.name.toLowerCase().includes(search) ||
        (cmd.description?.toLowerCase().includes(search) ?? false)
      );
    })
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedIndex]);

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-2.5 border-t border-border bg-muted/30 text-sm text-muted-foreground">
        No commands found
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-muted/30 max-h-48 overflow-auto">
      {filtered.map((cmd, index) => (
        <button
          key={cmd.path}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          onClick={() => onSelect(cmd)}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
            index === selectedIndex
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-muted"
          }`}
        >
          <span className="font-mono text-sm font-medium shrink-0">{cmd.name}</span>
          {cmd.description && (
            <span className="text-xs text-muted-foreground truncate">
              {cmd.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
