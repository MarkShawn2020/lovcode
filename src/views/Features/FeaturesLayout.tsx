import type { ReactNode } from "react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarLayout, NavSidebar } from "@/components/shared";
import { TEMPLATE_CATEGORIES } from "@/constants";
import { useI18n } from "@/i18n";
import type { FeatureType, TemplateCategory } from "@/types";

type SidebarKey = TemplateCategory | "introduction" | "basic-env" | "basic-maas" | "basic-version" | "basic-context" | "extensions";

// Map sidebar key to route path
const KEY_TO_ROUTE: Record<SidebarKey, string> = {
  introduction: "/features",
  "basic-env": "/settings/env",
  "basic-maas": "/settings/maas",
  "basic-version": "/settings/runtime",
  "basic-context": "/settings/context",
  settings: "/settings",
  commands: "/commands",
  mcps: "/mcp",
  skills: "/skills",
  hooks: "/hooks",
  agents: "/agents",
  "output-styles": "/output-styles",
  statuslines: "/statusline",
  extensions: "/extensions",
};

// Map feature type to sidebar key
const FEATURE_TO_KEY: Partial<Record<FeatureType, SidebarKey>> = {
  features: "introduction",
  "basic-env": "basic-env",
  "basic-maas": "basic-maas",
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
  extensions: "extensions",
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
  const { t, translate } = useI18n();

  const groups = useMemo(() => [
    {
      title: t("features.quickStart"),
      items: [
        { key: "introduction", label: t("features.introduction") },
        { key: "basic-maas", label: t("feature.maasRegistry") },
      ],
    },
    {
      title: t("features.basic"),
      items: [
        { key: "basic-env", label: t("common.environment") },
        { key: "basic-version", label: t("feature.agentRuntime") },
        { key: "basic-context", label: t("feature.context") },
      ],
    },
    {
      title: t("features.features"),
      items: [
        ...TEMPLATE_CATEGORIES.map(c => ({ key: c.key, label: translate(c.label) })),
        { key: "extensions", label: t("common.extensions") },
      ],
    },
  ], [t, translate]);

  const activeFeature = feature ?? currentFeature;
  const activeKey = activeFeature ? FEATURE_TO_KEY[activeFeature] ?? null : null;

  const handleItemClick = (key: string) => {
    if (onFeatureClick) {
      // Legacy mode
      const keyToFeature: Record<SidebarKey, FeatureType> = {
        introduction: "features",
        // Workspace is top-level navigation, not part of this sidebar.
        "basic-env": "basic-env",
        "basic-maas": "basic-maas",
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
        extensions: "extensions",
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
