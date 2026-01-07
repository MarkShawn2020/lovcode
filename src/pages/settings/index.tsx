import { useNavigate } from "react-router-dom";
import { SettingsView } from "../../views/Settings";
import { FeaturesLayout } from "../../views/Features";

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <FeaturesLayout feature="settings">
      <SettingsView
        onMarketplaceSelect={(template) => {
          navigate(`/settings/template/${encodeURIComponent(template.name)}?source=marketplace`);
        }}
      />
    </FeaturesLayout>
  );
}
