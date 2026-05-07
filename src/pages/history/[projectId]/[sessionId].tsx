import { Navigate, useLocation, useParams } from "react-router-dom";

export default function HistorySessionRedirectPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const location = useLocation();

  if (!projectId || !sessionId) return <Navigate to="/workbench" replace />;

  const search = new URLSearchParams(location.search);
  search.set("projectId", decodeURIComponent(projectId));
  search.set("sessionId", decodeURIComponent(sessionId));

  return <Navigate to={`/workbench?${search.toString()}`} replace />;
}
