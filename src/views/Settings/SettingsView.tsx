import { useState } from "react";
import { useInvokeQuery } from "../../hooks";
import { GearIcon } from "@radix-ui/react-icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  LoadingState,
  EmptyState,
  SearchInput,
  PageHeader,
  ConfigPage,
} from "../../components/config";
import { MarketplaceContent } from "../Marketplace";
import { ConfigFileItem } from "../../components/ContextFileItem";
import type { ClaudeSettings, TemplateComponent } from "../../types";

interface SettingsViewProps {
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function SettingsView({ onMarketplaceSelect }: SettingsViewProps) {
  const { data: settings, isLoading } = useInvokeQuery<ClaudeSettings>(["settings"], "get_settings");
  const { data: settingsPath = "" } = useInvokeQuery<string>(["settingsPath"], "get_settings_path");

  const [search, setSearch] = useState("");

  if (isLoading) return <LoadingState message="Loading settings..." />;

  const settingsMatchSearch =
    !search || JSON.stringify(settings?.raw || {}).toLowerCase().includes(search.toLowerCase());

  return (
    <ConfigPage>
      <PageHeader title="Settings" subtitle="settings.json templates" />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">Installed</TabsTrigger>
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          <SearchInput placeholder="Search settings..." value={search} onChange={setSearch} />

          {!settings?.raw && !search && (
            <EmptyState icon={GearIcon} message="No settings found" hint="Create ~/.claude/settings.json" />
          )}

          {settingsMatchSearch && settings?.raw && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                <GearIcon className="w-4 h-4" />
                <span className="text-sm font-medium text-ink">settings.json</span>
              </div>
              <div className="p-3">
                <ConfigFileItem name="settings.json" path={settingsPath} content={settings.raw} />
              </div>
            </div>
          )}

          {search && !settingsMatchSearch && (
            <p className="text-muted-foreground text-sm">No settings match "{search}"</p>
          )}
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="settings" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
