/**
 * AppShell - URL-based routing
 *
 * This component renders based on URL (via React Router), NOT Jotai state.
 * URL is the ONLY source of truth for navigation.
 */
import { useState, useEffect, useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { PersonIcon } from "@radix-ui/react-icons";
import { GlobalHeader, VerticalFeatureTabs } from "./components/GlobalHeader";
import { setAutoCopyOnSelect, getAutoCopyOnSelect } from "./components/Terminal";
import { Switch } from "./components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "./components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Button } from "./components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAtom } from "jotai";
import { marketplaceCategoryAtom, shortenPathsAtom, profileAtom, featureTabsLayoutAtom, workspaceDataAtom } from "./store";
import { AppConfigContext, useAppConfig, type AppConfig } from "./context";
import type { FeatureType, UserProfile, TemplateCategory } from "./types";

// Views
import {
  Home,
  WorkspaceView,
  FeaturesView,
  FeaturesLayout,
  OutputStylesView,
  StatuslineView,
  SubAgentsView,
  SkillsView,
  HooksView,
  McpView,
  CommandsView,
  MarketplaceView,
  MarketplaceLayout,
  TemplateDetailView,
  DistillView,
  ReferenceView,
  KnowledgeLayout,
  SettingsView,
  EnvSettingsView,
  LlmProviderView,
  ClaudeVersionView,
  ContextFilesView,
  ProjectList,
  SessionList,
  MessageView,
  AnnualReport2025,
} from "./views";
import type { TemplatesCatalog } from "./types";
import { useInvokeQuery } from "./hooks";

// ============================================================================
// Route to Feature mapping
// ============================================================================

function getFeatureFromPath(pathname: string): FeatureType | null {
  const path = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const segment = path.split("/")[0];

  const featureMap: Record<string, FeatureType> = {
    "": null as unknown as FeatureType,
    "workspace": "workspace",
    "features": "features",
    "chat": "chat",
    "skills": "skills",
    "commands": "commands",
    "mcp": "mcp",
    "hooks": "hooks",
    "agents": "sub-agents",
    "output-styles": "output-styles",
    "statusline": "statusline",
    "settings": "settings",
    "knowledge": "kb-distill",
    "marketplace": "marketplace",
  };

  // Handle settings sub-routes
  if (path.startsWith("settings/")) {
    const sub = path.split("/")[1];
    if (sub === "env") return "basic-env";
    if (sub === "llm") return "basic-llm";
    if (sub === "version") return "basic-version";
    if (sub === "context") return "basic-context";
    return "settings";
  }

  // Handle knowledge sub-routes
  if (path.startsWith("knowledge/")) {
    const sub = path.split("/")[1];
    if (sub === "distill") return "kb-distill";
    if (sub === "reference") return "kb-reference";
  }

  return featureMap[segment] ?? null;
}

// ============================================================================
// AppShell Component
// ============================================================================

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive current feature from URL
  const currentFeature = getFeatureFromPath(location.pathname);

  // App state (non-routing)
  const [featureTabsLayout] = useAtom(featureTabsLayoutAtom);
  const [workspace] = useAtom(workspaceDataAtom);
  const [marketplaceCategory, setMarketplaceCategory] = useAtom(marketplaceCategoryAtom);
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

  // URL-based navigation
  const handleFeatureClick = (feature: FeatureType) => {
    const routes: Record<FeatureType, string> = {
      "chat": "/chat",
      "basic-env": "/settings/env",
      "basic-llm": "/settings/llm",
      "basic-version": "/settings/version",
      "basic-context": "/settings/context",
      "settings": "/settings",
      "commands": "/commands",
      "mcp": "/mcp",
      "skills": "/skills",
      "hooks": "/hooks",
      "sub-agents": "/agents",
      "output-styles": "/output-styles",
      "statusline": "/statusline",
      "kb-distill": "/knowledge/distill",
      "kb-reference": "/knowledge/reference",
      "workspace": "/workspace",
      "features": "/features",
      "marketplace": "/marketplace",
    };
    const path = routes[feature];
    if (path) {
      navigate(path);
    }
  };

  // Parse current route
  const path = location.pathname.slice(1);
  const segments = path.split("/").filter(Boolean);
  const [first, second, third] = segments;

  // Determine which view to render based on URL
  const renderContent = () => {
    // Home
    if (!first) {
      return (
        <Home
          onFeatureClick={handleFeatureClick}
          onProjectClick={(p) => navigate(`/chat/${encodeURIComponent(p.id)}`)}
          onSessionClick={(s) => navigate(`/chat/${encodeURIComponent(s.project_id)}/${encodeURIComponent(s.id)}`)}
          onSearch={() => navigate("/chat")}
          onOpenAnnualReport={() => navigate("/annual-report-2025")}
        />
      );
    }

    // Annual Report
    if (first === "annual-report-2025") {
      return <AnnualReport2025 onClose={() => navigate("/")} />;
    }

    // Workspace
    if (first === "workspace") {
      return <WorkspaceView />;
    }

    // Features
    if (first === "features") {
      return <FeaturesView onFeatureClick={handleFeatureClick} currentFeature={currentFeature} />;
    }

    // Chat
    if (first === "chat") {
      if (third) {
        return (
          <MessageView
            projectId={decodeURIComponent(second)}
            projectPath=""
            sessionId={decodeURIComponent(third)}
            summary=""
            onBack={() => navigate(`/chat/${second}`)}
          />
        );
      }
      if (second) {
        return (
          <SessionList
            projectId={decodeURIComponent(second)}
            projectPath=""
            onBack={() => navigate("/chat")}
            onSelect={(s) => navigate(`/chat/${encodeURIComponent(s.project_id)}/${encodeURIComponent(s.id)}`)}
          />
        );
      }
      return (
        <ProjectList
          onSelectProject={(p) => navigate(`/chat/${encodeURIComponent(p.id)}`)}
          onSelectSession={(s) => navigate(`/chat/${encodeURIComponent(s.project_id)}/${encodeURIComponent(s.id)}`)}
          onSelectChat={(c) => navigate(`/chat/${encodeURIComponent(c.project_id)}/${encodeURIComponent(c.session_id)}`)}
        />
      );
    }

    // Feature pages with FeaturesLayout
    if (["settings", "commands", "mcp", "skills", "hooks", "agents", "output-styles", "statusline"].includes(first)) {
      return (
        <FeaturesLayout currentFeature={currentFeature} onFeatureClick={handleFeatureClick}>
          {first === "settings" && !second && (
            <SettingsView
              onMarketplaceSelect={() => navigate(`/marketplace/settings`)}
            />
          )}
          {first === "settings" && second === "env" && <EnvSettingsView />}
          {first === "settings" && second === "llm" && <LlmProviderView />}
          {first === "settings" && second === "version" && <ClaudeVersionView />}
          {first === "settings" && second === "context" && <ContextFilesView />}
          {first === "commands" && !second && (
            <CommandsView
              onSelect={(cmd) => navigate(`/commands/${encodeURIComponent(cmd.name)}`)}
              onMarketplaceSelect={() => navigate(`/marketplace/commands`)}
            />
          )}
          {/* Command detail is handled by CommandDetailPage route */}
          {first === "mcp" && (
            <McpView
              onMarketplaceSelect={() => navigate(`/marketplace/mcps`)}
            />
          )}
          {first === "skills" && !second && (
            <SkillsView
              onSelectTemplate={(template) => navigate(`/skills/${encodeURIComponent(template.name)}`)}
              onMarketplaceSelect={(template) => navigate(`/skills/${encodeURIComponent(template.name)}?source=marketplace`)}
            />
          )}
          {/* Skill detail is handled by SkillDetailPage route */}
          {first === "hooks" && (
            <HooksView
              onMarketplaceSelect={() => navigate(`/marketplace/hooks`)}
            />
          )}
          {first === "agents" && !second && (
            <SubAgentsView
              onSelect={(agent) => navigate(`/agents/${encodeURIComponent(agent.name)}`)}
              onMarketplaceSelect={() => navigate(`/marketplace/agents`)}
            />
          )}
          {first === "output-styles" && (
            <OutputStylesView
              onMarketplaceSelect={() => navigate(`/marketplace/output-styles`)}
            />
          )}
          {first === "statusline" && (
            <StatuslineView
              onMarketplaceSelect={() => navigate(`/marketplace/statuslines`)}
            />
          )}
          {/* Render child routes (detail pages) */}
          <Outlet />
        </FeaturesLayout>
      );
    }

    // Knowledge
    if (first === "knowledge") {
      return (
        <KnowledgeLayout currentFeature={currentFeature} onFeatureClick={handleFeatureClick}>
          {second === "distill" && (
            <DistillView
              onSelect={(doc) => navigate(`/knowledge/distill/${encodeURIComponent(doc.file)}`)}
              watchEnabled={distillWatchEnabled}
              onWatchToggle={(enabled) => {
                setDistillWatchEnabled(enabled);
                invoke("set_distill_watch_enabled", { enabled });
              }}
            />
          )}
          {second === "reference" && (
            <ReferenceView
              onDocOpen={(source) => navigate(`/knowledge/reference/${encodeURIComponent(source)}`)}
              onDocClose={() => navigate("/knowledge/reference")}
            />
          )}
        </KnowledgeLayout>
      );
    }

    // Marketplace
    if (first === "marketplace") {
      const category = (second as TemplateCategory) ?? marketplaceCategory;
      const templateName = third ? decodeURIComponent(third) : undefined;

      return (
        <MarketplaceLayout
          currentCategory={category}
          onCategoryClick={(cat) => navigate(`/marketplace/${cat}`)}
        >
          {templateName ? (
            <MarketplaceTemplateDetail
              category={category}
              templateName={templateName}
              onBack={() => navigate(`/marketplace/${category}`)}
            />
          ) : (
            <MarketplaceView
              initialCategory={category}
              onSelectTemplate={(template, cat) => {
                setMarketplaceCategory(cat);
                navigate(`/marketplace/${cat}/${encodeURIComponent(template.name)}`);
              }}
            />
          )}
        </MarketplaceLayout>
      );
    }

    // Fallback
    return <Home onFeatureClick={handleFeatureClick} onProjectClick={() => {}} onSessionClick={() => {}} onSearch={() => {}} onOpenAnnualReport={() => {}} />;
  };

  return (
    <AppConfigContext.Provider value={appConfig}>
      <div className="h-screen bg-canvas flex flex-col">
        <GlobalHeader
          currentFeature={currentFeature}
          canGoBack={window.history.length > 1}
          canGoForward={false}
          onGoBack={() => navigate(-1)}
          onGoForward={() => navigate(1)}
          onNavigate={() => {}}
          onFeatureClick={handleFeatureClick}
          onShowProfileDialog={() => setShowProfileDialog(true)}
          onShowSettings={() => setShowSettings(true)}
        />
        <div className="flex-1 flex overflow-hidden">
          {featureTabsLayout === "vertical" && workspace && <VerticalFeatureTabs />}
          <main className="flex-1 overflow-auto">
            {renderContent()}
          </main>
        </div>
      </div>
      <AppSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <ProfileDialog open={showProfileDialog} onClose={() => setShowProfileDialog(false)} profile={profile} onSave={setProfile} />
    </AppConfigContext.Provider>
  );
}

// ============================================================================
// Dialogs (moved from App.tsx)
// ============================================================================

function AppSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { shortenPaths, setShortenPaths } = useAppConfig();
  const [autoCopy, setAutoCopy] = useState(getAutoCopyOnSelect);
  const [featureTabsLayout, setFeatureTabsLayout] = useAtom(featureTabsLayoutAtom);

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
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Display</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Shorten paths</p>
                <p className="text-xs text-muted-foreground">Replace home directory with ~</p>
              </div>
              <Switch checked={shortenPaths} onCheckedChange={setShortenPaths} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Project tabs layout</p>
                <p className="text-xs text-muted-foreground">Position of project/feature tabs</p>
              </div>
              <div className="flex gap-0.5 p-0.5 bg-muted rounded-lg">
                <button
                  onClick={() => setFeatureTabsLayout("horizontal")}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    featureTabsLayout === "horizontal" ? "bg-background text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
                  }`}
                >
                  Horizontal
                </button>
                <button
                  onClick={() => setFeatureTabsLayout("vertical")}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    featureTabsLayout === "vertical" ? "bg-background text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
                  }`}
                >
                  Vertical
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Behavior</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Auto-copy on select</p>
                <p className="text-xs text-muted-foreground">Copy selected text automatically</p>
              </div>
              <Switch checked={autoCopy} onCheckedChange={handleAutoCopyChange} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileDialog({ open, onClose, profile, onSave }: { open: boolean; onClose: () => void; profile: UserProfile; onSave: (p: UserProfile) => void }) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl || "");

  useEffect(() => {
    setNickname(profile.nickname);
    setAvatarUrl(profile.avatarUrl || "");
  }, [profile]);

  const handleSave = () => {
    onSave({ nickname, avatarUrl: avatarUrl || "" });
    onClose();
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
              <AvatarFallback className="bg-primary/10 text-primary text-xl">
                {nickname ? nickname[0].toUpperCase() : <PersonIcon className="w-8 h-8" />}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-2">
              <Label htmlFor="nickname">Name</Label>
              <Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Your name" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="avatar">Avatar URL</Label>
            <Input id="avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
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
// Marketplace Template Detail (fetches template from catalog)
// ============================================================================

function MarketplaceTemplateDetail({
  category,
  templateName,
  onBack,
}: {
  category: TemplateCategory;
  templateName: string;
  onBack: () => void;
}) {
  const { data: catalog, isLoading } = useInvokeQuery<TemplatesCatalog>(
    ["templatesCatalog"],
    "get_templates_catalog"
  );

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  const templates = catalog?.[category] ?? [];
  const template = templates.find((t) => t.name === templateName);

  if (!template) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground mb-4">Template "{templateName}" not found</p>
        <button onClick={onBack} className="text-primary hover:underline">
          ← Back to list
        </button>
      </div>
    );
  }

  return (
    <TemplateDetailView
      template={template}
      category={category}
      onBack={onBack}
    />
  );
}
