/**
 * Skill Detail Page
 * - /skills/foo → installed skill
 * - /skills/foo?source=marketplace → marketplace template
 */
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { LocalSkill, TemplateComponent, TemplatesCatalog } from "../../types";
import { TemplateDetailView } from "../../views/Marketplace";
import { FeaturesLayout } from "../../views/Features";
import { LoadingState } from "../../components/config";

function skillToTemplate(skill: LocalSkill): TemplateComponent {
  return {
    name: skill.name,
    path: skill.path,
    category: "skill",
    component_type: "skill",
    description: skill.description,
    downloads: skill.marketplace?.downloads ?? null,
    content: skill.content,
    source_id: skill.marketplace?.source_id ?? null,
    source_name: skill.marketplace?.source_name ?? null,
    author: skill.marketplace?.author ?? null,
  };
}

export default function SkillDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMarketplace = searchParams.get("source") === "marketplace";

  const { data: localSkill, isLoading: localLoading } = useQuery({
    queryKey: ["skill", name],
    queryFn: async () => {
      const skills = await invoke<LocalSkill[]>("list_local_skills");
      return skills.find(s => s.name === name) ?? null;
    },
    enabled: !!name && !isMarketplace,
  });

  const { data: marketplaceTemplate, isLoading: marketplaceLoading } = useQuery({
    queryKey: ["marketplaceSkill", name],
    queryFn: async () => {
      const catalog = await invoke<TemplatesCatalog>("get_templates_catalog");
      return catalog.skills?.find(t => t.name === name) ?? null;
    },
    enabled: !!name && isMarketplace,
  });

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
