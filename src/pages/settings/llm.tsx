import { LlmProviderView } from "../../views/Settings";
import { FeaturesLayout } from "../../views/Features";

export default function LlmProviderPage() {
  return (
    <FeaturesLayout feature="basic-llm">
      <LlmProviderView />
    </FeaturesLayout>
  );
}
