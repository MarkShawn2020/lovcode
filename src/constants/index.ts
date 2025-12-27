import {
  HomeIcon,
  ReaderIcon,
  BookmarkIcon,
  LightningBoltIcon,
  GearIcon,
  CodeIcon,
  Component1Icon,
  Link2Icon,
  MixerHorizontalIcon,
  CubeIcon,
  ChatBubbleIcon,
  TargetIcon,
  LayersIcon,
  PersonIcon,
  DesktopIcon,
  RowsIcon,
} from "@radix-ui/react-icons";
import type { FeatureType, FeatureConfig, TemplateCategory } from "../types";

// ============================================================================
// Feature Icons
// ============================================================================

export const FEATURE_ICONS: Record<
  FeatureType | "home" | "knowledge" | "features" | "marketplace-menu" | "chat",
  React.ComponentType<{ className?: string }>
> = {
  home: HomeIcon,
  workspace: DesktopIcon,
  knowledge: ReaderIcon,
  "kb-reference": BookmarkIcon,
  "kb-distill": LightningBoltIcon,
  settings: GearIcon,
  statusline: RowsIcon,
  commands: CodeIcon,
  mcp: Component1Icon,
  skills: TargetIcon,
  hooks: Link2Icon,
  "sub-agents": PersonIcon,
  "output-styles": MixerHorizontalIcon,
  marketplace: CubeIcon,
  "marketplace-menu": CubeIcon,
  features: LayersIcon,
  chat: ChatBubbleIcon,
};

// ============================================================================
// Features Configuration
// ============================================================================

export const FEATURES: FeatureConfig[] = [
  // Workspace (parallel vibe coding)
  {
    type: "workspace",
    label: "Workspace",
    description: "Parallel vibe coding workspace",
    available: true,
    group: "history",
  },
  // Knowledge (collapsible submenu)
  {
    type: "kb-reference",
    label: "Reference",
    description: "Platform docs",
    available: true,
    group: "knowledge",
  },
  {
    type: "kb-distill",
    label: "Distill (CC)",
    description: "Experience summaries",
    available: true,
    group: "knowledge",
  },
  // Configuration
  {
    type: "settings",
    label: "Configuration",
    description: "Permissions, context & config",
    available: true,
    group: "config",
  },
  {
    type: "commands",
    label: "Commands",
    description: "Slash commands",
    available: true,
    group: "config",
  },
  {
    type: "mcp",
    label: "MCPs",
    description: "MCP servers",
    available: true,
    group: "config",
  },
  {
    type: "skills",
    label: "Skills",
    description: "Reusable skill templates",
    available: true,
    group: "config",
  },
  {
    type: "hooks",
    label: "Hooks",
    description: "Automation triggers",
    available: true,
    group: "config",
  },
  {
    type: "sub-agents",
    label: "Sub Agents",
    description: "AI agents with models",
    available: true,
    group: "config",
  },
  {
    type: "output-styles",
    label: "Output Styles",
    description: "Response formatting styles",
    available: true,
    group: "config",
  },
  {
    type: "statusline",
    label: "Status Line",
    description: "Custom CLI status line",
    available: true,
    group: "config",
  },
  // Marketplace
  {
    type: "marketplace",
    label: "Marketplace",
    description: "Browse and install templates",
    available: true,
    group: "marketplace",
  },
];

// ============================================================================
// Source Filters
// ============================================================================

export const SOURCE_FILTERS = [
  { id: "all", label: "All", tooltip: "All sources" },
  { id: "anthropic", label: "Anthropic", tooltip: "github.com/anthropics/claude-plugins-official" },
  { id: "lovstudio", label: "Lovstudio", tooltip: "github.com/markshawn2020/lovstudio-plugins-official" },
  { id: "community", label: "CCT", tooltip: "github.com/davila7/claude-code-templates" },
] as const;

export type SourceFilterId = (typeof SOURCE_FILTERS)[number]["id"];

// ============================================================================
// Template Categories
// ============================================================================

export const TEMPLATE_CATEGORIES: {
  key: TemplateCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "settings", label: "Configuration", icon: GearIcon },
  { key: "commands", label: "Commands", icon: LightningBoltIcon },
  { key: "mcps", label: "MCPs", icon: Component1Icon },
  { key: "skills", label: "Skills", icon: TargetIcon },
  { key: "hooks", label: "Hooks", icon: Link2Icon },
  { key: "agents", label: "Sub Agents", icon: PersonIcon },
  { key: "output-styles", label: "Output Styles", icon: MixerHorizontalIcon },
  { key: "statuslines", label: "Status Line", icon: RowsIcon },
];
