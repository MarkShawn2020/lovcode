import { PersonIcon } from "@radix-ui/react-icons";
import type { LocalAgent, TemplateComponent } from "../../types";
import {
  LoadingState,
  EmptyState,
  SearchInput,
  PageHeader,
  ItemCard,
  ConfigPage,
  useSearch,
} from "../../components/config";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";
import { useInvokeQuery } from "../../hooks";

interface SubAgentsViewProps {
  onSelect: (agent: LocalAgent) => void;
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function SubAgentsView({ onSelect, onMarketplaceSelect }: SubAgentsViewProps) {
  const { data: agents = [], isLoading } = useInvokeQuery<LocalAgent[]>(["agents"], "list_local_agents");
  const { search, setSearch, filtered } = useSearch(agents, ["name", "description", "model"]);

  if (isLoading) return <LoadingState message="Loading sub-agents..." />;

  return (
    <ConfigPage>
      <PageHeader
        title="Sub Agents"
        subtitle={`${agents.length} sub-agents in ~/.claude/commands`}
      />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">已安装</TabsTrigger>
          <TabsTrigger value="marketplace">市场</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          <SearchInput
            placeholder="Search installed sub-agents..."
            value={search}
            onChange={setSearch}
          />

          {filtered.length > 0 && (
            <div className="space-y-2">
              {filtered.map((agent) => (
                <ItemCard
                  key={agent.name}
                  name={agent.name}
                  description={agent.description}
                  badge={agent.model}
                  onClick={() => onSelect(agent)}
                />
              ))}
            </div>
          )}

          {filtered.length === 0 && !search && (
            <EmptyState
              icon={PersonIcon}
              message="No sub-agents found"
              hint="Browse marketplace to install sub-agents"
            />
          )}

          {filtered.length === 0 && search && (
            <p className="text-muted-foreground text-sm">No sub-agents match "{search}"</p>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="agents" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
