import { PlusIcon, Cross2Icon, CheckCircledIcon, UpdateIcon, ExclamationTriangleIcon, TimerIcon } from "@radix-ui/react-icons";
import type { Feature, FeatureStatus } from "./types";

interface FeatureTabsProps {
  features: Feature[];
  activeFeatureId?: string;
  onSelectFeature: (id: string) => void;
  onAddFeature: () => void;
  onRemoveFeature: (id: string) => void;
}

export function FeatureTabs({
  features,
  activeFeatureId,
  onSelectFeature,
  onAddFeature,
  onRemoveFeature,
}: FeatureTabsProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card overflow-x-auto">
      {features.map((feature) => {
        const isActive = feature.id === activeFeatureId;
        return (
          <div
            key={feature.id}
            className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors shrink-0 ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-ink hover:bg-card-alt"
            }`}
            onClick={() => onSelectFeature(feature.id)}
          >
            <StatusIcon status={feature.status} />
            <span className="text-sm truncate max-w-32">{feature.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFeature(feature.id);
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-card-alt transition-all"
              title="Remove feature"
            >
              <Cross2Icon className="w-3 h-3" />
            </button>
          </div>
        );
      })}
      <button
        onClick={onAddFeature}
        className="flex items-center gap-1 px-2 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors shrink-0"
        title="New feature"
      >
        <PlusIcon className="w-4 h-4" />
      </button>
    </div>
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
