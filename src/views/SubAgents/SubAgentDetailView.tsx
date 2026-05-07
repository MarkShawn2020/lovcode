import { invoke } from "@/lib/tauri";
import type { LocalAgent } from "../../types";
import { DetailHeader, DetailCard, ContentCard, ConfigPage } from "../../components/config";

interface SubAgentDetailViewProps {
  agent: LocalAgent;
  onBack: () => void;
}

export function SubAgentDetailView({ agent, onBack }: SubAgentDetailViewProps) {
  return (
    <ConfigPage>
      <DetailHeader
        title={agent.name}
        description={agent.description}
        backLabel="Sub Agents"
        onBack={onBack}
        path={agent.path}
        onOpenPath={(p) => invoke("open_in_editor", { path: p })}
      />
      <div className="space-y-4">
        {agent.model && (
          <DetailCard label="Model">
            <p className="font-mono text-accent">{agent.model}</p>
          </DetailCard>
        )}
        {agent.tools && (
          <DetailCard label="Tools">
            <p className="font-mono text-sm text-ink">{agent.tools}</p>
          </DetailCard>
        )}
        <ContentCard label="Content" content={agent.content} />
      </div>
    </ConfigPage>
  );
}
