import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import {
  QuestionMarkCircledIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  DotsHorizontalIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { useAppConfig } from "../../context";

interface DistillMenuProps {
  watchEnabled: boolean;
  onWatchToggle: (enabled: boolean) => void;
  onRefresh: () => void;
}

export function DistillMenu({ watchEnabled, onWatchToggle, onRefresh }: DistillMenuProps) {
  const { homeDir } = useAppConfig();
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandContent, setCommandContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (helpOpen && !commandContent) {
      const path = `${homeDir}/.claude/commands/distill.md`;
      invoke<string>("read_file", { path })
        .then(setCommandContent)
        .catch(() => setCommandContent(null));
    }
  }, [helpOpen, commandContent, homeDir]);

  const handleCopy = async () => {
    if (commandContent) {
      await navigator.clipboard.writeText(commandContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (commandContent) {
      const blob = new Blob([commandContent], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "distill.md";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-2 rounded-lg text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors">
            <DotsHorizontalIcon className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setHelpOpen(true)}>
            <QuestionMarkCircledIcon className="w-4 h-4 mr-2" />
            Help
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              invoke("open_in_editor", { path: `${homeDir}/.lovstudio/docs/distill` })
            }
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            Open Folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRefresh} disabled={watchEnabled}>
            <ReloadIcon className="w-4 h-4 mr-2" />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem checked={watchEnabled} onCheckedChange={onWatchToggle}>
            Auto Refresh
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>How to use Distill</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Distill captures wisdom from your Claude Code sessions into reusable knowledge.</p>
              <p className="font-medium text-ink">In Claude Code, run:</p>
              <code className="block px-3 py-2 rounded-lg bg-card-alt font-mono text-sm">
                /distill
              </code>
              <p>
                This analyzes your conversation and extracts key learnings into structured documents
                stored in:
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-card-alt px-2 py-1 rounded">
                  ~/.lovstudio/docs/distill/
                </code>
                <button
                  onClick={() =>
                    invoke("open_in_editor", { path: `${homeDir}/.lovstudio/docs/distill` })
                  }
                  className="p-1.5 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                  title="Open distill directory"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            </div>

            {commandContent && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">Command File (distill.md)</p>
                  <div className="flex gap-1">
                    <button
                      onClick={handleCopy}
                      className="p-1.5 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                      title="Copy to clipboard"
                    >
                      {copied ? (
                        <CheckIcon className="w-4 h-4 text-primary" />
                      ) : (
                        <CopyIcon className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="p-1.5 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                      title="Download file"
                    >
                      <DownloadIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-[40vh] overflow-auto rounded-lg bg-card-alt p-3">
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                    {commandContent}
                  </pre>
                </div>
              </div>
            )}

            {commandContent === null && (
              <p className="text-sm text-muted-foreground italic">
                Command file not found. Place distill.md in ~/.claude/commands/
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
