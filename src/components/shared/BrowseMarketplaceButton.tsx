import { Store } from "lucide-react";
import { useI18n } from "@/i18n";

interface BrowseMarketplaceButtonProps {
  onClick?: () => void;
}

export function BrowseMarketplaceButton({ onClick }: BrowseMarketplaceButtonProps) {
  const { t } = useI18n();
  if (!onClick) return null;
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-ink hover:bg-card-alt rounded-lg transition-colors"
      title={t("common.marketplace")}
    >
      <Store className="w-4 h-4" />
      <span>{t("common.marketplace")}</span>
    </button>
  );
}
