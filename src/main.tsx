import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import routes from "~react-pages";
import { Suspense } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppShell } from "@/components/AppShell";
import "./index.css";

// Routes that bypass AppShell — secondary windows with bare chrome.
const STANDALONE = new Set(["search-overlay"]);
const standalone = routes.filter(
  (r): r is { path: string } & typeof r =>
    !!r && typeof r === "object" && "path" in r && STANDALONE.has((r as any).path),
);
const shellChildren = routes.filter((r) => !standalone.includes(r as any));

const router = createHashRouter([
  ...standalone,
  { path: "/", element: <AppShell />, children: shellChildren as any },
]);

// Cross-window navigation: floating palette → main window result click.
listen<string>("lovcode:navigate-conversation", (event) => {
  const id = event.payload;
  if (id) router.navigate(`/conversation/${encodeURIComponent(id)}`).catch(() => {});
}).catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Suspense fallback={<div className="p-8 text-sm text-ink-soft">Loading…</div>}>
    <RouterProvider router={router} />
  </Suspense>,
);
