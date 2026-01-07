/**
 * Skill Detail Page - Route-based component
 *
 * Fetches skill data based on URL param and renders detail view.
 * This is a proper route component - URL is the source of truth.
 */
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { LocalSkill, TemplateComponent } from "../types";
import { TemplateDetailView } from "../views/Marketplace/TemplateDetailView";
import { LoadingState } from "../components/config";

/** Convert LocalSkill to TemplateComponent */
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

export function SkillDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: skill, isLoading, error } = useQuery({
    queryKey: ["skill", name],
    queryFn: async () => {
      const skills = await invoke<LocalSkill[]>("list_local_skills");
      const found = skills.find(s => s.name === name);
      if (!found) throw new Error(`Skill "${name}" not found`);
      return found;
    },
    enabled: !!name,
  });

  if (isLoading) {
    return <LoadingState message={`Loading ${name}...`} />;
  }

  if (error || !skill) {
    return (
      <div className="p-6">
        <p className="text-destructive">Skill "{name}" not found</p>
        <button onClick={() => navigate("/skills")} className="mt-2 text-primary hover:underline">
          ← Back to Skills
        </button>
      </div>
    );
  }

  return (
    <TemplateDetailView
      template={skillToTemplate(skill)}
      category="skills"
      onBack={() => navigate("/skills")}
      localPath={skill.path}
      isInstalled={true}
    />
  );
}
