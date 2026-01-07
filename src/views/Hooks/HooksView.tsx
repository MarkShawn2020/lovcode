import { useState } from "react";
import { Link2Icon } from "@radix-ui/react-icons";
import type { ClaudeSettings, TemplateComponent } from "../../types";
import {
  LoadingState,
  EmptyState,
  SearchInput,
  PageHeader,
  ConfigPage,
} from "../../components/config";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";
import { useInvokeQuery } from "../../hooks";

interface HooksViewProps {
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function HooksView({ onMarketplaceSelect }: HooksViewProps) {
  const { data: settings, isLoading } = useInvokeQuery<ClaudeSettings>(["settings"], "get_settings");
  const [search, setSearch] = useState("");

  if (isLoading) return <LoadingState message="Loading hooks..." />;

  const hooks = settings?.hooks as Record<string, unknown[]> | null;
  const hookEntries = hooks ? Object.entries(hooks) : [];
  const filtered = hookEntries.filter(([eventType]) =>
    eventType.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ConfigPage>
      <PageHeader
        title="Hooks"
        subtitle="Automation triggers in ~/.claude/settings.json"
      />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">已安装</TabsTrigger>
          <TabsTrigger value="marketplace">市场</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          <SearchInput
            placeholder="Search installed hooks..."
            value={search}
            onChange={setSearch}
          />

          {filtered.length > 0 && (
            <div className="space-y-4">
              {filtered.map(([eventType, handlers]) => (
                <div key={eventType} className="bg-card rounded-xl p-4 border border-border">
                  <p className="text-sm font-medium text-primary mb-3">{eventType}</p>
                  <div className="space-y-2">
                    {Array.isArray(handlers) &&
                      handlers.map((handler, i) => (
                        <pre
                          key={i}
                          className="bg-card-alt rounded-lg p-3 text-xs font-mono text-ink overflow-x-auto"
                        >
                          {JSON.stringify(handler, null, 2)}
                        </pre>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length === 0 && !search && (
            <EmptyState
              icon={Link2Icon}
              message="No hooks configured"
              hint="Browse marketplace to install hooks"
            />
          )}

          {filtered.length === 0 && search && (
            <p className="text-muted-foreground text-sm">No hooks match "{search}"</p>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="hooks" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
