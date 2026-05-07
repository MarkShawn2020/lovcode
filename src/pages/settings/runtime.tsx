import { AgentRuntimeView } from "../../views/Settings";
import { FeaturesLayout } from "../../views/Features";

export default function AgentRuntimePage() {
  return (
    <FeaturesLayout feature="basic-version">
      <AgentRuntimeView />
    </FeaturesLayout>
  );
}
