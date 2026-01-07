import { useNavigate } from "react-router-dom";
import { SkillsView } from "../../views/Skills";
import { FeaturesLayout } from "../../views/Features";

export default function SkillsPage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="skills">
      <SkillsView
        onSelectTemplate={(_template, localPath) => {
          const name = localPath.split("/").pop()?.replace(/\.md$/, "") || "";
          navigate(`/skills/${encodeURIComponent(name)}`);
        }}
        onMarketplaceSelect={(template) => {
          navigate(`/skills/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
