import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { version } from "../package.json";
import { PanelLeft, User, ExternalLink, FolderOpen, ChevronDown, HelpCircle, Copy, Download, Check, MoreHorizontal } from "lucide-react";
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
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Button } from "./components/ui/button";
import { ContextFileItem, ConfigFileItem } from "./components/ContextFileItem";
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

function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored !== null ? JSON.parse(stored) : defaultValue;
  });

  const setPersistedState = useCallback((value: T) => {
    setState(value);
    localStorage.setItem(key, JSON.stringify(value));
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

type FeatureType = "chat" | "settings" | "commands" | "mcp" | "skills" | "hooks" | "sub-agents" | "output-styles" | "marketplace" | "kb-distill" | "kb-notes" | "kb-bookmarks";

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
  { type: "kb-distill", label: "Distill", icon: "💡", description: "Experience summaries", available: true, group: "knowledge" },
  { type: "kb-notes", label: "Notes", icon: "📝", description: "Markdown notes", available: false, group: "knowledge" },
  { type: "kb-bookmarks", label: "Bookmarks", icon: "🔖", description: "External links", available: false, group: "knowledge" },
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
  session: string;
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
  | { type: "command-detail"; command: LocalCommand }
  | { type: "mcp" }
  | { type: "skills" }
  | { type: "skill-detail"; skill: LocalSkill }
  | { type: "hooks" }
  | { type: "sub-agents" }
  | { type: "sub-agent-detail"; agent: LocalAgent }
  | { type: "output-styles" }
  | { type: "kb-distill" }
  | { type: "kb-distill-detail"; document: DistillDocument }
  | { type: "kb-notes" }
  | { type: "kb-bookmarks" }
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
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState("lovcode:sidebarCollapsed", false);
  const [marketplaceCategory, setMarketplaceCategory] = usePersistedState<TemplateCategory>("lovcode:marketplaceCategory", "commands");
  const [catalog, setCatalog] = useState<TemplatesCatalog | null>(null);
  const [homeDir, setHomeDir] = useState("");
  const [shortenPaths, setShortenPaths] = usePersistedState("lovcode:shortenPaths", true);
  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = usePersistedState<UserProfile>("lovcode:profile", { nickname: "", avatarUrl: "" });
  const [showProfileDialog, setShowProfileDialog] = useState(false);

  // Load home directory for path shortening
  useEffect(() => {
    invoke<string>("get_home_dir").then(setHomeDir).catch(() => {});
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
                      : view.type === "kb-notes"
                        ? "kb-notes"
                        : view.type === "kb-bookmarks"
                          ? "kb-bookmarks"
                          : view.type === "marketplace" || view.type === "template-detail"
                        ? "marketplace"
                        : view.type === "feature-todo"
                          ? view.feature
                          : null;

  const handleFeatureClick = (feature: FeatureType) => {
    switch (feature) {
      case "chat":
        setView({ type: "chat-projects" });
        break;
      case "settings":
        setView({ type: "settings" });
        break;
      case "commands":
        setView({ type: "commands" });
        break;
      case "mcp":
        setView({ type: "mcp" });
        break;
      case "skills":
        setView({ type: "skills" });
        break;
      case "hooks":
        setView({ type: "hooks" });
        break;
      case "sub-agents":
        setView({ type: "sub-agents" });
        break;
      case "output-styles":
        setView({ type: "output-styles" });
        break;
      case "kb-distill":
        setView({ type: "kb-distill" });
        break;
      case "kb-notes":
        setView({ type: "kb-notes" });
        break;
      case "kb-bookmarks":
        setView({ type: "kb-bookmarks" });
        break;
      case "marketplace":
        setView({ type: "marketplace" });
        break;
      default:
        setView({ type: "feature-todo", feature });
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
              onClick={() => setView({ type: "home" })}
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
              <CollapsibleBody className="pl-4">
                {FEATURES.filter(f => f.group === "knowledge").map((feature) => (
                  <FeatureButton
                    key={feature.type}
                    feature={feature}
                    active={currentFeature === feature.type}
                    onClick={() => handleFeatureClick(feature.type)}
                  />
                ))}
              </CollapsibleBody>
            </Collapsible>
          </div>

          {/* Marketplace Group */}
          <div className="px-2 mb-2">
            {FEATURES.filter(f => f.group === "marketplace").map((feature) => (
              <FeatureButton
                key={feature.type}
                feature={feature}
                active={currentFeature === feature.type}
                onClick={() => handleFeatureClick(feature.type)}
              />
            ))}
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
          <div className={`pl-[92px] transition-opacity duration-300 ${sidebarCollapsed ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-ink hover:bg-card-alt"
              title="Expand sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
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
            onSelectProject={(p) => setView({
              type: "chat-sessions",
              projectId: p.id,
              projectPath: p.path
            })}
            onSelectSession={(s) => setView({
              type: "chat-messages",
              projectId: s.project_id,
              sessionId: s.id,
              summary: s.summary
            })}
            onSelectChat={(c) => setView({
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
            onBack={() => setView({ type: "chat-projects" })}
            onSelect={(s) => setView({
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
            onBack={() => setView({
              type: "chat-sessions",
              projectId: view.projectId,
              projectPath: ""
            })}
          />
        )}

        {view.type === "commands" && (
          <CommandsView
            onSelect={(cmd) => setView({ type: "command-detail", command: cmd })}
            marketplaceItems={catalog?.commands || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.commands.find(c => c.path === item.path);
              if (template) setView({ type: "template-detail", template, category: "commands" });
            }}
          />
        )}

        {view.type === "command-detail" && (
          <CommandDetailView
            command={view.command}
            onBack={() => setView({ type: "commands" })}
          />
        )}

        {view.type === "mcp" && (
          <McpView
            marketplaceItems={catalog?.mcps || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.mcps.find(c => c.path === item.path);
              if (template) setView({ type: "template-detail", template, category: "mcps" });
            }}
          />
        )}

        {view.type === "skills" && (
          <SkillsView
            onSelect={(skill) => setView({ type: "skill-detail", skill })}
            marketplaceItems={catalog?.skills || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.skills.find(c => c.path === item.path);
              if (template) setView({ type: "template-detail", template, category: "skills" });
            }}
          />
        )}

        {view.type === "skill-detail" && (
          <SkillDetailView
            skill={view.skill}
            onBack={() => setView({ type: "skills" })}
          />
        )}

        {view.type === "hooks" && (
          <HooksView
            marketplaceItems={catalog?.hooks || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.hooks.find(c => c.path === item.path);
              if (template) setView({ type: "template-detail", template, category: "hooks" });
            }}
          />
        )}

        {view.type === "sub-agents" && (
          <SubAgentsView
            onSelect={(agent) => setView({ type: "sub-agent-detail", agent })}
            marketplaceItems={catalog?.agents || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.agents.find(c => c.path === item.path);
              if (template) setView({ type: "template-detail", template, category: "agents" });
            }}
          />
        )}

        {view.type === "sub-agent-detail" && (
          <SubAgentDetailView
            agent={view.agent}
            onBack={() => setView({ type: "sub-agents" })}
          />
        )}

        {view.type === "output-styles" && (
          <OutputStylesView />
        )}

        {view.type === "kb-distill" && (
          <DistillView
            onSelect={(doc) => setView({ type: "kb-distill-detail", document: doc })}
          />
        )}

        {view.type === "kb-distill-detail" && (
          <DistillDetailView
            document={view.document}
            onBack={() => setView({ type: "kb-distill" })}
            onNavigateSession={(projectId, sessionId, summary) =>
              setView({ type: "chat-messages", projectId, sessionId, summary })
            }
          />
        )}

        {view.type === "kb-notes" && (
          <ConfigPage>
            <PageHeader title="Notes" subtitle="Markdown notes" />
            <Collapsible>
              <CollapsibleTrigger className="w-full group">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card-alt/50 text-sm text-muted-foreground hover:text-ink transition-colors">
                  <span>📝</span>
                  <span>About Notes</span>
                  <ChevronDown className="w-3 h-3 ml-auto transition-transform group-data-[state=open]:rotate-180" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleBody>
                <div className="mt-2 px-3 py-3 rounded-lg bg-card-alt/30 text-sm text-muted-foreground space-y-2">
                  <p>Store and organize your markdown notes directly in Lovcode.</p>
                  <p className="text-xs">Create personal notes, snippets, and references that complement your distilled knowledge.</p>
                </div>
              </CollapsibleBody>
            </Collapsible>
            <EmptyState icon="📝" message="Notes coming soon" hint="Support for markdown notes will be added" />
          </ConfigPage>
        )}

        {view.type === "kb-bookmarks" && (
          <ConfigPage>
            <PageHeader title="Bookmarks" subtitle="External links & docs" />
            <Collapsible>
              <CollapsibleTrigger className="w-full group">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card-alt/50 text-sm text-muted-foreground hover:text-ink transition-colors">
                  <span>🔖</span>
                  <span>About Bookmarks</span>
                  <ChevronDown className="w-3 h-3 ml-auto transition-transform group-data-[state=open]:rotate-180" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleBody>
                <div className="mt-2 px-3 py-3 rounded-lg bg-card-alt/30 text-sm text-muted-foreground space-y-2">
                  <p>Save links to external documentation, tutorials, and resources.</p>
                  <p className="text-xs">Build a curated library of references for quick access during development.</p>
                </div>
              </CollapsibleBody>
            </Collapsible>
            <EmptyState icon="🔖" message="Bookmarks coming soon" hint="Save and organize external documentation links" />
          </ConfigPage>
        )}

        {view.type === "settings" && (
          <SettingsView
            marketplaceItems={catalog?.settings || []}
            onMarketplaceSelect={(item) => {
              const template = catalog?.settings.find(c => c.path === item.path);
              if (template) setView({ type: "template-detail", template, category: "settings" });
            }}
          />
        )}

        {view.type === "marketplace" && (
          <MarketplaceView
            initialCategory={view.category ?? marketplaceCategory}
            onSelectTemplate={(template, category) => {
              setMarketplaceCategory(category);
              setView({ type: "template-detail", template, category });
            }}
            onCategoryChange={(category) => {
              setMarketplaceCategory(category);
              setView({ type: "marketplace", category });
            }}
          />
        )}

        {view.type === "template-detail" && (
          <TemplateDetailView
            template={view.template}
            category={view.category}
            onBack={() => setView({ type: "marketplace", category: marketplaceCategory })}
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
}: {
  feature: FeatureConfig;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : feature.available
            ? "text-ink hover:bg-card-alt"
            : "text-muted-foreground/60 hover:bg-card-alt"
      }`}
    >
      <span className="text-lg">{feature.icon}</span>
      <span className="text-sm">
        {feature.label}
        {!feature.available && <span className="ml-1.5 text-xs opacity-60">(TODO)</span>}
      </span>
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
// Sub Agents Feature
// ============================================================================

function SubAgentsView({
  onSelect,
  marketplaceItems,
  onMarketplaceSelect,
}: {
  onSelect: (agent: LocalAgent) => void;
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
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
      <PageHeader title="Sub Agents" subtitle={`${agents.length} sub-agents in ~/.claude/commands`} />
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

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} />
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

function DistillHelpButton() {
  const [open, setOpen] = useState(false);
  const [commandContent, setCommandContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && !commandContent) {
      invoke<string>("get_distill_command_file")
        .then(setCommandContent)
        .catch(() => setCommandContent(null));
    }
  }, [open, commandContent]);

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
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-lg text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors"
        title="How to use Distill"
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>How to use Distill</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Distill captures wisdom from your Claude Code sessions into reusable knowledge.</p>
              <p className="font-medium text-ink">In Claude Code, run:</p>
              <code className="block px-3 py-2 rounded-lg bg-card-alt font-mono text-sm">/distill</code>
              <p>This analyzes your conversation and extracts key learnings into structured documents stored in <code className="text-xs bg-card-alt px-1 rounded">~/.lovstudio/docs/distill/</code></p>
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
}: {
  onSelect: (doc: DistillDocument) => void;
}) {
  const [documents, setDocuments] = useState<DistillDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const { search, setSearch, filtered } = useSearch(documents, ["title", "tags"]);

  useEffect(() => {
    invoke<DistillDocument[]>("list_distill_documents")
      .then(setDocuments)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading distill documents..." />;

  return (
    <ConfigPage>
      <PageHeader
        title="Distill"
        subtitle={`${documents.length} experience summaries`}
        action={<DistillHelpButton />}
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
              badge={doc.date}
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
            <p className="text-muted-foreground">Session: <button onClick={handleNavigateSession} className="font-mono text-xs text-primary hover:underline">{document.session.slice(0, 8)}...</button></p>
          </div>
        </DetailCard>
        <ContentCard label="Content" content={content} />
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
}: {
  onSelect: (cmd: LocalCommand) => void;
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
}) {
  const [commands, setCommands] = useState<LocalCommand[]>([]);
  const [commandStats, setCommandStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<CommandSortKey>("usage");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const { search, setSearch, filtered } = useSearch(commands, ["name", "description"]);

  useEffect(() => {
    Promise.all([
      invoke<LocalCommand[]>("list_local_commands"),
      invoke<Record<string, number>>("get_command_stats")
    ])
      .then(([cmds, stats]) => {
        setCommands(cmds);
        setCommandStats(stats);
      })
      .finally(() => setLoading(false));
  }, []);

  // Sort filtered commands
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "usage") {
      const aCount = commandStats[a.name] || 0;
      const bCount = commandStats[b.name] || 0;
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

  if (loading) return <LoadingState message="Loading commands..." />;

  return (
    <ConfigPage>
      <PageHeader title="Commands" subtitle={`${commands.length} slash commands in ~/.claude/commands`} />
      <div className="flex items-center gap-4 mb-6">
        <SearchInput
          placeholder="Search local & marketplace..."
          value={search}
          onChange={setSearch}
          className="flex-1 max-w-md px-4 py-2 bg-card border border-border rounded-lg text-ink placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
        <div className="flex items-center gap-1 text-xs shrink-0">
          <span className="text-muted-foreground mr-1">Sort:</span>
          <button
            onClick={() => toggleSort("usage")}
            className={`px-2 py-1 rounded ${sortKey === "usage" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-ink"}`}
          >
            Usage {sortKey === "usage" && (sortDir === "desc" ? "↓" : "↑")}
          </button>
          <button
            onClick={() => toggleSort("name")}
            className={`px-2 py-1 rounded ${sortKey === "name" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-ink"}`}
          >
            Name {sortKey === "name" && (sortDir === "desc" ? "↓" : "↑")}
          </button>
        </div>
      </div>

      {/* Local results */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((cmd) => (
            <ItemCard
              key={cmd.name}
              name={cmd.name}
              description={cmd.description}
              badge={cmd.argument_hint}
              badgeVariant="muted"
              usageCount={commandStats[cmd.name]}
              onClick={() => onSelect(cmd)}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && !search && (
        <EmptyState icon="⚡" message="No commands found" hint="Create commands in ~/.claude/commands/" />
      )}

      {filtered.length === 0 && search && (
        <p className="text-muted-foreground text-sm">No local commands match "{search}"</p>
      )}

      {/* Marketplace results */}
      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} />
    </ConfigPage>
  );
}

function CommandDetailView({ command, onBack }: { command: LocalCommand; onBack: () => void }) {
  return (
    <ConfigPage>
      <DetailHeader
        title={command.name}
        description={command.description}
        backLabel="Commands"
        onBack={onBack}
        path={command.path}
        onOpenPath={(p) => invoke("open_in_editor", { path: p })}
      />
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
        <ContentCard label="Content" content={command.content} />
      </div>
    </ConfigPage>
  );
}

// ============================================================================
// MCP Feature
// ============================================================================

function McpView({
  marketplaceItems,
  onMarketplaceSelect,
}: {
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
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
          mcpConfigPath && (
            <button
              onClick={() => invoke("open_in_editor", { path: mcpConfigPath })}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors"
              title={formatPath(mcpConfigPath)}
            >
              <span>Open .claude.json</span>
            </button>
          )
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

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} />
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
}: {
  onSelect: (skill: LocalSkill) => void;
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
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
      <PageHeader title="Skills" subtitle={`${skills.length} skills in ~/.claude/skills`} />
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

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} />
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
}: {
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
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
      <PageHeader title="Hooks" subtitle="Automation triggers in ~/.claude/settings.json" />
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

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} />
    </ConfigPage>
  );
}

// ============================================================================
// Settings Feature
// ============================================================================

function SettingsView({
  marketplaceItems,
  onMarketplaceSelect,
}: {
  marketplaceItems: MarketplaceItem[];
  onMarketplaceSelect: (item: MarketplaceItem) => void;
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
      <PageHeader title="Settings" subtitle="User configuration (~/.claude)" />
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

      <MarketplaceSection items={marketplaceItems} search={search} onSelect={onMarketplaceSelect} />
    </ConfigPage>
  );
}

// ============================================================================
// Marketplace Feature
// ============================================================================

// Same order as sidebar Configuration group
const TEMPLATE_CATEGORIES: { key: TemplateCategory; label: string; icon: string }[] = [
  { key: "settings", label: "Configuration", icon: "⚙️" },
  { key: "commands", label: "Commands", icon: "⚡" },
  { key: "mcps", label: "MCPs", icon: "🔌" },
  { key: "skills", label: "Skills", icon: "🎯" },
  { key: "hooks", label: "Hooks", icon: "🪝" },
  { key: "agents", label: "Sub Agents", icon: "🤖" },
  { key: "output-styles", label: "Output Styles", icon: "🎨" },
];

function MarketplaceView({
  initialCategory,
  onSelectTemplate,
  onCategoryChange,
}: {
  initialCategory?: TemplateCategory;
  onSelectTemplate: (template: TemplateComponent, category: TemplateCategory) => void;
  onCategoryChange?: (category: TemplateCategory) => void;
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

  return (
    <ConfigPage>
      <PageHeader title="Marketplace" subtitle="Browse and install Claude Code templates" />

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TEMPLATE_CATEGORIES.map((cat) => {
          const count = catalog[cat.key]?.length || 0;
          return (
            <button
              key={cat.key}
              onClick={() => onCategoryChange?.(cat.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                activeCategory === cat.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-card-alt text-muted-foreground hover:text-ink"
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      <SearchInput
        placeholder={`Search ${TEMPLATE_CATEGORIES.find(c => c.key === activeCategory)?.label.toLowerCase()}...`}
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
}: {
  template: TemplateComponent;
  category: TemplateCategory;
  onBack: () => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <button
            onClick={handleInstall}
            disabled={installing || installed}
            className={`px-4 py-2 rounded-lg font-medium transition-colors shrink-0 ${
              installed
                ? "bg-green-500/20 text-green-600"
                : installing
                  ? "bg-card-alt text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {installed ? "✓ Installed" : installing ? "Installing..." : "Install"}
          </button>
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
  const [totalChats, setTotalChats] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [hideEmptySessions, setHideEmptySessions] = usePersistedState("lovcode-hide-empty-sessions-all", false);
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);

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
      invoke<ChatsResponse>("list_all_chats", { limit: 500 })
        .then((res) => {
          setAllChats(res.items);
          setTotalChats(res.total);
        })
        .finally(() => setLoadingChats(false));
    }
  }, [viewMode, allChats, loadingChats]);

  const loading = viewMode === "projects" ? loadingProjects : viewMode === "sessions" ? loadingSessions : loadingChats;

  // Search functions
  const handleBuildIndex = async () => {
    setIndexBuilding(true);
    setIndexStatus(null);
    try {
      const count = await invoke<number>("build_search_index");
      setIndexStatus(`Index built: ${count} messages indexed`);
    } catch (e) {
      setIndexStatus(`Error: ${e}`);
    } finally {
      setIndexBuilding(false);
    }
  };

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
              : `${(allChats || []).length} / ${totalChats} messages`}
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
              className="px-3 py-2 rounded-lg bg-card-alt text-muted-foreground hover:text-ink border border-border transition-colors disabled:opacity-50"
              title="Build search index"
            >
              {indexBuilding ? "Building..." : "🔄 Index"}
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
      <div className="space-y-3">
        {viewMode === "projects" ? (
          sortedProjects.map((project) => (
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
          ))
        ) : viewMode === "sessions" ? (
          sortedSessions.map((session) => (
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
          ))
        ) : (
          // Show search results if available, otherwise show all chats
          (searchResults !== null ? searchResults : (allChats || [])).map((chat) => (
            <button
              key={chat.uuid}
              onClick={() => onSelectChat(chat)}
              className="w-full text-left bg-card rounded-xl p-4 border border-border hover:border-primary transition-colors"
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
          ))
        )}
      </div>
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
  const [contextTab, setContextTab] = useState<"global" | "project">("project");
  const [selectMode, setSelectMode] = usePersistedState("lovcode:sessionSelectMode", false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [hideEmptySessions, setHideEmptySessions] = usePersistedState("lovcode-hide-empty-sessions", false);
  const [userPromptsOnly, setUserPromptsOnly] = usePersistedState("lovcode:userPromptsOnly", false);

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

      {/* Sessions Header */}
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
