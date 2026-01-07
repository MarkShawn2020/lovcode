import { CheckCircledIcon, DownloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { Button } from "../../components/ui/button";

interface PluginCardProps {
  name: string;
  description?: string | null;
  isInstalled: boolean;
  enabled?: boolean;
  onInstall?: () => void;
  onUninstall?: () => void;
  isLoading?: boolean;
}

export function PluginCard({
  name,
  description,
  isInstalled,
  enabled = true,
  onInstall,
  onUninstall,
  isLoading,
}: PluginCardProps) {
  return (
    <div className="w-full bg-card rounded-xl p-4 border border-border hover:border-primary/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-ink truncate">{name}</p>
            {isInstalled && (
              <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                enabled
                  ? "bg-green-500/10 text-green-600"
                  : "bg-muted text-muted-foreground"
              }`}>
                <CheckCircledIcon className="w-3 h-3 inline mr-1" />
                {enabled ? "已安装" : "已禁用"}
              </span>
            )}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{description}</p>
          )}
        </div>

        <div className="shrink-0">
          {isInstalled ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUninstall}
              disabled={isLoading}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <TrashIcon className="w-4 h-4 mr-1" />
              卸载
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onInstall}
              disabled={isLoading}
            >
              <DownloadIcon className="w-4 h-4 mr-1" />
              安装
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
