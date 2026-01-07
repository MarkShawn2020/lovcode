import { useNavigate } from "react-router-dom";
import { Home } from "../views/Home";

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <Home
      onFeatureClick={(feature) => {
        const routes: Record<string, string> = {
          "chat": "/chat",
          "basic-env": "/settings/env",
          "basic-llm": "/settings/llm",
          "basic-version": "/settings/version",
          "basic-context": "/settings/context",
          "settings": "/settings",
          "commands": "/commands",
          "mcp": "/mcp",
          "skills": "/skills",
          "hooks": "/hooks",
          "sub-agents": "/agents",
          "output-styles": "/output-styles",
          "statusline": "/statusline",
          "kb-distill": "/knowledge/distill",
          "kb-reference": "/knowledge/reference",
          "workspace": "/workspace",
          "features": "/features",
          "marketplace": "/marketplace",
        };
        const path = routes[feature];
        if (path) navigate(path);
      }}
      onProjectClick={(p) => navigate(`/chat/${encodeURIComponent(p.id)}`)}
      onSessionClick={(s) => navigate(`/chat/${encodeURIComponent(s.project_id)}/${encodeURIComponent(s.id)}`)}
      onSearch={() => navigate("/chat")}
      onOpenAnnualReport={() => navigate("/annual-report-2025")}
    />
  );
}
