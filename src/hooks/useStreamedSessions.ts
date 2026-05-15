import { useEffect, useState } from "react";
import { invoke, Channel } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Session } from "../types";

type SessionStreamEvent =
  | { kind: "cached"; sessions: Session[]; total: number }
  | { kind: "batch"; sessions: Session[] }
  | { kind: "done"; total: number };

interface UseStreamedSessions {
  sessions: Session[];
  /** True until the first cached preview or fresh batch arrives. */
  initialLoading: boolean;
  /** True while a backend refresh is running. */
  streaming: boolean;
  /** True when sessions represents a complete snapshot, either from cache or from the finished stream. */
  hasCompleteSnapshot: boolean;
}

const SESSIONS_QUERY_KEY = ["sessions"] as const;
const SESSION_STREAM_DEBUG_STORAGE_KEY = "lovcode.debug.sessions";

let sessionSnapshot: UseStreamedSessions = {
  sessions: [],
  initialLoading: true,
  streaming: false,
  hasCompleteSnapshot: false,
};
let streamSeq = 0;
let activeStreamId: string | null = null;
let pendingRefresh = false;
let currentQueryClient: QueryClient | null = null;
let sessionsChangedListenerStarted = false;

const subscribers = new Set<(snapshot: UseStreamedSessions) => void>();

function isSessionStreamDebugEnabled() {
  if (!import.meta.env.DEV) return false;
  try {
    return window.localStorage.getItem(SESSION_STREAM_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function debugSessionStream(message: string) {
  if (isSessionStreamDebugEnabled()) console.debug(`[sessions-stream] ${message}`);
}

function getCachedSessions(queryClient: QueryClient) {
  return queryClient.getQueryData<Session[]>(SESSIONS_QUERY_KEY) ?? [];
}

function publishSessionSnapshot(next: UseStreamedSessions) {
  sessionSnapshot = next;
  subscribers.forEach((subscriber) => subscriber(sessionSnapshot));
}

function patchSessionSnapshot(patch: Partial<UseStreamedSessions>) {
  publishSessionSnapshot({ ...sessionSnapshot, ...patch });
}

function hydrateSessionSnapshotFromCache(queryClient: QueryClient) {
  currentQueryClient = queryClient;
  const cached = getCachedSessions(queryClient);
  if (cached.length > 0 && !sessionSnapshot.hasCompleteSnapshot && sessionSnapshot.sessions.length === 0) {
    patchSessionSnapshot({
      sessions: cached,
      initialLoading: false,
      hasCompleteSnapshot: true,
    });
  }
  return sessionSnapshot;
}

function maybeRunPendingRefresh(queryClient: QueryClient) {
  if (!pendingRefresh) return;
  pendingRefresh = false;
  startSessionStream("refresh", queryClient);
}

function createSessionStreamId(seq: number) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${seq}-${Math.random().toString(36).slice(2)}`;
}

function cancelSessionStream(streamId: string, reason: string) {
  debugSessionStream(`cancel ${streamId} (${reason})`);
  invoke("cancel_session_stream", { streamId }).catch(() => {});
}

function stopActiveSessionStream(reason: string) {
  const streamId = activeStreamId;
  if (!streamId) return;
  activeStreamId = null;
  streamSeq += 1;
  pendingRefresh = false;
  cancelSessionStream(streamId, reason);
  patchSessionSnapshot({
    initialLoading: false,
    streaming: false,
    hasCompleteSnapshot: sessionSnapshot.hasCompleteSnapshot || sessionSnapshot.sessions.length > 0,
  });
}

function startSessionStream(mode: "initial" | "refresh", queryClient: QueryClient) {
  currentQueryClient = queryClient;

  if (mode === "initial" && sessionSnapshot.hasCompleteSnapshot) return;
  if (sessionSnapshot.streaming) {
    if (mode === "refresh") pendingRefresh = true;
    return;
  }

  const cachedSessions = getCachedSessions(queryClient);
  const hasUsableSnapshot = sessionSnapshot.hasCompleteSnapshot || cachedSessions.length > 0;
  const publishBatches = mode === "initial" && !hasUsableSnapshot;
  const seq = streamSeq + 1;
  const streamId = createSessionStreamId(seq);
  const accumulated: Session[] = [];
  const t0 = performance.now();
  const channel = new Channel<SessionStreamEvent>();
  streamSeq = seq;
  activeStreamId = streamId;

  if (mode === "initial") {
    if (cachedSessions.length > 0 && !sessionSnapshot.hasCompleteSnapshot) {
      patchSessionSnapshot({
        sessions: cachedSessions,
        initialLoading: false,
        hasCompleteSnapshot: true,
      });
    } else if (!hasUsableSnapshot) {
      patchSessionSnapshot({
        initialLoading: true,
        hasCompleteSnapshot: false,
      });
    }
  }

  patchSessionSnapshot({ streaming: true });
  debugSessionStream(`invoke list_all_sessions_streamed ${streamId} at ${performance.now().toFixed(0)}`);

  channel.onmessage = (event) => {
    if (streamSeq !== seq || activeStreamId !== streamId) return;

    if (event.kind === "cached") {
      if (
        !sessionSnapshot.hasCompleteSnapshot &&
        sessionSnapshot.sessions.length === 0 &&
        event.sessions.length > 0
      ) {
        patchSessionSnapshot({
          sessions: event.sessions,
          initialLoading: false,
          hasCompleteSnapshot: false,
        });
      } else if (sessionSnapshot.initialLoading) {
        patchSessionSnapshot({ initialLoading: false });
      }
      debugSessionStream(
        `cached n=${event.sessions.length}, total=${event.total} at +${(performance.now() - t0).toFixed(0)}ms`,
      );
      return;
    }

    if (event.kind === "batch") {
      accumulated.push(...event.sessions);
      if (publishBatches) {
        patchSessionSnapshot({
          sessions: [...accumulated],
          initialLoading: false,
          hasCompleteSnapshot: false,
        });
      } else if (sessionSnapshot.initialLoading) {
        patchSessionSnapshot({ initialLoading: false });
      }
      debugSessionStream(`batch n=${event.sessions.length}, total=${accumulated.length} at +${(performance.now() - t0).toFixed(0)}ms`);
      return;
    }

    const completeSessions = [...accumulated];
    activeStreamId = null;
    queryClient.setQueryData<Session[]>(SESSIONS_QUERY_KEY, completeSessions);
    publishSessionSnapshot({
      sessions: completeSessions,
      initialLoading: false,
      streaming: false,
      hasCompleteSnapshot: true,
    });
    debugSessionStream(`done total=${event.total} at +${(performance.now() - t0).toFixed(0)}ms`);
    maybeRunPendingRefresh(queryClient);
  };

  invoke("list_all_sessions_streamed", { streamId, onEvent: channel, refresh: mode === "refresh" })
    .catch((err) => {
      console.warn("[sessions-stream] failed:", err);
      if (streamSeq !== seq || activeStreamId !== streamId) return;
      activeStreamId = null;
      patchSessionSnapshot({
        initialLoading: false,
        streaming: false,
        hasCompleteSnapshot: true,
      });
      maybeRunPendingRefresh(queryClient);
    });
}

function ensureSessionsChangedListener(queryClient: QueryClient) {
  currentQueryClient = queryClient;
  if (sessionsChangedListenerStarted) return;
  sessionsChangedListenerStarted = true;
  listen("sessions-changed", () => {
    startSessionStream("refresh", currentQueryClient ?? queryClient);
  }).catch(() => {
    sessionsChangedListenerStarted = false;
  });
}

function subscribeToSessionSnapshot(subscriber: (snapshot: UseStreamedSessions) => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopActiveSessionStream("no-subscribers");
  };
}

const handleSessionStreamPageHide = () => {
  stopActiveSessionStream("pagehide");
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", handleSessionStreamPageHide);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", handleSessionStreamPageHide);
    }
    stopActiveSessionStream("hmr-dispose");
  });
}

/**
 * Shared session-list subscription. The backend scan is tied to the app runtime,
 * not to whichever route currently renders, so top-nav changes reuse the in-memory
 * snapshot and only refresh when the file watcher emits `sessions-changed`.
 */
export function useStreamedSessions(): UseStreamedSessions {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState<UseStreamedSessions>(() => hydrateSessionSnapshotFromCache(queryClient));

  useEffect(() => {
    const unsubscribe = subscribeToSessionSnapshot(setSnapshot);
    setSnapshot(hydrateSessionSnapshotFromCache(queryClient));
    ensureSessionsChangedListener(queryClient);
    startSessionStream("initial", queryClient);
    return unsubscribe;
  }, [queryClient]);

  return snapshot;
}

/**
 * Read-only consumer of the ["sessions"] cache populated by useStreamedSessions.
 * Use in always-mounted siblings (GlobalChatSearch, ActivityCard) so they
 * don't trigger their own non-streamed `list_all_sessions` IPC on reload.
 */
export function useSessionsCache(): Session[] {
  const { data = [] } = useQuery<Session[]>({
    queryKey: SESSIONS_QUERY_KEY,
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
