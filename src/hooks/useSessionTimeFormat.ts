import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getSessionTimeFormat,
  subscribeSessionTimeFormat,
  type SessionTimeFormat,
} from "@/lib/sessionTime";

export function useSessionTimeFormat() {
  return useSyncExternalStore<SessionTimeFormat>(
    subscribeSessionTimeFormat,
    getSessionTimeFormat,
    () => "relative",
  );
}

export function useRelativeTimeNow(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [enabled]);

  return now;
}
