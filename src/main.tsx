import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import routes from "~react-pages";
import { Suspense } from "react";
import { listen } from "@tauri-apps/api/event";
import "./index.css";

const router = createHashRouter(routes);

// Cross-window navigation: floating palette → main window result click.
listen<string>("lovcode:navigate-conversation", (event) => {
  const id = event.payload;
  if (id) {
    router.navigate(`/conversation/${encodeURIComponent(id)}`).catch(() => {});
  }
}).catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
    <RouterProvider router={router} />
  </Suspense>,
);
