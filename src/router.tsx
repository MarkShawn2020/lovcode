/**
 * React Router Configuration
 *
 * Uses vite-plugin-pages for file-system based routing.
 * URL is the ONLY source of truth for navigation.
 */
import { Suspense } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import routes from "~react-pages";
import RootLayout from "./pages/_layout";

// ============================================================================
// Router Configuration
// ============================================================================

// The global-search panel renders in its own native window.
const STANDALONE_PATHS = new Set(["/search-overlay"]);
const standaloneRoutes = routes.filter((r) =>
  r && typeof r === "object" && "path" in r && STANDALONE_PATHS.has(`/${(r as { path?: string }).path ?? ""}`)
);
const layoutRoutes = routes.filter((r) => !standaloneRoutes.includes(r));

const routesWithLayout = [
  ...standaloneRoutes,
  {
    path: "/",
    element: <RootLayout />,
    children: layoutRoutes,
  },
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
