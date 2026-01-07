/**
 * React Router Configuration
 *
 * Uses vite-plugin-pages for file-system based routing.
 * URL is the ONLY source of truth for navigation.
 */
import { Suspense } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import routes from "~react-pages";
import { LoadingState } from "./components/config";
import RootLayout from "./pages/_layout";

// ============================================================================
// Router Configuration
// ============================================================================

// Wrap routes with root layout
const routesWithLayout = [
  {
    path: "/",
    element: <RootLayout />,
    children: routes,
  },
];

const router = createHashRouter(routesWithLayout);

// ============================================================================
// Router Provider
// ============================================================================

export function AppRouter() {
  return (
    <Suspense fallback={<LoadingState message="Loading..." />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}

// ============================================================================
// Re-exports for navigation
// ============================================================================

export { useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
