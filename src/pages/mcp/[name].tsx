/**
 * MCP Detail Page (marketplace only for now)
 */
import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";
import { queryKeys, useInvokeQuery } from "../../hooks";

export default function McpDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: catalog, isLoading } = useInvokeQuery<TemplatesCatalog>(
    queryKeys.templatesCatalog,
    "get_templates_catalog",
    undefined,
    { enabled: !!name },
  );
  const template = useMemo(
    () => catalog?.mcps?.find((item) => item.name === name) ?? null,
    [catalog, name],
  );

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
