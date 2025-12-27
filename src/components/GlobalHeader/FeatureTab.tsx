import { useState, useRef, useEffect } from "react";
import { useAtom } from "jotai";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Cross2Icon,
  CheckCircledIcon,
  UpdateIcon,
  ExclamationTriangleIcon,
  TimerIcon,
  DrawingPinFilledIcon,
  Pencil1Icon,
  ArchiveIcon,
  TrashIcon,
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
import { workspaceDataAtom } from "@/store";
import { invoke } from "@tauri-apps/api/core";
import type { Feature, FeatureStatus, WorkspaceData } from "@/views/Workspace/types";

interface FeatureTabProps {
  feature: Feature;
  projectId: string;
  isActive: boolean;
  onSelect: () => void;
  isDragging?: boolean;
}

function StatusIcon({ status }: { status: FeatureStatus }) {
  switch (status) {
    case "pending":
      return <TimerIcon className="w-3 h-3 text-muted-foreground" />;
    case "running":
      return <UpdateIcon className="w-3 h-3 text-blue-500" />;
    case "completed":
      return <CheckCircledIcon className="w-3 h-3 text-green-500" />;
    case "needs-review":
      return <ExclamationTriangleIcon className="w-3 h-3 text-amber-500" />;
  }
}

export function FeatureTab({
  feature,
  projectId,
  isActive,
  onSelect,
  isDragging,
}: FeatureTabProps) {
  const [workspace, setWorkspace] = useAtom(workspaceDataAtom);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(feature.name);
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

  const handleArchive = async () => {
    if (!workspace) return;

    const newProjects = workspace.projects.map((p) => {
      if (p.id !== projectId) return p;
      const activeFeatures = p.features.filter((f) => f.id !== feature.id && !f.archived);
      return {
        ...p,
        features: p.features.map((f) =>
          f.id === feature.id ? { ...f, archived: true } : f
        ),
        active_feature_id:
          p.active_feature_id === feature.id
            ? activeFeatures[0]?.id
            : p.active_feature_id,
      };
    });

    await saveWorkspace({ ...workspace, projects: newProjects });
  };

  const handleDelete = async () => {
    if (!workspace) return;

    const newProjects = workspace.projects.map((p) => {
      if (p.id !== projectId) return p;
      const remainingFeatures = p.features.filter((f) => f.id !== feature.id);
      const activeFeatures = remainingFeatures.filter((f) => !f.archived);
      return {
        ...p,
        features: remainingFeatures,
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

  const handleStatusChange = async (status: FeatureStatus) => {
    if (!workspace) return;

    const newProjects = workspace.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            features: p.features.map((f) =>
              f.id === feature.id ? { ...f, status } : f
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={onSelect}
          onDoubleClick={handleDoubleClick}
          onPointerDown={(e) => e.stopPropagation()}
          className={`group flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer transition-colors ${
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
          <StatusIcon status={feature.status} />
          {feature.seq > 0 && (
            <span className="text-[10px] text-muted-foreground/60">#{feature.seq}</span>
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
              className="w-16 text-xs bg-card border border-border rounded px-1 outline-none focus:border-primary"
            />
          ) : (
            <span className="text-xs truncate max-w-[60px]" title={feature.name}>
              {feature.name}
            </span>
          )}
          {/* Close button - archive on click */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleArchive();
            }}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
            title="Archive"
          >
            <Cross2Icon className="w-3 h-3" />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-[140px]">
        <ContextMenuItem
          onClick={() => {
            setRenameValue(feature.name);
            setIsRenaming(true);
          }}
          className="gap-2 cursor-pointer"
        >
          <Pencil1Icon className="w-3.5 h-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={handlePin} className="gap-2 cursor-pointer">
          <DrawingPinFilledIcon className="w-3.5 h-3.5" />
          {feature.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <StatusIcon status={feature.status} />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[120px]">
            <ContextMenuItem
              onClick={() => handleStatusChange("pending")}
              disabled={feature.status === "pending"}
              className="gap-2 cursor-pointer"
            >
              <TimerIcon className="w-3.5 h-3.5 text-muted-foreground" />
              Pending
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleStatusChange("running")}
              disabled={feature.status === "running"}
              className="gap-2 cursor-pointer"
            >
              <UpdateIcon className="w-3.5 h-3.5 text-blue-500" />
              Running
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleStatusChange("completed")}
              disabled={feature.status === "completed"}
              className="gap-2 cursor-pointer"
            >
              <CheckCircledIcon className="w-3.5 h-3.5 text-green-500" />
              Completed
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleStatusChange("needs-review")}
              disabled={feature.status === "needs-review"}
              className="gap-2 cursor-pointer"
            >
              <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" />
              Needs Review
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleArchive} className="gap-2 cursor-pointer">
          <ArchiveIcon className="w-3.5 h-3.5" />
          Archive
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleDelete}
          className="gap-2 cursor-pointer text-destructive focus:text-destructive"
        >
          <TrashIcon className="w-3.5 h-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Sortable wrapper for drag-and-drop
export function SortableFeatureTab(props: Omit<FeatureTabProps, "isDragging">) {
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
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <FeatureTab {...props} isDragging={isDragging} />
    </div>
  );
}
