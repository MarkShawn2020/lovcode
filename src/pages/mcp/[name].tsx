/**
 * MCP Detail Page (marketplace only for now)
 */
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";

export default function McpDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading } = useQuery({
    queryKey: ["marketplaceMcp", name],
    queryFn: async () => {
      const catalog = await invoke<TemplatesCatalog>("get_templates_catalog");
      return catalog.mcps?.find(t => t.name === name) ?? null;
    },
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <FeaturesLayout feature="mcp">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (!template) {
    return (
      <FeaturesLayout feature="mcp">
        <div className="p-6">
          <p className="text-destructive">MCP server "{name}" not found</p>
          <button onClick={() => navigate("/mcp")} className="mt-2 text-primary hover:underline">
            ← Back to MCP
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="mcp">
      <TemplateDetailView
        template={template}
        category="mcps"
        onBack={() => navigate("/mcp")}
      />
    </FeaturesLayout>
  );
}
