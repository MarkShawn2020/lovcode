import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";
import { getPageWindowErrorMessage, openCurrentPageInNewWindow } from "@/lib/pageWindow";

export function useDuplicatePageWindow() {
  const { t } = useI18n();

  return useCallback(() => {
    try {
      openCurrentPageInNewWindow({
        onCreated: () => {
          toast.success(t("nav.pageOpenedInNewWindow"));
        },
        onError: (error) => {
          toast.error(t("nav.openPageInNewWindowFailed", { message: getPageWindowErrorMessage(error) }));
        },
      });
    } catch (error) {
      toast.error(t("nav.openPageInNewWindowFailed", { message: getPageWindowErrorMessage(error) }));
    }
  }, [t]);
}
