import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PtyExitEvent {
  id: string;
}

/**
 * Hook to track PTY running status for multiple sessions.
 * Returns a Map of ptyId -> isRunning status.
 */
export function usePtyStatus(ptyIds: string[]): Map<string, boolean> {
  const [statusMap, setStatusMap] = useState<Map<string, boolean>>(new Map());

  // Check initial status for all PTY IDs
  const checkStatus = useCallback(async () => {
    const newMap = new Map<string, boolean>();
    await Promise.all(
      ptyIds.map(async (id) => {
        try {
          const exists = await invoke<boolean>("pty_exists", { id });
          newMap.set(id, exists);
        } catch {
          newMap.set(id, false);
        }
      })
    );
    setStatusMap(newMap);
  }, [ptyIds]);

  // Check status on mount and when ptyIds change
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Listen for PTY exit events
  useEffect(() => {
    const unlisten = listen<PtyExitEvent>("pty-exit", (event) => {
      const exitedId = event.payload.id;
      setStatusMap((prev) => {
        if (prev.has(exitedId)) {
          const next = new Map(prev);
          next.set(exitedId, false);
          return next;
        }
        return prev;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return statusMap;
}
