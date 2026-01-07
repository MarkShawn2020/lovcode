import { useNavigate } from "react-router-dom";
import { OutputStylesView } from "../../views/OutputStyles";
import { FeaturesLayout } from "../../views/Features";

export default function OutputStylesPage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="output-styles">
      <OutputStylesView
        onMarketplaceSelect={(template) => {
          navigate(`/output-styles/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
