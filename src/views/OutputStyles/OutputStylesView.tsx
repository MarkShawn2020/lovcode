import { MixerHorizontalIcon } from "@radix-ui/react-icons";
import type { TemplateComponent } from "../../types";
import { ConfigPage, PageHeader, EmptyState } from "../../components/config";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";

interface OutputStylesViewProps {
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function OutputStylesView({ onMarketplaceSelect }: OutputStylesViewProps) {
  return (
    <ConfigPage>
      <PageHeader title="Output Styles" subtitle="Response formatting styles" />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">已安装</TabsTrigger>
          <TabsTrigger value="marketplace">市场</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          <EmptyState
            icon={MixerHorizontalIcon}
            message="Coming soon"
            hint="Output styles will be available in a future update"
          />
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="output-styles" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
