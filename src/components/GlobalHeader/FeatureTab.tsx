import { useState, useRef, useEffect } from "react";
import { useAtom } from "jotai";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Cross2Icon,
  CheckCircledIcon,
  TimerIcon,
  DrawingPinFilledIcon,
  ArchiveIcon,
  GearIcon,
} from "@radix-ui/react-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { workspaceDataAtom } from "@/store";
import { invoke } from "@tauri-apps/api/core";
import type { Feature, FeatureStatus, WorkspaceData } from "@/views/Workspace/types";

interface FeatureTabProps {
  feature: Feature;
  projectId: string;
  isActive: boolean;
  onSelect: () => void;
  isDragging?: boolean;
  dragHandleProps?: ReturnType<typeof useSortable>["listeners"];
}

export function FeatureTab({
  feature,
  projectId,
  isActive,
  onSelect,
  isDragging,
  dragHandleProps,
}: FeatureTabProps) {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(feature.name);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailForm, setDetailForm] = useState({
    name: feature.name,
    description: feature.description || "",
    status: feature.status,
    git_branch: feature.git_branch || "",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isRenaming]);

  const saveWorkspace = async (data: WorkspaceData) => {
    setWorkspace(data);
    await invoke("workspace_save", { data });
  };

  const handleRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === feature.name || !workspace) {
      setIsRenaming(false);
      setRenameValue(feature.name);
      return;
    }

    await invoke("workspace_rename_feature", { featureId: feature.id, name: trimmed });

    const newProjects = workspace.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            features: p.features.map((f) =>
              f.id === feature.id ? { ...f, name: trimmed } : f
            ),
          }
        : p
    );

    await saveWorkspace({ ...workspace, projects: newProjects });
    setIsRenaming(false);
  };

  const handleArchive = async (note?: string) => {
    if (!workspace) return;

    const newProjects = workspace.projects.map((p) => {
      if (p.id !== projectId) return p;
      const activeFeatures = p.features.filter((f) => f.id !== feature.id && !f.archived);
      return {
        ...p,
        features: p.features.map((f) =>
          f.id === feature.id ? { ...f, archived: true, archived_note: note } : f
        ),
        active_feature_id:
          p.active_feature_id === feature.id
            ? activeFeatures[0]?.id
            : p.active_feature_id,
      };
    });

    await saveWorkspace({ ...workspace, projects: newProjects });
  };

  const handlePin = async () => {
    if (!workspace) return;

    const newProjects = workspace.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            features: p.features.map((f) =>
              f.id === feature.id ? { ...f, pinned: !f.pinned } : f
            ),
          }
        : p
    );

    await saveWorkspace({ ...workspace, projects: newProjects });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(feature.name);
    setIsRenaming(true);
  };

  const openDetailDialog = () => {
    setDetailForm({
      name: feature.name,
      description: feature.description || "",
      status: feature.status,
      git_branch: feature.git_branch || "",
    });
    setIsDetailOpen(true);
  };

  const handleSaveDetail = async () => {
    if (!workspace) return;
    const trimmedName = detailForm.name.trim();
    if (!trimmedName) return;

    if (trimmedName !== feature.name) {
      await invoke("workspace_rename_feature", { featureId: feature.id, name: trimmedName });
    }

    const newProjects = workspace.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            features: p.features.map((f) =>
              f.id === feature.id
                ? {
                    ...f,
                    name: trimmedName,
                    description: detailForm.description || undefined,
                    status: detailForm.status,
                    git_branch: detailForm.git_branch || undefined,
                  }
                : f
            ),
          }
        : p
    );

    await saveWorkspace({ ...workspace, projects: newProjects });
    setIsDetailOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.keyCode === 229) return; // IME
    if (e.key === "Enter" && !isComposingRef.current) {
      handleRename();
    } else if (e.key === "Escape") {
      setIsRenaming(false);
      setRenameValue(feature.name);
    }
  };

  return (
  <>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={onSelect}
          onDoubleClick={handleDoubleClick}
          onPointerDown={(e) => e.stopPropagation()}
          className={`group flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer transition-colors max-w-[140px] ${
            isDragging
              ? "bg-primary/20 shadow-lg"
              : isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-ink hover:bg-card-alt"
          }`}
        >
          {feature.pinned && (
            <DrawingPinFilledIcon className="w-2.5 h-2.5 text-primary/70 flex-shrink-0" />
          )}
          {isRenaming ? (
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { isComposingRef.current = false; }}
              onClick={(e) => e.stopPropagation()}
              className="w-16 text-xs bg-card border border-border rounded px-1 outline-none focus:border-primary flex-shrink-0"
            />
          ) : (
            <span
              className="text-xs truncate min-w-0 cursor-grab active:cursor-grabbing"
              title={feature.name}
              {...dragHandleProps}
            >
              {feature.name}
            </span>
          )}
          {/* Close button - archive on click */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleArchive();
            }}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all flex-shrink-0"
            title="Archive"
          >
            <Cross2Icon className="w-3 h-3" />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-[140px]">
        <ContextMenuItem onClick={openDetailDialog} className="gap-2 cursor-pointer">
          <GearIcon className="w-3.5 h-3.5" />
          Details
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handlePin} className="gap-2 cursor-pointer">
          <DrawingPinFilledIcon className="w-3.5 h-3.5" />
          {feature.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <ArchiveIcon className="w-3.5 h-3.5" />
            Archive
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[120px]">
            <ContextMenuItem
              onClick={() => handleArchive("completed")}
              className="gap-2 cursor-pointer"
            >
              <CheckCircledIcon className="w-3.5 h-3.5 text-green-500" />
              Completed
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleArchive("cancelled")}
              className="gap-2 cursor-pointer"
            >
              <Cross2Icon className="w-3.5 h-3.5 text-muted-foreground" />
              Cancelled
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleArchive("on-hold")}
              className="gap-2 cursor-pointer"
            >
              <TimerIcon className="w-3.5 h-3.5 text-amber-500" />
              On Hold
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>

    {/* Feature Detail Dialog */}
    <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Feature Details</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Name</label>
            <input
              value={detailForm.name}
              onChange={(e) => setDetailForm({ ...detailForm, name: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={detailForm.description}
              onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })}
              rows={3}
              placeholder="Optional description..."
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Status</label>
            <select
              value={detailForm.status}
              onChange={(e) => setDetailForm({ ...detailForm, status: e.target.value as FeatureStatus })}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="needs-review">Needs Review</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Git Branch</label>
            <input
              value={detailForm.git_branch}
              onChange={(e) => setDetailForm({ ...detailForm, git_branch: e.target.value })}
              placeholder="feature/my-branch"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => setIsDetailOpen(false)}
            className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveDetail}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}

// Sortable wrapper for drag-and-drop
export function SortableFeatureTab(props: Omit<FeatureTabProps, "isDragging" | "dragHandleProps">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.feature.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex-shrink-0">
      <FeatureTab {...props} isDragging={isDragging} dragHandleProps={listeners} />
    </div>
  );
}
