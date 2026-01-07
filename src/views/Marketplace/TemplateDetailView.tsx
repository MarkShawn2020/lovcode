import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Markdown from "react-markdown";
import { StarFilledIcon, HeartFilledIcon, GlobeIcon, Pencil1Icon, TrashIcon, ExternalLinkIcon, DotsHorizontalIcon, FileIcon, CopyIcon } from "@radix-ui/react-icons";
import type { TemplateComponent, TemplateCategory } from "../../types";
import { TEMPLATE_CATEGORIES } from "../../constants";
import { DetailCard, ConfigPage } from "../../components/config";
import { CodePreview } from "../../components/shared";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";

function getLanguageForCategory(category: TemplateCategory): string {
  switch (category) {
    case "mcps":
    case "hooks":
    case "settings":
      return "json";
    case "statuslines":
      return "shell";
    default:
      return "markdown";
  }
}

interface TemplateDetailViewProps {
  template: TemplateComponent;
  category: TemplateCategory;
  onBack: () => void;
  onNavigateToInstalled?: () => void;
  /** Local file path for installed items (enables "Open in Editor") */
  localPath?: string;
  /** Skip install check if we know it's already installed */
  isInstalled?: boolean;
}

export function TemplateDetailView({
  template,
  category,
  onBack,
  onNavigateToInstalled,
  localPath,
  isInstalled: initiallyInstalled,
}: TemplateDetailViewProps) {
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [installed, setInstalled] = useState(initiallyInstalled ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Skip check if we already know it's installed
    if (initiallyInstalled !== undefined) return;

    if (category === "mcps") {
      invoke<boolean>("check_mcp_installed", { name: template.name }).then(setInstalled);
    } else if (category === "skills") {
      invoke<boolean>("check_skill_installed", { name: template.name }).then(setInstalled);
    }
  }, [category, template.name, initiallyInstalled]);

  const handleUninstall = async () => {
    setUninstalling(true);
    setError(null);

    try {
      if (category === "mcps") {
        await invoke("uninstall_mcp_template", { name: template.name });
      } else if (category === "skills") {
        await invoke("uninstall_skill", { name: template.name });
      }
      setInstalled(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setUninstalling(false);
    }
  };

  const handleInstall = async () => {
    if (!template.content) {
      setError("No content available for this template");
      return;
    }

    setInstalling(true);
    setError(null);

    try {
      switch (category) {
        case "commands":
        case "agents":
          await invoke("install_command_template", {
            name: template.name,
            content: template.content,
          });
          break;
        case "skills":
          await invoke("install_skill_template", {
            name: template.name,
            content: template.content,
            source_id: template.source_id,
            source_name: template.source_name,
            author: template.author,
            downloads: template.downloads,
            template_path: template.path,
          });
          break;
        case "mcps":
          await invoke("install_mcp_template", { name: template.name, config: template.content });
          break;
        case "hooks":
          await invoke("install_hook_template", { name: template.name, config: template.content });
          break;
        case "settings":
        case "output-styles":
          await invoke("install_setting_template", { config: template.content });
          break;
        case "statuslines":
          // Install to ~/.lovstudio/lovcode/statusline/{name}.sh
          await invoke("install_statusline_template", { name: template.name, content: template.content });
          break;
      }
      setInstalled(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const categoryInfo = TEMPLATE_CATEGORIES.find((c) => c.key === category);
  const filePath = localPath || template.path;

  const handleReveal = () => invoke("reveal_path", { path: filePath });
  const handleOpenFile = () => invoke("open_path", { path: filePath });
  const handleCopyPath = () => invoke("copy_to_clipboard", { text: filePath });

  return (
    <ConfigPage>
      <header className="mb-6">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-ink mb-2 flex items-center gap-1 text-sm"
        >
          <span>←</span> {categoryInfo?.label}
        </button>
        {/* Title row with dropdown menu */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-serif text-2xl font-semibold text-ink">{template.name}</h1>
              {template.source_id && template.source_name && (
                <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 border border-border text-muted-foreground">
                  {template.source_id === "anthropic" ? (
                    <StarFilledIcon className="w-3 h-3 text-primary" />
                  ) : template.source_id === "lovstudio" ? (
                    <HeartFilledIcon className="w-3 h-3 text-primary" />
                  ) : (
                    <GlobeIcon className="w-3 h-3" />
                  )}
                  {template.source_name}
                </span>
              )}
              {installed && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary">
                  Installed
                </span>
              )}
            </div>
            {/* Description */}
            {template.description && (
              <p className="text-muted-foreground mt-2">{template.description}</p>
            )}
            {/* Metadata row */}
            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                {categoryInfo?.icon && <categoryInfo.icon className="w-4 h-4" />}{" "}
                {categoryInfo?.label}
              </span>
              {template.author && (
                <>
                  <span>•</span>
                  <span>by {template.author}</span>
                </>
              )}
              {template.downloads != null && (
                <>
                  <span>•</span>
                  <span>↓ {template.downloads}</span>
                </>
              )}
            </div>
          </div>
          {/* Three-dot menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 rounded-xl hover:bg-card-alt text-muted-foreground hover:text-ink">
                <DotsHorizontalIcon className="w-5 h-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!installed && (
                <DropdownMenuItem onClick={handleInstall} disabled={installing}>
                  {installing ? "Installing..." : "Install"}
                </DropdownMenuItem>
              )}
              {localPath && (
                <DropdownMenuItem onClick={() => invoke("open_in_editor", { path: localPath })}>
                  <Pencil1Icon className="w-4 h-4 mr-2" />
                  Open in Editor
                </DropdownMenuItem>
              )}
              {installed && onNavigateToInstalled && (
                <DropdownMenuItem onClick={onNavigateToInstalled}>
                  <ExternalLinkIcon className="w-4 h-4 mr-2" />
                  View Installed
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleReveal}>
                <ExternalLinkIcon className="w-4 h-4 mr-2" />
                Reveal in Finder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenFile}>
                <FileIcon className="w-4 h-4 mr-2" />
                Open File
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyPath}>
                <CopyIcon className="w-4 h-4 mr-2" />
                Copy Path
              </DropdownMenuItem>
              {installed && (category === "mcps" || category === "skills") && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleUninstall}
                    disabled={uninstalling}
                    className="text-red-600 focus:text-red-600"
                  >
                    <TrashIcon className="w-4 h-4 mr-2" />
                    {uninstalling ? "Uninstalling..." : "Uninstall"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error && (
          <div className="mt-4 p-3 bg-primary/10 text-primary rounded-xl text-sm">{error}</div>
        )}
      </header>

      {template.content && (
        <DetailCard label="Content Preview">
          {category === "mcps" || category === "hooks" || category === "settings" || category === "statuslines" ? (
            <CodePreview value={template.content} language={getLanguageForCategory(category)} height={400} />
          ) : (
            <div className="prose prose-sm max-w-none prose-neutral prose-pre:bg-card-alt prose-pre:text-ink prose-code:text-ink">
              <Markdown>{template.content}</Markdown>
            </div>
          )}
        </DetailCard>
      )}
    </ConfigPage>
  );
}
