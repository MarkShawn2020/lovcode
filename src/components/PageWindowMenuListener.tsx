import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDuplicatePageWindow } from "@/hooks/useDuplicatePageWindow";
import { isTauri } from "@/lib/tauri";
import { DUPLICATE_PAGE_WINDOW_EVENT } from "@/lib/pageWindow";

export function PageWindowMenuListener() {
  const duplicatePageWindow = useDuplicatePageWindow();

  useEffect(() => {
    if (!isTauri()) return;

    const unlisten = listen(DUPLICATE_PAGE_WINDOW_EVENT, () => {
      duplicatePageWindow();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [duplicatePageWindow]);

  return null;
}
