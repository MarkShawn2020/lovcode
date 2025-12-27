import { FEATURES, FEATURE_ICONS } from "@/constants";
import type { FeatureType } from "@/types";
import { FeaturesLayout } from "./FeaturesLayout";

interface FeaturesViewProps {
  onFeatureClick: (feature: FeatureType) => void;
  currentFeature: FeatureType | null;
}

export function FeaturesView({ onFeatureClick, currentFeature }: FeaturesViewProps) {
  const configFeatures = FEATURES.filter(f => f.group === "config" && f.type !== "settings");

  return (
    <FeaturesLayout currentFeature={currentFeature} onFeatureClick={onFeatureClick}>
      <div className="p-6">
        <h1 className="text-2xl font-serif text-foreground mb-2">Features</h1>
        <p className="text-muted-foreground mb-6">Claude Code ecosystem components</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          {configFeatures.map((feature) => {
            const Icon = FEATURE_ICONS[feature.type];

            return (
              <button
                key={feature.type}
                onClick={() => onFeatureClick(feature.type)}
                className="flex items-start gap-4 p-4 rounded-xl border bg-card border-border hover:border-primary/30 hover:bg-card-alt text-left transition-all"
              >
                {Icon && (
                  <div className="p-2 rounded-lg bg-muted">
                    <Icon className="w-5 h-5" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground">{feature.label}</div>
                  <div className="text-sm text-muted-foreground mt-0.5">{feature.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </FeaturesLayout>
  );
}
