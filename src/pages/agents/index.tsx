import { useNavigate } from "react-router-dom";
import { SubAgentsView } from "../../views/SubAgents";
import { FeaturesLayout } from "../../views/Features";

export default function AgentsPage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="sub-agents">
      <SubAgentsView
        onSelect={(agent) => navigate(`/agents/${encodeURIComponent(agent.name)}`)}
        onMarketplaceSelect={(template) => {
          navigate(`/agents/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
