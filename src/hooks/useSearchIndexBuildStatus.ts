import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/tauri";

export interface SearchIndexBuildStatus {
  state: "idle" | "building" | "ready" | "error" | string;
  totalSessions: number;
  processedSessions: number;
  indexedMessages: number;
  skippedSessions: number;
  currentSessionId?: string | null;
  currentTitle?: string | null;
  currentProjectPath?: string | null;
  startedAt?: number | null;
  updatedAt?: number | null;
  completedAt?: number | null;
  error?: string | null;
}

export function useSearchIndexBuildStatus() {
  const [status, setStatus] = useState<SearchIndexBuildStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<SearchIndexBuildStatus>("get_search_index_status")
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {});

    const unlisten = listen<SearchIndexBuildStatus>("search-index:build", (event) => {
      setStatus(event.payload);
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const start = useCallback((force = false) => {
    return invoke<SearchIndexBuildStatus>("start_search_index_build", { force })
      .then((next) => {
        setStatus(next);
        return next;
      });
  }, []);

  const progress = useMemo(() => {
    if (!status?.totalSessions) return 0;
    return Math.min(1, status.processedSessions / status.totalSessions);
  }, [status]);

  return { status, progress, start };
}
