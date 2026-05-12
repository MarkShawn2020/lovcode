import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import routes from "~react-pages";
import { Suspense } from "react";
import "./index.css";

const router = createHashRouter(routes);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
    <RouterProvider router={router} />
  </Suspense>,
);
