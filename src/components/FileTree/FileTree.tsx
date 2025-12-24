import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRightIcon, ChevronDownIcon, FileIcon, CopyIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FileTreeProps {
  rootPath: string;
  onFileClick?: (path: string) => void;
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  onFileClick?: (path: string) => void;
}

function TreeNode({ entry, depth, onFileClick }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChildren = useCallback(async () => {
    if (!entry.is_dir || children.length > 0) return;

    setLoading(true);
    try {
      const entries = await invoke<DirEntry[]>("list_directory", { path: entry.path });
      setChildren(entries);
    } catch (err) {
      console.error("Failed to load directory:", err);
    } finally {
      setLoading(false);
    }
  }, [entry.path, entry.is_dir, children.length]);

  const handleClick = useCallback(() => {
    if (entry.is_dir) {
      if (!expanded) {
        loadChildren();
      }
      setExpanded(!expanded);
    } else {
      onFileClick?.(entry.path);
    }
  }, [entry, expanded, loadChildren, onFileClick]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(entry.path);
  }, [entry.path]);

  const handleCopyName = useCallback(() => {
    navigator.clipboard.writeText(entry.name);
  }, [entry.name]);

  const handleCopyContent = useCallback(async () => {
    if (entry.is_dir) return;
    try {
      const content = await invoke<string>("read_file", { path: entry.path });
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Failed to copy content:", err);
    }
  }, [entry.path, entry.is_dir]);

  const handleOpenInEditor = useCallback(async () => {
    try {
      await invoke("open_in_editor", { path: entry.path });
    } catch (err) {
      console.error("Failed to open in editor:", err);
    }
  }, [entry.path]);

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="flex items-center gap-1 py-0.5 px-1 hover:bg-primary/10 rounded cursor-pointer text-sm transition-colors"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onClick={handleClick}
          >
            {entry.is_dir ? (
              expanded ? (
                <ChevronDownIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )
            ) : (
              <FileIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            )}
            <span className="truncate text-ink/80">{entry.name}</span>
            {loading && <span className="text-xs text-muted-foreground ml-1">...</span>}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleCopyPath}>
            <CopyIcon className="w-4 h-4 mr-2" />
            Copy Path
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCopyName}>
            <CopyIcon className="w-4 h-4 mr-2" />
            Copy Name
          </ContextMenuItem>
          {!entry.is_dir && (
            <ContextMenuItem onClick={handleCopyContent}>
              <CopyIcon className="w-4 h-4 mr-2" />
              Copy Content
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleOpenInEditor}>
            <ExternalLinkIcon className="w-4 h-4 mr-2" />
            Open in Editor
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ rootPath, onFileClick }: FileTreeProps) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRoot() {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<DirEntry[]>("list_directory", { path: rootPath });
        if (!cancelled) {
          setEntries(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadRoot();

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  if (loading) {
    return <div className="text-xs text-muted-foreground p-2">Loading...</div>;
  }

  if (error) {
    return <div className="text-xs text-destructive p-2">{error}</div>;
  }

  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground p-2">Empty directory</div>;
  }

  return (
    <div className="py-1">
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}
