import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { GlobalHeader, type PrimaryRoute } from "@/components/GlobalHeader";

export default function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoute: PrimaryRoute = location.pathname.startsWith("/workbench") || location.pathname.startsWith("/workspace") || location.pathname.startsWith("/history")
    ? "library"
    : location.pathname.startsWith("/settings")
      ? "settings"
      : "search";

  const navigatePrimary = (route: PrimaryRoute) => {
    navigate({ search: "/search", library: "/workbench", settings: "/settings" }[route]);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <GlobalHeader
        activeRoute={activeRoute}
        onNavigate={navigatePrimary}
        onGoBack={() => navigate(-1)}
        onGoForward={() => navigate(1)}
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
