import type { FeatureConfig } from "../../types";

interface FeatureButtonProps {
  feature: FeatureConfig;
  active: boolean;
  onClick: () => void;
  statusIndicator?: "on" | "off";
  compact?: boolean;
}

export function FeatureButton({
  feature,
  active,
  onClick,
  statusIndicator,
  compact,
}: FeatureButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 ${compact ? "py-1.5" : "py-2"} rounded-lg text-left transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : feature.available
            ? "text-ink hover:bg-card-alt"
            : "text-muted-foreground/60 hover:bg-card-alt"
      }`}
    >
      <span className="text-sm flex-1">
        {feature.label}
        {!feature.available && <span className="ml-1.5 text-xs opacity-60">(TODO)</span>}
      </span>
      {statusIndicator !== undefined && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${statusIndicator === "on" ? "bg-primary" : "bg-muted-foreground/40"}`}
        />
      )}
    </button>
  );
}
