import { AppWindow, Code2, ExternalLink } from "lucide-react";
import type { EditorTargetId } from "@/lib/editorTargets";
import { EDITOR_TARGETS } from "@/lib/editorTargets";
import { useI18n } from "@/i18n";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

type OpenInEditorAction = (editor?: EditorTargetId) => void | Promise<unknown>;

interface OpenInEditorMenuProps {
  variant: "context" | "dropdown";
  onSelect: OpenInEditorAction;
  label?: string;
  includeDefault?: boolean;
  excludeTargets?: readonly EditorTargetId[];
}

function EditorTargetIcon({ editor }: { editor?: EditorTargetId }) {
  if (editor === "yoda") return <AppWindow className="h-4 w-4" />;
  if (editor) return <Code2 className="h-4 w-4" />;
  return <ExternalLink className="h-4 w-4" />;
}

export function OpenInEditorMenu({
  variant,
  onSelect,
  label,
  includeDefault = true,
  excludeTargets = [],
}: OpenInEditorMenuProps) {
  const { t } = useI18n();
  const triggerLabel = label ?? t("editor.openWith");
  const editorTargets = EDITOR_TARGETS.filter((target) => !excludeTargets.includes(target.id));
  const select = (editor?: EditorTargetId) => {
    void onSelect(editor);
  };

  const defaultEditorItem = (
    <>
      <EditorTargetIcon />
      {t("editor.defaultEditor")}
    </>
  );

  if (variant === "dropdown") {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <ExternalLink className="h-4 w-4" />
          {triggerLabel}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-44">
          {includeDefault ? (
            <>
              <DropdownMenuItem onSelect={() => select()} className="gap-2">
                {defaultEditorItem}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {editorTargets.map((target) => (
            <DropdownMenuItem key={target.id} onSelect={() => select(target.id)} className="gap-2">
              <EditorTargetIcon editor={target.id} />
              {target.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="gap-2">
        <ExternalLink className="h-4 w-4" />
        {triggerLabel}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-44">
        {includeDefault ? (
          <>
            <ContextMenuItem onSelect={() => select()} className="gap-2">
              {defaultEditorItem}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        {editorTargets.map((target) => (
          <ContextMenuItem key={target.id} onSelect={() => select(target.id)} className="gap-2">
            <EditorTargetIcon editor={target.id} />
            {target.label}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
