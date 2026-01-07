import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { TemplatesCatalog } from "../../../types";
import { TemplateDetailView } from "../../../views/Marketplace";
import { FeaturesLayout } from "../../../views/Features";
import { LoadingState } from "../../../components/config";

export default function SettingsTemplateDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: template, isLoading } = useQuery({
    queryKey: ["marketplaceSettings", name],
    queryFn: async () => {
      const catalog = await invoke<TemplatesCatalog>("get_templates_catalog");
      return catalog.settings?.find(t => t.name === name) ?? null;
    },
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <FeaturesLayout feature="settings">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (!template) {
    return (
      <FeaturesLayout feature="settings">
        <div className="p-6">
          <p className="text-destructive">Settings template "{name}" not found</p>
          <button onClick={() => navigate("/settings")} className="mt-2 text-primary hover:underline">
            ← Back to Settings
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="settings">
      <TemplateDetailView
        template={template}
        category="settings"
        onBack={() => navigate("/settings")}
      />
    </FeaturesLayout>
  );
}
