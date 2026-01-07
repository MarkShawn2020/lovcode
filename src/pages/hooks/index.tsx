import { useNavigate } from "react-router-dom";
import { HooksView } from "../../views/Hooks";
import { FeaturesLayout } from "../../views/Features";

export default function HooksPage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="hooks">
      <HooksView
        onMarketplaceSelect={(template) => {
          navigate(`/hooks/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
