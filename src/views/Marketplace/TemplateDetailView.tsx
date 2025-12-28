import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Markdown from "react-markdown";
import { StarFilledIcon, HeartFilledIcon, GlobeIcon } from "@radix-ui/react-icons";
import type { TemplateComponent, TemplateCategory } from "../../types";
import { TEMPLATE_CATEGORIES } from "../../constants";
import { DetailCard, ConfigPage } from "../../components/config";
import { CodePreview } from "../../components/shared";

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
}

export function TemplateDetailView({
  template,
  category,
  onBack,
  onNavigateToInstalled,
}: TemplateDetailViewProps) {
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (category === "mcps") {
      invoke<boolean>("check_mcp_installed", { name: template.name }).then(setInstalled);
    }
  }, [category, template.name]);

  const handleUninstall = async () => {
    if (category !== "mcps") return;

    setUninstalling(true);
    setError(null);

    try {
      await invoke("uninstall_mcp_template", { name: template.name });
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
        case "skills":
          await invoke("install_command_template", {
            name: template.name,
            content: template.content,
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

  return (
    <ConfigPage>
      <header className="mb-6">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-ink mb-2 flex items-center gap-1 text-sm"
        >
          <span>←</span> {categoryInfo?.label}
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-ink">{template.name}</h1>
              {/* Source badge */}
              {template.source_id && template.source_name && (
                <span className="text-xs px-2 py-1 rounded-lg flex items-center gap-1.5 bg-primary/10 text-primary">
                  {template.source_id === "anthropic" ? (
                    <StarFilledIcon className="w-3.5 h-3.5" />
                  ) : template.source_id === "lovstudio" ? (
                    <HeartFilledIcon className="w-3.5 h-3.5" />
                  ) : (
                    <GlobeIcon className="w-3.5 h-3.5" />
                  )}
                  {template.source_name}
                </span>
              )}
            </div>
            {template.description && (
              <p className="text-muted-foreground mt-2">{template.description}</p>
            )}
            <p className="font-mono text-xs text-muted-foreground mt-2">{template.path}</p>
            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                {categoryInfo?.icon && <categoryInfo.icon className="w-4 h-4" />}{" "}
                {categoryInfo?.label}
              </span>
              <span>•</span>
              <span>{template.category}</span>
              {template.author && (
                <>
                  <span>•</span>
                  <span>by {template.author}</span>
                </>
              )}
              {template.downloads != null && (
                <>
                  <span>•</span>
                  <span>↓ {template.downloads} downloads</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {installed && onNavigateToInstalled && (
              <button
                onClick={onNavigateToInstalled}
                className="px-4 py-2 rounded-lg font-medium transition-colors border border-border hover:bg-card-alt"
              >
                View
              </button>
            )}
            {installed && category === "mcps" ? (
              <button
                onClick={handleUninstall}
                disabled={uninstalling}
                className="px-4 py-2 rounded-lg font-medium transition-colors bg-red-500/10 text-red-600 hover:bg-red-500/20"
              >
                {uninstalling ? "Uninstalling..." : "Uninstall"}
              </button>
            ) : (
              <button
                onClick={handleInstall}
                disabled={installing || installed}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  installed
                    ? "bg-green-500/20 text-green-600"
                    : installing
                      ? "bg-card-alt text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {installed ? "✓ Installed" : installing ? "Installing..." : "Install"}
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 text-red-600 rounded-lg text-sm">{error}</div>
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
