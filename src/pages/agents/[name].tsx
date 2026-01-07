import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";

export default function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading } = useQuery({
    queryKey: ["marketplaceAgent", name],
    queryFn: async () => {
      const catalog = await invoke<TemplatesCatalog>("get_templates_catalog");
      return catalog.agents?.find(t => t.name === name) ?? null;
    },
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <FeaturesLayout feature="sub-agents">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (!template) {
    return (
      <FeaturesLayout feature="sub-agents">
        <div className="p-6">
          <p className="text-destructive">Agent "{name}" not found</p>
          <button onClick={() => navigate("/agents")} className="mt-2 text-primary hover:underline">
            ← Back to Agents
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="sub-agents">
      <TemplateDetailView
        template={template}
        category="agents"
        onBack={() => navigate("/agents")}
      />
    </FeaturesLayout>
  );
}
