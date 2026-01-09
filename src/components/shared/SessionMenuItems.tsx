import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Copy, Download } from "lucide-react";
import { ExternalLinkIcon, ChatBubbleIcon } from "@radix-ui/react-icons";
import {
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

export interface SessionMenuConfig {
  projectId: string;
  sessionId: string;
  originalChat?: boolean;
  setOriginalChat?: (v: boolean) => void;
  markdownPreview?: boolean;
  setMarkdownPreview?: (v: boolean) => void;
  onExport?: () => void;
  onResume?: () => void;
  onCopySessionId?: () => void;
}

// Shared handlers
export function useSessionMenuHandlers(projectId: string, sessionId: string) {
  const handleReveal = () => invoke("reveal_session_file", { projectId, sessionId });
  const handleOpenInEditor = () => invoke("open_session_in_editor", { projectId, sessionId });
  const handleCopyPath = async () => {
    const homeDir = await invoke<string>("get_home_dir");
    const path = `${homeDir}/.claude/projects/${projectId}/${sessionId}.jsonl`;
    await invoke("copy_to_clipboard", { text: path });
  };
  const handleCopySessionId = () => invoke("copy_to_clipboard", { text: sessionId });

  return { handleReveal, handleOpenInEditor, handleCopyPath, handleCopySessionId };
}

// DropdownMenu items
export function SessionDropdownMenuItems({
  projectId,
  sessionId,
  originalChat,
  setOriginalChat,
  markdownPreview,
  setMarkdownPreview,
  onExport,
  onResume,
}: SessionMenuConfig) {
  const { handleReveal, handleOpenInEditor, handleCopyPath, handleCopySessionId } =
    useSessionMenuHandlers(projectId, sessionId);

  return (
    <>
      {onResume && (
        <>
          <DropdownMenuItem onClick={handleCopySessionId} className="gap-2">
            <Copy size={14} />
            Copy Session ID
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onResume} className="gap-2">
            <ChatBubbleIcon className="w-3.5 h-3.5" />
            Resume Session
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={handleReveal} className="gap-2">
        <FolderOpen size={14} />
        Reveal in Finder
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleOpenInEditor} className="gap-2">
        <ExternalLinkIcon width={14} />
        Open in Editor
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleCopyPath} className="gap-2">
        <Copy size={14} />
        Copy Path
      </DropdownMenuItem>
      {(setOriginalChat || setMarkdownPreview) && (
        <>
          <DropdownMenuSeparator />
          {setOriginalChat && (
            <DropdownMenuCheckboxItem checked={originalChat} onCheckedChange={setOriginalChat}>
              Readable Slash Command
            </DropdownMenuCheckboxItem>
          )}
          {setMarkdownPreview && (
            <DropdownMenuCheckboxItem checked={markdownPreview} onCheckedChange={setMarkdownPreview}>
              Markdown Preview
            </DropdownMenuCheckboxItem>
          )}
        </>
      )}
      {onExport && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onExport} className="gap-2">
            <Download size={14} />
            Export
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

// ContextMenu items
export function SessionContextMenuItems({
  projectId,
  sessionId,
  originalChat,
  setOriginalChat,
  markdownPreview,
  setMarkdownPreview,
  onExport,
  onResume,
}: SessionMenuConfig) {
  const { handleReveal, handleOpenInEditor, handleCopyPath, handleCopySessionId } =
    useSessionMenuHandlers(projectId, sessionId);

  return (
    <>
      {onResume && (
        <>
          <ContextMenuItem onClick={handleCopySessionId} className="gap-2">
            <Copy size={14} />
            Copy Session ID
          </ContextMenuItem>
          <ContextMenuItem onClick={onResume} className="gap-2">
            <ChatBubbleIcon className="w-3.5 h-3.5" />
            Resume Session
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={handleReveal} className="gap-2">
        <FolderOpen size={14} />
        Reveal in Finder
      </ContextMenuItem>
      <ContextMenuItem onClick={handleOpenInEditor} className="gap-2">
        <ExternalLinkIcon width={14} />
        Open in Editor
      </ContextMenuItem>
      <ContextMenuItem onClick={handleCopyPath} className="gap-2">
        <Copy size={14} />
        Copy Path
      </ContextMenuItem>
      {(setOriginalChat || setMarkdownPreview) && (
        <>
          <ContextMenuSeparator />
          {setOriginalChat && (
            <ContextMenuCheckboxItem checked={originalChat} onCheckedChange={setOriginalChat}>
              Readable Slash Command
            </ContextMenuCheckboxItem>
          )}
          {setMarkdownPreview && (
            <ContextMenuCheckboxItem checked={markdownPreview} onCheckedChange={setMarkdownPreview}>
              Markdown Preview
            </ContextMenuCheckboxItem>
          )}
        </>
      )}
      {onExport && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onExport} className="gap-2">
            <Download size={14} />
            Export
          </ContextMenuItem>
        </>
      )}
    </>
  );
}
