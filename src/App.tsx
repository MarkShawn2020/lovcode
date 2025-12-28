import { useState, useEffect, useCallback, useRef } from "react";
import { version } from "../package.json";
// Radix icons
import {
  PersonIcon, ChevronDownIcon,
  HomeIcon, ReaderIcon, GearIcon, LayersIcon, CubeIcon, ChatBubbleIcon,
  DoubleArrowLeftIcon,
} from "@radix-ui/react-icons";
import { GlobalHeader } from "./components/GlobalHeader";
import { setAutoCopyOnSelect, getAutoCopyOnSelect } from "./components/Terminal";
import { Collapsible, CollapsibleTrigger, CollapsibleContent as CollapsibleBody } from "./components/ui/collapsible";
import { Switch } from "./components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "./components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Button } from "./components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Modular imports
import type {
  FeatureType, FeatureConfig, View, LocalCommand,
  TemplatesCatalog, UserProfile,
} from "./types";
import { useAtom } from "jotai";
import { sidebarCollapsedAtom, marketplaceCategoryAtom, shortenPathsAtom, profileAtom, navigationStateAtom, viewAtom, viewHistoryAtom, historyIndexAtom } from "./store";
import { AppConfigContext, useAppConfig, type AppConfig } from "./context";
import { FEATURES, FEATURE_ICONS } from "./constants";
// Modular views
import {
  Home,
  WorkspaceView,
  FeaturesView,
  FeaturesLayout,
  OutputStylesView,
  StatuslineView,
  SubAgentsView,
  SubAgentDetailView,
  SkillsView,
  SkillDetailView,
  HooksView,
  McpView,
  FeatureTodo,
  CommandsView,
  CommandDetailView,
  MarketplaceView,
  MarketplaceLayout,
  TemplateDetailView,
  DistillView,
  DistillDetailView,
  ReferenceView,
  KnowledgeLayout,
  SettingsView,
  ProjectList,
  SessionList,
  MessageView,
} from "./views";

// ============================================================================
// App Component
// ============================================================================

function App() {
  const [view] = useAtom(viewAtom);
  const [viewHistory] = useAtom(viewHistoryAtom);
  const [historyIndex] = useAtom(historyIndexAtom);
  const [, setNavigationState] = useAtom(navigationStateAtom);

  const navigate = useCallback((newView: View) => {
    setNavigationState(prev => {
      const newHistory = prev.history.slice(0, prev.index + 1);
      newHistory.push(newView);
      let newIndex = prev.index + 1;
      if (newHistory.length > 50) {
        newHistory.shift();
        newIndex = 49;
      }
      return { history: newHistory, index: newIndex };
    });
  }, [setNavigationState]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < viewHistory.length - 1;

  const goBack = useCallback(() => {
    setNavigationState(prev => {
      if (prev.index > 0) {
        return { ...prev, index: prev.index - 1 };
      }
      return prev;
    });
  }, [setNavigationState]);

  const goForward = useCallback(() => {
    setNavigationState(prev => {
      if (prev.index < prev.history.length - 1) {
        return { ...prev, index: prev.index + 1 };
      }
      return prev;
    });
  }, [setNavigationState]);

  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [marketplaceCategory, setMarketplaceCategory] = useAtom(marketplaceCategoryAtom);
  const [catalog, setCatalog] = useState<TemplatesCatalog | null>(null);
  const [homeDir, setHomeDir] = useState("");
  const [shortenPaths, setShortenPaths] = useAtom(shortenPathsAtom);
  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = useAtom(profileAtom);
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [distillWatchEnabled, setDistillWatchEnabled] = useState(true);

  useEffect(() => {
    invoke<string>("get_home_dir").then(setHomeDir).catch(() => {});
    invoke<boolean>("get_distill_watch_enabled").then(setDistillWatchEnabled).catch(() => {});
  }, []);


  useEffect(() => {
    const unlisten = listen("menu-settings", () => setShowSettings(true));
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        window.dispatchEvent(new Event("app:before-reload"));
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

  useEffect(() => {
    invoke<TemplatesCatalog>("get_templates_catalog").then(setCatalog).catch(() => {});
  }, []);

  const currentFeature: FeatureType | null =
    view.type === "chat-projects" || view.type === "chat-sessions" || view.type === "chat-messages"
      ? "chat"
      : view.type === "workspace"
        ? "workspace"
        : view.type === "features"
        ? "features"
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
                    : view.type === "statusline"
                      ? "statusline"
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
      case "statusline":
        navigate({ type: "statusline" });
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
      case "workspace":
        navigate({ type: "workspace" });
        break;
      case "features":
        navigate({ type: "features" });
        break;
      default:
        navigate({ type: "feature-todo", feature });
    }
  };

  return (
    <AppConfigContext.Provider value={appConfig}>
    {sidebarCollapsed ? (
      /* Collapsed: vertical layout */
      <div className="h-screen bg-canvas flex flex-col">
        <GlobalHeader
          currentFeature={currentFeature}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={goBack}
          onGoForward={goForward}
          onNavigate={navigate}
          onFeatureClick={handleFeatureClick}
          onShowProfileDialog={() => setShowProfileDialog(true)}
          onShowSettings={() => setShowSettings(true)}
        />
        <main className="flex-1 overflow-auto">
        {view.type === "home" && (
          <Home
            onFeatureClick={handleFeatureClick}
            onProjectClick={(p) => navigate({ type: "chat-sessions", projectId: p.id, projectPath: p.path })}
            onSessionClick={(s) => navigate({ type: "chat-messages", projectId: s.project_id, sessionId: s.id, summary: s.summary })}
            onSearch={() => navigate({ type: "chat-projects" })}
          />
        )}
        {view.type === "workspace" && <WorkspaceView />}
        {view.type === "features" && <FeaturesView onFeatureClick={handleFeatureClick} currentFeature={currentFeature} />}
        {view.type === "chat-projects" && (
          <ProjectList
            onSelectProject={(p) => navigate({ type: "chat-sessions", projectId: p.id, projectPath: p.path })}
            onSelectSession={(s) => navigate({ type: "chat-messages", projectId: s.project_id, sessionId: s.id, summary: s.summary })}
            onSelectChat={(c) => navigate({ type: "chat-messages", projectId: c.project_id, sessionId: c.session_id, summary: c.session_summary })}
          />
        )}
        {view.type === "chat-sessions" && (
          <SessionList
            projectId={view.projectId}
            projectPath={view.projectPath}
            onBack={() => navigate({ type: "chat-projects" })}
            onSelect={(s) => navigate({ type: "chat-messages", projectId: s.project_id, sessionId: s.id, summary: s.summary })}
          />
        )}
        {view.type === "chat-messages" && (
          <MessageView
            projectId={view.projectId}
            sessionId={view.sessionId}
            summary={view.summary}
            onBack={() => navigate({ type: "chat-sessions", projectId: view.projectId, projectPath: "" })}
          />
        )}
        {(view.type === "commands" || view.type === "command-detail" || view.type === "mcp" ||
          view.type === "skills" || view.type === "skill-detail" || view.type === "hooks" ||
          view.type === "sub-agents" || view.type === "sub-agent-detail" || view.type === "output-styles" ||
          view.type === "statusline") && (
          <FeaturesLayout currentFeature={currentFeature} onFeatureClick={handleFeatureClick}>
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
                onCommandUpdated={() => {}}
                onRenamed={async (newPath: string) => {
                  const commands = await invoke<LocalCommand[]>("list_local_commands");
                  const cmd = commands.find(c => c.path === newPath);
                  if (cmd) navigate({ type: "command-detail", command: cmd });
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
            {view.type === "skill-detail" && <SkillDetailView skill={view.skill} onBack={() => navigate({ type: "skills" })} />}
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
            {view.type === "sub-agent-detail" && <SubAgentDetailView agent={view.agent} onBack={() => navigate({ type: "sub-agents" })} />}
            {view.type === "output-styles" && <OutputStylesView />}
            {view.type === "statusline" && (
              <StatuslineView
                installedTemplates={catalog?.statuslines.filter(s => s.source_id === "personal") || []}
                onBrowseMore={() => navigate({ type: "marketplace", category: "statuslines" })}
              />
            )}
          </FeaturesLayout>
        )}
        {(view.type === "kb-distill" || view.type === "kb-distill-detail" || view.type === "kb-reference" || view.type === "kb-reference-doc") && (
          <KnowledgeLayout currentFeature={currentFeature} onFeatureClick={handleFeatureClick}>
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
                onNavigateSession={(projectId, sessionId, summary) => navigate({ type: "chat-messages", projectId, sessionId, summary })}
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
          </KnowledgeLayout>
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
        {(view.type === "marketplace" || view.type === "template-detail") && (
          <MarketplaceLayout
            currentCategory={view.type === "marketplace" ? (view.category ?? marketplaceCategory) : view.category}
            onCategoryClick={(category) => navigate({ type: "marketplace", category })}
          >
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
          </MarketplaceLayout>
        )}
        {view.type === "feature-todo" && <FeatureTodo feature={view.feature} />}
        </main>
      </div>
    ) : (
    <div className="h-screen bg-canvas flex">
      {/* Sidebar - expanded */}
      <aside className="flex flex-col border-r border-border bg-card w-52 shrink-0">
          <div data-tauri-drag-region className="h-[52px] shrink-0 flex items-center justify-end px-3 border-b border-border">
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1 text-muted-foreground hover:text-ink hover:bg-card-alt transition-colors rounded"
              title="Collapse sidebar"
            >
              <DoubleArrowLeftIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-3">
            <div className="px-2 mb-2">
              <button
                onClick={() => navigate({ type: "home" })}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  view.type === "home" ? "bg-primary/10 text-primary" : "text-ink hover:bg-card-alt"
                }`}
              >
                <HomeIcon className="w-5 h-5" />
                <span className="text-sm">Home</span>
              </button>
            </div>

            <div className="mx-4 border-t border-border" />

            <div className="px-2 py-2 flex flex-col gap-0.5">
              {FEATURES.filter(f => f.group === "history").map((feature) => (
                <FeatureButton
                  key={feature.type}
                  feature={feature}
                  active={currentFeature === feature.type}
                  onClick={() => handleFeatureClick(feature.type)}
                />
              ))}
              <button
                onClick={() => handleFeatureClick("chat")}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  currentFeature === "chat" ? "bg-primary/10 text-primary" : "text-ink hover:bg-card-alt"
                }`}
              >
                <ChatBubbleIcon className="w-5 h-5" />
                <span className="text-sm">Chat History</span>
              </button>
              <Collapsible defaultOpen={currentFeature?.startsWith("kb-")}>
                <CollapsibleTrigger className="w-full group">
                  <div className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    currentFeature?.startsWith("kb-") ? "text-primary" : "text-ink hover:bg-card-alt"
                  }`}>
                    <ReaderIcon className="w-5 h-5" />
                    <span className="text-sm flex-1">Knowledge</span>
                    <ChevronDownIcon className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
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

            <div className="mx-4 border-t border-border" />

            <div className="px-2 py-2 flex flex-col gap-0.5">
              <button
                onClick={() => handleFeatureClick("settings")}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  currentFeature === "settings" ? "bg-primary/10 text-primary" : "text-ink hover:bg-card-alt"
                }`}
              >
                <GearIcon className="w-5 h-5" />
                <span className="text-sm">Configuration</span>
              </button>
              <Collapsible defaultOpen={FEATURES.some(f => f.group === "config" && f.type !== "settings" && currentFeature === f.type)}>
                <CollapsibleTrigger className="w-full group">
                  <div className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    FEATURES.some(f => f.group === "config" && f.type !== "settings" && currentFeature === f.type)
                      ? "text-primary" : "text-ink hover:bg-card-alt"
                  }`}>
                    <LayersIcon className="w-5 h-5" />
                    <span className="text-sm flex-1">Features</span>
                    <ChevronDownIcon className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleBody className="pl-4 flex flex-col gap-0.5">
                  {FEATURES.filter(f => f.group === "config" && f.type !== "settings").map((feature) => (
                    <FeatureButton
                      key={feature.type}
                      feature={feature}
                      active={currentFeature === feature.type}
                      onClick={() => handleFeatureClick(feature.type)}
                      compact
                    />
                  ))}
                </CollapsibleBody>
              </Collapsible>
              <button
                onClick={() => handleFeatureClick("marketplace")}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  currentFeature === "marketplace" ? "bg-primary/10 text-primary" : "text-ink hover:bg-card-alt"
                }`}
              >
                <CubeIcon className="w-5 h-5" />
                <span className="text-sm">Marketplace</span>
              </button>
            </div>
          </div>

          <div className="px-3 py-2.5 border-t border-border/50">
            <div className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-default">
              <img src="/logo.png" alt="Lovcode" className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium text-muted-foreground tracking-wide">Lovcode</span>
              <span className="text-[10px] text-muted-foreground/60">v{version}</span>
            </div>
          </div>
        </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        <GlobalHeader
          currentFeature={currentFeature}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={goBack}
          onGoForward={goForward}
          onNavigate={navigate}
          onFeatureClick={handleFeatureClick}
          onShowProfileDialog={() => setShowProfileDialog(true)}
          onShowSettings={() => setShowSettings(true)}
        />

        <main className="flex-1 overflow-auto">
        {view.type === "home" && (
          <Home
            onFeatureClick={handleFeatureClick}
            onProjectClick={(p) => navigate({ type: "chat-sessions", projectId: p.id, projectPath: p.path })}
            onSessionClick={(s) => navigate({ type: "chat-messages", projectId: s.project_id, sessionId: s.id, summary: s.summary })}
            onSearch={() => navigate({ type: "chat-projects" })}
          />
        )}
        {view.type === "workspace" && <WorkspaceView />}
        {view.type === "features" && <FeaturesView onFeatureClick={handleFeatureClick} currentFeature={currentFeature} />}

        {view.type === "chat-projects" && (
          <ProjectList
            onSelectProject={(p) => navigate({ type: "chat-sessions", projectId: p.id, projectPath: p.path })}
            onSelectSession={(s) => navigate({ type: "chat-messages", projectId: s.project_id, sessionId: s.id, summary: s.summary })}
            onSelectChat={(c) => navigate({ type: "chat-messages", projectId: c.project_id, sessionId: c.session_id, summary: c.session_summary })}
          />
        )}

        {view.type === "chat-sessions" && (
          <SessionList
            projectId={view.projectId}
            projectPath={view.projectPath}
            onBack={() => navigate({ type: "chat-projects" })}
            onSelect={(s) => navigate({ type: "chat-messages", projectId: s.project_id, sessionId: s.id, summary: s.summary })}
          />
        )}

        {view.type === "chat-messages" && (
          <MessageView
            projectId={view.projectId}
            sessionId={view.sessionId}
            summary={view.summary}
            onBack={() => navigate({ type: "chat-sessions", projectId: view.projectId, projectPath: "" })}
          />
        )}

        {(view.type === "commands" || view.type === "command-detail" || view.type === "mcp" ||
          view.type === "skills" || view.type === "skill-detail" || view.type === "hooks" ||
          view.type === "sub-agents" || view.type === "sub-agent-detail" || view.type === "output-styles" ||
          view.type === "statusline") && (
          <FeaturesLayout currentFeature={currentFeature} onFeatureClick={handleFeatureClick}>
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
                onCommandUpdated={() => {}}
                onRenamed={async (newPath: string) => {
                  const commands = await invoke<LocalCommand[]>("list_local_commands");
                  const cmd = commands.find(c => c.path === newPath);
                  if (cmd) navigate({ type: "command-detail", command: cmd });
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
            {view.type === "skill-detail" && <SkillDetailView skill={view.skill} onBack={() => navigate({ type: "skills" })} />}
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
            {view.type === "sub-agent-detail" && <SubAgentDetailView agent={view.agent} onBack={() => navigate({ type: "sub-agents" })} />}
            {view.type === "output-styles" && <OutputStylesView />}
            {view.type === "statusline" && (
              <StatuslineView
                installedTemplates={catalog?.statuslines.filter(s => s.source_id === "personal") || []}
                onBrowseMore={() => navigate({ type: "marketplace", category: "statuslines" })}
              />
            )}
          </FeaturesLayout>
        )}

        {(view.type === "kb-distill" || view.type === "kb-distill-detail" || view.type === "kb-reference" || view.type === "kb-reference-doc") && (
          <KnowledgeLayout currentFeature={currentFeature} onFeatureClick={handleFeatureClick}>
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
                onNavigateSession={(projectId, sessionId, summary) => navigate({ type: "chat-messages", projectId, sessionId, summary })}
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
          </KnowledgeLayout>
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

        {(view.type === "marketplace" || view.type === "template-detail") && (
          <MarketplaceLayout
            currentCategory={view.type === "marketplace" ? (view.category ?? marketplaceCategory) : view.category}
            onCategoryClick={(category) => navigate({ type: "marketplace", category })}
          >
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
          </MarketplaceLayout>
        )}

        {view.type === "feature-todo" && <FeatureTodo feature={view.feature} />}
        </main>
      </div>
    </div>
    )}
    <AppSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    <ProfileDialog open={showProfileDialog} onClose={() => setShowProfileDialog(false)} profile={profile} onSave={setProfile} />
    </AppConfigContext.Provider>
  );
}

// ============================================================================
// App Settings Dialog
// ============================================================================

function AppSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { shortenPaths, setShortenPaths } = useAppConfig();
  const [autoCopy, setAutoCopy] = useState(getAutoCopyOnSelect);

  const handleAutoCopyChange = (checked: boolean) => {
    setAutoCopy(checked);
    setAutoCopyOnSelect(checked);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-xl w-96 max-w-[90vw]">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Settings</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-ink text-xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-5">
          {/* Display */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Display</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Shorten paths</p>
                <p className="text-xs text-muted-foreground">Replace home directory with ~</p>
              </div>
              <Switch checked={shortenPaths} onCheckedChange={setShortenPaths} />
            </div>
          </div>
          {/* Terminal */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Terminal</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Auto copy on select</p>
                <p className="text-xs text-muted-foreground">Copy terminal selection to clipboard</p>
              </div>
              <Switch checked={autoCopy} onCheckedChange={handleAutoCopyChange} />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
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
    reader.onload = (event) => setAvatarUrl(event.target?.result as string);
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
          <div className="flex flex-col items-center gap-3">
            <div className="relative cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
              <Avatar className="h-20 w-20">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={nickname || "User"} /> : null}
                <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                  {nickname ? nickname.charAt(0).toUpperCase() : <PersonIcon className="w-8 h-8" />}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white text-xs">Upload</span>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            <p className="text-xs text-muted-foreground">Click avatar to upload</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nickname">Nickname</Label>
            <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Enter your nickname" />
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
  const Icon = FEATURE_ICONS[feature.type];
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
      {Icon && <Icon className="w-5 h-5" />}
      <span className="text-sm flex-1">
        {feature.label}
        {!feature.available && <span className="ml-1.5 text-xs opacity-60">(TODO)</span>}
      </span>
      {statusIndicator !== undefined && (
        <span className={`w-1.5 h-1.5 rounded-full ${statusIndicator === "on" ? "bg-primary" : "bg-muted-foreground/40"}`} />
      )}
    </button>
  );
}

export default App;
