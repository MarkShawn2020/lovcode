/**
 * Root Layout - wraps all pages
 *
 * This is the shared layout for all routes.
 * Contains header, sidebar, and renders child routes via Outlet.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Archive, X } from "lucide-react";
import { GlobalHeader } from "../components/GlobalHeader";
import { GlobalChatSearch } from "../components/GlobalChatSearch";
import { StatusBar } from "../components/StatusBar";
import { UpdateChecker } from "../components/UpdateChecker";
import { ChatFilePreviewProvider } from "../views/Chat/FilePreviewContext";
import { EnvironmentEditor } from "../components/Environment/EnvironmentDialog";
import { setAutoCopyOnSelect, getAutoCopyOnSelect } from "../components/Terminal";
import { Switch } from "../components/ui/switch";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { invoke } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "../hooks";
import { useAtom } from "jotai";
import {
  shortenPathsAtom,
  globalChatSearchHotkeyAtom,
  composerSubmitShortcutAtom,
  type ComposerSubmitShortcut,
} from "../store";
import { AppConfigContext, useAppConfig, type AppConfig } from "../context";
import {
  getProjectPathFromDefaultSessionEnvironmentKey,
  isDefaultSessionEnvironmentKey,
  normalizeEnvironmentKey,
} from "../lib/agent/environment";
import { useI18n, type LanguagePreference, type TranslationKey } from "../i18n";
import type { AgentSession, AgentWorkspaceState, EnvironmentConfig, EnvironmentScope, FeatureType, Session } from "../types";

const AGENT_WORKSPACE_STATE_UPDATED_EVENT = "agent-workspace-state-updated";

// ============================================================================
// Route to top-nav section mapping
// ============================================================================

const TOP_NAV_BY_ROUTE_SEGMENT: Record<string, FeatureType> = {
  dashboard: "dashboard",
  workbench: "workbench",
  workspace: "workbench",
  history: "workbench",
  features: "features",
  settings: "features",
  commands: "features",
  mcp: "features",
  skills: "features",
  hooks: "features",
  agents: "features",
  "output-styles": "features",
  statusline: "features",
  marketplace: "features",
  extensions: "features",
  lab: "lab",
  wishes: "lab",
  knowledge: "lab",
  docs: "lab",
  events: "lab",
  "annual-report-2025": "lab",
};

function getTopNavFeatureFromPath(pathname: string): FeatureType | null {
  const path = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const segment = path.split("/")[0];
  return TOP_NAV_BY_ROUTE_SEGMENT[segment] ?? null;
}

// ============================================================================
// Layout Component
// ============================================================================

export default function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Derive the active top-level nav item from URL.
  const activeTopNavFeature = getTopNavFeatureFromPath(location.pathname);

  // App state (non-routing)
  const [homeDir, setHomeDir] = useState("");
  const [shortenPaths, setShortenPaths] = useAtom(shortenPathsAtom);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    invoke<string>("get_home_dir").then(setHomeDir).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem("lovcode:profile");
    } catch {}
  }, []);

  // Splash dismissal:
  //   - On /workbench (and "/" which redirects via HomePage), the workbench
  //     controls the splash — wait until the session list is
  //     actually ready, no jarring "empty shell" gap.
  //   - On every other route, RootLayout dismisses immediately — those
  //     pages don't have a multi-second initial query.
  // The lastPath resume target may be anything, so we also skip dispatch
  // on "/" because HomePage will redirect within a microtask.
  useEffect(() => {
    const p = location.pathname;
    if (p === "/" || p.startsWith("/workbench")) return;
    window.dispatchEvent(new Event("app:ready"));
  }, [location.pathname]);

  const persistLastPath = useCallback(() => {
    const path = location.pathname + location.search;
    // Skip transient routes — they shouldn't be the "resume" target.
    if (path && path !== "/" && location.pathname !== "/annual-report-2025") {
      try { localStorage.setItem("lovcode:lastPath", path); } catch {}
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    persistLastPath();
  }, [persistLastPath]);

  useEffect(() => {
    window.addEventListener("beforeunload", persistLastPath);
    return () => window.removeEventListener("beforeunload", persistLastPath);
  }, [persistLastPath]);

  useEffect(() => {
    const unlisten = listen("menu-settings", () => setShowSettings(true));
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Backend (notify) watches ~/.claude/projects/ and emits "sessions-changed"
  // when Claude Code writes / appends a jsonl. Invalidate so the next read
  // picks up the change. The sessions cache (B) makes this re-read cheap —
  // only the changed file's mtime is bumped, everything else hits cache.
  useEffect(() => {
    const unlisten = listen("sessions-changed", () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    });
    return () => { unlisten.then(fn => fn()); };
  }, [queryClient]);

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
      "dashboard": "/dashboard",
      "lab": "/lab",
      "workbench": "/workbench",
      "wish-room": "/wishes",
      "chat": "/workbench",
      "workspace": "/workspace",
      "basic-env": "/settings/env",
      "basic-maas": "/settings/maas",
      "basic-version": "/settings/runtime",
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
      "features": "/features",
      "marketplace": "/marketplace",
      "extensions": "/extensions",
      "events": "/events",
    };
    const path = routes[feature];
    if (path) {
      navigate(path);
    }
  };

  return (
    <AppConfigContext.Provider value={appConfig}>
      <div className="h-screen bg-canvas flex flex-col">
        <GlobalHeader
          activeFeature={activeTopNavFeature}
          canGoBack={window.history.length > 1}
          canGoForward={false}
          onGoBack={() => navigate(-1)}
          onGoForward={() => navigate(1)}
          onFeatureClick={handleFeatureClick}
          onShowSettings={() => setShowSettings(true)}
        />
        <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
          <main className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <ChatFilePreviewProvider contentClassName="overflow-auto">
              <Outlet />
            </ChatFilePreviewProvider>
          </main>
        </div>
        <StatusBar />
      </div>
      <AppSettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <GlobalChatSearch />
      <UpdateChecker />
    </AppConfigContext.Provider>
  );
}

// ============================================================================
// Dialogs
// ============================================================================

interface StatusBarSettings {
  enabled: boolean;
  scriptPath?: string;
}

interface ArchivedSettingsItem {
  id: string;
  title: string;
  projectPath: string | null;
  projectLabel: string;
  sourceLabel: string;
  lastActivityAt: number | null;
  archivedAt: number | null;
  updatedAt: number;
  runtimeSessionId?: string;
}

interface EnvironmentSettingsItem {
  id: string;
  type: EnvironmentScope;
  title: string;
  subtitle: string;
  projectPath: string | null;
  sessionKey: string | null;
  sessionTitle: string | null;
  globalConfig: EnvironmentConfig | null;
  projectConfig: EnvironmentConfig | null;
  sessionConfig: EnvironmentConfig | null;
  updatedAt: number | null;
}

type SettingsSection = "display" | "composer" | "archived" | "environment" | "terminal" | "statusbar";

const settingsGroups: Array<{ titleKey: TranslationKey; sections: Array<{ id: SettingsSection; labelKey: TranslationKey }> }> = [
  {
    titleKey: "common.preferences",
    sections: [
      { id: "display", labelKey: "common.display" },
      { id: "composer", labelKey: "settings.composer" },
    ],
  },
  {
    titleKey: "common.workspace",
    sections: [
      { id: "archived", labelKey: "common.archived" },
    ],
  },
  {
    titleKey: "common.runtime",
    sections: [
      { id: "environment", labelKey: "common.environment" },
      { id: "terminal", labelKey: "common.terminal" },
      { id: "statusbar", labelKey: "common.statusBar" },
    ],
  },
];

const composerSubmitShortcutOptions: { value: ComposerSubmitShortcut; label: string }[] = [
  { value: "enter", label: "Enter" },
  { value: "mod-enter", label: "⌘/Ctrl Enter" },
];

function getSettingsProjectName(path?: string | null) {
  if (!path) return "Unknown project";
  return path.replace(/[/\\]+$/, "").split(/[\\/]/).filter(Boolean).pop() || path;
}

function getSettingsHistoryConversationId(session: Session) {
  return `history:${session.project_id}:${session.id}`;
}

function getSettingsRuntimeConversationId(session: AgentSession, transcript?: Session) {
  return transcript ? getSettingsHistoryConversationId(transcript) : `runtime:${session.id}`;
}

function getSettingsHistoryTitle(session: Session) {
  return session.title || session.summary || session.last_prompt || "Untitled conversation";
}

function getSettingsRuntimeTitle(session: AgentSession) {
  const title = session.title.trim();
  return title || (session.provider === "terminal" ? "Shell" : "New session");
}

function formatSettingsTimestamp(timestamp: number | null | undefined, locale: string) {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(locale, sameYear
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function getArchivedListTimestamp(item: ArchivedSettingsItem) {
  return item.archivedAt ?? item.lastActivityAt ?? item.updatedAt;
}

function buildArchivedSettingsItems(
  workspaceState: AgentWorkspaceState | null,
  historySessions: Session[],
): ArchivedSettingsItem[] {
  if (!workspaceState) return [];

  const conversationMeta = workspaceState.conversationMeta ?? {};
  const historyById = new Map(historySessions.map((session) => [session.id, session]));
  const items = new Map<string, ArchivedSettingsItem>();

  historySessions.forEach((session) => {
    const conversationId = getSettingsHistoryConversationId(session);
    const meta = conversationMeta[conversationId];
    if (!meta?.archived) return;
    const projectPath = session.project_path;
    items.set(conversationId, {
      id: conversationId,
      title: getSettingsHistoryTitle(session),
      projectPath,
      projectLabel: getSettingsProjectName(projectPath),
      sourceLabel: session.source === "codex" ? "Codex history" : "Claude history",
      lastActivityAt: session.last_modified * 1000,
      archivedAt: meta.archivedAt ?? null,
      updatedAt: session.last_modified * 1000,
    });
  });

  workspaceState.sessions.forEach((session) => {
    const transcript = session.linkedHistorySessionId ? historyById.get(session.linkedHistorySessionId) : undefined;
    const conversationId = getSettingsRuntimeConversationId(session, transcript);
    const meta = conversationMeta[conversationId];
    if (!session.archived && !meta?.archived) return;

    const current = items.get(conversationId);
    const projectPath = current?.projectPath ?? transcript?.project_path ?? session.cwd;
    const lastActivityAt = Math.max(
      current?.lastActivityAt ?? 0,
      session.lastActivityAt ?? session.updatedAt,
      transcript ? transcript.last_modified * 1000 : 0,
    );
    items.set(conversationId, {
      id: conversationId,
      title: current?.title ?? (transcript ? getSettingsHistoryTitle(transcript) : getSettingsRuntimeTitle(session)),
      projectPath,
      projectLabel: getSettingsProjectName(projectPath),
      sourceLabel: session.provider === "terminal" ? "Terminal session" : session.provider === "codex" ? "Codex session" : "Claude session",
      lastActivityAt: lastActivityAt || null,
      archivedAt: meta?.archivedAt ?? session.archivedAt ?? current?.archivedAt ?? null,
      updatedAt: Math.max(current?.updatedAt ?? 0, lastActivityAt),
      runtimeSessionId: session.id,
    });
  });

  Object.entries(conversationMeta).forEach(([conversationId, meta]) => {
    if (!meta?.archived || items.has(conversationId)) return;
    items.set(conversationId, {
      id: conversationId,
      title: "Archived conversation",
      projectPath: null,
      projectLabel: "Saved state",
      sourceLabel: conversationId.startsWith("history:") ? "History session" : "Workspace session",
      lastActivityAt: null,
      archivedAt: meta.archivedAt ?? null,
      updatedAt: meta.archivedAt ?? 0,
    });
  });

  return [...items.values()].sort((a, b) => (b.archivedAt ?? b.lastActivityAt ?? b.updatedAt) - (a.archivedAt ?? a.lastActivityAt ?? a.updatedAt));
}

function buildEnvironmentSettingsItems(
  workspaceState: AgentWorkspaceState | null,
  historySessions: Session[],
): EnvironmentSettingsItem[] {
  if (!workspaceState) return [];

  const globalEnvironment = workspaceState.globalEnvironment ?? null;
  const projectEnvironments = workspaceState.projectEnvironments ?? {};
  const sessionEnvironments = workspaceState.sessionEnvironments ?? {};
  const historyById = new Map(historySessions.map((session) => [session.id, session]));
  const historyByConversationId = new Map(historySessions.map((session) => [getSettingsHistoryConversationId(session), session]));
  const runtimeByConversationId = new Map<string, { session: AgentSession; transcript?: Session }>();

  workspaceState.sessions.forEach((session) => {
    const transcript = session.linkedHistorySessionId ? historyById.get(session.linkedHistorySessionId) : undefined;
    runtimeByConversationId.set(getSettingsRuntimeConversationId(session, transcript), { session, transcript });
    runtimeByConversationId.set(`runtime:${session.id}`, { session, transcript });
  });

  const items: EnvironmentSettingsItem[] = globalEnvironment
    ? [{
        id: "global",
        type: "global" as const,
        title: globalEnvironment.name || "Global runtime",
        subtitle: "Global environment",
        projectPath: null,
        sessionKey: null,
        sessionTitle: null,
        globalConfig: globalEnvironment,
        projectConfig: null,
        sessionConfig: null,
        updatedAt: globalEnvironment.updatedAt ?? null,
      }]
    : [];

  items.push(...Object.entries(projectEnvironments).map(([projectKey, config]) => ({
    id: `project:${projectKey}`,
    type: "project" as const,
    title: config.name || getSettingsProjectName(projectKey),
    subtitle: "Project environment",
    projectPath: projectKey,
    sessionKey: null,
    sessionTitle: null,
    globalConfig: globalEnvironment,
    projectConfig: config,
    sessionConfig: null,
    updatedAt: config.updatedAt ?? null,
  })));

  Object.entries(sessionEnvironments).forEach(([sessionKey, config]) => {
    const defaultProjectPath = getProjectPathFromDefaultSessionEnvironmentKey(sessionKey);
    const history = historyByConversationId.get(sessionKey);
    const runtime = runtimeByConversationId.get(sessionKey);
    const runtimeSession = runtime?.session;
    const transcript = runtime?.transcript;
    const projectPath = history?.project_path ?? transcript?.project_path ?? runtimeSession?.cwd ?? (defaultProjectPath || null);
    const projectKey = normalizeEnvironmentKey(projectPath);
    const defaultSession = isDefaultSessionEnvironmentKey(sessionKey);
    const sessionTitle = defaultSession
      ? `${getSettingsProjectName(projectPath)} sessions`
      : history
        ? getSettingsHistoryTitle(history)
        : transcript
          ? getSettingsHistoryTitle(transcript)
          : runtimeSession
            ? getSettingsRuntimeTitle(runtimeSession)
            : "Saved session";
    const sourceLabel = defaultSession
      ? "Session defaults"
      : history
        ? history.source === "codex" ? "Codex history" : "Claude history"
        : runtimeSession
          ? runtimeSession.provider === "terminal" ? "Terminal session" : runtimeSession.provider === "codex" ? "Codex session" : "Claude session"
          : "Session environment";

    items.push({
      id: `session:${sessionKey}`,
      type: "session" as const,
      title: config.name || sessionTitle,
      subtitle: `${sourceLabel} · ${getSettingsProjectName(projectPath)}`,
      projectPath,
      sessionKey,
      sessionTitle,
      globalConfig: globalEnvironment,
      projectConfig: projectKey ? projectEnvironments[projectKey] ?? null : null,
      sessionConfig: config,
      updatedAt: config.updatedAt ?? null,
    });
  });

  return items.sort((a, b) => {
    const byUpdated = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    if (byUpdated !== 0) return byUpdated;
    const byType = a.type.localeCompare(b.type);
    if (byType !== 0) return byType;
    return a.title.localeCompare(b.title);
  });
}

function AppSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { shortenPaths, setShortenPaths, formatPath } = useAppConfig();
  const queryClient = useQueryClient();
  const { activeLanguage, languagePreference, locale, setLanguagePreference, systemLanguage, t, translate } = useI18n();
  const [autoCopy, setAutoCopy] = useState(getAutoCopyOnSelect);
  const [globalChatSearchHotkey, setGlobalChatSearchHotkey] = useAtom(globalChatSearchHotkeyAtom);
  const [composerSubmitShortcut, setComposerSubmitShortcut] = useAtom(composerSubmitShortcutAtom);
  const [statusBarEnabled, setStatusBarEnabled] = useState(false);
  const [statusBarScript, setStatusBarScript] = useState("~/.lovstudio/lovcode/statusbar/default.sh");
  const [activeSection, setActiveSection] = useState<SettingsSection>("display");
  const [archivedWorkspaceState, setArchivedWorkspaceState] = useState<AgentWorkspaceState | null>(null);
  const [archivedHistorySessions, setArchivedHistorySessions] = useState<Session[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);
  const [environmentWorkspaceState, setEnvironmentWorkspaceState] = useState<AgentWorkspaceState | null>(null);
  const [environmentHistorySessions, setEnvironmentHistorySessions] = useState<Session[]>([]);
  const [selectedEnvironmentItemId, setSelectedEnvironmentItemId] = useState<string | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const archivedItems = buildArchivedSettingsItems(archivedWorkspaceState, archivedHistorySessions);
  const environmentItems = useMemo(
    () => buildEnvironmentSettingsItems(environmentWorkspaceState, environmentHistorySessions),
    [environmentHistorySessions, environmentWorkspaceState],
  );
  const selectedEnvironmentItem =
    environmentItems.find((item) => item.id === selectedEnvironmentItemId) ?? environmentItems[0] ?? null;
  const languageOptions: Array<{ value: LanguagePreference; label: string }> = [
    {
      value: "system",
      label: t("language.systemWithLanguage", {
        language: systemLanguage === "zh" ? t("language.chinese") : t("language.english"),
      }),
    },
    { value: "en", label: t("language.english") },
    { value: "zh", label: t("language.chinese") },
  ];

  // Load statusbar settings on open
  useEffect(() => {
    if (!open) return;
    invoke<StatusBarSettings | null>("get_statusbar_settings").then((settings) => {
      if (settings) {
        setStatusBarEnabled(settings.enabled);
        setStatusBarScript(settings.scriptPath || "~/.lovstudio/lovcode/statusbar/default.sh");
      }
    }).catch(() => {});
  }, [open]);

  const loadArchivedSessions = useCallback(async () => {
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const workspaceState = await invoke<AgentWorkspaceState>("get_agent_workspace_state");
      let historySessions = queryClient.getQueryData<Session[]>(["sessions"]) ?? [];
      const hasArchivedHistoryMeta = Object.entries(workspaceState.conversationMeta ?? {}).some(
        ([conversationId, meta]) => conversationId.startsWith("history:") && meta?.archived,
      );

      if (hasArchivedHistoryMeta && historySessions.length === 0) {
        historySessions = await invoke<Session[]>("list_all_sessions").catch(() => []);
      }

      setArchivedWorkspaceState(workspaceState);
      setArchivedHistorySessions(historySessions);
    } catch (error) {
      console.error("Failed to load archived conversations:", error);
      setArchivedError("Failed to load archived conversations.");
    } finally {
      setArchivedLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!open || activeSection !== "archived") return;
    void loadArchivedSessions();
  }, [activeSection, loadArchivedSessions, open]);

  const loadEnvironmentSettings = useCallback(async () => {
    setEnvironmentLoading(true);
    setEnvironmentError(null);
    try {
      const workspaceState = await invoke<AgentWorkspaceState>("get_agent_workspace_state");
      let historySessions = queryClient.getQueryData<Session[]>(["sessions"]) ?? [];
      const sessionEnvironmentKeys = Object.keys(workspaceState.sessionEnvironments ?? {});
      const missingHistorySession = sessionEnvironmentKeys.some(
        (key) => key.startsWith("history:") && !historySessions.some((session) => getSettingsHistoryConversationId(session) === key),
      );

      if (missingHistorySession) {
        historySessions = await invoke<Session[]>("list_all_sessions").catch(() => []);
      }

      setEnvironmentWorkspaceState(workspaceState);
      setEnvironmentHistorySessions(historySessions);
    } catch (error) {
      console.error("Failed to load environment settings:", error);
      setEnvironmentError("Failed to load environment settings.");
    } finally {
      setEnvironmentLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!open || activeSection !== "environment") return;
    void loadEnvironmentSettings();
  }, [activeSection, loadEnvironmentSettings, open]);

  useEffect(() => {
    if (!open || activeSection !== "environment") return;
    setSelectedEnvironmentItemId((current) => {
      if (current && environmentItems.some((item) => item.id === current)) return current;
      return environmentItems[0]?.id ?? null;
    });
  }, [activeSection, environmentItems, open]);

  const handleSaveEnvironmentConfig = async (scope: EnvironmentScope, config: EnvironmentConfig) => {
    if (!selectedEnvironmentItem) return;
    const latestState = await invoke<AgentWorkspaceState>("get_agent_workspace_state");
    let nextState: AgentWorkspaceState;
    if (scope === "global") {
      nextState = {
        ...latestState,
        globalEnvironment: config,
      };
    } else if (scope === "project") {
      const projectKey = normalizeEnvironmentKey(selectedEnvironmentItem.projectPath);
      if (!projectKey) return;
      nextState = {
        ...latestState,
        projectEnvironments: {
          ...(latestState.projectEnvironments ?? {}),
          [projectKey]: config,
        },
      };
    } else {
      if (!selectedEnvironmentItem.sessionKey) return;
      nextState = {
        ...latestState,
        sessionEnvironments: {
          ...(latestState.sessionEnvironments ?? {}),
          [selectedEnvironmentItem.sessionKey]: config,
        },
      };
    }
    const saved = await invoke<AgentWorkspaceState>("save_agent_workspace_state", { state: nextState });
    setEnvironmentWorkspaceState(saved);
    setArchivedWorkspaceState(saved);
    window.dispatchEvent(new CustomEvent<AgentWorkspaceState>(AGENT_WORKSPACE_STATE_UPDATED_EVENT, { detail: saved }));
  };

  const handleUnarchiveConversation = async (item: ArchivedSettingsItem) => {
    setUnarchivingId(item.id);
    setArchivedError(null);
    try {
      const latestState = await invoke<AgentWorkspaceState>("get_agent_workspace_state");
      const timestamp = Date.now();
      const currentMeta = latestState.conversationMeta ?? {};
      const nextMeta = {
        ...currentMeta,
        [item.id]: {
          ...(currentMeta[item.id] ?? { id: item.id }),
          archived: false,
          archivedAt: null,
          unread: false,
        },
      };
      const nextState = {
        ...latestState,
        conversationMeta: nextMeta,
        sessions: latestState.sessions.map((session) =>
          session.id === item.runtimeSessionId
            ? {
                ...session,
                archived: false,
                archivedAt: null,
                unread: false,
                updatedAt: timestamp,
              }
            : session,
        ),
      };

      const saved = await invoke<AgentWorkspaceState>("save_agent_workspace_state", { state: nextState });
      setArchivedWorkspaceState(saved);
      window.dispatchEvent(new CustomEvent<AgentWorkspaceState>(AGENT_WORKSPACE_STATE_UPDATED_EVENT, { detail: saved }));
    } catch (error) {
      console.error("Failed to unarchive conversation:", error);
      setArchivedError("Failed to unarchive conversation.");
    } finally {
      setUnarchivingId(null);
    }
  };

  const handleAutoCopyChange = (checked: boolean) => {
    setAutoCopy(checked);
    setAutoCopyOnSelect(checked);
  };

  const handleStatusBarEnabledChange = async (checked: boolean) => {
    setStatusBarEnabled(checked);
    try {
      await invoke("save_statusbar_settings", {
        settings: { enabled: checked, scriptPath: statusBarScript },
      });
    } catch (e) {
      console.error("Failed to save statusbar settings:", e);
    }
  };

  const handleStatusBarScriptChange = async (path: string) => {
    setStatusBarScript(path);
    if (statusBarEnabled) {
      try {
        await invoke("save_statusbar_settings", {
          settings: { enabled: true, scriptPath: path },
        });
      } catch (e) {
        console.error("Failed to save statusbar settings:", e);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <div className="relative flex h-[32rem] max-h-[86vh] w-[52rem] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-serif text-lg font-semibold text-foreground">{t("common.settings")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card-alt hover:text-foreground"
            aria-label={t("settings.closeSettings")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Two-column layout */}
        <div className="flex min-h-0 flex-1">
          {/* Left sidebar */}
          <div className="w-40 shrink-0 border-r border-border bg-muted/30 px-3 py-4">
            {settingsGroups.map((group) => (
              <div key={group.titleKey} className="mb-5 last:mb-0">
                <p className="mb-1.5 px-2 text-[11px] font-medium text-muted-foreground">
                  {t(group.titleKey)}
                </p>
                <div className="space-y-0.5">
                  {group.sections.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full border-l-2 px-2 py-1.5 text-left text-sm transition-colors ${
                        activeSection === section.id
                          ? "border-primary bg-background font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {t(section.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* Right content */}
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {activeSection === "display" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.shortenPaths")}</p>
                    <p className="text-xs text-muted-foreground">{t("settings.shortenPathsDescription")}</p>
                  </div>
                  <Switch checked={shortenPaths} onCheckedChange={setShortenPaths} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("common.language")}</p>
                    <p className="text-xs text-muted-foreground">{t("settings.languageDescription")}</p>
                  </div>
                  <Select
                    value={languagePreference}
                    onValueChange={(value) => setLanguagePreference(value as LanguagePreference)}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.globalHotkey")}</p>
                    <p className="text-xs text-muted-foreground">{t("settings.globalHotkeyDescription")}</p>
                  </div>
                  <Switch checked={globalChatSearchHotkey} onCheckedChange={setGlobalChatSearchHotkey} />
                </div>
              </div>
            )}
            {activeSection === "composer" && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-serif text-lg font-semibold text-foreground">{t("settings.composer")}</h3>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">{t("settings.submitShortcut")}</p>
                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-background p-1">
                    {composerSubmitShortcutOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setComposerSubmitShortcut(option.value)}
                        className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          composerSubmitShortcut === option.value
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-card-alt hover:text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {activeSection === "archived" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-serif text-lg font-semibold text-foreground">{t("common.archived")}</h3>
                  </div>
                  {!archivedLoading && !archivedError ? (
                    <p className="shrink-0 text-xs font-medium text-muted-foreground">
                      {activeLanguage === "zh" ? `${archivedItems.length} 个对话` : `${archivedItems.length} conversations`}
                    </p>
                  ) : null}
                </div>
                {archivedLoading ? (
                  <div className="rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("settings.loadingArchivedConversations")}
                  </div>
                ) : archivedError ? (
                  <div className="rounded-xl border border-border bg-background px-4 py-4">
                    <p className="text-sm text-destructive">{archivedError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={loadArchivedSessions} className="mt-3 rounded-lg">
                      {t("common.retry")}
                    </Button>
                  </div>
                ) : archivedItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-background px-4 py-8 text-center">
                    <Archive className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">{t("settings.noArchivedConversations")}</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border bg-background">
                    {archivedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-4 border-b border-border px-4 py-4 transition-colors last:border-b-0 hover:bg-card-alt/50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground" title={item.title}>
                            {item.title}
                          </p>
                          <p
                            className="mt-1 truncate text-sm text-muted-foreground"
                            title={item.projectPath ?? item.projectLabel}
                          >
                            {formatSettingsTimestamp(getArchivedListTimestamp(item), locale)} · {item.projectPath ? formatPath(item.projectPath) : item.projectLabel}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={unarchivingId === item.id}
                          onClick={() => handleUnarchiveConversation(item)}
                          title={`${t("settings.unarchive")} ${item.title}`}
                          aria-label={`${t("settings.unarchive")} ${item.title}`}
                          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-card-alt px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                        >
                          {t("settings.unarchive")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeSection === "terminal" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.autoCopyOnSelect")}</p>
                    <p className="text-xs text-muted-foreground">{t("settings.autoCopyOnSelectDescription")}</p>
                  </div>
                  <Switch checked={autoCopy} onCheckedChange={handleAutoCopyChange} />
                </div>
              </div>
            )}
            {activeSection === "environment" && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-lg font-semibold text-foreground">{t("common.environment")}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t("settings.environmentDescription")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {!environmentLoading && !environmentError ? (
                      <p className="text-xs font-medium text-muted-foreground">
                        {environmentItems.length === 1
                          ? t("settings.environmentCountOne")
                          : t("settings.environmentCount", { count: environmentItems.length })}
                      </p>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" onClick={loadEnvironmentSettings} disabled={environmentLoading}>
                      {t("common.refresh")}
                    </Button>
                  </div>
                </div>

                {environmentLoading ? (
                  <div className="rounded-xl border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("settings.loadingEnvironmentSettings")}
                  </div>
                ) : environmentError ? (
                  <div className="rounded-xl border border-border bg-background px-4 py-4">
                    <p className="text-sm text-destructive">{environmentError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={loadEnvironmentSettings} className="mt-3 rounded-lg">
                      {t("common.retry")}
                    </Button>
                  </div>
                ) : environmentItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("settings.noExecEnvironments")}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-xl border border-border bg-background">
                      <div className="max-h-44 overflow-y-auto p-1.5">
	                        {environmentItems.map((item) => {
	                          const selected = selectedEnvironmentItem?.id === item.id;
	                          const projectLabel = item.projectPath ? formatPath(item.projectPath) : t("common.global");
	                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedEnvironmentItemId(item.id)}
                              className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                                selected
                                  ? "border-primary bg-primary/5"
                                  : "border-transparent hover:bg-card-alt/60"
                              }`}
                            >
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <p className="truncate text-sm font-medium text-foreground" title={translate(item.title)}>
                                      {translate(item.title)}
                                    </p>
	                                    <span className="shrink-0 rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-normal text-primary">
	                                      {item.type === "global" ? t("common.global") : item.type === "project" ? t("common.project") : t("common.session")}
	                                    </span>
                                  </div>
                                  <p className="mt-1 truncate text-xs text-muted-foreground" title={translate(item.subtitle)}>
                                    {translate(item.subtitle)}
                                  </p>
                                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={item.projectPath ?? projectLabel}>
                                    {projectLabel}
                                  </p>
                                </div>
                                {item.updatedAt ? (
                                  <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground">
                                    {formatSettingsTimestamp(item.updatedAt, locale)}
                                  </span>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
	                    {selectedEnvironmentItem && (selectedEnvironmentItem.type === "global" || selectedEnvironmentItem.projectPath) ? (
	                      <EnvironmentEditor
	                        active
	                        embedded
	                        showRunControls={false}
	                        showScopeControls={false}
	                        projectPath={selectedEnvironmentItem.projectPath}
	                        sessionKey={selectedEnvironmentItem.sessionKey}
	                        sessionTitle={selectedEnvironmentItem.sessionTitle}
	                        globalConfig={selectedEnvironmentItem.globalConfig}
	                        projectConfig={selectedEnvironmentItem.projectConfig}
	                        sessionConfig={selectedEnvironmentItem.sessionConfig}
                        defaultScope={selectedEnvironmentItem.type}
                        onSave={handleSaveEnvironmentConfig}
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-background px-4 py-6 text-sm text-muted-foreground">
                        {t("settings.sessionEnvironmentSourceMissing")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {activeSection === "statusbar" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settings.customScriptMode")}</p>
                    <p className="text-xs text-muted-foreground">{t("settings.customScriptModeDescription")}</p>
                  </div>
                  <Switch checked={statusBarEnabled} onCheckedChange={handleStatusBarEnabledChange} />
                </div>
                {statusBarEnabled && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">{t("settings.scriptPath")}</label>
                    <Input
                      className="text-xs font-mono"
                      placeholder="~/.lovstudio/lovcode/statusbar/default.sh"
                      value={statusBarScript}
                      onChange={(e) => handleStatusBarScriptChange(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {t("settings.statusbarScriptHelp")}
                      <br />
                      <span className="text-muted-foreground/70">{t("settings.supportsAnsiColorCodes")}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
