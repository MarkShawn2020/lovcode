import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";

export default function HookDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading } = useQuery({
    queryKey: ["marketplaceHook", name],
    queryFn: async () => {
      const catalog = await invoke<TemplatesCatalog>("get_templates_catalog");
      return catalog.hooks?.find(t => t.name === name) ?? null;
    },
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <FeaturesLayout feature="hooks">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (!template) {
    return (
      <FeaturesLayout feature="hooks">
        <div className="p-6">
          <p className="text-destructive">Hook "{name}" not found</p>
          <button onClick={() => navigate("/hooks")} className="mt-2 text-primary hover:underline">
            ← Back to Hooks
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="hooks">
      <TemplateDetailView
        template={template}
        category="hooks"
        onBack={() => navigate("/hooks")}
      />
    </FeaturesLayout>
  );
}
