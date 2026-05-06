import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";
import { queryKeys, useInvokeQuery } from "../../hooks";

export default function HookDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: catalog, isLoading } = useInvokeQuery<TemplatesCatalog>(
    queryKeys.templatesCatalog,
    "get_templates_catalog",
    undefined,
    { enabled: !!name },
  );
  const template = useMemo(
    () => catalog?.hooks?.find((item) => item.name === name) ?? null,
    [catalog, name],
  );

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
