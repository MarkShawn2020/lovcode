import { useState } from "react";
import type React from "react";
import { PlusIcon, CheckCircledIcon, UpdateIcon, ExclamationTriangleIcon, TimerIcon, CheckIcon, Cross2Icon, DrawingPinIcon, DrawingPinFilledIcon } from "@radix-ui/react-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";
import type { Feature, FeatureStatus } from "./types";

interface FeatureTabsProps {
  features: Feature[];
  activeFeatureId?: string;
  onSelectFeature: (id: string) => void;
  onAddFeature: () => void;
  onUpdateFeatureStatus: (id: string, status: FeatureStatus, note?: string) => void;
  onArchiveFeature: (id: string, note?: string) => void;
  onPinFeature: (id: string, pinned: boolean) => void;
  isAddingFeature?: boolean;
  newFeatureName?: string;
  onNewFeatureNameChange?: (name: string) => void;
  onConfirmAddFeature?: () => void;
  onCancelAddFeature?: () => void;
}

const STATUS_OPTIONS: { value: FeatureStatus; label: string; icon: React.ReactNode }[] = [
  { value: "pending", label: "Pending", icon: <TimerIcon className="w-3.5 h-3.5 text-muted-foreground" /> },
  { value: "running", label: "Running", icon: <UpdateIcon className="w-3.5 h-3.5 text-blue-500" /> },
  { value: "completed", label: "Completed", icon: <CheckCircledIcon className="w-3.5 h-3.5 text-green-500" /> },
  { value: "needs-review", label: "Needs Review", icon: <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" /> },
];

type ArchiveAction = { type: "complete"; featureId: string } | { type: "cancel"; featureId: string };

export function FeatureTabs({
  features,
  activeFeatureId,
  onSelectFeature,
  onAddFeature,
  onUpdateFeatureStatus,
  onArchiveFeature,
  onPinFeature,
  isAddingFeature,
  newFeatureName,
  onNewFeatureNameChange,
  onConfirmAddFeature,
  onCancelAddFeature,
}: FeatureTabsProps) {
  const [archiveAction, setArchiveAction] = useState<ArchiveAction | null>(null);
  const [archiveNote, setArchiveNote] = useState("");

  const activeFeatures = features
    .filter((f) => !f.archived)
    .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));
  const pendingFeature = archiveAction ? features.find((f) => f.id === archiveAction.featureId) : null;

  const handleConfirmArchive = () => {
    if (!archiveAction) return;
    const note = archiveNote.trim() || undefined;
    if (archiveAction.type === "complete") {
      onUpdateFeatureStatus(archiveAction.featureId, "completed", note);
    } else {
      onArchiveFeature(archiveAction.featureId, note);
    }
    setArchiveAction(null);
    setArchiveNote("");
  };

  const handleCancelDialog = () => {
    setArchiveAction(null);
    setArchiveNote("");
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card overflow-x-auto">
        {activeFeatures.map((feature) => {
          const isActive = feature.id === activeFeatureId;
          return (
            <ContextMenu key={feature.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors shrink-0 ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-ink hover:bg-card-alt"
                  }`}
                  onClick={() => onSelectFeature(feature.id)}
                >
                  {feature.pinned && <DrawingPinFilledIcon className="w-3 h-3 text-primary/70" />}
                  <StatusIcon status={feature.status} />
                  <span className="text-sm truncate max-w-32">{feature.name}</span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-[160px]">
                <ContextMenuItem
                  onClick={() => onPinFeature(feature.id, !feature.pinned)}
                  className="gap-2 cursor-pointer"
                >
                  {feature.pinned ? (
                    <DrawingPinFilledIcon className="w-3.5 h-3.5" />
                  ) : (
                    <DrawingPinIcon className="w-3.5 h-3.5" />
                  )}
                  <span>{feature.pinned ? "Unpin" : "Pin"}</span>
                </ContextMenuItem>
                <ContextMenuSeparator />
                {STATUS_OPTIONS.map((option) => (
                  <ContextMenuItem
                    key={option.value}
                    onClick={() => {
                      if (option.value === "completed") {
                        setArchiveAction({ type: "complete", featureId: feature.id });
                      } else {
                        onUpdateFeatureStatus(feature.id, option.value);
                      }
                    }}
                    className={`gap-2 cursor-pointer ${feature.status === option.value ? "bg-accent" : ""}`}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => setArchiveAction({ type: "cancel", featureId: feature.id })}
                  className="gap-2 cursor-pointer text-muted-foreground"
                >
                  <Cross2Icon className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {isAddingFeature ? (
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="text"
              value={newFeatureName || ""}
              onChange={(e) => onNewFeatureNameChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirmAddFeature?.();
                if (e.key === "Escape") onCancelAddFeature?.();
              }}
              placeholder="Feature name"
              className="w-32 px-2 py-1 text-sm border border-border rounded bg-card text-ink focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
            <button
              onClick={onConfirmAddFeature}
              className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors"
              title="Confirm"
            >
              <CheckIcon className="w-4 h-4" />
            </button>
            <button
              onClick={onCancelAddFeature}
              className="p-1.5 text-muted-foreground hover:text-ink hover:bg-card-alt rounded transition-colors"
              title="Cancel"
            >
              <Cross2Icon className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onAddFeature}
            className="flex items-center gap-1 px-2 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors shrink-0"
            title="New feature"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Archive confirmation dialog */}
      <Dialog open={archiveAction !== null} onOpenChange={(open) => !open && handleCancelDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {archiveAction?.type === "complete" ? "Complete" : "Cancel"} "{pendingFeature?.name}"
            </DialogTitle>
          </DialogHeader>
          <textarea
            value={archiveNote}
            onChange={(e) => setArchiveNote(e.target.value)}
            placeholder="Add a note (optional)"
            className="w-full h-24 px-3 py-2 text-sm border border-border rounded-lg bg-card text-ink resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={handleCancelDialog}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleConfirmArchive}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors"
            >
              {archiveAction?.type === "complete" ? "Complete" : "Cancel"} Feature
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusIcon({ status }: { status: FeatureStatus }) {
  switch (status) {
    case "pending":
      return <TimerIcon className="w-3.5 h-3.5 text-muted-foreground" />;
    case "running":
      return <UpdateIcon className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    case "completed":
      return <CheckCircledIcon className="w-3.5 h-3.5 text-green-500" />;
    case "needs-review":
      return <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" />;
  }
}
