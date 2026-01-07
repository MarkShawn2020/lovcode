import type { FeatureType } from "../../types";
import { FEATURES } from "../../constants";

interface FeatureTodoProps {
  feature: FeatureType;
}

export function FeatureTodo({ feature }: FeatureTodoProps) {
  const feat = FEATURES.find((f) => f.type === feature);

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6">
      <span className="text-6xl mb-4">🚧</span>
      <h1 className="font-serif text-2xl font-semibold text-ink mb-2">{feat?.label}</h1>
      <p className="text-muted-foreground text-center max-w-md mb-6">{feat?.description}</p>
      <div className="px-4 py-2 rounded-lg bg-card-alt text-muted-foreground text-sm">
        Coming soon
      </div>
    </div>
  );
}
