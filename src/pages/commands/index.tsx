import { useNavigate } from "react-router-dom";
import { CommandsView } from "../../views/Commands";
import { FeaturesLayout } from "../../views/Features";

export default function CommandsPage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="commands">
      <CommandsView
        onSelect={(command) => {
          navigate(`/commands/${encodeURIComponent(command.name)}`);
        }}
        onMarketplaceSelect={(template) => {
          navigate(`/commands/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
