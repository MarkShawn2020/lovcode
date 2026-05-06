/**
 * Skill Detail Page
 * - /skills/foo → installed skill
 * - /skills/foo?source=marketplace → marketplace template
 */
import { useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import type { LocalSkill, TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";
import { skillToTemplate } from "../../views/Skills/skillTemplates";
import { queryKeys, useInvokeQuery } from "../../hooks";

export default function SkillDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMarketplace = searchParams.get("source") === "marketplace";

  const { data: skills = [], isLoading: localLoading } = useInvokeQuery<LocalSkill[]>(
    queryKeys.skills,
    "list_local_skills",
    undefined,
    { enabled: !!name && !isMarketplace },
  );
  const localSkill = useMemo(
    () => skills.find((skill) => skill.name === name) ?? null,
    [name, skills],
  );

  const { data: catalog, isLoading: marketplaceLoading } = useInvokeQuery<TemplatesCatalog>(
    queryKeys.templatesCatalog,
    "get_templates_catalog",
    undefined,
    { enabled: !!name && isMarketplace },
  );
  const marketplaceTemplate = useMemo(
    () => catalog?.skills?.find((template) => template.name === name) ?? null,
    [catalog, name],
  );

  const isLoading = isMarketplace ? marketplaceLoading : localLoading;

  if (isLoading) {
    return (
      <FeaturesLayout feature="skills">
        <LoadingState message={`Loading ${name}...`} />
      </FeaturesLayout>
    );
  }

  if (isMarketplace) {
    if (!marketplaceTemplate) {
      return (
        <FeaturesLayout feature="skills">
          <div className="p-6">
            <p className="text-destructive">Template "{name}" not found in marketplace</p>
            <button onClick={() => navigate("/skills")} className="mt-2 text-primary hover:underline">
              ← Back to Skills
            </button>
          </div>
        </FeaturesLayout>
      );
    }
    return (
      <FeaturesLayout feature="skills">
        <TemplateDetailView
          template={marketplaceTemplate}
          category="skills"
          onBack={() => navigate("/skills")}
        />
      </FeaturesLayout>
    );
  }

  if (!localSkill) {
    return (
      <FeaturesLayout feature="skills">
        <div className="p-6">
          <p className="text-destructive">Skill "{name}" not found</p>
          <button onClick={() => navigate("/skills")} className="mt-2 text-primary hover:underline">
            ← Back to Skills
          </button>
        </div>
      </FeaturesLayout>
    );
  }

  return (
    <FeaturesLayout feature="skills">
      <TemplateDetailView
        template={skillToTemplate(localSkill)}
        category="skills"
        onBack={() => navigate("/skills")}
        localPath={localSkill.path}
        isInstalled={true}
      />
    </FeaturesLayout>
  );
}
