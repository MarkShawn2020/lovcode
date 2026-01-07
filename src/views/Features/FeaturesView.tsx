import { FEATURES } from "@/constants";
import type { FeatureType, FeatureConfig } from "@/types";
import { FeaturesLayout } from "./FeaturesLayout";

interface FeaturesViewProps {
  onFeatureClick: (feature: FeatureType) => void;
  currentFeature: FeatureType | null;
}

interface FeatureCardProps {
  feature: FeatureConfig;
  onClick: () => void;
}

function FeatureCard({ feature, onClick }: FeatureCardProps) {
  return (
    <button
      onClick={onClick}
      className="p-4 rounded-xl border bg-card border-border hover:border-primary/30 hover:bg-card-alt text-left transition-all"
    >
      <div className="font-medium text-foreground">{feature.label}</div>
      <div className="text-sm text-muted-foreground mt-1">{feature.description}</div>
    </button>
  );
}

export function FeaturesView({ onFeatureClick, currentFeature }: FeaturesViewProps) {
  const basicFeatures = FEATURES.filter(f => f.group === "basic");
  const configFeatures = FEATURES.filter(f => f.group === "config");

  return (
    <FeaturesLayout currentFeature={currentFeature} onFeatureClick={onFeatureClick}>
      <div className="p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-serif text-foreground mb-2">Configuration</h1>
          <p className="text-muted-foreground">Claude Code ecosystem components</p>
        </div>

        {/* Basic Section */}
        <section>
          <h2 className="text-lg font-medium text-foreground mb-4">Basic</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            {basicFeatures.map((feature) => (
              <FeatureCard
                key={feature.type}
                feature={feature}
                onClick={() => onFeatureClick(feature.type)}
              />
            ))}
          </div>
        </section>

        {/* Features Section */}
        <section>
          <h2 className="text-lg font-medium text-foreground mb-4">Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            {configFeatures.map((feature) => (
              <FeatureCard
                key={feature.type}
                feature={feature}
                onClick={() => onFeatureClick(feature.type)}
              />
            ))}
          </div>
        </section>
      </div>
    </FeaturesLayout>
  );
}
