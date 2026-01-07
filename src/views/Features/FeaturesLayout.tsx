import type { ReactNode } from "react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarLayout, NavSidebar } from "@/components/shared";
import { TEMPLATE_CATEGORIES, FEATURE_ICONS } from "@/constants";
import type { FeatureType, TemplateCategory } from "@/types";

type SidebarKey = TemplateCategory | "basic-env" | "basic-llm" | "basic-version" | "basic-context";

// Map sidebar key to route path
const KEY_TO_ROUTE: Record<SidebarKey, string> = {
  "basic-env": "/settings/env",
  "basic-llm": "/settings/llm",
  "basic-version": "/settings/version",
  "basic-context": "/settings/context",
  settings: "/settings",
  commands: "/commands",
  mcps: "/mcp",
  skills: "/skills",
  hooks: "/hooks",
  agents: "/agents",
  "output-styles": "/output-styles",
  statuslines: "/statusline",
};

// Map feature type to sidebar key
const FEATURE_TO_KEY: Partial<Record<FeatureType, SidebarKey>> = {
  "basic-env": "basic-env",
  "basic-llm": "basic-llm",
  "basic-version": "basic-version",
  "basic-context": "basic-context",
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
  feature?: FeatureType;
  // Legacy props for gradual migration
  currentFeature?: FeatureType | null;
  onFeatureClick?: (feature: FeatureType) => void;
}

export function FeaturesLayout({ children, feature, currentFeature, onFeatureClick }: FeaturesLayoutProps) {
  const navigate = useNavigate();

  const groups = useMemo(() => [
    {
      title: "Basic",
      items: [
        { key: "basic-env", label: "Environment", icon: FEATURE_ICONS["basic-env"] },
        { key: "basic-llm", label: "LLM Provider", icon: FEATURE_ICONS["basic-llm"] },
        { key: "basic-version", label: "CC Version", icon: FEATURE_ICONS["basic-version"] },
        { key: "basic-context", label: "Context", icon: FEATURE_ICONS["basic-context"] },
      ],
    },
    {
      title: "Features",
      items: TEMPLATE_CATEGORIES.map(c => ({ key: c.key, label: c.label, icon: c.icon })),
    },
  ], []);

  const activeFeature = feature ?? currentFeature;
  const activeKey = activeFeature ? FEATURE_TO_KEY[activeFeature] ?? null : null;

  const handleItemClick = (key: string) => {
    if (onFeatureClick) {
      // Legacy mode
      const keyToFeature: Record<SidebarKey, FeatureType> = {
        "basic-env": "basic-env",
        "basic-llm": "basic-llm",
        "basic-version": "basic-version",
        "basic-context": "basic-context",
        settings: "settings",
        commands: "commands",
        mcps: "mcp",
        skills: "skills",
        hooks: "hooks",
        agents: "sub-agents",
        "output-styles": "output-styles",
        statuslines: "statusline",
      };
      onFeatureClick(keyToFeature[key as SidebarKey]);
    } else {
      // Router mode
      navigate(KEY_TO_ROUTE[key as SidebarKey]);
    }
  };

  return (
    <SidebarLayout
      sidebar={
        <NavSidebar
          groups={groups}
          activeKey={activeKey}
          onItemClick={handleItemClick}
        />
      }
    >
      {children}
    </SidebarLayout>
  );
}
