import { EnvSettingsView } from "../../views/Settings";
import { FeaturesLayout } from "../../views/Features";

export default function EnvSettingsPage() {
  return (
    <FeaturesLayout feature="basic-env">
      <EnvSettingsView />
    </FeaturesLayout>
  );
}
