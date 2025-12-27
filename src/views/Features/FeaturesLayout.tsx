import type { ReactNode } from "react";
import { useMemo } from "react";
import { SidebarLayout, NavSidebar } from "@/components/shared";
import { TEMPLATE_CATEGORIES } from "@/constants";
import type { FeatureType, TemplateCategory } from "@/types";

// Map template category key to feature type
const CATEGORY_TO_FEATURE: Record<TemplateCategory, FeatureType> = {
  settings: "settings",
  commands: "commands",
  mcps: "mcp",
  skills: "skills",
  hooks: "hooks",
  agents: "sub-agents",
  "output-styles": "output-styles",
  statuslines: "statusline",
};

// Map feature type to template category key
const FEATURE_TO_CATEGORY: Partial<Record<FeatureType, TemplateCategory>> = {
  settings: "settings",
  commands: "commands",
  mcp: "mcps",
  skills: "skills",
  hooks: "hooks",
  "sub-agents": "agents",
  "output-styles": "output-styles",
  statusline: "statuslines",
};

interface FeaturesLayoutProps {
  children: ReactNode;
  currentFeature: FeatureType | null;
  onFeatureClick: (feature: FeatureType) => void;
}

export function FeaturesLayout({ children, currentFeature, onFeatureClick }: FeaturesLayoutProps) {
  const items = useMemo(() =>
    TEMPLATE_CATEGORIES
      .filter(c => c.key !== "settings")
      .map(c => ({ key: c.key, label: c.label, icon: c.icon })),
    []
  );

  const activeKey = currentFeature ? FEATURE_TO_CATEGORY[currentFeature] ?? null : null;

  return (
    <SidebarLayout
      sidebar={
        <NavSidebar
          items={items}
          activeKey={activeKey}
          onItemClick={(key) => onFeatureClick(CATEGORY_TO_FEATURE[key as TemplateCategory])}
        />
      }
    >
      {children}
    </SidebarLayout>
  );
}
