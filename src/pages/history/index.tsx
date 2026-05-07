import { Navigate, useLocation } from "react-router-dom";

export default function HistoryRedirectPage() {
  const location = useLocation();
  return <Navigate to={`/workbench${location.search}`} replace />;
}
