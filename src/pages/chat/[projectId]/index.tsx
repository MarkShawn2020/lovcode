import { useParams, useNavigate } from "react-router-dom";
import { SessionList } from "../../../views/Chat";

export default function ChatSessionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  if (!projectId) return null;

  return (
    <SessionList
      projectId={decodeURIComponent(projectId)}
      projectPath=""
      onBack={() => navigate("/chat")}
      onSelect={(s) => navigate(`/chat/${encodeURIComponent(s.project_id)}/${encodeURIComponent(s.id)}`)}
    />
  );
}
