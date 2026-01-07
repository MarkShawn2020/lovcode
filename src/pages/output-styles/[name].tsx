import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";

export default function OutputStyleDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading } = useQuery({
    queryKey: ["marketplaceOutputStyle", name],
    queryFn: async () => {
      const catalog = await invoke<TemplatesCatalog>("get_templates_catalog");
      return catalog["output-styles"]?.find((t) => t.name === name) ?? null;
    },
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <FeaturesLayout feature="output-styles">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (!template) {
    return (
      <FeaturesLayout feature="output-styles">
        <div className="p-6">
          <p className="text-destructive">Output style "{name}" not found</p>
          <button onClick={() => navigate("/output-styles")} className="mt-2 text-primary hover:underline">
            ← Back to Output Styles
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="output-styles">
      <TemplateDetailView
        template={template}
        category="output-styles"
        onBack={() => navigate("/output-styles")}
      />
    </FeaturesLayout>
  );
}
