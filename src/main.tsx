import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loader } from "@monaco-editor/react";
import App from "./App";
import "./index.css";

// Configure Monaco Editor to use local bundled version (avoid CDN issues)
loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs" } });

// Disable browser context menu in production (no reload/inspect-element)
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
