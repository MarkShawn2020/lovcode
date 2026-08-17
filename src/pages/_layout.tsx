import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { GlobalHeader, type PrimaryRoute } from "@/components/GlobalHeader";
import { AppUpdateNotice } from "@/components/AppUpdateNotice";
import { SearchIndexStatus } from "@/components/SearchIndexStatus";
import { useSearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";

export default function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    status: indexStatus,
    progress: indexProgress,
    activity: indexActivity,
    start: startIndexBuild,
  } = useSearchIndexBuildStatus();
  const indexStartAttempted = useRef(false);
  const activeRoute: PrimaryRoute = location.pathname.startsWith("/workbench") || location.pathname.startsWith("/workspace") || location.pathname.startsWith("/history")
    ? "library"
    : location.pathname.startsWith("/settings")
      ? "settings"
      : "search";

  const navigatePrimary = (route: PrimaryRoute) => {
    navigate({ search: "/search", library: "/workbench", settings: "/settings" }[route]);
  };

  useEffect(() => {
    if (indexStatus?.state !== "idle" || indexStartAttempted.current) return;
    indexStartAttempted.current = true;
    startIndexBuild(false).catch(() => {
      indexStartAttempted.current = false;
    });
  }, [indexStatus?.state, startIndexBuild]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <GlobalHeader
        activeRoute={activeRoute}
        onNavigate={navigatePrimary}
        onGoBack={() => navigate(-1)}
        onGoForward={() => navigate(1)}
        rightSlot={
          <SearchIndexStatus
            status={indexStatus}
            progress={indexProgress}
            activity={indexActivity}
            onRetry={() => void startIndexBuild(false)}
          />
        }
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <AppUpdateNotice />
    </div>
  );
}
