import { ExtensionsView } from "../../views/Extensions";
import { FeaturesLayout } from "../../views/Features";

export default function ExtensionsPage() {
  return (
    <FeaturesLayout feature="extensions">
      <ExtensionsView />
    </FeaturesLayout>
  );
}
