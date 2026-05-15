import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/tauri";

export interface SearchIndexBuildStatus {
  state: "idle" | "building" | "ready" | "error" | string;
  totalSessions: number;
  processedSessions: number;
  totalMessages?: number;
  processedMessages?: number;
  indexedMessages: number;
  totalBytes?: number;
  processedBytes?: number;
  skippedSessions: number;
  indexSizeBytes?: number;
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

  useEffect(() => {
    if (status?.state !== "building") return;

    const timer = window.setInterval(() => {
      invoke<SearchIndexBuildStatus>("get_search_index_status")
        .then((next) => setStatus(next))
        .catch(() => {});
    }, 1500);

    return () => window.clearInterval(timer);
  }, [status?.state]);

  const start = useCallback((force = false) => {
    return invoke<SearchIndexBuildStatus>("start_search_index_build", { force })
      .then((next) => {
        setStatus(next);
        return next;
      });
  }, []);

  const progress = useMemo(() => {
    const totalMessages = status?.totalMessages ?? 0;
    if (totalMessages > 0) {
      return Math.min(1, (status?.processedMessages ?? 0) / totalMessages);
    }
    const totalBytes = status?.totalBytes ?? 0;
    if (totalBytes > 0) {
      return Math.min(1, (status?.processedBytes ?? 0) / totalBytes);
    }
    if (!status?.totalSessions) return 0;
    return Math.min(1, status.processedSessions / status.totalSessions);
  }, [status]);

  return { status, progress, start };
}
