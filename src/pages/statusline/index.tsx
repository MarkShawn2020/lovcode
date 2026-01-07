import { useNavigate } from "react-router-dom";
import { StatuslineView } from "../../views/Statusline/StatuslineView";
import { FeaturesLayout } from "../../views/Features";
import type { TemplateComponent } from "../../types";

export default function StatuslinePage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="statusline">
      <StatuslineView
        onMarketplaceSelect={(template: TemplateComponent) => {
          navigate(`/statusline/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
