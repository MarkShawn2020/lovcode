import { Fragment, type ReactNode } from "react";
import { invoke } from "@/lib/tauri";
import { Copy, ExternalLink, Eye, FolderOpen, Settings2 } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";

export type ProjectPathMenuVariant = "context" | "dropdown";
type ProjectPathMenuAction = (path: string) => void | Promise<void>;

export interface ProjectPathMenuBaseProps {
  path: string;
  isPlainChat?: boolean;
  showSectionLabels?: boolean;
  onViewDetails?: ProjectPathMenuAction;
  onOpenInEditor?: ProjectPathMenuAction;
  onOpenFolder?: ProjectPathMenuAction;
  onCopyPath?: ProjectPathMenuAction;
  onConfigureRuntimeEnvironment?: ProjectPathMenuAction;
}

export interface ProjectPathMenuItemsProps extends ProjectPathMenuBaseProps {
  variant: ProjectPathMenuVariant;
}

interface ProjectPathMenuItem {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface ProjectPathMenuSection {
  title: string;
  items: ProjectPathMenuItem[];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectPathMenuItems({
  path,
  isPlainChat = false,
  showSectionLabels = true,
  onViewDetails,
  onOpenInEditor,
  onOpenFolder,
  onCopyPath,
  onConfigureRuntimeEnvironment,
  variant,
}: ProjectPathMenuItemsProps) {
  const { t } = useI18n();
  const runAction = (action: ProjectPathMenuAction) => {
    void action(path);
  };
  const openFolder = async () => {
    if (onOpenFolder) {
      await onOpenFolder(path);
      return;
    }
    try {
      await invoke("open_path", { path });
    } catch (error) {
      toast.error(t("workspace.openProjectInFinderFailed", { message: getErrorMessage(error) }));
    }
  };
  const copyPath = async () => {
    if (onCopyPath) {
      await onCopyPath(path);
      return;
    }
    try {
      await invoke("copy_to_clipboard", { text: path });
      toast.success(t("session.infoCopied", { label: t("workspace.path") }));
    } catch (error) {
      toast.error(t("session.copyFailed", { label: t("workspace.path"), message: getErrorMessage(error) }));
    }
  };
  const sections: ProjectPathMenuSection[] = [];

  if (!isPlainChat) {
    const projectItems: ProjectPathMenuItem[] = [];
    if (onViewDetails) {
      projectItems.push({
        label: t("workspace.viewDetails"),
        icon: <Eye className="h-4 w-4" />,
        onSelect: () => runAction(onViewDetails),
      });
    }
    if (onOpenInEditor) {
      projectItems.push({
        label: t("common.openInEditor"),
        icon: <ExternalLink className="h-4 w-4" />,
        onSelect: () => runAction(onOpenInEditor),
      });
    }
    projectItems.push(
      {
        label: t("workspace.openInFinder"),
        icon: <FolderOpen className="h-4 w-4" />,
        onSelect: () => {
          void openFolder();
        },
      },
      {
        label: t("common.copyPath"),
        icon: <Copy className="h-4 w-4" />,
        onSelect: () => {
          void copyPath();
        },
      },
    );
    sections.push({ title: t("common.project"), items: projectItems });
  }

  if (!isPlainChat && onConfigureRuntimeEnvironment) {
    sections.push({
      title: t("workspace.advanced"),
      items: [
        {
          label: t("workspace.configureRuntimeEnvironment"),
          icon: <Settings2 className="h-4 w-4" />,
          onSelect: () => runAction(onConfigureRuntimeEnvironment),
        },
      ],
    });
  }

  if (variant === "dropdown") {
    return (
      <>
        {sections.map((section, index) => (
          <Fragment key={section.title}>
            {index > 0 && <DropdownMenuSeparator />}
            {showSectionLabels && (
              <DropdownMenuLabel className="text-xs text-muted-foreground">{section.title}</DropdownMenuLabel>
            )}
            {section.items.map((item) => (
              <DropdownMenuItem key={item.label} onSelect={item.onSelect} className="gap-2">
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </>
    );
  }

  return (
    <>
      {sections.map((section, index) => (
        <Fragment key={section.title}>
          {index > 0 && <ContextMenuSeparator />}
          {showSectionLabels && (
            <ContextMenuLabel className="text-xs text-muted-foreground">{section.title}</ContextMenuLabel>
          )}
          {section.items.map((item) => (
            <ContextMenuItem key={item.label} onSelect={item.onSelect} className="gap-2">
              {item.icon}
              {item.label}
            </ContextMenuItem>
          ))}
        </Fragment>
      ))}
    </>
  );
}

export function ProjectPathContextMenuItems(props: ProjectPathMenuBaseProps) {
  return <ProjectPathMenuItems {...props} variant="context" />;
}

export function ProjectPathDropdownMenuItems(props: ProjectPathMenuBaseProps) {
  return <ProjectPathMenuItems {...props} variant="dropdown" />;
}
