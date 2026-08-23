export type SessionTimeFormat = "relative" | "absolute";

export const SESSION_TIME_FORMAT_STORAGE_KEY = "ataru:sessionTimeFormat";

const absoluteTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto",
  style: "short",
});

const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((subscriber) => subscriber());
}

function handleStorageChange(event: StorageEvent) {
  if (event.key === SESSION_TIME_FORMAT_STORAGE_KEY) notifySubscribers();
}

export function normalizeSessionTimeFormat(value: string | null | undefined): SessionTimeFormat {
  return value === "absolute" ? "absolute" : "relative";
}

export function getSessionTimeFormat(): SessionTimeFormat {
  if (typeof window === "undefined") return "relative";
  try {
    return normalizeSessionTimeFormat(window.localStorage.getItem(SESSION_TIME_FORMAT_STORAGE_KEY));
  } catch {
    return "relative";
  }
}

export function setSessionTimeFormat(format: SessionTimeFormat) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_TIME_FORMAT_STORAGE_KEY, format);
  } catch {
    return;
  }
  notifySubscribers();
}

export function subscribeSessionTimeFormat(subscriber: () => void) {
  subscribers.add(subscriber);
  if (subscribers.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorageChange);
  }
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorageChange);
    }
  };
}

export function formatAbsoluteSessionTime(timestamp: number) {
  return absoluteTimeFormatter.format(new Date(timestamp * 1000));
}

export function formatRelativeSessionTime(timestamp: number, now = Date.now()) {
  const differenceInSeconds = timestamp - Math.floor(now / 1000);
  const absoluteDifference = Math.abs(differenceInSeconds);

  if (absoluteDifference < 60) return "刚刚";
  if (absoluteDifference < 60 * 60) {
    return relativeTimeFormatter.format(Math.round(differenceInSeconds / 60), "minute");
  }
  if (absoluteDifference < 24 * 60 * 60) {
    return relativeTimeFormatter.format(Math.round(differenceInSeconds / (60 * 60)), "hour");
  }
  if (absoluteDifference < 30 * 24 * 60 * 60) {
    return relativeTimeFormatter.format(Math.round(differenceInSeconds / (24 * 60 * 60)), "day");
  }
  if (absoluteDifference < 365 * 24 * 60 * 60) {
    return relativeTimeFormatter.format(Math.round(differenceInSeconds / (30 * 24 * 60 * 60)), "month");
  }
  return relativeTimeFormatter.format(Math.round(differenceInSeconds / (365 * 24 * 60 * 60)), "year");
}

export function formatSessionTime(timestamp: number, format: SessionTimeFormat, now = Date.now()) {
  return format === "relative"
    ? formatRelativeSessionTime(timestamp, now)
    : formatAbsoluteSessionTime(timestamp);
}
