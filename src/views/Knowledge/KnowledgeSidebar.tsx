import { BookmarkIcon, LightningBoltIcon } from "@radix-ui/react-icons";
import type { FeatureType } from "@/types";

const KNOWLEDGE_FEATURES = [
  { type: "kb-reference" as const, label: "Reference", icon: BookmarkIcon },
  { type: "kb-distill" as const, label: "Distill", icon: LightningBoltIcon },
];

interface KnowledgeSidebarProps {
  currentFeature: FeatureType | null;
  onFeatureClick: (feature: FeatureType) => void;
}

export function KnowledgeSidebar({ currentFeature, onFeatureClick }: KnowledgeSidebarProps) {
  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card overflow-y-auto">
      <div className="p-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-2">
          Knowledge
        </h2>
        <nav className="flex flex-col gap-0.5">
          {KNOWLEDGE_FEATURES.map((feature) => {
            const Icon = feature.icon;
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
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{feature.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
