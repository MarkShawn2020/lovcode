import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo, UIEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { version } from "../package.json";
import { PanelLeft, User, ExternalLink, FolderOpen, ChevronDown, ChevronRight as ChevronRightIcon, HelpCircle, Copy, Download, Check, MoreHorizontal, RefreshCw, ChevronLeft, ChevronRight, Store, Archive, RotateCcw, List, FolderTree, Folder, Terminal, FileText } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent as CollapsibleBody } from "./components/ui/collapsible";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown from "react-markdown";
import { Switch } from "./components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "./components/ui/avatar";
import { Popover, PopoverTrigger, PopoverContent } from "./components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
} from "./components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Button } from "./components/ui/button";
import { ContextFileItem, ConfigFileItem } from "./components/ContextFileItem";
import { DocumentReader } from "./components/DocumentReader";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import {
  LoadingState,
  EmptyState,
  SearchInput,
  PageHeader,
  DetailHeader,
  ItemCard,
  DetailCard,
  ContentCard,
  ConfigPage,
  useSearch,
  MarketplaceSection,
  type MarketplaceItem,
} from "./components/config";

// ============================================================================
// Hooks
// ============================================================================

function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setPersistedState = useCallback((value: T | ((prev: T) => T)) => {
    setState(prev => {
      const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
      localStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, [key]);

  return [state, setPersistedState];
}

// ============================================================================
// App Config Context
// ============================================================================

interface AppConfig {
  homeDir: string;
  shortenPaths: boolean;
  setShortenPaths: (value: boolean) => void;
  formatPath: (path: string) => string;
}

const AppConfigContext = createContext<AppConfig>({
  homeDir: "",
  shortenPaths: true,
  setShortenPaths: () => {},
  formatPath: (p) => p,
});

export const useAppConfig = () => useContext(AppConfigContext);

// ============================================================================
// Types & Config
// ============================================================================

type FeatureType = "chat" | "settings" | "commands" | "mcp" | "skills" | "hooks" | "sub-agents" | "output-styles" | "marketplace" | "kb-distill" | "kb-reference";

interface FeatureConfig {
  type: FeatureType;
  label: string;
  icon: string;
  description: string;
  available: boolean;
  group: "history" | "config" | "marketplace" | "knowledge";
}

// Group 1: Projects (chat history)
// Group 2: Configuration
// Group 3: Marketplace
const FEATURES: FeatureConfig[] = [
  // Projects
  { type: "chat", label: "Projects", icon: "💬", description: "Browse conversation history", available: true, group: "history" },
  // Knowledge (collapsible submenu)
  { type: "kb-reference", label: "Reference", icon: "📖", description: "Platform docs", available: true, group: "knowledge" },
  { type: "kb-distill", label: "Distill (CC)", icon: "💡", description: "Experience summaries", available: true, group: "knowledge" },
  // Configuration
  { type: "settings", label: "Configuration", icon: "⚙️", description: "Permissions, context & config", available: true, group: "config" },
  { type: "commands", label: "Commands", icon: "⚡", description: "Slash commands", available: true, group: "config" },
  { type: "mcp", label: "MCPs", icon: "🔌", description: "MCP servers", available: true, group: "config" },
  { type: "skills", label: "Skills", icon: "🎯", description: "Reusable skill templates", available: true, group: "config" },
  { type: "hooks", label: "Hooks", icon: "🪝", description: "Automation triggers", available: true, group: "config" },
  { type: "sub-agents", label: "Sub Agents", icon: "🤖", description: "AI agents with models", available: true, group: "config" },
  { type: "output-styles", label: "Output Styles", icon: "🎨", description: "Response formatting styles", available: true, group: "config" },
  // Marketplace
  { type: "marketplace", label: "Marketplace", icon: "🛒", description: "Browse and install templates", available: true, group: "marketplace" },
];

// ============================================================================
// Data Types
// ============================================================================

interface Project {
  id: string;
  path: string;
  session_count: number;
  last_active: number;
}

interface Session {
  id: string;
  project_id: string;
  project_path: string | null;
  summary: string | null;
  message_count: number;
  last_modified: number;
}

interface Message {
  uuid: string;
  role: string;
  content: string;
  timestamp: string;
  is_meta: boolean;
  is_tool: boolean;
}

interface ChatMessage {
  uuid: string;
  role: string;
  content: string;
  timestamp: string;
  project_id: string;
  project_path: string;
  session_id: string;
  session_summary: string | null;
}

interface SearchResult {
  uuid: string;
  content: string;
  role: string;
  project_id: string;
  project_path: string;
  session_id: string;
  session_summary: string | null;
  timestamp: string;
  score: number;
}

interface ChatsResponse {
  items: ChatMessage[];
  total: number;
}

interface LocalCommand {
  name: string;
  path: string;
  description: string | null;
  allowed_tools: string | null;
  argument_hint: string | null;
  content: string;
  version: string | null;
  status: "active" | "deprecated" | "archived";
  deprecated_by: string | null;
  changelog: string | null;
  aliases: string[];
}

interface LocalAgent {
  name: string;
  path: string;
  description: string | null;
  model: string | null;
  tools: string | null;
  content: string;
}

interface LocalSkill {
  name: string;
  path: string;
  description: string | null;
  content: string;
}

interface DistillDocument {
  date: string;
  file: string;
  title: string;
  tags: string[];
  session: string | null;
}

interface McpServer {
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface ClaudeSettings {
  raw: Record<string, unknown> | null;
  permissions: Record<string, unknown> | null;
  hooks: Record<string, unknown[]> | null;
  mcp_servers: McpServer[];
}

interface ContextFile {
  name: string;
  path: string;
  scope: string;
  content: string;
  last_modified: number;
}

interface TemplateComponent {
  name: string;
  path: string;
  category: string;
  component_type: string;
  description: string | null;
  downloads: number | null;
  content: string | null;
}

interface TemplatesCatalog {
  settings: TemplateComponent[];
  commands: TemplateComponent[];
  mcps: TemplateComponent[];
  skills: TemplateComponent[];
  hooks: TemplateComponent[];
  agents: TemplateComponent[];
  "output-styles": TemplateComponent[];
}

type TemplateCategory = "settings" | "commands" | "mcps" | "skills" | "hooks" | "agents" | "output-styles";

const TEMPLATE_CATEGORIES: { key: TemplateCategory; label: string; icon: string }[] = [
  { key: "settings", label: "Configuration", icon: "⚙️" },
  { key: "commands", label: "Commands", icon: "⚡" },
  { key: "mcps", label: "MCPs", icon: "🔌" },
  { key: "skills", label: "Skills", icon: "🎯" },
  { key: "hooks", label: "Hooks", icon: "🪝" },
  { key: "agents", label: "Sub Agents", icon: "🤖" },
  { key: "output-styles", label: "Output Styles", icon: "🎨" },
];

// ============================================================================
// View State
// ============================================================================

type View =
  | { type: "home" }
  | { type: "chat-projects" }
  | { type: "chat-sessions"; projectId: string; projectPath: string }
  | { type: "chat-messages"; projectId: string; sessionId: string; summary: string | null }
  | { type: "settings" }
  | { type: "commands" }
  | { type: "command-detail"; command: LocalCommand; scrollToChangelog?: boolean }
  | { type: "mcp" }
  | { type: "skills" }
  | { type: "skill-detail"; skill: LocalSkill }
  | { type: "hooks" }
  | { type: "sub-agents" }
  | { type: "sub-agent-detail"; agent: LocalAgent }
  | { type: "output-styles" }
  | { type: "kb-distill" }
  | { type: "kb-distill-detail"; document: DistillDocument }
  | { type: "kb-reference" }
  | { type: "kb-reference-doc"; source: string; docIndex: number }
  | { type: "marketplace"; category?: TemplateCategory }
  | { type: "template-detail"; template: TemplateComponent; category: TemplateCategory }
  | { type: "feature-todo"; feature: FeatureType };

// ============================================================================
// App Component
// ============================================================================

interface UserProfile {
  nickname: string;
  avatarUrl: string;
}

function App() {
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem("lovcode-view");
    if (saved) {
      try {
        return JSON.parse(saved) as View;
      } catch {
        return { type: "home" };
      }
    }
    return { type: "home" };
  });
  const [viewHistory, setViewHistory] = useState<View[]>(() => {
    const saved = localStorage.getItem("lovcode-view");
    if (saved) {
      try {
        return [JSON.parse(saved) as View];
      } catch {
        return [{ type: "home" }];
      }
    }
    return [{ type: "home" }];
  });
  const [historyIndex, setHistoryIndex] = useState(0);

  const navigate = useCallback((newView: View) => {
    setViewHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(newView);
      // Limit history size
      if (newHistory.length > 50) newHistory.shift();
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
    setView(newView);
  }, [historyIndex]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < viewHistory.length - 1;

  const goBack = useCallback(() => {
    if (canGoBack) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setView(viewHistory[newIndex]);
    }
  }, [canGoBack, historyIndex, viewHistory]);

  const goForward = useCallback(() => {
    if (canGoForward) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setView(viewHistory[newIndex]);
    }
  }, [canGoForward, historyIndex, viewHistory]);

  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState("lovcode:sidebarCollapsed", false);
  const [marketplaceCategory, setMarketplaceCategory] = usePersistedState<TemplateCategory>("lovcode:marketplaceCategory", "commands");
  const [catalog, setCatalog] = useState<TemplatesCatalog | null>(null);
  const [homeDir, setHomeDir] = useState("");
  const [shortenPaths, setShortenPaths] = usePersistedState("lovcode:shortenPaths", true);
  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = usePersistedState<UserProfile>("lovcode:profile", { nickname: "", avatarUrl: "" });
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [distillWatchEnabled, setDistillWatchEnabled] = useState(true);

  // Load home directory and distill watch status
  useEffect(() => {
    invoke<string>("get_home_dir").then(setHomeDir).catch(() => {});
    invoke<boolean>("get_distill_watch_enabled").then(setDistillWatchEnabled).catch(() => {});
  }, []);

  // Persist view to localStorage
  useEffect(() => {
    localStorage.setItem("lovcode-view", JSON.stringify(view));
  }, [view]);

  // Listen for menu settings event
  useEffect(() => {
    const unlisten = listen("menu-settings", () => setShowSettings(true));
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Cmd+R to reload page
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        // Trigger save before reload
        window.dispatchEvent(new Event("app:before-reload"));
        // Small delay to ensure save completes
        setTimeout(() => window.location.reload(), 50);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const formatPath = useCallback((path: string) => {
    if (shortenPaths && homeDir && path.startsWith(homeDir)) {
      return "~" + path.slice(homeDir.length);
    }
    return path;
  }, [shortenPaths, homeDir]);

  const appConfig: AppConfig = { homeDir, shortenPaths, setShortenPaths, formatPath };

  // Load marketplace catalog once for unified search
  useEffect(() => {
    invoke<TemplatesCatalog>("get_templates_catalog").then(setCatalog).catch(() => {});
  }, []);

  const currentFeature: FeatureType | null =
    view.type === "chat-projects" || view.type === "chat-sessions" || view.type === "chat-messages"
      ? "chat"
      : view.type === "settings"
        ? "settings"
        : view.type === "commands" || view.type === "command-detail"
          ? "commands"
          : view.type === "mcp"
            ? "mcp"
            : view.type === "skills" || view.type === "skill-detail"
              ? "skills"
              : view.type === "hooks"
                ? "hooks"
                : view.type === "sub-agents" || view.type === "sub-agent-detail"
                  ? "sub-agents"
                  : view.type === "output-styles"
                    ? "output-styles"
                    : view.type === "kb-distill" || view.type === "kb-distill-detail"
                      ? "kb-distill"
                      : view.type === "kb-reference" || view.type === "kb-reference-doc"
                        ? "kb-reference"
                        : view.type === "marketplace" || view.type === "template-detail"
                        ? "marketplace"
                        : view.type === "feature-todo"
                          ? view.feature
                          : null;

  const handleFeatureClick = (feature: FeatureType) => {
    switch (feature) {
      case "chat":
        navigate({ type: "chat-projects" });
        break;
      case "settings":
        navigate({ type: "settings" });
        break;
      case "commands":
        navigate({ type: "commands" });
        break;
      case "mcp":
        navigate({ type: "mcp" });
        break;
      case "skills":
        navigate({ type: "skills" });
        break;
      case "hooks":
        navigate({ type: "hooks" });
        break;
      case "sub-agents":
        navigate({ type: "sub-agents" });
        break;
      case "output-styles":
        navigate({ type: "output-styles" });
        break;
      case "kb-distill":
        navigate({ type: "kb-distill" });
        break;
      case "kb-reference":
        navigate({ type: "kb-reference" });
        break;
      case "marketplace":
        navigate({ type: "marketplace", category: marketplaceCategory });
        break;
      default:
        navigate({ type: "feature-todo", feature });
    }
  };

  return (
    <AppConfigContext.Provider value={appConfig}>
    <div className="h-screen bg-canvas flex">
      {/* Sidebar with animation */}
      <aside className={`flex flex-col border-r border-border bg-card transition-all duration-300 ease-in-out overflow-hidden ${sidebarCollapsed ? "w-0 border-r-0" : "w-52"}`}>
        {/* Traffic light row */}
        <div data-tauri-drag-region className="h-[52px] shrink-0 flex items-center justify-end px-3 border-b border-border min-w-52">
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-ink hover:bg-card-alt"
            title="Collapse sidebar"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3 min-w-52">
          {/* Home */}
          <div className="px-2 mb-2">
            <button
              onClick={() => navigate({ type: "home" })}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                view.type === "home"
                  ? "bg-primary/10 text-primary"
                  : "text-ink hover:bg-card-alt"
              }`}
            >
              <span className="text-lg">🏠</span>
              <span className="text-sm">Home</span>
            </button>
          </div>

          {/* History Group */}
          <div className="px-2 mb-2">
            {FEATURES.filter(f => f.group === "history").map((feature) => (
              <FeatureButton
                key={feature.type}
                feature={feature}
                active={currentFeature === feature.type}
                onClick={() => handleFeatureClick(feature.type)}
              />
            ))}

            {/* Knowledge Collapsible Menu */}
            <Collapsible defaultOpen={currentFeature?.startsWith("kb-")}>
              <CollapsibleTrigger className="w-full group">
                <div className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  currentFeature?.startsWith("kb-")
                    ? "text-primary"
                    : "text-ink hover:bg-card-alt"
                }`}>
                  <span className="text-lg">📚</span>
                  <span className="text-sm flex-1">Knowledge</span>
                  <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleBody className="pl-4 flex flex-col gap-0.5">
                {FEATURES.filter(f => f.group === "knowledge").map((feature) => (
                  <FeatureButton
                    key={feature.type}
                    feature={feature}
                    active={currentFeature === feature.type}
                    onClick={() => handleFeatureClick(feature.type)}
                    statusIndicator={feature.type === "kb-distill" ? (distillWatchEnabled ? "on" : "off") : undefined}
                    compact
                  />
                ))}
              </CollapsibleBody>
            </Collapsible>
          </div>

          {/* Marketplace Group */}
          <div className="px-2 mb-2">
            <Collapsible defaultOpen={view.type === "marketplace" || view.type === "template-detail"}>
              <CollapsibleTrigger className="w-full group">
                <div className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  view.type === "marketplace" || view.type === "template-detail"
                    ? "text-primary"
                    : "text-ink hover:bg-card-alt"
                }`}>
                  <span className="text-lg">🛒</span>
                  <span className="text-sm flex-1">Marketplace</span>
                  <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleBody className="pl-4 flex flex-col gap-0.5">
                {TEMPLATE_CATEGORIES.map((cat) => {
                  const isActive = (view.type === "marketplace" && view.category === cat.key) ||
                    (view.type === "template-detail" && view.category === cat.key);
                  return (
                    <button
                      key={cat.key}
                      onClick={() => navigate({ type: "marketplace", category: cat.key })}
                      className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-ink hover:bg-card-alt"
                      }`}
                    >
                      <span className="text-lg">{cat.icon}</span>
                      <span className="text-sm">{cat.label}</span>
                    </button>
                  );
                })}
              </CollapsibleBody>
            </Collapsible>
          </div>

          {/* Config Group */}
          <div className="px-2 py-2 border-t border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wide px-3 py-2">Features</p>
            {FEATURES.filter(f => f.group === "config").map((feature) => (
              <FeatureButton
                key={feature.type}
                feature={feature}
                active={currentFeature === feature.type}
                onClick={() => handleFeatureClick(feature.type)}
              />
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-border min-w-52">
          <p className="text-xs text-muted-foreground text-center">Lovcode v{version}</p>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar - always 52px height, button only visible when collapsed */}
        <div
          data-tauri-drag-region
          className="h-[52px] shrink-0 flex items-center justify-between border-b border-border bg-card"
        >
          <div className={`flex items-center gap-1 ${sidebarCollapsed ? "pl-[92px]" : "pl-3"}`}>
            {/* Expand sidebar button - only when collapsed */}
            <button
              onClick={() => setSidebarCollapsed(false)}
              className={`p-1.5 rounded-md text-muted-foreground hover:text-ink hover:bg-card-alt transition-opacity duration-300 ${sidebarCollapsed ? "opacity-100" : "opacity-0 pointer-events-none w-0 p-0"}`}
              title="Expand sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            {/* Navigation buttons */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={goBack}
                disabled={!canGoBack}
                className="p-1.5 rounded-md text-muted-foreground hover:text-ink hover:bg-card-alt disabled:opacity-30 disabled:pointer-events-none"
                title="Go back"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={goForward}
                disabled={!canGoForward}
                className="p-1.5 rounded-md text-muted-foreground hover:text-ink hover:bg-card-alt disabled:opacity-30 disabled:pointer-events-none"
                title="Go forward"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Profile Button */}
          <div className="pr-4">
            <Popover>
              <PopoverTrigger className="rounded-full hover:ring-2 hover:ring-primary/50 transition-all">
                <Avatar className="h-8 w-8 cursor-pointer">
                  {profile.avatarUrl ? (
                    <AvatarImage src={profile.avatarUrl} alt={profile.nickname || "User"} />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-primary text-sm">
                    {profile.nickname ? profile.nickname.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
                  </AvatarFallback>
                </Avatar>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-2">
                <div className="space-y-1">
                  {profile.nickname && (
                    <p className="px-2 py-1.5 text-sm font-medium text-ink truncate">{profile.nickname}</p>
                  )}
                  <button
                    onClick={() => setShowProfileDialog(true)}
                    className="w-full text-left px-2 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-md transition-colors"
                  >
                    Edit Profile
                  </button>
                  <button
                    onClick={() => setShowSettings(true)}
                    className="w-full text-left px-2 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-md transition-colors"
                  >
                    Settings
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <main className="flex-1 overflow-auto">
        {view.type === "home" && (
          <Home onFeatureClick={handleFeatureClick} />
        )}

        {view.type === "chat-projects" && (
          <ProjectList
            onSelectProject={(p) => navigate({
              type: "chat-sessions",
              projectId: p.id,
              projectPath: p.path
            })}
            onSelectSession={(s) => navigate({
              type: "chat-messages",
              projectId: s.project_id,
              sessionId: s.id,
              summary: s.summary
            })}
            onSelectChat={(c) => navigate({
              type: "chat-messages",
              projectId: c.project_id,
              sessionId: c.session_id,
              summary: c.session_summary
            })}
          />
        )}

        {view.type === "chat-sessions" && (
          <SessionList
            projectId={view.projectId}
            projectPath={view.projectPath}
            onBack={() => navigate({ type: "chat-projects" })}
            onSelect={(s) => navigate({
              type: "chat-messages",
              projectId: s.project_id,
              sessionId: s.id,
              summary: s.summary
            })}
          />
        )}

        {view.type === "chat-messages" && (
          <MessageView
            projectId={view.projectId}
            sessionId={view.sessionId}
            summary={view.summary}
            onBack={() => navigate({
              type: "chat-sessions",
              projectId: view.projectId,
              projectPath: ""
            })}
          />
        )}

        {view.type === "commands" && (
          <CommandsView
            onSelect={(cmd, scrollToChangelog) => navigate({ type: "command-detail", command: cmd, scrollToChangelog })}
            marketplaceItems={catalog?.commands || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.commands.find(c => c.path === item.path);
              if (template) navigate({ type: "template-detail", template, category: "commands" });
            }}
            onBrowseMore={() => navigate({ type: "marketplace", category: "commands" })}
          />
        )}

        {view.type === "command-detail" && (
          <CommandDetailView
            command={view.command}
            onBack={() => navigate({ type: "commands" })}
            onCommandUpdated={() => {
              // Will refresh when navigating back to commands view
            }}
            scrollToChangelog={view.scrollToChangelog}
          />
        )}

        {view.type === "mcp" && (
          <McpView
            marketplaceItems={catalog?.mcps || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.mcps.find(c => c.path === item.path);
              if (template) navigate({ type: "template-detail", template, category: "mcps" });
            }}
            onBrowseMore={() => navigate({ type: "marketplace", category: "mcps" })}
          />
        )}

        {view.type === "skills" && (
          <SkillsView
            onSelect={(skill) => navigate({ type: "skill-detail", skill })}
            marketplaceItems={catalog?.skills || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.skills.find(c => c.path === item.path);
              if (template) navigate({ type: "template-detail", template, category: "skills" });
            }}
            onBrowseMore={() => navigate({ type: "marketplace", category: "skills" })}
          />
        )}

        {view.type === "skill-detail" && (
          <SkillDetailView
            skill={view.skill}
            onBack={() => navigate({ type: "skills" })}
          />
        )}

        {view.type === "hooks" && (
          <HooksView
            marketplaceItems={catalog?.hooks || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.hooks.find(c => c.path === item.path);
              if (template) navigate({ type: "template-detail", template, category: "hooks" });
            }}
            onBrowseMore={() => navigate({ type: "marketplace", category: "hooks" })}
          />
        )}

        {view.type === "sub-agents" && (
          <SubAgentsView
            onSelect={(agent) => navigate({ type: "sub-agent-detail", agent })}
            marketplaceItems={catalog?.agents || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.agents.find(c => c.path === item.path);
              if (template) navigate({ type: "template-detail", template, category: "agents" });
            }}
            onBrowseMore={() => navigate({ type: "marketplace", category: "agents" })}
          />
        )}

        {view.type === "sub-agent-detail" && (
          <SubAgentDetailView
            agent={view.agent}
            onBack={() => navigate({ type: "sub-agents" })}
          />
        )}

        {view.type === "output-styles" && (
          <OutputStylesView />
        )}

        {view.type === "kb-distill" && (
          <DistillView
            onSelect={(doc) => navigate({ type: "kb-distill-detail", document: doc })}
            watchEnabled={distillWatchEnabled}
            onWatchToggle={(enabled) => {
              setDistillWatchEnabled(enabled);
              invoke("set_distill_watch_enabled", { enabled });
            }}
          />
        )}

        {view.type === "kb-distill-detail" && (
          <DistillDetailView
            document={view.document}
            onBack={() => navigate({ type: "kb-distill" })}
            onNavigateSession={(projectId, sessionId, summary) =>
              navigate({ type: "chat-messages", projectId, sessionId, summary })
            }
          />
        )}

        {(view.type === "kb-reference" || view.type === "kb-reference-doc") && (
          <ReferenceView
            initialSource={view.type === "kb-reference-doc" ? view.source : undefined}
            initialDocIndex={view.type === "kb-reference-doc" ? view.docIndex : undefined}
            onDocOpen={(source, docIndex) => navigate({ type: "kb-reference-doc", source, docIndex })}
            onDocClose={() => navigate({ type: "kb-reference" })}
          />
        )}

        {view.type === "settings" && (
          <SettingsView
            marketplaceItems={catalog?.settings || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.settings.find(c => c.path === item.path);
              if (template) navigate({ type: "template-detail", template, category: "settings" });
            }}
            onBrowseMore={() => navigate({ type: "marketplace", category: "settings" })}
          />
        )}

        {view.type === "marketplace" && (
          <MarketplaceView
            initialCategory={view.category ?? marketplaceCategory}
            onSelectTemplate={(template, category) => {
              setMarketplaceCategory(category);
              navigate({ type: "template-detail", template, category });
            }}
          />
        )}

        {view.type === "template-detail" && (
          <TemplateDetailView
            template={view.template}
            category={view.category}
            onBack={() => navigate({ type: "marketplace", category: marketplaceCategory })}
            onNavigateToInstalled={view.category === "mcps" ? () => navigate({ type: "mcp" }) : undefined}
          />
        )}

        {view.type === "feature-todo" && (
          <FeatureTodo feature={view.feature} />
        )}
        </main>
      </div>
    </div>
    <AppSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    <ProfileDialog
      open={showProfileDialog}
      onClose={() => setShowProfileDialog(false)}
      profile={profile}
      onSave={setProfile}
    />
    </AppConfigContext.Provider>
  );
}

// ============================================================================
// App Settings Dialog
// ============================================================================

function AppSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { shortenPaths, setShortenPaths } = useAppConfig();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-96 max-w-[90vw]">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Settings</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-ink text-xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">Shorten paths</p>
              <p className="text-xs text-muted-foreground">Replace home directory with ~</p>
            </div>
            <Switch checked={shortenPaths} onCheckedChange={setShortenPaths} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Profile Dialog
// ============================================================================

function ProfileDialog({
  open,
  onClose,
  profile,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  onSave: (profile: UserProfile) => void;
}) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setNickname(profile.nickname);
      setAvatarUrl(profile.avatarUrl);
    }
  }, [open, profile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setAvatarUrl(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    onSave({ nickname, avatarUrl });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Avatar Preview with Upload */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
            >
              <Avatar className="h-20 w-20">
                {avatarUrl ? (
                  <AvatarImage src={avatarUrl} alt={nickname || "User"} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                  {nickname ? nickname.charAt(0).toUpperCase() : <User className="w-8 h-8" />}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white text-xs">Upload</span>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <p className="text-xs text-muted-foreground">Click avatar to upload</p>
          </div>

          {/* Nickname */}
          <div className="space-y-2">
            <Label htmlFor="nickname">Nickname</Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter your nickname"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Sidebar Components
// ============================================================================

function FeatureButton({
  feature,
  active,
  onClick,
  statusIndicator,
  compact,
}: {
  feature: FeatureConfig;
  active: boolean;
  onClick: () => void;
  statusIndicator?: "on" | "off";
  compact?: boolean;
}) {
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
      <span className="text-lg">{feature.icon}</span>
      <span className="text-sm flex-1">
        {feature.label}
        {!feature.available && <span className="ml-1.5 text-xs opacity-60">(TODO)</span>}
      </span>
      {statusIndicator !== undefined && (
        <span className={`w-1.5 h-1.5 rounded-full ${statusIndicator === "on" ? "bg-green-500" : "bg-muted-foreground/40"}`} />
      )}
    </button>
  );
}

// ============================================================================
// Home Component
// ============================================================================

function Home({ onFeatureClick }: { onFeatureClick: (feature: FeatureType) => void }) {
  const [stats, setStats] = useState<{ projects: number; sessions: number; commands: number } | null>(null);

  useEffect(() => {
    Promise.all([
      invoke<Project[]>("list_projects"),
      invoke<LocalCommand[]>("list_local_commands")
    ]).then(([projects, commands]) => {
      const sessions = projects.reduce((sum, p) => sum + p.session_count, 0);
      setStats({ projects: projects.length, sessions, commands: commands.length });
    });
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-16">
      <h1 className="font-serif text-5xl font-bold text-primary mb-3 tracking-tight">Lovcode</h1>
      <p className="text-muted-foreground text-lg mb-12">Your Vibe Coding Hub</p>

      {stats && (
        <div className="flex gap-3 mb-12">
          {[
            { value: stats.projects, label: "Projects" },
            { value: stats.sessions, label: "Sessions" },
            { value: stats.commands, label: "Commands" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="text-center px-6 py-4 bg-card rounded-2xl border border-border/60"
            >
              <p className="text-3xl font-semibold text-ink font-serif">{stat.value}</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-lg">
        {FEATURES.map((feature) => (
          <button
            key={feature.type}
            onClick={() => onFeatureClick(feature.type)}
            className={`flex flex-col items-center p-6 rounded-2xl border transition-all duration-200 ${
              feature.available
                ? "bg-card border-border/60 hover:border-primary hover:shadow-sm cursor-pointer"
                : "bg-card/40 border-border/40"
            }`}
          >
            <span className="text-3xl mb-3">{feature.icon}</span>
            <span className={`text-sm font-medium ${feature.available ? "text-ink" : "text-muted-foreground"}`}>
              {feature.label}
            </span>
            {!feature.available && (
              <span className="text-xs text-muted-foreground/70 mt-1.5 italic">Soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

function BrowseMarketplaceButton({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors"
      title="Browse marketplace"
    >
      <Store className="w-4 h-4" />
      <span>Marketplace</span>
    </button>
  );
}

// ============================================================================
// Sub Agents Feature
// ============================================================================

function SubAgentsView({
  onSelect,
  marketplaceItems,
  onMarketplaceSelect,
  onBrowseMore,
}: {
  onSelect: (agent: LocalAgent) => void;
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
  onBrowseMore?: () => void;
}) {
  const [agents, setAgents] = useState<LocalAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const { search, setSearch, filtered } = useSearch(agents, ["name", "description", "model"]);

  useEffect(() => {
    invoke<LocalAgent[]>("list_local_agents")
      .then(setAgents)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading sub-agents..." />;

  return (
    <ConfigPage>
      <PageHeader title="Sub Agents" subtitle={`${agents.length} sub-agents in ~/.claude/commands`} action={<BrowseMarketplaceButton onClick={onBrowseMore} />} />
      <SearchInput placeholder="Search local & marketplace..." value={search} onChange={setSearch} />

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((agent) => (
            <ItemCard
              key={agent.name}
              name={agent.name}
              description={agent.description}
              badge={agent.model}
              onClick={() => onSelect(agent)}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && !search && (
        <EmptyState icon="🤖" message="No sub-agents found" hint="Sub-agents are commands with a model field in frontmatter" />
      )}

      {filtered.length === 0 && search && (
        <p className="text-muted-foreground text-sm">No local sub-agents match "{search}"</p>
      )}

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} onBrowseMore={onBrowseMore} />
    </ConfigPage>
  );
}

function SubAgentDetailView({ agent, onBack }: { agent: LocalAgent; onBack: () => void }) {
  return (
    <ConfigPage>
      <DetailHeader
        title={agent.name}
        description={agent.description}
        backLabel="Sub Agents"
        onBack={onBack}
        path={agent.path}
        onOpenPath={(p) => invoke("open_in_editor", { path: p })}
      />
      <div className="space-y-4">
        {agent.model && (
          <DetailCard label="Model">
            <p className="font-mono text-accent">{agent.model}</p>
          </DetailCard>
        )}
        {agent.tools && (
          <DetailCard label="Tools">
            <p className="font-mono text-sm text-ink">{agent.tools}</p>
          </DetailCard>
        )}
        <ContentCard label="Content" content={agent.content} />
      </div>
    </ConfigPage>
  );
}

// ============================================================================
// Distill Feature (Knowledge Base)
// ============================================================================

function DistillMenu({
  watchEnabled,
  onWatchToggle,
  onRefresh,
}: {
  watchEnabled: boolean;
  onWatchToggle: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  const { homeDir } = useAppConfig();
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandContent, setCommandContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (helpOpen && !commandContent) {
      invoke<string>("get_distill_command_file")
        .then(setCommandContent)
        .catch(() => setCommandContent(null));
    }
  }, [helpOpen, commandContent]);

  const handleCopy = async () => {
    if (commandContent) {
      await navigator.clipboard.writeText(commandContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (commandContent) {
      const blob = new Blob([commandContent], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "distill.md";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-2 rounded-lg text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors">
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setHelpOpen(true)}>
            <HelpCircle className="w-4 h-4 mr-2" />
            Help
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => invoke("open_in_editor", { path: `${homeDir}/.lovstudio/docs/distill` })}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Open Folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onRefresh} disabled={watchEnabled}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem checked={watchEnabled} onCheckedChange={onWatchToggle}>
            Auto Refresh
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>How to use Distill</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Distill captures wisdom from your Claude Code sessions into reusable knowledge.</p>
              <p className="font-medium text-ink">In Claude Code, run:</p>
              <code className="block px-3 py-2 rounded-lg bg-card-alt font-mono text-sm">/distill</code>
              <p>This analyzes your conversation and extracts key learnings into structured documents stored in:</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-card-alt px-2 py-1 rounded">~/.lovstudio/docs/distill/</code>
                <button
                  onClick={() => invoke("open_in_editor", { path: `${homeDir}/.lovstudio/docs/distill` })}
                  className="p-1.5 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                  title="Open distill directory"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            </div>

            {commandContent && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">Command File (distill.md)</p>
                  <div className="flex gap-1">
                    <button
                      onClick={handleCopy}
                      className="p-1.5 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                      title="Copy to clipboard"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="p-1.5 rounded text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
                      title="Download file"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-[40vh] overflow-auto rounded-lg bg-card-alt p-3">
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{commandContent}</pre>
                </div>
              </div>
            )}

            {commandContent === null && (
              <p className="text-sm text-muted-foreground italic">Command file not found. Place distill.md in ~/.claude/commands/</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DistillView({
  onSelect,
  watchEnabled,
  onWatchToggle,
}: {
  onSelect: (doc: DistillDocument) => void;
  watchEnabled: boolean;
  onWatchToggle: (enabled: boolean) => void;
}) {
  const [documents, setDocuments] = useState<DistillDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const { search, setSearch, filtered } = useSearch(documents, ["title", "tags"]);

  const fetchDocuments = () => {
    setLoading(true);
    invoke<DistillDocument[]>("list_distill_documents")
      .then(setDocuments)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDocuments();
    // Listen for distill directory changes
    const unlisten = listen("distill-changed", () => {
      fetchDocuments();
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  if (loading) return <LoadingState message="Loading distill documents..." />;

  return (
    <ConfigPage>
      <PageHeader
        title="Distill (CC)"
        subtitle={`${documents.length} summaries`}
        action={<DistillMenu watchEnabled={watchEnabled} onWatchToggle={onWatchToggle} onRefresh={fetchDocuments} />}
      />

      <SearchInput
        placeholder="Search by title or tags..."
        value={search}
        onChange={setSearch}
      />

      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((doc) => (
            <ItemCard
              key={doc.file}
              name={doc.title}
              description={doc.tags.map(t => `#${t}`).join(" ")}
              timestamp={doc.date}
              onClick={() => onSelect(doc)}
            />
          ))}
        </div>
      ) : !search ? (
        <EmptyState
          icon="💡"
          message="No distill documents yet"
          hint="Use /distill in Claude Code to capture wisdom"
        />
      ) : (
        <p className="text-muted-foreground text-sm">No documents match "{search}"</p>
      )}
    </ConfigPage>
  );
}

function DistillDetailView({
  document,
  onBack,
  onNavigateSession,
}: {
  document: DistillDocument;
  onBack: () => void;
  onNavigateSession: (projectId: string, sessionId: string, summary: string | null) => void;
}) {
  const { homeDir } = useAppConfig();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<string>("get_distill_document", { file: document.file })
      .then(setContent)
      .finally(() => setLoading(false));
  }, [document.file]);

  const handleNavigateSession = async () => {
    if (!document.session) return;
    const session = await invoke<Session | null>("find_session_project", { sessionId: document.session });
    if (session) {
      onNavigateSession(session.project_id, session.id, session.summary);
    }
  };

  if (loading) return <LoadingState message="Loading document..." />;

  const distillPath = `~/.lovstudio/docs/distill/${document.file}`;

  return (
    <ConfigPage>
      <DetailHeader
        title={document.title}
        description={document.tags.map(t => `#${t}`).join(" · ")}
        backLabel="Distill"
        onBack={onBack}
        path={distillPath}
        onOpenPath={(p) => invoke("open_in_editor", { path: p.replace("~", homeDir) })}
        onNavigateSession={handleNavigateSession}
      />
      <div className="space-y-4">
        <DetailCard label="Metadata">
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Date: <span className="text-ink">{document.date}</span></p>
            {document.session ? (
              <p className="text-muted-foreground">Session: <button onClick={handleNavigateSession} className="font-mono text-xs text-primary hover:underline">{document.session.slice(0, 8)}...</button></p>
            ) : (
              <p className="text-muted-foreground">Session: <span className="text-xs text-muted-foreground italic">N/A</span></p>
            )}
          </div>
        </DetailCard>
        <ContentCard label="Content" content={content} />
      </div>
    </ConfigPage>
  );
}

// ============================================================================
// Reference Feature
// ============================================================================

interface ReferenceSource {
  name: string;
  path: string;
  doc_count: number;
}

interface ReferenceDoc {
  name: string;
  path: string;
  group: string | null;
}

function ReferenceDocTree({
  docs,
  sourceName,
  onDocClick,
}: {
  docs: ReferenceDoc[];
  sourceName: string;
  onDocClick: (source: string, doc: ReferenceDoc, index: number) => void;
}) {
  const [allCollapsed, setAllCollapsed] = usePersistedState<Record<string, string[]>>("lovcode:reference:collapsedGroups", {});
  const collapsedGroups = useMemo(() => new Set(allCollapsed[sourceName] ?? []), [allCollapsed, sourceName]);
  const setCollapsedGroups = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setAllCollapsed(prev => ({
      ...prev,
      [sourceName]: Array.from(updater(new Set(prev[sourceName] ?? [])))
    }));
  }, [sourceName, setAllCollapsed]);

  // Group docs by their group field
  const grouped = useMemo(() => {
    const groups: { name: string | null; docs: { doc: ReferenceDoc; index: number }[] }[] = [];
    let currentGroup: string | null = null;
    let currentDocs: { doc: ReferenceDoc; index: number }[] = [];

    docs.forEach((doc, index) => {
      if (doc.group !== currentGroup) {
        if (currentDocs.length > 0) {
          groups.push({ name: currentGroup, docs: currentDocs });
        }
        currentGroup = doc.group;
        currentDocs = [];
      }
      currentDocs.push({ doc, index });
    });

    if (currentDocs.length > 0) {
      groups.push({ name: currentGroup, docs: currentDocs });
    }

    return groups;
  }, [docs]);

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {grouped.map((group, groupIdx) => (
        <div key={group.name ?? `ungrouped-${groupIdx}`}>
          {group.name && (
            <button
              onClick={() => toggleGroup(group.name!)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-ink transition-colors"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${collapsedGroups.has(group.name) ? "-rotate-90" : ""}`} />
              <span className="font-medium">{group.name}</span>
              <span className="text-muted-foreground/60">({group.docs.length})</span>
            </button>
          )}
          {!collapsedGroups.has(group.name ?? "") && (
            <div className={group.name ? "ml-3" : ""}>
              {group.docs.map(({ doc, index }) => (
                <button
                  key={doc.path}
                  onClick={() => onDocClick(sourceName, doc, index)}
                  className="w-full flex items-center gap-2 px-4 py-1.5 rounded-lg text-left text-sm hover:bg-card-alt transition-colors"
                >
                  <span className="text-muted-foreground text-xs">📄</span>
                  <span className="truncate">{doc.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReferenceView({
  initialSource,
  initialDocIndex,
  onDocOpen,
  onDocClose,
}: {
  initialSource?: string;
  initialDocIndex?: number;
  onDocOpen: (source: string, docIndex: number) => void;
  onDocClose: () => void;
}) {
  const [sources, setSources] = useState<ReferenceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [persistedSource, setPersistedSource] = usePersistedState<string | null>("lovcode:reference:expandedSource", null);
  const [expandedSource, setExpandedSource] = useState<string | null>(initialSource ?? persistedSource);

  // Sync to persisted state when expandedSource changes
  useEffect(() => {
    if (expandedSource !== persistedSource) {
      setPersistedSource(expandedSource);
    }
  }, [expandedSource]);
  const [docs, setDocs] = useState<ReferenceDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docContent, setDocContent] = useState<string>("");
  const [docLoading, setDocLoading] = useState(false);

  const isDocView = initialSource !== undefined && initialDocIndex !== undefined;

  // Load sources
  useEffect(() => {
    invoke<ReferenceSource[]>("list_reference_sources")
      .then(setSources)
      .finally(() => setLoading(false));
  }, []);

  // Load docs when source is expanded or when initial source is provided
  useEffect(() => {
    if (!expandedSource) return;
    setDocsLoading(true);
    invoke<ReferenceDoc[]>("list_reference_docs", { source: expandedSource })
      .then(setDocs)
      .finally(() => setDocsLoading(false));
  }, [expandedSource]);

  // Load doc content when in doc view
  useEffect(() => {
    if (!isDocView || docs.length === 0) return;
    const doc = docs[initialDocIndex];
    if (!doc) return;
    setDocLoading(true);
    invoke<string>("get_reference_doc", { path: doc.path })
      .then(setDocContent)
      .finally(() => setDocLoading(false));
  }, [isDocView, initialDocIndex, docs]);

  const handleSourceClick = (source: ReferenceSource) => {
    if (expandedSource === source.name) {
      setExpandedSource(null);
      setDocs([]);
      return;
    }
    setExpandedSource(source.name);
  };

  const handleDocClick = (source: string, _doc: ReferenceDoc, index: number) => {
    onDocOpen(source, index);
  };

  const handleNavigate = async (index: number) => {
    if (!initialSource) return;
    // Save scroll position before navigating
    const scrollKey = `lovcode:ref-scroll:${initialSource}:${initialDocIndex}`;
    const scrollContainer = document.querySelector("[data-ref-scroll]");
    if (scrollContainer) {
      localStorage.setItem(scrollKey, String(scrollContainer.scrollTop));
    }
    onDocOpen(initialSource, index);
  };

  if (loading) return <LoadingState message="Loading reference sources..." />;

  if (isDocView && docs.length > 0) {
    return (
      <DocumentReader
        documents={docs}
        currentIndex={initialDocIndex}
        content={docContent}
        loading={docLoading}
        sourceName={initialSource}
        onNavigate={handleNavigate}
        onBack={onDocClose}
      />
    );
  }

  return (
    <ConfigPage>
      <div className="space-y-2">
        {sources.length > 0 ? (
          sources.map((source) => (
            <div key={source.name}>
              <button
                onClick={() => handleSourceClick(source)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                  expandedSource === source.name
                    ? "bg-primary/10 text-primary"
                    : "bg-card hover:bg-card-alt"
                }`}
              >
                <span className="text-lg">📖</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{source.name}</div>
                  <div className="text-xs text-muted-foreground">{source.doc_count} docs</div>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${expandedSource === source.name ? "rotate-180" : ""}`} />
              </button>
              {expandedSource === source.name && (
                <div className="ml-4 mt-1 space-y-1">
                  {docsLoading ? (
                    <div className="px-4 py-2 text-sm text-muted-foreground">Loading...</div>
                  ) : docs.length > 0 ? (
                    <ReferenceDocTree docs={docs} sourceName={source.name} onDocClick={handleDocClick} />
                  ) : (
                    <div className="px-4 py-2 text-sm text-muted-foreground">No documents</div>
                  )}
                </div>
              )}
            </div>
          ))
        ) : (
          <EmptyState
            icon="📖"
            message="No reference sources"
            hint="Add documentation symlinks to ~/.lovstudio/docs/reference/"
          />
        )}
      </div>
    </ConfigPage>
  );
}

// ============================================================================
// Output Styles Feature
// ============================================================================

function OutputStylesView() {
  return (
    <ConfigPage>
      <PageHeader title="Output Styles" subtitle="Response formatting styles" />
      <EmptyState icon="🎨" message="Coming soon" hint="Output styles will be available in a future update" />
    </ConfigPage>
  );
}

// ============================================================================
// Commands Feature
// ============================================================================

type CommandSortKey = "usage" | "name";
type SortDirection = "asc" | "desc";

function CommandsView({
  onSelect,
  marketplaceItems,
  onMarketplaceSelect,
  onBrowseMore,
}: {
  onSelect: (cmd: LocalCommand, scrollToChangelog?: boolean) => void;
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
  onBrowseMore?: () => void;
}) {
  const [commands, setCommands] = useState<LocalCommand[]>([]);
  const [commandStats, setCommandStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = usePersistedState<CommandSortKey>("lovcode:commands:sortKey", "usage");
  const [sortDir, setSortDir] = usePersistedState<SortDirection>("lovcode:commands:sortDir", "desc");
  const [showDeprecated, setShowDeprecated] = usePersistedState("lovcode:commands:showDeprecated", false);
  const [viewMode, setViewMode] = usePersistedState<"flat" | "tree">("lovcode:commands:viewMode", "tree");
  const [expandedFoldersArr, setExpandedFoldersArr] = usePersistedState<string[]>("lovcode:commands:expandedFolders", []);
  const expandedFolders = useMemo(() => new Set(expandedFoldersArr), [expandedFoldersArr]);
  const [deprecateDialogOpen, setDeprecateDialogOpen] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<LocalCommand | null>(null);
  const [replacementCommand, setReplacementCommand] = useState("");
  const [deprecationNote, setDeprecationNote] = useState("");
  const { search, setSearch, filtered } = useSearch(commands, ["name", "description"]);

  // Calculate usage count including aliases
  const getUsageCount = (cmd: LocalCommand) => {
    const mainCount = commandStats[cmd.name.slice(1)] || 0;
    const aliasCount = cmd.aliases.reduce((sum, alias) => {
      const key = alias.startsWith('/') ? alias.slice(1) : alias;
      return sum + (commandStats[key] || 0);
    }, 0);
    return mainCount + aliasCount;
  };

  const refreshCommands = () => {
    invoke<LocalCommand[]>("list_local_commands").then(setCommands);
  };

  const handleDeprecate = async () => {
    if (!selectedCommand) return;
    try {
      await invoke("deprecate_command", {
        path: selectedCommand.path,
        replacedBy: replacementCommand || null,
        note: deprecationNote || null,
      });
      setDeprecateDialogOpen(false);
      setSelectedCommand(null);
      setReplacementCommand("");
      setDeprecationNote("");
      refreshCommands();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRestore = async (cmd: LocalCommand) => {
    try {
      await invoke("restore_command", { path: cmd.path });
      refreshCommands();
    } catch (e) {
      console.error(e);
    }
  };

  const openDeprecateDialog = (cmd: LocalCommand) => {
    setSelectedCommand(cmd);
    setDeprecateDialogOpen(true);
  };

  useEffect(() => {
    // Load commands first for instant display
    invoke<LocalCommand[]>("list_local_commands")
      .then(setCommands)
      .finally(() => setLoading(false));
  }, []);

  // Load stats after initial render to avoid blocking UI
  useEffect(() => {
    if (!loading) {
      invoke<Record<string, number>>("get_command_stats").then(setCommandStats);
    }
  }, [loading]);

  // Filter by status: show deprecated/archived only when toggle is on OR when searching
  const statusFiltered = filtered.filter((cmd) => {
    if (cmd.status === "active") return true;
    // Show deprecated/archived when toggle is on or when actively searching
    return showDeprecated || search.length > 0;
  });

  // Sort filtered commands
  const sorted = [...statusFiltered].sort((a, b) => {
    // Always put deprecated/archived at the end
    if (a.status !== "active" && b.status === "active") return 1;
    if (a.status === "active" && b.status !== "active") return -1;

    if (sortKey === "usage") {
      const aCount = getUsageCount(a);
      const bCount = getUsageCount(b);
      return sortDir === "desc" ? bCount - aCount : aCount - bCount;
    } else {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "desc" ? -cmp : cmp;
    }
  });

  const toggleSort = (key: CommandSortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir(key === "usage" ? "desc" : "asc");
    }
  };

  // Count stats
  const activeCount = commands.filter((c) => c.status === "active").length;
  const deprecatedCount = commands.filter((c) => c.status !== "active").length;

  // Build tree structure for tree view (supports unlimited nesting)
  type FolderNode = { type: "folder"; name: string; path: string; childMap: Map<string, TreeNode> };
  type TreeNode = { type: "folder"; name: string; path: string; children: TreeNode[] } | { type: "command"; command: LocalCommand };

  const buildTree = (cmds: LocalCommand[]): TreeNode[] => {
    const root: Map<string, FolderNode | { type: "command"; command: LocalCommand }> = new Map();

    for (const cmd of cmds) {
      const match = cmd.path.match(/\.claude\/commands\/(.+)$/);
      const relativePath = match ? match[1] : cmd.name + ".md";
      const parts = relativePath.replace(/\.md$/, "").split("/");

      if (parts.length === 1) {
        root.set(cmd.name, { type: "command", command: cmd });
      } else {
        let currentLevel = root;
        let currentPath = "";
        for (let i = 0; i < parts.length - 1; i++) {
          const folderName = parts[i];
          currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
          let folder = currentLevel.get(folderName);
          if (!folder || folder.type !== "folder") {
            folder = { type: "folder", name: folderName, path: currentPath, childMap: new Map() };
            currentLevel.set(folderName, folder);
          }
          currentLevel = folder.childMap;
        }
        currentLevel.set(cmd.name, { type: "command", command: cmd });
      }
    }

    // Convert FolderNode to TreeNode and sort
    const convertAndSort = (map: Map<string, FolderNode | { type: "command"; command: LocalCommand }>): TreeNode[] => {
      const nodes: TreeNode[] = [];
      for (const node of map.values()) {
        if (node.type === "folder") {
          nodes.push({ type: "folder", name: node.name, path: node.path, children: convertAndSort(node.childMap) });
        } else {
          nodes.push(node);
        }
      }
      return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        if (a.type === "folder" && b.type === "folder") return a.name.localeCompare(b.name);
        if (a.type === "command" && b.type === "command") {
          if (sortKey === "usage") {
            const diff = getUsageCount(b.command) - getUsageCount(a.command);
            return sortDir === "desc" ? diff : -diff;
          }
          const cmp = a.command.name.localeCompare(b.command.name);
          return sortDir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    };

    return convertAndSort(root);
  };

  const tree = viewMode === "tree" ? buildTree(statusFiltered) : [];

  const toggleFolder = (path: string) => {
    setExpandedFoldersArr(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isFolder = node.type === "folder";
    // 文件夹正常缩进，命令文本对齐到父文件夹文本
    const indent = isFolder ? depth * 24 : Math.max(0, (depth - 1) * 24);
    const isExpanded = isFolder && expandedFolders.has(node.path);

    // 命令相关
    const cmd = !isFolder ? node.command : null;
    // 根路径时显示完整名称，文件夹下只显示最后一段
    const shortName = cmd ? (depth === 0 ? cmd.name : (cmd.name.split("/").pop() || cmd.name)) : "";
    const isInactive = cmd ? (cmd.status === "deprecated" || cmd.status === "archived") : false;
    const usageCount = cmd ? getUsageCount(cmd) : 0;

    return (
      <div key={isFolder ? node.path : cmd!.path} style={{ marginLeft: indent }}>
        <button
          onClick={() => isFolder ? toggleFolder(node.path) : onSelect(cmd!)}
          className={`w-full flex items-center gap-2 py-1.5 px-2 text-left rounded-md transition-colors ${
            isInactive ? "opacity-60 hover:opacity-100" : ""
          } hover:bg-muted/50`}
        >
          {/* 图标 */}
          {isFolder ? (
            <Folder className="w-4 h-4 text-primary" />
          ) : (
            <Terminal className={`w-4 h-4 ${isInactive ? "text-muted-foreground" : "text-primary"}`} />
          )}
          {/* 名称 */}
          <span className={`font-mono font-medium ${isInactive ? "text-muted-foreground" : "text-primary"}`}>
            {isFolder ? node.name : shortName}
          </span>
          {/* Badge: 数量或版本 */}
          {isFolder ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              {node.children.length}
            </span>
          ) : cmd?.version && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              v{cmd.version.replace(/^["']|["']$/g, '')}
            </span>
          )}
          {/* 使用次数 */}
          {!isFolder && usageCount > 0 && (
            <span
              className={`text-xs font-bold italic tabular-nums ${
                usageCount >= 100 ? "text-amber-500" :
                usageCount >= 50 ? "text-orange-500" :
                usageCount >= 10 ? "text-primary" : "text-muted-foreground"
              }`}
              title={`Used ${usageCount} times`}
            >
              ×{usageCount}
            </span>
          )}
          {/* Aliases indicator with hover dropdown */}
          {!isFolder && cmd?.aliases && cmd.aliases.length > 0 && (
            <span className="relative group/aliases">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/70 font-medium">
                +{cmd.aliases.length}
              </span>
              <div className="absolute left-0 top-full mt-1 hidden group-hover/aliases:block z-50 bg-popover border border-border rounded-md shadow-md p-2 min-w-max">
                <div className="text-xs text-muted-foreground mb-1">Aliases:</div>
                {cmd.aliases.map((alias, i) => (
                  <div key={i} className="font-mono text-xs text-primary">{alias}</div>
                ))}
              </div>
            </span>
          )}
          <span className="flex-1" />
          {/* 状态 Badge */}
          {cmd?.status === "deprecated" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">deprecated</span>
          )}
          {cmd?.status === "archived" && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-card-alt text-muted-foreground">archived</span>
          )}
          {/* 命令菜单 */}
          {!isFolder && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <span
                  role="button"
                  className="w-4 h-4 flex items-center justify-center cursor-pointer hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSelect(cmd!)}>
                  <HelpCircle className="w-4 h-4 mr-2" />
                  View Details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => cmd?.changelog && onSelect(cmd, true)}
                  disabled={!cmd?.changelog}
                  className={!cmd?.changelog ? "opacity-50" : ""}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  View Changelog
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => invoke("open_in_editor", { path: cmd!.path })}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open in Editor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(cmd!.path)}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Path
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isInactive ? (
                  <DropdownMenuItem onClick={() => handleRestore(cmd!)}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => openDeprecateDialog(cmd!)} className="text-amber-600">
                    <Archive className="w-4 h-4 mr-2" />
                    Deprecate
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </button>
        {isFolder && isExpanded && (
          <div className="space-y-1 mt-1">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <LoadingState message="Loading commands..." />;

  return (
    <ConfigPage>
      <PageHeader title="Commands" subtitle={`${activeCount} active, ${deprecatedCount} deprecated`} action={<BrowseMarketplaceButton onClick={onBrowseMore} />} />
      <div className="flex items-center gap-3 mb-6">
        <SearchInput
          placeholder="Search local & marketplace..."
          value={search}
          onChange={setSearch}
          className="flex-1 px-4 py-2 bg-card border border-border rounded-lg text-ink placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="text-xs">View</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={viewMode} onValueChange={(v) => setViewMode(v as "flat" | "tree")}>
              <DropdownMenuRadioItem value="tree">
                <FolderTree className="w-4 h-4 mr-2" /> Tree
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="flat">
                <List className="w-4 h-4 mr-2" /> Flat
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Sort</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => toggleSort("usage")}>
              {sortKey === "usage" && <Check className="w-4 h-4 mr-2" />}
              {sortKey !== "usage" && <span className="w-4 mr-2" />}
              Usage {sortKey === "usage" && (sortDir === "desc" ? "↓" : "↑")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleSort("name")}>
              {sortKey === "name" && <Check className="w-4 h-4 mr-2" />}
              {sortKey !== "name" && <span className="w-4 mr-2" />}
              Name {sortKey === "name" && (sortDir === "desc" ? "↓" : "↑")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={showDeprecated} onCheckedChange={setShowDeprecated}>
              Show deprecated
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Local results */}
      {viewMode === "flat" && sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((cmd) => (
            <CommandItemCard
              key={cmd.path}
              command={cmd}
              usageCount={getUsageCount(cmd)}
              onClick={() => onSelect(cmd)}
              onOpenInEditor={() => invoke("open_in_editor", { path: cmd.path })}
              onDeprecate={() => openDeprecateDialog(cmd)}
              onRestore={() => handleRestore(cmd)}
            />
          ))}
        </div>
      )}
      {viewMode === "tree" && tree.length > 0 && (
        <div className="space-y-1">
          {tree.map(node => renderTreeNode(node))}
        </div>
      )}

      {statusFiltered.length === 0 && !search && (
        <EmptyState icon="⚡" message="No commands found" hint="Create commands in ~/.claude/commands/" />
      )}

      {statusFiltered.length === 0 && search && (
        <p className="text-muted-foreground text-sm">No local commands match "{search}"</p>
      )}

      {/* Marketplace results */}
      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} onBrowseMore={onBrowseMore} />

      {/* Deprecate dialog */}
      <Dialog open={deprecateDialogOpen} onOpenChange={setDeprecateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deprecate {selectedCommand?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              This will move the file to <code>~/.claude/.commands/archived/</code>, outside the commands directory so Claude Code won't load it.
            </p>
            <div>
              <Label htmlFor="replacement">Replacement command (optional)</Label>
              <Input
                id="replacement"
                placeholder="/new-command"
                value={replacementCommand}
                onChange={(e) => setReplacementCommand(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="deprecation-note">Note (optional)</Label>
              <Input
                id="deprecation-note"
                placeholder="Reason for deprecation..."
                value={deprecationNote}
                onChange={(e) => setDeprecationNote(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeprecateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeprecate} className="bg-amber-600 hover:bg-amber-700">
              Deprecate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfigPage>
  );
}

function CommandItemCard({
  command,
  displayName,
  usageCount,
  onClick,
  onOpenInEditor,
  onDeprecate,
  onRestore,
}: {
  command: LocalCommand;
  displayName?: string;
  usageCount?: number;
  onClick: () => void;
  onOpenInEditor?: () => void;
  onDeprecate?: () => void;
  onRestore?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isDeprecated = command.status === "deprecated";
  const isArchived = command.status === "archived";
  const isInactive = isDeprecated || isArchived;

  const handleCopyPath = () => {
    navigator.clipboard.writeText(command.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 py-1.5 px-2 text-left rounded-md transition-colors ${
        isInactive ? "opacity-60 hover:opacity-100" : ""
      } hover:bg-muted/50`}
    >
      <Terminal className={`w-4 h-4 shrink-0 ${isInactive ? "text-muted-foreground" : "text-primary"}`} />
      <span className={`font-mono font-medium shrink-0 ${isInactive ? "text-muted-foreground" : "text-primary"}`}>
        {displayName ?? command.name}
      </span>
      {command.version && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium shrink-0">
          v{command.version.replace(/^["']|["']$/g, '')}
        </span>
      )}
      {usageCount !== undefined && usageCount > 0 && (
        <span
          className={`shrink-0 text-xs font-bold italic tabular-nums ${
            usageCount >= 100 ? "text-amber-500" :
            usageCount >= 50 ? "text-orange-500" :
            usageCount >= 10 ? "text-primary" : "text-muted-foreground"
          }`}
          title={`Used ${usageCount} times`}
        >
          ×{usageCount}
        </span>
      )}
      <span className="flex-1" /> {/* spacer */}
      {copied && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 shrink-0 animate-pulse">
          Copied!
        </span>
      )}
      {isDeprecated && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 shrink-0">
          deprecated
        </span>
      )}
      {isArchived && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-card-alt text-muted-foreground shrink-0">
          archived
        </span>
      )}
      <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-4 w-4 shrink-0 p-0" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onClick}>
              <HelpCircle className="w-4 h-4 mr-2" />
              View Details
            </DropdownMenuItem>
            {onOpenInEditor && (
              <DropdownMenuItem onClick={onOpenInEditor}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in Editor
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleCopyPath}>
              {copied ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? "Copied!" : "Copy Path"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isInactive && onRestore && (
              <DropdownMenuItem onClick={onRestore}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Restore
              </DropdownMenuItem>
            )}
            {!isInactive && onDeprecate && (
              <DropdownMenuItem onClick={onDeprecate} className="text-amber-600">
                <Archive className="w-4 h-4 mr-2" />
                Deprecate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
    </button>
  );
}

function CommandDetailView({
  command,
  onBack,
  onCommandUpdated,
  scrollToChangelog: shouldScrollToChangelog,
}: {
  command: LocalCommand;
  onBack: () => void;
  onCommandUpdated?: () => void;
  scrollToChangelog?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [deprecateDialogOpen, setDeprecateDialogOpen] = useState(false);
  const [replacementCommand, setReplacementCommand] = useState("");
  const [deprecationNote, setDeprecationNote] = useState("");
  const changelogRef = useRef<HTMLDivElement>(null);
  const [editingAliases, setEditingAliases] = useState(false);
  const [localAliases, setLocalAliases] = useState(command.aliases);
  const [aliasesInput, setAliasesInput] = useState(command.aliases.join(", "));

  const isDeprecated = command.status === "deprecated";
  const isArchived = command.status === "archived";
  const isInactive = isDeprecated || isArchived;

  const scrollToChangelog = () => {
    changelogRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Auto-scroll to changelog if requested
  useEffect(() => {
    if (shouldScrollToChangelog && command.changelog) {
      // Small delay to ensure DOM is ready
      setTimeout(scrollToChangelog, 100);
    }
  }, [shouldScrollToChangelog, command.changelog]);

  const handleDeprecate = async () => {
    setLoading(true);
    try {
      await invoke("deprecate_command", {
        path: command.path,
        replacedBy: replacementCommand || null,
        note: deprecationNote || null,
      });
      setDeprecateDialogOpen(false);
      onCommandUpdated?.();
      onBack();
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    try {
      await invoke("restore_command", { path: command.path });
      onCommandUpdated?.();
      onBack();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAliases = async () => {
    const aliases = aliasesInput
      .split(",")
      .map(a => a.trim())
      .filter(a => a.length > 0);
    try {
      await invoke("update_command_aliases", { path: command.path, aliases });
      setLocalAliases(aliases);
      setEditingAliases(false);
      onCommandUpdated?.();
    } catch (e) {
      console.error("Failed to update aliases:", e);
    }
  };

  // Generate default alias placeholder from command name (e.g., /lovstudio/better/readme -> /better-readme)
  const defaultAliasPlaceholder = (() => {
    const parts = command.name.split("/").filter(Boolean);
    if (parts.length <= 1) return "";
    // Take last two parts and join with hyphen
    const lastParts = parts.slice(-2);
    return "/" + lastParts.join("-");
  })();

  const handleAliasKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveAliases();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = aliasesInput.trimEnd();
      if (!trimmed && defaultAliasPlaceholder) {
        // Accept placeholder when input is empty
        setAliasesInput(defaultAliasPlaceholder + ", ");
      } else if (trimmed && !trimmed.endsWith(",")) {
        // Add comma and space to continue
        setAliasesInput(trimmed + ", ");
      }
    }
  };

  return (
    <ConfigPage>
      <DetailHeader
        title={command.name}
        description={command.description}
        backLabel="Commands"
        onBack={onBack}
        path={command.path}
        onOpenPath={(p) => invoke("open_in_editor", { path: p })}
        badge={command.version ? `v${command.version.replace(/^["']|["']$/g, '')}` : null}
        statusBadge={
          isDeprecated ? { label: "deprecated", variant: "warning" as const } :
          isArchived ? { label: "archived", variant: "muted" as const } :
          null
        }
        menuItems={
          isInactive
            ? [{ label: "Restore", onClick: handleRestore, icon: RotateCcw, disabled: loading }]
            : [{ label: "Deprecate", onClick: () => setDeprecateDialogOpen(true), icon: Archive, variant: "danger" as const }]
        }
        hasChangelog={!!command.changelog}
        onChangelogClick={scrollToChangelog}
      />

      {/* Deprecation warning */}
      {isDeprecated && command.deprecated_by && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-sm text-amber-600">
            ⚠️ This command is deprecated. Use <span className="font-mono font-medium">{command.deprecated_by}</span> instead.
          </p>
        </div>
      )}

      {/* Archive notice */}
      {isArchived && (
        <div className="mb-4 p-3 rounded-lg bg-card-alt border border-border">
          <p className="text-sm text-muted-foreground">
            📦 This is an archived version. It is not loaded by Claude Code.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {command.argument_hint && (
          <DetailCard label="Arguments">
            <p className="font-mono text-ink">{command.argument_hint}</p>
          </DetailCard>
        )}
        {command.allowed_tools && (
          <DetailCard label="Allowed Tools">
            <p className="font-mono text-sm text-ink">{command.allowed_tools}</p>
          </DetailCard>
        )}
        {/* Aliases section */}
        <DetailCard label="Aliases" action={
          editingAliases ? (
            <div className="flex gap-2">
              <button onClick={() => { setEditingAliases(false); setAliasesInput(localAliases.join(", ")); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              <button onClick={handleSaveAliases} className="text-xs text-primary hover:text-primary/80">Save</button>
            </div>
          ) : (
            <button onClick={() => setEditingAliases(true)} className="text-xs text-muted-foreground hover:text-primary">Edit</button>
          )
        }>
          {editingAliases ? (
            <Input
              value={aliasesInput}
              onChange={(e) => setAliasesInput(e.target.value)}
              onKeyDown={handleAliasKeyDown}
              placeholder={defaultAliasPlaceholder || "/old-name"}
              className="font-mono text-sm"
              autoFocus
            />
          ) : localAliases.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {localAliases.map((alias, i) => (
                <span key={i} className="font-mono text-sm px-2 py-0.5 rounded bg-primary/10 text-primary">{alias}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No aliases. Add previous command names to aggregate usage stats.</p>
          )}
        </DetailCard>
        <ContentCard label="Content" content={command.content} />
        {command.changelog && (
          <div ref={changelogRef}>
            <ContentCard label="Changelog" content={command.changelog} />
          </div>
        )}
      </div>

      {/* Deprecate dialog */}
      <Dialog open={deprecateDialogOpen} onOpenChange={setDeprecateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deprecate {command.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              This will move the file to <code>~/.claude/.commands/archived/</code>, outside the commands directory so Claude Code won't load it.
            </p>
            <div>
              <Label htmlFor="replacement">Replacement command (optional)</Label>
              <Input
                id="replacement"
                placeholder="/new-command"
                value={replacementCommand}
                onChange={(e) => setReplacementCommand(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="deprecation-note">Note (optional)</Label>
              <Input
                id="deprecation-note"
                placeholder="Reason for deprecation..."
                value={deprecationNote}
                onChange={(e) => setDeprecationNote(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeprecateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeprecate} disabled={loading} className="bg-amber-600 hover:bg-amber-700">
              Deprecate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfigPage>
  );
}

// ============================================================================
// MCP Feature
// ============================================================================

function McpView({
  marketplaceItems,
  onMarketplaceSelect,
  onBrowseMore,
}: {
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
  onBrowseMore?: () => void;
}) {
  const { formatPath } = useAppConfig();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [mcpConfigPath, setMcpConfigPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingEnv, setEditingEnv] = useState<{ server: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    Promise.all([
      invoke<ClaudeSettings>("get_settings"),
      invoke<string>("get_mcp_config_path"),
    ])
      .then(([settings, path]) => {
        setServers(settings.mcp_servers);
        setMcpConfigPath(path);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleEnvClick = (serverName: string, key: string, currentValue: string) => {
    setEditingEnv({ server: serverName, key });
    setEditValue(currentValue);
  };

  const handleEnvSave = async () => {
    if (!editingEnv) return;
    await invoke("update_mcp_env", {
      serverName: editingEnv.server,
      envKey: editingEnv.key,
      envValue: editValue,
    });
    setServers((prev) =>
      prev.map((s) =>
        s.name === editingEnv.server ? { ...s, env: { ...s.env, [editingEnv.key]: editValue } } : s
      )
    );
    setEditingEnv(null);
  };

  const getMcpUrl = (server: McpServer): string | null => {
    if (server.command === "npx" && server.args.length > 0) {
      const pkg = server.args.find((a) => a.startsWith("@") || a.startsWith("mcp-"));
      if (pkg) return `https://www.npmjs.com/package/${pkg}`;
    }
    return null;
  };

  if (loading) return <LoadingState message="Loading MCP servers..." />;

  const filtered = servers.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ConfigPage>
      <PageHeader
        title="MCP Servers"
        subtitle={`${servers.length} configured servers`}
        action={
          <div className="flex items-center gap-2">
            <BrowseMarketplaceButton onClick={onBrowseMore} />
            {mcpConfigPath && (
              <button
                onClick={() => invoke("open_in_editor", { path: mcpConfigPath })}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors"
                title={formatPath(mcpConfigPath)}
              >
                <span>Open .claude.json</span>
              </button>
            )}
          </div>
        }
      />
      <SearchInput placeholder="Search local & marketplace..." value={search} onChange={setSearch} />

      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((server) => (
            <div key={server.name} className="bg-card rounded-xl p-4 border border-border">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="font-medium text-ink flex items-center gap-2">
                    {server.name}
                    {getMcpUrl(server) && (
                      <button
                        onClick={() => openUrl(getMcpUrl(server)!)}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Open in npm"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </p>
                  {server.description && <p className="text-sm text-muted-foreground mt-1">{server.description}</p>}
                </div>
              </div>
              <div className="bg-card-alt rounded-lg p-3 font-mono text-xs">
                <p className="text-muted-foreground">
                  <span className="text-ink">{server.command}</span>
                  {server.args.length > 0 && <span className="text-muted-foreground"> {server.args.join(" ")}</span>}
                </p>
              </div>
              {Object.keys(server.env).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(server.env).map(([key, value]) =>
                    editingEnv?.server === server.name && editingEnv?.key === key ? (
                      <div key={key} className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">{key}=</span>
                        <input
                          autoFocus
                          className="text-xs px-2 py-1 rounded bg-canvas border border-border text-ink w-40"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEnvSave();
                            if (e.key === "Escape") setEditingEnv(null);
                          }}
                          onBlur={handleEnvSave}
                        />
                      </div>
                    ) : (
                      <button
                        key={key}
                        onClick={() => handleEnvClick(server.name, key, value)}
                        className="text-xs bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary/20 transition-colors cursor-pointer"
                        title={`Click to edit ${key}`}
                      >
                        {key}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && !search && (
        <EmptyState icon="🔌" message="No MCP servers configured" hint="Add servers to mcpServers in ~/.claude/settings.json" />
      )}

      {filtered.length === 0 && search && (
        <p className="text-muted-foreground text-sm">No local MCP servers match "{search}"</p>
      )}

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} onBrowseMore={onBrowseMore} />
    </ConfigPage>
  );
}

// ============================================================================
// Skills Feature
// ============================================================================

function SkillsView({
  onSelect,
  marketplaceItems,
  onMarketplaceSelect,
  onBrowseMore,
}: {
  onSelect: (skill: LocalSkill) => void;
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
  onBrowseMore?: () => void;
}) {
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const { search, setSearch, filtered } = useSearch(skills, ["name", "description"]);

  useEffect(() => {
    invoke<LocalSkill[]>("list_local_skills")
      .then(setSkills)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading skills..." />;

  return (
    <ConfigPage>
      <PageHeader title="Skills" subtitle={`${skills.length} skills in ~/.claude/skills`} action={<BrowseMarketplaceButton onClick={onBrowseMore} />} />
      <SearchInput placeholder="Search local & marketplace..." value={search} onChange={setSearch} />

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((skill) => (
            <ItemCard key={skill.name} name={skill.name} description={skill.description} onClick={() => onSelect(skill)} />
          ))}
        </div>
      )}

      {filtered.length === 0 && !search && (
        <EmptyState icon="🎯" message="No skills found" hint="Skills are stored as SKILL.md in ~/.claude/skills/" />
      )}

      {filtered.length === 0 && search && (
        <p className="text-muted-foreground text-sm">No local skills match "{search}"</p>
      )}

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} onBrowseMore={onBrowseMore} />
    </ConfigPage>
  );
}

function SkillDetailView({ skill, onBack }: { skill: LocalSkill; onBack: () => void }) {
  return (
    <ConfigPage>
      <DetailHeader
        title={skill.name}
        description={skill.description}
        backLabel="Skills"
        onBack={onBack}
        path={skill.path}
        onOpenPath={(p) => invoke("open_in_editor", { path: p })}
      />
      <div className="space-y-4">
        <ContentCard label="Content" content={skill.content} />
      </div>
    </ConfigPage>
  );
}

// ============================================================================
// Hooks Feature
// ============================================================================

function HooksView({
  marketplaceItems,
  onMarketplaceSelect,
  onBrowseMore,
}: {
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
  onBrowseMore?: () => void;
}) {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    invoke<ClaudeSettings>("get_settings")
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading hooks..." />;

  const hooks = settings?.hooks as Record<string, unknown[]> | null;
  const hookEntries = hooks ? Object.entries(hooks) : [];
  const filtered = hookEntries.filter(([eventType]) =>
    eventType.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ConfigPage>
      <PageHeader title="Hooks" subtitle="Automation triggers in ~/.claude/settings.json" action={<BrowseMarketplaceButton onClick={onBrowseMore} />} />
      <SearchInput placeholder="Search local & marketplace..." value={search} onChange={setSearch} />

      {filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map(([eventType, handlers]) => (
            <div key={eventType} className="bg-card rounded-xl p-4 border border-border">
              <p className="text-sm font-medium text-primary mb-3">{eventType}</p>
              <div className="space-y-2">
                {Array.isArray(handlers) && handlers.map((handler, i) => (
                  <pre key={i} className="bg-card-alt rounded-lg p-3 text-xs font-mono text-ink overflow-x-auto">
                    {JSON.stringify(handler, null, 2)}
                  </pre>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && !search && (
        <EmptyState icon="🪝" message="No hooks configured" hint="Add hooks to ~/.claude/settings.json" />
      )}

      {filtered.length === 0 && search && (
        <p className="text-muted-foreground text-sm">No local hooks match "{search}"</p>
      )}

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} onBrowseMore={onBrowseMore} />
    </ConfigPage>
  );
}

// ============================================================================
// Settings Feature
// ============================================================================

function SettingsView({
  marketplaceItems,
  onMarketplaceSelect,
  onBrowseMore,
}: {
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
  onBrowseMore?: () => void;
}) {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [settingsPath, setSettingsPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      invoke<ClaudeSettings>("get_settings"),
      invoke<ContextFile[]>("get_context_files"),
      invoke<string>("get_settings_path"),
    ])
      .then(([s, c, p]) => {
        setSettings(s);
        setContextFiles(c.filter(f => f.scope === "global"));
        setSettingsPath(p);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading settings..." />;

  const hasContent = settings?.raw || contextFiles.length > 0;

  // Filter context files by search
  const filteredContextFiles = contextFiles.filter(
    (f) => f.name.toLowerCase().includes(search.toLowerCase())
  );

  // Check if settings JSON contains search term
  const settingsMatchSearch = !search || JSON.stringify(settings?.raw || {}).toLowerCase().includes(search.toLowerCase());

  return (
    <ConfigPage>
      <PageHeader title="Settings" subtitle="User configuration (~/.claude)" action={<BrowseMarketplaceButton onClick={onBrowseMore} />} />
      <SearchInput placeholder="Search local & marketplace..." value={search} onChange={setSearch} />

      {!hasContent && !search && (
        <EmptyState icon="⚙️" message="No configuration found" hint="Create ~/.claude/settings.json or CLAUDE.md" />
      )}

      {(filteredContextFiles.length > 0 || (settingsMatchSearch && settings?.raw)) && (
        <div className="space-y-4">
          {/* Context Section */}
          {filteredContextFiles.length > 0 && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2 border-b border-border">
                <span className="text-sm font-medium text-ink">📄 Context ({filteredContextFiles.length})</span>
              </div>
              <div className="p-3 space-y-1">
                {filteredContextFiles.map((file) => (
                  <ContextFileItem key={file.path} file={file} />
                ))}
              </div>
            </div>
          )}

          {/* Configuration Section */}
          {settingsMatchSearch && settings?.raw && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2 border-b border-border">
                <span className="text-sm font-medium text-ink">⚙️ Configuration</span>
              </div>
              <div className="p-3">
                <ConfigFileItem
                  name="settings.json"
                  path={settingsPath}
                  content={settings.raw}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {search && filteredContextFiles.length === 0 && !settingsMatchSearch && (
        <p className="text-muted-foreground text-sm">No local settings match "{search}"</p>
      )}

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} onBrowseMore={onBrowseMore} />
    </ConfigPage>
  );
}

// ============================================================================
// Marketplace Feature
// ============================================================================

function MarketplaceView({
  initialCategory,
  onSelectTemplate,
}: {
  initialCategory?: TemplateCategory;
  onSelectTemplate: (template: TemplateComponent, category: TemplateCategory) => void;
}) {
  const [catalog, setCatalog] = useState<TemplatesCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeCategory = initialCategory || "commands";
  const [search, setSearch] = useState("");

  useEffect(() => {
    invoke<TemplatesCatalog>("get_templates_catalog")
      .then(setCatalog)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading templates catalog..." />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <span className="text-4xl mb-4">❌</span>
        <p className="text-ink font-medium mb-2">Failed to load templates</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">{error}</p>
      </div>
    );
  }

  if (!catalog) return null;

  const components = catalog[activeCategory] || [];
  const filtered = components.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.description?.toLowerCase().includes(search.toLowerCase()) ||
    c.category.toLowerCase().includes(search.toLowerCase())
  );
  const sorted = [...filtered].sort((a, b) => (b.downloads || 0) - (a.downloads || 0));

  const categoryInfo = TEMPLATE_CATEGORIES.find(c => c.key === activeCategory);

  return (
    <ConfigPage>
      <PageHeader
        title={categoryInfo?.label || "Marketplace"}
        subtitle={`Browse and install ${categoryInfo?.label.toLowerCase()} templates`}
      />

      <SearchInput
        placeholder={`Search ${categoryInfo?.label.toLowerCase()}...`}
        value={search}
        onChange={setSearch}
      />

      {/* Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((template) => (
          <button
            key={template.path}
            onClick={() => onSelectTemplate(template, activeCategory)}
            className="text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="font-medium text-ink truncate">{template.name}</p>
              {template.downloads != null && (
                <span className="text-xs text-muted-foreground shrink-0">↓{template.downloads}</span>
              )}
            </div>
            {template.description && <p className="text-sm text-muted-foreground line-clamp-2">{template.description}</p>}
            <p className="text-xs text-muted-foreground/60 mt-2">{template.category}</p>
          </button>
        ))}
      </div>

      {sorted.length === 0 && <EmptyState icon="📦" message="No templates found" />}
    </ConfigPage>
  );
}

function TemplateDetailView({
  template,
  category,
  onBack,
  onNavigateToInstalled,
}: {
  template: TemplateComponent;
  category: TemplateCategory;
  onBack: () => void;
  onNavigateToInstalled?: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (category === "mcps") {
      invoke<boolean>("check_mcp_installed", { name: template.name }).then(setInstalled);
    }
  }, [category, template.name]);

  const handleUninstall = async () => {
    if (category !== "mcps") return;

    setUninstalling(true);
    setError(null);

    try {
      await invoke("uninstall_mcp_template", { name: template.name });
      setInstalled(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setUninstalling(false);
    }
  };

  const handleInstall = async () => {
    if (!template.content) {
      setError("No content available for this template");
      return;
    }

    setInstalling(true);
    setError(null);

    try {
      switch (category) {
        case "commands":
        case "agents":
        case "skills":
          await invoke("install_command_template", { name: template.name, content: template.content });
          break;
        case "mcps":
          await invoke("install_mcp_template", { name: template.name, config: template.content });
          break;
        case "hooks":
          await invoke("install_hook_template", { name: template.name, config: template.content });
          break;
        case "settings":
        case "output-styles":
          await invoke("install_setting_template", { config: template.content });
          break;
      }
      setInstalled(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const categoryInfo = TEMPLATE_CATEGORIES.find(c => c.key === category);

  return (
    <ConfigPage>
      <header className="mb-6">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-ink mb-2 flex items-center gap-1 text-sm"
        >
          <span>←</span> {categoryInfo?.label}
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">{template.name}</h1>
            {template.description && <p className="text-muted-foreground mt-2">{template.description}</p>}
            <p className="font-mono text-xs text-muted-foreground mt-2">{template.path}</p>
            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span>{categoryInfo?.icon} {categoryInfo?.label}</span>
              <span>•</span>
              <span>{template.category}</span>
              {template.downloads != null && (
                <>
                  <span>•</span>
                  <span>↓ {template.downloads} downloads</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {installed && onNavigateToInstalled && (
              <button
                onClick={onNavigateToInstalled}
                className="px-4 py-2 rounded-lg font-medium transition-colors border border-border hover:bg-card-alt"
              >
                View
              </button>
            )}
            {installed && category === "mcps" ? (
              <button
                onClick={handleUninstall}
                disabled={uninstalling}
                className="px-4 py-2 rounded-lg font-medium transition-colors bg-red-500/10 text-red-600 hover:bg-red-500/20"
              >
                {uninstalling ? "Uninstalling..." : "Uninstall"}
              </button>
            ) : (
              <button
                onClick={handleInstall}
                disabled={installing || installed}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  installed
                    ? "bg-green-500/20 text-green-600"
                    : installing
                      ? "bg-card-alt text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {installed ? "✓ Installed" : installing ? "Installing..." : "Install"}
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 text-red-600 rounded-lg text-sm">{error}</div>
        )}
      </header>

      {template.content && (
        <DetailCard label="Content Preview">
          <div className="prose prose-sm max-w-none prose-neutral prose-pre:bg-card-alt prose-pre:text-ink prose-code:text-ink">
            {category === "mcps" || category === "hooks" || category === "settings" ? (
              <pre className="bg-card-alt rounded-lg p-3 text-xs font-mono overflow-x-auto text-ink whitespace-pre-wrap break-words">
                {template.content}
              </pre>
            ) : (
              <Markdown>{template.content}</Markdown>
            )}
          </div>
        </DetailCard>
      )}
    </ConfigPage>
  );
}

// ============================================================================
// Feature TODO Placeholder
// ============================================================================

function FeatureTodo({ feature }: { feature: FeatureType }) {
  const feat = FEATURES.find(f => f.type === feature);

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6">
      <span className="text-6xl mb-4">{feat?.icon || "🚧"}</span>
      <h1 className="font-serif text-2xl font-semibold text-ink mb-2">
        {feat?.label}
      </h1>
      <p className="text-muted-foreground text-center max-w-md mb-6">
        {feat?.description}
      </p>
      <div className="px-4 py-2 rounded-lg bg-card-alt text-muted-foreground text-sm">
        Coming soon
      </div>
    </div>
  );
}

// ============================================================================
// Chat Feature Components
// ============================================================================

type SortKey = "recent" | "sessions" | "name";
type ChatViewMode = "projects" | "sessions" | "chats";

function VirtualChatList({
  chats,
  onSelectChat,
  formatPath,
  hasMore,
  loadMore,
  loadingMore,
}: {
  chats: (ChatMessage | SearchResult)[];
  onSelectChat: (c: ChatMessage) => void;
  formatPath: (p: string) => string;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const ITEM_HEIGHT = 110; // Approximate height of each chat item

  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  // Infinite scroll: load more when near bottom
  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 200;
    if (nearBottom && hasMore && !loadingMore) {
      loadMore();
    }
  }, [hasMore, loadMore, loadingMore]);

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="h-[calc(100vh-320px)] overflow-auto -mr-4 pr-4"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const chat = chats[virtualItem.index];
          return (
            <div
              key={chat.uuid}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="pb-3"
            >
              <button
                onClick={() => onSelectChat(chat)}
                className="w-full h-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    chat.role === "user" ? "bg-primary/15 text-primary" : "bg-card-alt text-muted-foreground"
                  }`}>
                    {chat.role}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {chat.timestamp ? new Date(chat.timestamp).toLocaleString() : ""}
                  </span>
                  {"score" in chat && (
                    <span className="text-xs text-muted-foreground">
                      · score: {(chat as SearchResult).score.toFixed(2)}
                    </span>
                  )}
                </div>
                <p className="text-ink line-clamp-2">{chat.content}</p>
                <p className="text-xs text-muted-foreground mt-2 truncate">
                  {formatPath(chat.project_path)} · {chat.session_summary || "Untitled"}
                </p>
              </button>
            </div>
          );
        })}
      </div>
      {loadingMore && (
        <div className="py-4 text-center text-muted-foreground text-sm">Loading more...</div>
      )}
    </div>
  );
}

function ProjectList({
  onSelectProject,
  onSelectSession,
  onSelectChat,
}: {
  onSelectProject: (p: Project) => void;
  onSelectSession: (s: Session) => void;
  onSelectChat: (c: ChatMessage) => void;
}) {
  const { formatPath } = useAppConfig();
  const [viewMode, setViewMode] = usePersistedState<ChatViewMode>("lovcode:chatViewMode", "projects");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [allSessions, setAllSessions] = useState<Session[] | null>(null);
  const [allChats, setAllChats] = useState<ChatMessage[] | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMoreChats, setLoadingMoreChats] = useState(false);
  const [totalChats, setTotalChats] = useState(0);
  const CHATS_PAGE_SIZE = 50;
  const [sortBy, setSortBy] = usePersistedState<SortKey>("lovcode:allProjects:sortBy", "recent");
  const [hideEmptySessions, setHideEmptySessions] = usePersistedState("lovcode-hide-empty-sessions-all", false);
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);
  const [indexBuilt, setIndexBuilt] = useState(false);

  // Lazy load projects only when needed
  useEffect(() => {
    if (viewMode === "projects" && projects === null && !loadingProjects) {
      setLoadingProjects(true);
      invoke<Project[]>("list_projects")
        .then(setProjects)
        .finally(() => setLoadingProjects(false));
    }
  }, [viewMode, projects, loadingProjects]);

  // Lazy load sessions only when needed
  useEffect(() => {
    if (viewMode === "sessions" && allSessions === null && !loadingSessions) {
      setLoadingSessions(true);
      invoke<Session[]>("list_all_sessions")
        .then(setAllSessions)
        .finally(() => setLoadingSessions(false));
    }
  }, [viewMode, allSessions, loadingSessions]);

  // Lazy load chats only when needed
  useEffect(() => {
    if (viewMode === "chats" && allChats === null && !loadingChats) {
      setLoadingChats(true);
      invoke<ChatsResponse>("list_all_chats", { limit: CHATS_PAGE_SIZE })
        .then((res) => {
          setAllChats(res.items);
          setTotalChats(res.total);
        })
        .finally(() => setLoadingChats(false));
    }
  }, [viewMode, allChats, loadingChats]);

  // Load more chats
  const loadMoreChats = useCallback(async () => {
    if (loadingMoreChats || !allChats || allChats.length >= totalChats) return;
    setLoadingMoreChats(true);
    try {
      const res = await invoke<ChatsResponse>("list_all_chats", {
        limit: CHATS_PAGE_SIZE,
        offset: allChats.length
      });
      setAllChats(prev => [...(prev || []), ...res.items]);
    } finally {
      setLoadingMoreChats(false);
    }
  }, [allChats, totalChats, loadingMoreChats]);

  const loading = viewMode === "projects" ? loadingProjects : viewMode === "sessions" ? loadingSessions : loadingChats;

  // Search functions
  const handleBuildIndex = async () => {
    setIndexBuilding(true);
    setIndexStatus(null);
    try {
      await invoke<number>("build_search_index");
      setIndexBuilt(true);
    } catch (e) {
      setIndexStatus(`Error: ${e}`);
    } finally {
      setIndexBuilding(false);
    }
  };

  // Auto-build search index when switching to chats view
  useEffect(() => {
    if (viewMode === "chats" && !indexBuilt && !indexBuilding) {
      handleBuildIndex();
    }
  }, [viewMode, indexBuilt, indexBuilding]);

  // Debounced search effect
  useEffect(() => {
    if (viewMode !== "chats") return;

    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await invoke<SearchResult[]>("search_chats", { query: searchQuery, limit: 50 });
        setSearchResults(results);
      } catch (e) {
        if (String(e).includes("not built")) {
          setIndexStatus("Search index not built. Click 'Build Index' to create it.");
        }
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, viewMode]);

  const formatRelativeTime = (ts: number) => {
    const now = Date.now() / 1000;
    const diff = now - ts;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts * 1000).toLocaleDateString();
  };

  const sortedProjects = [...(projects || [])].sort((a, b) => {
    switch (sortBy) {
      case "recent": return b.last_active - a.last_active;
      case "sessions": return b.session_count - a.session_count;
      case "name": return a.path.localeCompare(b.path);
    }
  });

  const filteredSessions = hideEmptySessions ? (allSessions || []).filter(s => s.message_count > 0) : (allSessions || []);

  const sortedSessions = [...filteredSessions].sort((a, b) => {
    switch (sortBy) {
      case "recent": return b.last_modified - a.last_modified;
      case "sessions": return b.message_count - a.message_count;
      case "name": return (a.summary || "").localeCompare(b.summary || "");
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading {viewMode}...</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-ink">History</h1>
        <p className="text-muted-foreground mt-1">
          {viewMode === "projects"
            ? `${(projects || []).length} projects with Claude Code history`
            : viewMode === "sessions"
              ? `${filteredSessions.length} sessions${hideEmptySessions ? ` (${(allSessions || []).length - filteredSessions.length} hidden)` : ""}`
              : `${(allChats || []).length} / ${totalChats} messages${indexBuilt ? " · Index ready" : indexBuilding ? " · Building index..." : ""}`}
        </p>
      </header>

      {/* View Mode Tabs */}
      <div className="flex border-b border-border mb-4">
        <button
          onClick={() => setViewMode("projects")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "projects"
              ? "text-primary border-b-2 border-primary -mb-px"
              : "text-muted-foreground hover:text-ink"
          }`}
        >
          📁 Projects
        </button>
        <button
          onClick={() => setViewMode("sessions")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "sessions"
              ? "text-primary border-b-2 border-primary -mb-px"
              : "text-muted-foreground hover:text-ink"
          }`}
        >
          💬 Sessions
        </button>
        <button
          onClick={() => setViewMode("chats")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            viewMode === "chats"
              ? "text-primary border-b-2 border-primary -mb-px"
              : "text-muted-foreground hover:text-ink"
          }`}
        >
          🗨️ Chats
        </button>
      </div>

      {/* Sort & Filter Controls */}
      {viewMode !== "chats" && (
        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="flex gap-2">
            {([
              ["recent", "Recent"],
              ["sessions", viewMode === "projects" ? "Sessions" : "Messages"],
              ["name", "Name"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  sortBy === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-card-alt text-muted-foreground hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {viewMode === "sessions" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Switch checked={hideEmptySessions} onCheckedChange={setHideEmptySessions} />
              <span>Hide empty</span>
            </label>
          )}
        </div>
      )}

      {/* Search Controls for Chats */}
      {viewMode === "chats" && (
        <div className="mb-6 space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..."
                className="w-full px-3 py-2 pr-8 rounded-lg bg-card border border-border text-ink placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">...</span>
              )}
            </div>
            <button
              onClick={handleBuildIndex}
              disabled={indexBuilding}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card-alt text-muted-foreground hover:text-ink border border-border transition-colors disabled:opacity-50"
              title="Rebuild search index"
            >
              <RefreshCw className={`w-4 h-4 ${indexBuilding ? "animate-spin" : ""}`} />
              {indexBuilding ? "Building..." : "Rebuild"}
            </button>
          </div>
          {indexStatus && (
            <p className="text-xs text-muted-foreground">{indexStatus}</p>
          )}
          {searchQuery.trim() && searchResults !== null && (
            <p className="text-xs text-muted-foreground">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
            </p>
          )}
        </div>
      )}

      {/* Content List */}
      {viewMode === "projects" ? (
        <div className="space-y-3">
          {sortedProjects.map((project) => (
            <button
              key={project.id}
              onClick={() => onSelectProject(project)}
              className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
            >
              <p className="font-medium text-ink truncate">{formatPath(project.path)}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {project.session_count} session{project.session_count !== 1 ? "s" : ""} · {formatRelativeTime(project.last_active)}
              </p>
            </button>
          ))}
        </div>
      ) : viewMode === "sessions" ? (
        <div className="space-y-3">
          {sortedSessions.map((session) => (
            <button
              key={`${session.project_id}-${session.id}`}
              onClick={() => onSelectSession(session)}
              className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
            >
              <p className="font-medium text-ink line-clamp-2">
                {session.summary || "Untitled session"}
              </p>
              <p className="text-sm text-muted-foreground mt-1 truncate">
                {session.project_path ? formatPath(session.project_path) : session.project_id}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {session.message_count} messages · {formatRelativeTime(session.last_modified)}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <VirtualChatList
          chats={searchResults !== null ? searchResults : (allChats || [])}
          onSelectChat={onSelectChat}
          formatPath={formatPath}
          hasMore={searchResults === null && (allChats?.length || 0) < totalChats}
          loadMore={loadMoreChats}
          loadingMore={loadingMoreChats}
        />
      )}
    </div>
  );
}

function SessionList({
  projectId,
  projectPath,
  onBack,
  onSelect
}: {
  projectId: string;
  projectPath: string;
  onBack: () => void;
  onSelect: (s: Session) => void;
}) {
  const { formatPath } = useAppConfig();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [globalContext, setGlobalContext] = useState<ContextFile[]>([]);
  const [projectContext, setProjectContext] = useState<ContextFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [contextTab, setContextTab] = usePersistedState<"global" | "project">("lovcode:sessions:contextTab", "project");
  const [selectMode, setSelectMode] = usePersistedState("lovcode:sessionSelectMode", false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [hideEmptySessions, setHideEmptySessions] = usePersistedState("lovcode-hide-empty-sessions", false);
  const [userPromptsOnly, setUserPromptsOnly] = usePersistedState("lovcode:userPromptsOnly", false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const filteredSessions = hideEmptySessions ? sessions.filter(s => s.message_count > 0) : sessions;

  useEffect(() => {
    Promise.all([
      invoke<Session[]>("list_sessions", { projectId }),
      invoke<ContextFile[]>("get_context_files"),
      projectPath ? invoke<ContextFile[]>("get_project_context", { projectPath }) : Promise.resolve([]),
    ])
      .then(([s, global, project]) => {
        setSessions(s);
        setGlobalContext(global.filter(f => f.scope === "global"));
        setProjectContext(project);
      })
      .finally(() => setLoading(false));
  }, [projectId, projectPath]);

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await invoke<SearchResult[]>("search_chats", {
          query: searchQuery,
          limit: 50,
          projectId,
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, projectId]);

  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleString();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filteredSessions.map(s => s.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const exportSessions = async () => {
    setExporting(true);
    try {
      const selected = sessions.filter(s => selectedIds.has(s.id));
      const projectName = projectPath ? formatPath(projectPath) : projectId;
      const totalMessages = selected.reduce((sum, s) => sum + s.message_count, 0);
      const exportDate = new Date().toISOString();

      const frontmatter = `---
title: "${projectName} - Sessions Export"
description: "Claude Code conversation history exported from Lovcode"
project: "${projectPath || projectId}"
exported_at: ${exportDate}
sessions: ${selected.length}
total_messages: ${totalMessages}
generator: "Lovcode"
---`;

      const toAnchor = (s: string) => s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      const toc = selected.map((s, i) => {
        const title = `Session ${i + 1}: ${s.summary || "Untitled"}`;
        return `- [${title}](#${toAnchor(title)})`;
      }).join('\n');

      const parts: string[] = [];
      for (let i = 0; i < selected.length; i++) {
        const session = selected[i];
        const allMessages = await invoke<Message[]>("get_session_messages", { projectId, sessionId: session.id });
        const messages = userPromptsOnly ? allMessages.filter(m => m.role === "user") : allMessages;
        const sessionMd = messages.map(m => {
          const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
          return `### ${role}\n\n${m.content}`;
        }).join("\n\n---\n\n");
        const msgCountLabel = userPromptsOnly ? `${messages.length} prompts` : `${session.message_count} messages`;
        const meta = `_${msgCountLabel} · ${formatDate(session.last_modified)}_`;
        parts.push(`## Session ${i + 1}: ${session.summary || "Untitled"}\n\n${meta}\n\n${sessionMd}`);
      }
      const body = parts.join("\n\n<br>\n\n---\n\n<br>\n\n");
      const header = `# ${projectName}

> This file contains exported Claude Code conversation sessions.
> ${selected.length} sessions · ${totalMessages} messages`;
      const footer = `\n\n---\n\n_Powered by [Lovcode](https://github.com/MarkShawn2020/lovcode) · Exported at ${new Date().toLocaleString()}_`;
      const content = `${frontmatter}\n\n${header}\n\n### Table of Contents\n\n${toc}\n\n---\n\n${body}${footer}`;
      const defaultName = (projectPath ? formatPath(projectPath) : projectId).replace(/[/\\?%*:|"<>]/g, '-');
      const path = await save({
        defaultPath: `${defaultName}-sessions.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (path) {
        await invoke('write_file', { path, content });
      }
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <header className="mb-6">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-ink mb-2 flex items-center gap-1 text-sm"
        >
          <span>←</span> Projects
        </button>
        <h1 className="font-serif text-2xl font-semibold text-ink truncate">
          {projectPath ? formatPath(projectPath) : projectId}
        </h1>
      </header>

      <div className="relative mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search chats..."
          className="w-full max-w-md px-4 py-2 pr-8 bg-card border border-border rounded-lg text-ink placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">...</span>
        )}
      </div>

      {/* Context Card with Tabs */}
      {(globalContext.length > 0 || projectContext.length > 0) && (
        <div className="mb-4 bg-card rounded-xl border border-border overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setContextTab("project")}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                contextTab === "project"
                  ? "text-primary border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-ink"
              }`}
            >
              📁 Project ({projectContext.length})
            </button>
            <button
              onClick={() => setContextTab("global")}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                contextTab === "global"
                  ? "text-primary border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-ink"
              }`}
            >
              🌐 Global ({globalContext.length})
            </button>
          </div>

          {/* Content */}
          <div className="p-3 space-y-1">
            {(contextTab === "global" ? globalContext : projectContext).map((file) => (
              <ContextFileItem key={file.path} file={file} showIcon />
            ))}
            {(contextTab === "global" ? globalContext : projectContext).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No context files</p>
            )}
          </div>
        </div>
      )}

      {/* Search Results */}
      {searchQuery.trim() && searchResults !== null && (
        <>
          <p className="mb-4 text-xs text-muted-foreground uppercase tracking-wide">
            🔍 Search Results ({searchResults.length})
          </p>
          <div className="space-y-3 mb-6">
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No results found</p>
            ) : (
              searchResults.map((result) => (
                <div
                  key={result.uuid}
                  className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors cursor-pointer"
                  onClick={() => {
                    const session = sessions.find(s => s.id === result.session_id);
                    if (session) onSelect(session);
                  }}
                >
                  <p className="text-xs text-muted-foreground mb-1">
                    {result.session_summary || "Untitled session"}
                  </p>
                  <p className="text-sm text-ink line-clamp-3">{result.content}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {result.role} · {result.timestamp}
                  </p>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Sessions Header */}
      {!(searchQuery.trim() && searchResults !== null) && (
      <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">
          💬 Sessions ({hideEmptySessions ? `${filteredSessions.length}/${sessions.length}` : sessions.length})
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={hideEmptySessions} onCheckedChange={setHideEmptySessions} />
            <span>Hide empty</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={selectMode} onCheckedChange={(v) => { setSelectMode(v); if (!v) deselectAll(); }} />
            <span>Select</span>
          </label>
          {selectMode && (
            <>
              <button
                onClick={selectedIds.size === filteredSessions.length ? deselectAll : selectAll}
                className="text-xs px-2 py-1 rounded bg-card-alt hover:bg-border text-muted-foreground hover:text-ink transition-colors"
              >
                {selectedIds.size === filteredSessions.length ? "Deselect All" : "Select All"}
              </button>
              {selectedIds.size > 0 && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userPromptsOnly}
                      onChange={(e) => setUserPromptsOnly(e.target.checked)}
                      className="w-3 h-3 accent-primary cursor-pointer"
                    />
                    <span>Prompts only</span>
                  </label>
                  <button
                    onClick={exportSessions}
                    disabled={exporting}
                    className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {exporting ? "Exporting..." : `Export ${selectedIds.size}`}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {filteredSessions.map((session) => {
          const isSelected = selectedIds.has(session.id);
          return (
            <div
              key={session.id}
              onClick={selectMode ? () => toggleSelect(session.id) : () => onSelect(session)}
              className={`w-full text-left bg-card rounded-xl p-4 border transition-colors cursor-pointer ${
                selectMode && isSelected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink line-clamp-2">
                    {session.summary || "Untitled session"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {session.message_count} messages · {formatDate(session.last_modified)}
                  </p>
                </div>
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(session.id)}
                    className="w-4 h-4 accent-primary cursor-pointer mt-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}

function restoreSlashCommand(content: string): string {
  const pattern = /<command-message>[^<]*<\/command-message>\s*<command-name>(\/[^<]+)<\/command-name>(?:\s*<command-args>([^<]*)<\/command-args>)?/g;
  return content.replace(pattern, (_match, cmd, args) => {
    const trimmedArgs = (args || '').trim();
    return trimmedArgs ? `${cmd} ${trimmedArgs}` : cmd;
  });
}

// ============================================================================
// Export Dialog
// ============================================================================

type ExportFormat = "markdown" | "json";
type MarkdownStyle = "full" | "bullet" | "qa";

const exportFormatAtom = atomWithStorage<ExportFormat>("lovcode:exportFormat", "markdown");
const exportMdStyleAtom = atomWithStorage<MarkdownStyle>("lovcode:exportMdStyle", "full");
const exportTruncateAtom = atomWithStorage("lovcode:exportTruncate", false);
const exportSeparatorAtom = atomWithStorage("lovcode:exportSeparator", true);
const exportOriginalAtom = atomWithStorage("lovcode:exportOriginal", true);
const exportWatermarkAtom = atomWithStorage("lovcode:exportWatermark", true);
const exportJsonPrettyAtom = atomWithStorage("lovcode:exportJsonPretty", true);

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allMessages: Message[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  defaultName: string;
}

function ExportDialog({ open, onOpenChange, allMessages, selectedIds, onSelectedIdsChange, defaultName }: ExportDialogProps) {
  const [selectPreset, setSelectPreset] = useState<"all" | "user" | "custom">("all");

  // Apply preset when changed
  useEffect(() => {
    if (selectPreset === "all") {
      onSelectedIdsChange(new Set(allMessages.map(m => m.uuid)));
    } else if (selectPreset === "user") {
      onSelectedIdsChange(new Set(allMessages.filter(m => m.role === "user").map(m => m.uuid)));
    }
  }, [selectPreset, allMessages, onSelectedIdsChange]);

  // Initialize to all when dialog opens
  useEffect(() => {
    if (open) {
      setSelectPreset("all");
    }
  }, [open]);
  const [format, setFormat] = useAtom(exportFormatAtom);
  const [mdStyle, setMdStyle] = useAtom(exportMdStyleAtom);
  const [truncateBullet, setTruncateBullet] = useAtom(exportTruncateAtom);
  const [addSeparator, setAddSeparator] = useAtom(exportSeparatorAtom);
  const [exportOriginal, setExportOriginal] = useAtom(exportOriginalAtom);
  const [addWatermark, setAddWatermark] = useAtom(exportWatermarkAtom);
  const [jsonPretty, setJsonPretty] = useAtom(exportJsonPrettyAtom);

  // Filter and process messages based on original mode
  const messages = exportOriginal
    ? allMessages.filter(m => selectedIds.has(m.uuid) && !m.is_meta && !m.is_tool)
    : allMessages.filter(m => selectedIds.has(m.uuid));
  const processContent = (content: string) =>
    exportOriginal ? restoreSlashCommand(content) : content;

  const generateOutput = () => {
    if (format === "json") {
      const data = messages.map(m => ({
        role: m.role,
        content: processContent(m.content),
      }));
      return JSON.stringify(data, null, jsonPretty ? 2 : undefined);
    }

    const truncate = (text: string) => {
      if (!truncateBullet) return text;
      const firstLine = text.split('\n')[0].slice(0, 200);
      const isTruncated = text.includes('\n') || text.length > 200;
      return `${firstLine}${isTruncated ? '...' : ''}`;
    };

    // Find indices of user messages for separator logic
    const userIndices = messages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0);
    const needsSeparator = (i: number) => addSeparator && userIndices.includes(i) && i !== userIndices[0];

    let output: string;
    if (mdStyle === "bullet") {
      output = messages.map((m, i) => {
        const prefix = m.role === "user" ? "- **Q:**" : "- **A:**";
        const content = truncate(processContent(m.content));
        const line = `${prefix} ${content}`;
        return needsSeparator(i) ? `\n---\n\n${line}` : line;
      }).join("\n");
    } else if (mdStyle === "qa") {
      output = messages.map((m, i) => {
        const prefix = m.role === "user" ? "**Q:**" : "**A:**";
        const content = truncate(processContent(m.content));
        const line = `${prefix} ${content}`;
        return needsSeparator(i) ? `---\n\n${line}` : line;
      }).join("\n\n");
    } else {
      output = messages.map((m, i) => {
        const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
        const content = truncate(processContent(m.content));
        const line = `## ${role}\n\n${content}`;
        return needsSeparator(i) ? `---\n\n${line}` : line;
      }).join("\n\n");
    }
    if (addWatermark) {
      output += "\n\n---\n\n*Exported with [Lovcode](https://github.com/MarkShawn2020/lovcode) - A desktop companion app for AI coding tools*";
    }
    return output;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generateOutput());
    onOpenChange(false);
  };

  const handleExport = async () => {
    const ext = format === "json" ? "json" : "md";
    const filterName = format === "json" ? "JSON" : "Markdown";
    const path = await save({
      defaultPath: `${defaultName}.${ext}`,
      filters: [{ name: filterName, extensions: [ext] }]
    });
    if (path) {
      await invoke('write_file', { path, content: generateOutput() });
      onOpenChange(false);
    }
  };

  const preview = generateOutput();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex !flex-col max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Export {messages.length} Messages</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 py-2 border-b border-border items-center">
          <Label className="text-sm text-muted-foreground-foreground">Select</Label>
          <Select value={selectPreset} onValueChange={(v) => setSelectPreset(v as "all" | "user" | "custom")}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({allMessages.length})</SelectItem>
              <SelectItem value="user">User only ({allMessages.filter(m => m.role === "user").length})</SelectItem>
              <SelectItem value="custom">Custom ({selectedIds.size})</SelectItem>
            </SelectContent>
          </Select>

          <Label className="text-sm text-muted-foreground-foreground">Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="markdown">Markdown</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>

          {format === "markdown" && (
            <>
              <Label className="text-sm text-muted-foreground-foreground">Style</Label>
              <Select value={mdStyle} onValueChange={(v) => setMdStyle(v as MarkdownStyle)}>
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full</SelectItem>
                  <SelectItem value="qa">QA</SelectItem>
                  <SelectItem value="bullet">QA (list)</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}

          <Label className="text-sm text-muted-foreground">Options</Label>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={exportOriginal}
                onChange={(e) => setExportOriginal(e.target.checked)}
                className="w-4 h-4 accent-primary cursor-pointer"
              />
              <span>Original</span>
            </label>

            {format === "markdown" && (
              <>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={truncateBullet}
                    onChange={(e) => setTruncateBullet(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span>Truncate</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addSeparator}
                    onChange={(e) => setAddSeparator(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span>Separator</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addWatermark}
                    onChange={(e) => setAddWatermark(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span>Watermark</span>
                </label>
              </>
            )}

            {format === "json" && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={jsonPretty}
                  onChange={(e) => setJsonPretty(e.target.checked)}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                <span>Pretty</span>
              </label>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden mt-4">
          <div className="text-xs text-muted-foreground-foreground mb-2 shrink-0">Preview</div>
          <div className="flex-1 bg-card-alt rounded-lg p-4 text-sm text-ink overflow-auto font-mono whitespace-pre-wrap break-all">
            {preview}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleCopy}>
            Copy
          </Button>
          <Button onClick={handleExport}>
            Export
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageView({
  projectId,
  sessionId,
  summary,
  onBack
}: {
  projectId: string;
  sessionId: string;
  summary: string | null;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [originalChat, setOriginalChat] = usePersistedState("lovcode:originalChat", true);
  const [markdownPreview, setMarkdownPreview] = usePersistedState("lovcode:markdownPreview", false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  useEffect(() => {
    invoke<Message[]>("get_session_messages", { projectId, sessionId })
      .then(setMessages)
      .finally(() => setLoading(false));
  }, [projectId, sessionId]);

  const processContent = (content: string) => {
    return originalChat ? restoreSlashCommand(content) : content;
  };

  const filteredMessages = useMemo(() =>
    originalChat ? messages.filter(m => !m.is_meta && !m.is_tool) : messages,
    [messages, originalChat]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-8">
      <header className="mb-8">
        <button
          onClick={onBack}
          className="text-muted-foreground-foreground hover:text-foreground flex items-center gap-1 text-sm mb-4"
        >
          <span>←</span> Sessions
        </button>
        <div className="flex items-start justify-between gap-4">
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="cursor-context-menu flex-1 min-w-0">
                <h1 className="font-serif text-2xl font-semibold text-ink leading-tight mb-1">
                  {summary || "Session"}
                </h1>
                <p className="text-primary text-xs font-mono truncate">{sessionId}</p>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              <ContextMenuItem onClick={() => invoke("reveal_session_file", { projectId, sessionId })}>
                <FolderOpen size={14} />
                Reveal in Finder
              </ContextMenuItem>
              <ContextMenuItem onClick={() => invoke("open_session_in_editor", { projectId, sessionId })}>
                <ExternalLink size={14} />
                Open in Editor
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem
                checked={originalChat}
                onCheckedChange={setOriginalChat}
              >
                Original View
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem
                checked={markdownPreview}
                onCheckedChange={setMarkdownPreview}
              >
                Markdown Preview
              </ContextMenuCheckboxItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => setExportDialogOpen(true)}>
                <Download size={14} />
                Export
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-muted-foreground-foreground p-1 rounded hover:bg-card-alt shrink-0">
                <MoreHorizontal size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => invoke("reveal_session_file", { projectId, sessionId })}>
                <FolderOpen size={14} />
                Reveal in Finder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => invoke("open_session_in_editor", { projectId, sessionId })}>
                <ExternalLink size={14} />
                Open in Editor
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={originalChat}
                onCheckedChange={setOriginalChat}
              >
                Original View
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={markdownPreview}
                onCheckedChange={setMarkdownPreview}
              >
                Markdown Preview
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setExportDialogOpen(true)}>
                <Download size={14} />
                Export
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="space-y-4">
        {filteredMessages.map((msg) => {
          const displayContent = processContent(msg.content);
          return (
            <div
              key={msg.uuid}
              className={`group relative rounded-xl p-4 ${
                msg.role === "user"
                  ? "bg-card-alt"
                  : "bg-card border border-border"
              }`}
            >
              <CopyButton text={displayContent} />
              <p className="text-xs text-muted-foreground-foreground mb-2 uppercase tracking-wide">
                {msg.role}
              </p>
              <CollapsibleContent content={displayContent} markdown={markdownPreview} />
            </div>
          );
        })}
      </div>

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        allMessages={filteredMessages}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        defaultName={summary?.slice(0, 50).replace(/[/\\?%*:|"<>]/g, '-') || 'session'}
      />
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

function CollapsibleContent({ content, markdown }: { content: string; markdown: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflow, setIsOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setIsOverflow(el.scrollHeight > 40);
    }
  }, [content, markdown]);

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={`text-ink text-sm leading-relaxed ${
          !expanded && isOverflow ? "max-h-10 overflow-hidden" : ""
        }`}
      >
        {markdown ? (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        )}
      </div>
      {isOverflow && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-primary hover:text-primary/80"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }, [text]);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-3 right-3 p-1.5 rounded-md bg-card-alt/80 hover:bg-card-alt text-muted-foreground hover:text-ink transition-opacity opacity-0 group-hover:opacity-100"
      title="Copy"
    >
      {copied ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

export default App;
