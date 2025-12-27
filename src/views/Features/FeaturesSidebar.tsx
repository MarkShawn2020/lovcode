import { FEATURES, FEATURE_ICONS } from "@/constants";
import type { FeatureType } from "@/types";

interface FeaturesSidebarProps {
  currentFeature: FeatureType | null;
  onFeatureClick: (feature: FeatureType) => void;
}

export function FeaturesSidebar({ currentFeature, onFeatureClick }: FeaturesSidebarProps) {
  const configFeatures = FEATURES.filter(f => f.group === "config" && f.type !== "settings");

  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card overflow-y-auto">
      <div className="p-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
          Features
        </h2>
        <nav className="flex flex-col gap-0.5">
          {configFeatures.map((feature) => {
            const Icon = FEATURE_ICONS[feature.type];
            const isActive = currentFeature === feature.type;

            return (
              <button
                key={feature.type}
                onClick={() => onFeatureClick(feature.type)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-card-alt"
                }`}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                <span className="truncate">{feature.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
