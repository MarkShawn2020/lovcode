import { Navigate } from "react-router-dom";

const LAST_PATH_KEY = "lovcode:lastPath";

// Routes that no longer exist (/chat and /history merged into /workbench)
function migrateLegacyPath(path: string): string {
  if (path === "/settings/llm") return "/settings/maas";
  if (path === "/chat" || path.startsWith("/chat/")) return migrateHistoryPath(path.replace(/^\/chat/, "/history"));
  return migrateHistoryPath(path);
}

function migrateHistoryPath(path: string): string {
  if (path === "/history") return "/workbench";
  if (path.startsWith("/history?")) return path.replace(/^\/history/, "/workbench");
  if (!path.startsWith("/history/")) return path;

  const [pathname, query = ""] = path.split("?");
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 3) {
    const params = new URLSearchParams(query);
    params.set("projectId", safeDecode(parts[1]));
    params.set("sessionId", safeDecode(parts[2]));
    return `/workbench?${params.toString()}`;
  }

  return "/workbench";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getLastPath(): string {
  try {
    const saved = localStorage.getItem(LAST_PATH_KEY);
    if (saved && saved !== "/" && saved.startsWith("/") && saved !== "/annual-report-2025") {
      return migrateLegacyPath(saved);
    }
  } catch {}
  return "/workbench";
}

export default function HomePage() {
  return <Navigate to={getLastPath()} replace />;
}
