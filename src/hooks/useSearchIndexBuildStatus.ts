import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { getSearchIndexActivity, type SearchIndexActivity } from "@/lib/searchIndexStatus";
import { invoke, isTauri } from "@/lib/tauri";

export interface SearchIndexBuildStatus {
  state: "idle" | "building" | "ready" | "error" | string;
  mode?: "full" | "incremental" | string;
  searchAvailable: boolean;
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

const unavailableStatus: SearchIndexBuildStatus = {
  state: "unavailable",
  mode: "full",
  searchAvailable: false,
  totalSessions: 0,
  processedSessions: 0,
  indexedMessages: 0,
  skippedSessions: 0,
};

let statusSnapshot: SearchIndexBuildStatus | null = null;
let statusInitialized = false;
let statusRequest: Promise<SearchIndexBuildStatus> | null = null;
let statusPollTimer: number | null = null;
const statusSubscribers = new Set<() => void>();

function emitStatusSnapshot(next: SearchIndexBuildStatus) {
  statusSnapshot = next;
  if (next.state === "building" && statusPollTimer === null) {
    statusPollTimer = window.setInterval(() => {
      refreshStatus().catch(() => {});
    }, 1500);
  } else if (next.state !== "building" && statusPollTimer !== null) {
    window.clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  statusSubscribers.forEach((notify) => notify());
}

function refreshStatus() {
  if (statusRequest) return statusRequest;
  statusRequest = invoke<SearchIndexBuildStatus>("get_search_index_status")
    .then((next) => {
      emitStatusSnapshot(next);
      return next;
    })
    .finally(() => {
      statusRequest = null;
    });
  return statusRequest;
}

function initializeStatusStore() {
  if (statusInitialized) return;
  statusInitialized = true;
  if (!isTauri()) {
    emitStatusSnapshot(unavailableStatus);
    return;
  }

  refreshStatus().catch(() => {});
  listen<SearchIndexBuildStatus>("search-index:build", (event) => {
    emitStatusSnapshot(event.payload);
  }).catch(() => {});
}

function subscribeToStatus(notify: () => void) {
  statusSubscribers.add(notify);
  initializeStatusStore();
  return () => {
    statusSubscribers.delete(notify);
  };
}

function getStatusSnapshot() {
  return statusSnapshot;
}

function startSearchIndexBuild(force = false) {
  initializeStatusStore();
  return invoke<SearchIndexBuildStatus>("start_search_index_build", { force }).then((next) => {
    emitStatusSnapshot(next);
    return next;
  });
}

/**
 * The watcher fires one pass per changed session file, so a save that touches
 * several files produces a burst of short passes with idle gaps between them.
 * Holding the flag past the last pass turns that strobe into one continuous
 * "syncing" reading — the only honest way to do it is a timer, since the gaps
 * are in the data, not in the rendering.
 */
const SYNCING_HOLD_MS = 1500;

function useHeldSyncingFlag(active: boolean) {
  const [held, setHeld] = useState(active);

  useEffect(() => {
    if (active) {
      setHeld(true);
      return;
    }
    const timer = window.setTimeout(() => setHeld(false), SYNCING_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  return held;
}

export function useSearchIndexBuildStatus() {
  const status = useSyncExternalStore(subscribeToStatus, getStatusSnapshot, getStatusSnapshot);
  const rawActivity = getSearchIndexActivity(status);
  const syncing = useHeldSyncingFlag(rawActivity.syncing);
  const activity: SearchIndexActivity = { fullBuild: rawActivity.fullBuild, syncing };

  const progress = useMemo(() => {
    // Only a full rebuild has a meaningful denominator; an incremental pass
    // pins its totals to the published corpus so the panel stays still.
    if (!rawActivity.fullBuild) return status?.searchAvailable ? 1 : 0;
    const totalBytes = status?.totalBytes ?? 0;
    if (totalBytes > 0) {
      return Math.min(1, (status?.processedBytes ?? 0) / totalBytes);
    }
    if (!status?.totalSessions) return 0;
    return Math.min(1, status.processedSessions / status.totalSessions);
  }, [status, rawActivity.fullBuild]);

  return { status, progress, activity, start: startSearchIndexBuild };
}
