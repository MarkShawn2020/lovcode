import { useNavigate } from "react-router-dom";
import { McpView } from "../../views/Mcp";
import { FeaturesLayout } from "../../views/Features";

export default function McpPage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="mcp">
      <McpView
        onMarketplaceSelect={(template) => {
          navigate(`/mcp/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
