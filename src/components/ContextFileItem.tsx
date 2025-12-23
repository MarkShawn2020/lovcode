import { invoke } from "@tauri-apps/api/core";
import Markdown from "react-markdown";
import { Collapsible, CollapsibleTrigger, CollapsibleContent, useCollapsible } from "./ui/collapsible";
// Radix icons
import { ExternalLinkIcon, CopyIcon, CheckIcon } from "@radix-ui/react-icons";
import { useState, ReactNode } from "react";
import { useAppConfig } from "../App";

function ChevronIcon() {
  const { open } = useCollapsible();
  return <span className="text-xs text-muted-foreground">{open ? "▼" : "▶"}</span>;
}

// ============================================================================
// CollapsibleItem - Base component for collapsible file items
// ============================================================================

interface CollapsibleItemProps {
  name: string;
  path: string;
  content: string;
  variant?: "card" | "card-alt";
  renderContent?: (content: string) => ReactNode;
}

export function CollapsibleItem({ name, path, content, variant = "card-alt", renderContent }: CollapsibleItemProps) {
  const { formatPath } = useAppConfig();
  const [copied, setCopied] = useState(false);
  const bgClass = variant === "card" ? "bg-card border border-border" : "bg-card-alt";
  const hoverClass = variant === "card" ? "hover:bg-card-alt/50" : "hover:bg-card-alt/80";

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Collapsible className={`${bgClass} rounded-lg overflow-hidden`}>
      <CollapsibleTrigger className={`flex items-center gap-2 px-3 py-1.5 w-full ${hoverClass}`}>
        <ChevronIcon />
        <span className="text-sm text-ink shrink-0">{name}</span>
        <span className="flex-1 font-mono text-xs text-muted-foreground truncate text-left">{formatPath(path)}</span>
        <button
          onClick={handleCopy}
          className="text-muted-foreground hover:text-primary shrink-0"
          title="Copy content"
        >
          {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); invoke("open_in_editor", { path }); }}
          className="text-muted-foreground hover:text-primary shrink-0"
          title={formatPath(path)}
        >
          <ExternalLinkIcon className="w-3.5 h-3.5" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-2 border-t border-border/50 pt-2">
        {renderContent ? renderContent(content) : (
          <div className="prose prose-sm max-w-none text-ink">
            <Markdown>{content}</Markdown>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================================
// ContextFileItem - For context files (CLAUDE.md etc)
// ============================================================================

interface ContextFile {
  name: string;
  path: string;
  scope: string;
  content: string;
}

interface ContextFileItemProps {
  file: ContextFile;
  showIcon?: boolean;
  variant?: "card" | "card-alt";
}

export function ContextFileItem({ file, showIcon = false, variant = "card-alt" }: ContextFileItemProps) {
  const icon = showIcon ? (file.scope === "command" ? "⚡ " : "📄 ") : "";
  return (
    <CollapsibleItem
      name={`${icon}${file.name}`}
      path={file.path}
      content={file.content}
      variant={variant}
    />
  );
}

// ============================================================================
// ConfigFileItem - For settings.json
// ============================================================================

interface ConfigFileItemProps {
  name: string;
  path: string;
  content: Record<string, unknown>;
  variant?: "card" | "card-alt";
}

export function ConfigFileItem({ name, path, content, variant = "card-alt" }: ConfigFileItemProps) {
  const jsonString = JSON.stringify(content, null, 2);
  return (
    <CollapsibleItem
      name={name}
      path={path}
      content={jsonString}
      variant={variant}
      renderContent={(c) => (
        <pre className="bg-card-alt rounded-lg p-3 text-xs font-mono text-ink overflow-x-auto max-h-96">
          {c}
        </pre>
      )}
    />
  );
}
