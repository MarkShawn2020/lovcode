import { invoke } from "@tauri-apps/api/core";
import { FileIcon, CopyIcon, ExternalLinkIcon } from "@radix-ui/react-icons";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "../ui/context-menu";

interface FilePathProps {
  path: string;
  className?: string;
  showIcon?: boolean;
}

export function FilePath({ path, className = "", showIcon = false }: FilePathProps) {
  const handleReveal = async () => {
    try {
      await invoke("reveal_path", { path });
    } catch (e) {
      console.error("Failed to reveal path:", e);
    }
  };

  const handleOpen = async () => {
    try {
      await invoke("open_path", { path });
    } catch (e) {
      console.error("Failed to open path:", e);
    }
  };

  const handleCopyPath = async () => {
    try {
      await invoke("copy_to_clipboard", { text: path });
    } catch (e) {
      console.error("Failed to copy path:", e);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 font-mono text-muted-foreground/50 hover:text-muted-foreground cursor-context-menu truncate ${className}`}
          title={path}
        >
          {showIcon && <FileIcon className="w-3 h-3 flex-shrink-0" />}
          <span className="truncate">{path}</span>
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleReveal}>
          <ExternalLinkIcon className="w-4 h-4 mr-2" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpen}>
          <FileIcon className="w-4 h-4 mr-2" />
          Open File
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyPath}>
          <CopyIcon className="w-4 h-4 mr-2" />
          Copy Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
