import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";
import { queryKeys, useInvokeQuery } from "../../hooks";

export default function StatuslineDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: catalog, isLoading } = useInvokeQuery<TemplatesCatalog>(
    queryKeys.templatesCatalog,
    "get_templates_catalog",
    undefined,
    { enabled: !!name },
  );
  const template = useMemo(
    () => catalog?.statuslines?.find((item) => item.name === name) ?? null,
    [catalog, name],
  );

  if (isLoading) {
    return (
      <FeaturesLayout feature="statusline">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (!template) {
    return (
      <FeaturesLayout feature="statusline">
        <div className="p-6">
          <p className="text-destructive">Statusline "{name}" not found</p>
          <button onClick={() => navigate("/statusline")} className="mt-2 text-primary hover:underline">
            ← Back to Statusline
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="statusline">
      <TemplateDetailView
        template={template}
        category="statuslines"
        onBack={() => navigate("/statusline")}
      />
    </FeaturesLayout>
  );
}
