/**
 * React Router Configuration
 *
 * URL is the ONLY source of truth for navigation.
 * Each route renders its component directly - no Jotai state involvement.
 */
import { createHashRouter, RouterProvider, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { LoadingState } from "./components/config";

// Lazy load route components for code splitting
const AppShell = lazy(() => import("./AppShell").then(m => ({ default: m.AppShell })));

// Route page components (these fetch their own data)
import { SkillDetailPage, CommandDetailPage } from "./routes";

// ============================================================================
// Router Configuration
// ============================================================================

const router = createHashRouter([
  {
    path: "/",
    element: (
      <Suspense fallback={<LoadingState message="Loading..." />}>
        <AppShell />
      </Suspense>
    ),
    children: [
      // Home
      { index: true, element: <RouteContent route="home" /> },

      // Workspace
      { path: "workspace", element: <RouteContent route="workspace" /> },

      // Features
      { path: "features", element: <RouteContent route="features" /> },

      // Skills
      { path: "skills", element: <RouteContent route="skills" /> },
      { path: "skills/:name", element: <SkillDetailPage /> },

      // Commands
      { path: "commands", element: <RouteContent route="commands" /> },
      { path: "commands/:name", element: <CommandDetailPage /> },

      // MCP
      { path: "mcp", element: <RouteContent route="mcp" /> },

      // Hooks
      { path: "hooks", element: <RouteContent route="hooks" /> },

      // Sub-Agents
      { path: "agents", element: <RouteContent route="sub-agents" /> },

      // Output Styles
      { path: "output-styles", element: <RouteContent route="output-styles" /> },

      // Statusline
      { path: "statusline", element: <RouteContent route="statusline" /> },

      // Settings
      { path: "settings", element: <RouteContent route="settings" /> },
      { path: "settings/env", element: <RouteContent route="basic-env" /> },
      { path: "settings/llm", element: <RouteContent route="basic-llm" /> },
      { path: "settings/version", element: <RouteContent route="basic-version" /> },
      { path: "settings/context", element: <RouteContent route="basic-context" /> },

      // Chat
      { path: "chat", element: <RouteContent route="chat-projects" /> },
      { path: "chat/:projectId", element: <RouteContent route="chat-sessions" /> },
      { path: "chat/:projectId/:sessionId", element: <RouteContent route="chat-messages" /> },

      // Knowledge
      { path: "knowledge/distill", element: <RouteContent route="kb-distill" /> },
      { path: "knowledge/reference", element: <RouteContent route="kb-reference" /> },

      // Marketplace
      { path: "marketplace", element: <RouteContent route="marketplace" /> },
      { path: "marketplace/:category", element: <RouteContent route="marketplace" /> },

      // Annual Report
      { path: "annual-report-2025", element: <RouteContent route="annual-report-2025" /> },

      // Catch-all
      { path: "*", element: <RouteContent route="home" /> },
    ],
  },
]);

// ============================================================================
// Route Content Component
// ============================================================================

/**
 * Placeholder component for routes handled by AppShell
 */
function RouteContent(_props: { route: string }) {
  // AppShell reads location and renders the appropriate view
  return null;
}

// ============================================================================
// Router Provider
// ============================================================================

export function AppRouter() {
  return <RouterProvider router={router} />;
}

// ============================================================================
// Hooks for navigation
// ============================================================================

export { useNavigate, useLocation, useParams } from "react-router-dom";

/**
 * Get current route info from URL
 */
export function useCurrentRoute() {
  const location = useLocation();
  return parsePathToRoute(location.pathname);
}

export type RouteInfo = {
  route: string;
  params: Record<string, string>;
};

function parsePathToRoute(pathname: string): RouteInfo {
  const path = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) return { route: "home", params: {} };

  const [first, second, third] = segments;

  switch (first) {
    case "workspace": return { route: "workspace", params: {} };
    case "features": return { route: "features", params: {} };
    case "annual-report-2025": return { route: "annual-report-2025", params: {} };
    case "skills":
      if (second) return { route: "skill-detail", params: { name: decodeURIComponent(second) } };
      return { route: "skills", params: {} };
    case "commands":
      if (second) return { route: "command-detail", params: { name: decodeURIComponent(second) } };
      return { route: "commands", params: {} };
    case "mcp": return { route: "mcp", params: {} };
    case "hooks": return { route: "hooks", params: {} };
    case "agents": return { route: "sub-agents", params: {} };
    case "output-styles": return { route: "output-styles", params: {} };
    case "statusline": return { route: "statusline", params: {} };
    case "settings":
      if (second === "env") return { route: "basic-env", params: {} };
      if (second === "llm") return { route: "basic-llm", params: {} };
      if (second === "version") return { route: "basic-version", params: {} };
      if (second === "context") return { route: "basic-context", params: {} };
      return { route: "settings", params: {} };
    case "chat":
      if (third) return { route: "chat-messages", params: { projectId: decodeURIComponent(second), sessionId: decodeURIComponent(third) } };
      if (second) return { route: "chat-sessions", params: { projectId: decodeURIComponent(second) } };
      return { route: "chat-projects", params: {} };
    case "knowledge":
      if (second === "distill") return { route: "kb-distill", params: {} };
      if (second === "reference") return { route: "kb-reference", params: {} };
      return { route: "home", params: {} };
    case "marketplace":
      if (second) return { route: "marketplace", params: { category: second } };
      return { route: "marketplace", params: {} };
    default:
      return { route: "home", params: {} };
  }
}
