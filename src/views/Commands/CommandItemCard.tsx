import { useState } from "react";
import { Terminal } from "lucide-react";
import {
  DotsHorizontalIcon,
  QuestionMarkCircledIcon,
  ExternalLinkIcon,
  CopyIcon,
  CheckIcon,
  ResetIcon,
  ArchiveIcon,
} from "@radix-ui/react-icons";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { LocalCommand } from "../../types";

interface CommandItemCardProps {
  command: LocalCommand;
  displayName?: string;
  usageCount?: number;
  onClick: () => void;
  onOpenInEditor?: () => void;
  onDeprecate?: () => void;
  onRestore?: () => void;
}

export function CommandItemCard({
  command,
  displayName,
  usageCount,
  onClick,
  onOpenInEditor,
  onDeprecate,
  onRestore,
}: CommandItemCardProps) {
  const [copied, setCopied] = useState(false);
  const isDeprecated = command.status === "deprecated";
  const isArchived = command.status === "archived";
  const isInactive = isDeprecated || isArchived;

  const handleCopyPath = () => {
    navigator.clipboard.writeText(command.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={`w-full flex items-center gap-2 py-1.5 px-2 text-left rounded-md transition-colors cursor-pointer ${
        isInactive ? "opacity-60 hover:opacity-100" : ""
      } hover:bg-muted/50`}
    >
      <Terminal
        className={`w-4 h-4 shrink-0 ${isInactive ? "text-muted-foreground" : "text-primary"}`}
      />
      <span
        className={`font-mono font-medium shrink-0 ${isInactive ? "text-muted-foreground" : "text-primary"}`}
      >
        {displayName ?? command.name}
      </span>
      {command.version && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
          v{command.version.replace(/^["']|["']$/g, "")}
        </span>
      )}
      {usageCount !== undefined && usageCount > 0 && (
        <span
          className={`shrink-0 text-xs font-bold italic tabular-nums ${
            usageCount >= 100
              ? "text-amber-500"
              : usageCount >= 50
                ? "text-orange-500"
                : usageCount >= 10
                  ? "text-primary"
                  : "text-muted-foreground"
          }`}
          title={`Used ${usageCount} times`}
        >
          ×{usageCount}
        </span>
      )}
      <span className="flex-1" />
      {copied && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 shrink-0 animate-pulse">
          Copied!
        </span>
      )}
      {isDeprecated && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 shrink-0">
          deprecated
        </span>
      )}
      {isArchived && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-card-alt text-muted-foreground shrink-0">
          archived
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 shrink-0 p-0"
            onClick={(e) => e.stopPropagation()}
          >
            <DotsHorizontalIcon className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onClick}>
            <QuestionMarkCircledIcon className="w-4 h-4 mr-2" />
            View Details
          </DropdownMenuItem>
          {onOpenInEditor && (
            <DropdownMenuItem onClick={onOpenInEditor}>
              <ExternalLinkIcon className="w-4 h-4 mr-2" />
              Open in Editor
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleCopyPath}>
            {copied ? (
              <CheckIcon className="w-4 h-4 mr-2 text-primary" />
            ) : (
              <CopyIcon className="w-4 h-4 mr-2" />
            )}
            {copied ? "Copied!" : "Copy Path"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isInactive && onRestore && (
            <DropdownMenuItem onClick={onRestore}>
              <ResetIcon className="w-4 h-4 mr-2" />
              Restore
            </DropdownMenuItem>
          )}
          {!isInactive && onDeprecate && (
            <DropdownMenuItem onClick={onDeprecate} className="text-amber-600">
              <ArchiveIcon className="w-4 h-4 mr-2" />
              Deprecate
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
