import { ClaudeVersionView } from "../../views/Settings";
import { FeaturesLayout } from "../../views/Features";

export default function ClaudeVersionPage() {
  return (
    <FeaturesLayout feature="basic-version">
      <ClaudeVersionView />
    </FeaturesLayout>
  );
}
