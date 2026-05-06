import { MixerHorizontalIcon } from "@radix-ui/react-icons";
import type { TemplateComponent } from "../../types";
import { ConfigPage, PageHeader, EmptyState } from "../../components/config";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { MarketplaceContent } from "../Marketplace";
import { useI18n } from "@/i18n";

interface OutputStylesViewProps {
  onMarketplaceSelect: (template: TemplateComponent) => void;
}

export function OutputStylesView({ onMarketplaceSelect }: OutputStylesViewProps) {
  const { t } = useI18n();
  return (
    <ConfigPage>
      <PageHeader title={t("common.outputStyles")} subtitle={t("config.outputStylesSubtitle")} />

      <Tabs defaultValue="installed" className="flex-1 flex flex-col">
        <TabsList className="bg-card-alt border border-border">
          <TabsTrigger value="installed">{t("common.installed")}</TabsTrigger>
          <TabsTrigger value="marketplace">{t("common.marketplace")}</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          <EmptyState
            icon={MixerHorizontalIcon}
            message={t("config.comingSoon")}
            hint={t("config.outputStylesComingSoon")}
          />
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <MarketplaceContent category="output-styles" onSelectTemplate={onMarketplaceSelect} />
        </TabsContent>
      </Tabs>
    </ConfigPage>
  );
}
