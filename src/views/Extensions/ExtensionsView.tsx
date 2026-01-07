import { useState } from "react";
import { DownloadIcon } from "@radix-ui/react-icons";
import type { InstalledPlugin, ExtensionMarketplace, MarketplacePlugin } from "../../types";
import {
  LoadingState,
  EmptyState,
  SearchInput,
  PageHeader,
  ConfigPage,
  useSearch,
} from "../../components/config";
import { useInvokeQuery, useInvokeMutation } from "../../hooks";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { PluginCard } from "./PluginCard";

export function ExtensionsView() {
  const [activeTab, setActiveTab] = useState<"installed" | "official">("installed");

  const {
    data: installedPlugins = [],
    isLoading: loadingInstalled,
    refetch: refetchInstalled,
  } = useInvokeQuery<InstalledPlugin[]>(["installedPlugins"], "list_installed_plugins");

  const {
    data: marketplaces = [],
    isLoading: loadingMarketplaces,
  } = useInvokeQuery<ExtensionMarketplace[]>(["extensionMarketplaces"], "list_extension_marketplaces");

  const officialMarketplace = marketplaces.find((m) => m.is_official);

  const {
    data: officialPlugins = [],
    isLoading: loadingOfficial,
  } = useInvokeQuery<MarketplacePlugin[]>(
    ["marketplacePlugins", "official"],
    "fetch_marketplace_plugins",
    officialMarketplace?.repo
      ? {
          owner: officialMarketplace.repo.split("/")[0],
          repo: officialMarketplace.repo.split("/")[1],
          plugins_path: "plugins",
        }
      : undefined
  );

  const { search, setSearch, filtered: filteredInstalled } = useSearch(installedPlugins, ["name", "marketplace"]);
  const { search: searchOfficial, setSearch: setSearchOfficial, filtered: filteredOfficial } = useSearch(
    officialPlugins,
    ["name"]
  );

  const installMutation = useInvokeMutation<string, { plugin_id: string; marketplace?: string }>(
    "install_extension",
    [["installedPlugins"]]
  );

  const uninstallMutation = useInvokeMutation<string, { plugin_id: string }>(
    "uninstall_extension",
    [["installedPlugins"]]
  );

  const installedPluginIds = new Set(installedPlugins.map((p) => p.name));

  const handleInstall = async (pluginName: string, marketplace?: string) => {
    try {
      await installMutation.mutateAsync({ plugin_id: pluginName, marketplace });
      refetchInstalled();
    } catch {
      // Error handling - mutation will show error state
    }
  };

  const handleUninstall = async (pluginId: string) => {
    try {
      await uninstallMutation.mutateAsync({ plugin_id: pluginId });
      refetchInstalled();
    } catch {
      // Error handling
    }
  };

  return (
    <ConfigPage>
      <PageHeader
        title="Extensions"
        subtitle="Manage Claude Code plugins"
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">
            已安装 ({installedPlugins.length})
          </TabsTrigger>
          <TabsTrigger value="official">官方插件</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          {loadingInstalled ? (
            <LoadingState message="Loading installed plugins..." />
          ) : (
            <>
              <SearchInput
                placeholder="Search installed plugins..."
                value={search}
                onChange={setSearch}
              />

              {filteredInstalled.length > 0 && (
                <div className="space-y-2">
                  {filteredInstalled.map((plugin) => (
                    <PluginCard
                      key={plugin.id}
                      name={plugin.name}
                      description={`@${plugin.marketplace}`}
                      isInstalled
                      enabled={plugin.enabled}
                      onUninstall={() => handleUninstall(plugin.id)}
                      isLoading={uninstallMutation.isPending}
                    />
                  ))}
                </div>
              )}

              {filteredInstalled.length === 0 && !search && (
                <EmptyState
                  icon={DownloadIcon}
                  message="No plugins installed"
                  hint="Browse official plugins to install"
                />
              )}

              {filteredInstalled.length === 0 && search && (
                <p className="text-muted-foreground text-sm">No plugins match "{search}"</p>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="official" className="mt-4 space-y-4">
          {loadingOfficial || loadingMarketplaces ? (
            <LoadingState message="Loading official plugins..." />
          ) : (
            <>
              <SearchInput
                placeholder="Search official plugins..."
                value={searchOfficial}
                onChange={setSearchOfficial}
              />

              {filteredOfficial.length > 0 && (
                <div className="space-y-2">
                  {filteredOfficial.map((plugin) => {
                    const isInstalled = installedPluginIds.has(plugin.name);
                    return (
                      <PluginCard
                        key={plugin.name}
                        name={plugin.name}
                        description={plugin.description}
                        isInstalled={isInstalled}
                        onInstall={() => handleInstall(plugin.name, "claude-plugins-official")}
                        onUninstall={() => handleUninstall(`${plugin.name}@claude-plugins-official`)}
                        isLoading={installMutation.isPending || uninstallMutation.isPending}
                      />
                    );
                  })}
                </div>
              )}

              {filteredOfficial.length === 0 && !searchOfficial && (
                <EmptyState
                  icon={DownloadIcon}
                  message="No official plugins available"
                  hint="Check your network connection"
                />
              )}

              {filteredOfficial.length === 0 && searchOfficial && (
                <p className="text-muted-foreground text-sm">No plugins match "{searchOfficial}"</p>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
