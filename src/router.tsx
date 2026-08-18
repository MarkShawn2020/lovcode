/**
 * React Router Configuration
 *
 * Uses vite-plugin-pages for file-system based routing.
 * URL is the ONLY source of truth for navigation.
 */
import { Suspense } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import routes from "~react-pages";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import RootLayout from "./pages/_layout";

// ============================================================================
// Router Configuration
// ============================================================================

// Routes that bypass RootLayout: the global-search panel renders in its own
// native window, and /landing is the public web page served on
// ataru.lovstudio.ai — it must not mount the desktop shell, which invokes Tauri.
const STANDALONE_PATHS = new Set(["/search-overlay", "/landing"]);
const standaloneRoutes = routes.filter((r) =>
  r && typeof r === "object" && "path" in r && STANDALONE_PATHS.has(`/${(r as { path?: string }).path ?? ""}`)
);
const layoutRoutes = routes.filter((r) => !standaloneRoutes.includes(r));

const routesWithLayout = [
  ...standaloneRoutes.map((r) => ({ ...(r as object), errorElement: <RouteErrorBoundary /> })),
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: layoutRoutes,
  },
  // Unknown paths would otherwise hit React Router's developer error screen.
  { path: "*", element: <RouteErrorBoundary /> },
];

const router = createHashRouter(routesWithLayout);

// ============================================================================
// Router Provider
// ============================================================================

export function AppRouter() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">正在读取本地对话…</div>}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

// ============================================================================
// Re-exports for navigation
// ============================================================================

export { useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
