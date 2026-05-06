import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "../types";

type SessionStreamEvent =
  | { kind: "batch"; sessions: Session[] }
  | { kind: "done"; total: number };

interface UseStreamedSessions {
  sessions: Session[];
  /** True until the first batch arrives — splash should stay up until this is false. */
  initialLoading: boolean;
  /** True until the final "done" event — list keeps growing during this period. */
  streaming: boolean;
}

/**
 * Streamed replacement for `useInvokeQuery(["sessions"], "list_all_sessions")`.
 * Subscribes to `list_all_sessions_streamed`, accumulates batches as they
 * arrive (200 sessions each), and writes the full set into react-query's
 * `["sessions"]` cache when streaming completes — so other consumers
 * (`useInvokeQuery(["sessions"])`) get the same data for free.
 */
export function useStreamedSessions(): UseStreamedSessions {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [streaming, setStreaming] = useState(true);
  const queryClient = useQueryClient();
  const streamSeqRef = useRef(0);
  const streamCleanupRef = useRef<(() => void) | null>(null);

  const streamSessions = useCallback((mode: "initial" | "refresh") => {
    streamCleanupRef.current?.();
    let cancelled = false;
    const seq = streamSeqRef.current + 1;
    streamSeqRef.current = seq;
    const accumulated: Session[] = [];
    const t0 = performance.now();
    const channel = new Channel<SessionStreamEvent>();

    if (mode === "initial") setInitialLoading(true);
    setStreaming(true);
    console.log(`[DEBUG][STREAM] invoke list_all_sessions_streamed at ${performance.now().toFixed(0)}`);

    channel.onmessage = (event) => {
      if (cancelled || streamSeqRef.current !== seq) return;

      if (event.kind === "batch") {
        accumulated.push(...event.sessions);
        if (mode === "initial") setSessions([...accumulated]);
        setInitialLoading(false);
        console.log(`[DEBUG][STREAM] batch n=${event.sessions.length}, total=${accumulated.length} at +${(performance.now() - t0).toFixed(0)}ms`);
        return;
      }

      setSessions([...accumulated]);
      setInitialLoading(false);
      setStreaming(false);
      queryClient.setQueryData<Session[]>(["sessions"], accumulated);
      console.log(`[DEBUG][STREAM] done total=${event.total} at +${(performance.now() - t0).toFixed(0)}ms`);
    };

    const cleanup = () => {
      cancelled = true;
      if (streamCleanupRef.current === cleanup) streamCleanupRef.current = null;
    };
    streamCleanupRef.current = cleanup;

    invoke("list_all_sessions_streamed", { onEvent: channel })
      .catch((err) => {
        console.error("[DEBUG][STREAM] failed:", err);
        if (cancelled || streamSeqRef.current !== seq) return;
        setInitialLoading(false);
        setStreaming(false);
      });

    return cleanup;
  }, [queryClient]);

  useEffect(() => {
    const cleanup = streamSessions("initial");
    return () => {
      cleanup();
      streamCleanupRef.current?.();
      streamCleanupRef.current = null;
    };
  }, [streamSessions]);

  useEffect(() => {
    const unlisten = listen("sessions-changed", () => {
      streamSessions("refresh");
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [streamSessions]);

  return { sessions, initialLoading, streaming };
}

/**
 * Read-only consumer of the ["sessions"] cache populated by useStreamedSessions.
 * Use in always-mounted siblings (GlobalChatSearch, ActivityCard) so they
 * don't trigger their own non-streamed `list_all_sessions` IPC on reload — that
 * was racing the streamed call and re-introducing the 6-second JSON.parse stall.
 */
export function useSessionsCache(): Session[] {
  const { data = [] } = useQuery<Session[]>({
    queryKey: ["sessions"],
    // queryFn is required by react-query v5 even with enabled:false. It will
    // never run because enabled is false; data is populated externally by
    // useStreamedSessions via queryClient.setQueryData(["sessions"], ...).
    queryFn: () => Promise.resolve([] as Session[]),
    enabled: false,
    staleTime: Infinity,
    initialData: [],
  });
  return data;
}
