import { PageHeader, ConfigPage } from "../../components/config";
import { ClaudeCodeVersionSection } from "./ClaudeCodeVersionSection";

export function ClaudeVersionView() {
  return (
    <ConfigPage>
      <PageHeader title="CC Version" subtitle="Claude Code version management" />
      <div className="flex-1 flex flex-col">
        <ClaudeCodeVersionSection />
      </div>
    </ConfigPage>
  );
}
