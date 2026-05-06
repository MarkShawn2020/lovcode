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
import { useI18n } from "@/i18n";

interface SubAgentsViewProps {
  onSelect: (agent: LocalAgent) => void;
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function SubAgentsView({ onSelect, onMarketplaceSelect }: SubAgentsViewProps) {
  const { t } = useI18n();
  const { data: agents = [], isLoading } = useInvokeQuery<LocalAgent[]>(["agents"], "list_local_agents");
  const { search, setSearch, filtered } = useSearch(agents, ["name", "description", "model"]);

  if (isLoading) return <LoadingState message={t("config.loadingSubAgents")} />;

  return (
    <ConfigPage>
      <PageHeader
        title={t("common.subAgents")}
        subtitle={t("config.subAgentsCount", { count: agents.length })}
      />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">{t("common.installed")}</TabsTrigger>
          <TabsTrigger value="marketplace">{t("common.marketplace")}</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          <SearchInput
            placeholder={t("config.searchInstalledSubAgents")}
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
              message={t("config.noSubAgents")}
              hint={t("config.installSubAgentsHint")}
            />
          )}

          {filtered.length === 0 && search && (
            <p className="text-muted-foreground text-sm">{t("config.noSubAgentsMatch", { search })}</p>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="agents" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
