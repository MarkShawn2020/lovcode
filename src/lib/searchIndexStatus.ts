interface SearchIndexStatusLike {
  state?: string;
  totalSessions?: number;
  processedSessions?: number;
  totalMessages?: number;
  processedMessages?: number;
  indexedMessages?: number;
  totalBytes?: number;
  processedBytes?: number;
  indexSizeBytes?: number;
  startedAt?: number | null;
  completedAt?: number | null;
  error?: string | null;
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "--";

  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatByteSize(bytes: number | null | undefined) {
  const value = bytes ?? 0;
  if (!Number.isFinite(value) || value <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex <= 1 || size >= 100 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export function getSearchIndexTiming(
  status: SearchIndexStatusLike | null | undefined,
  progress: number,
  nowSeconds = Date.now() / 1000,
) {
  if (!status?.startedAt) return { elapsed: "--", eta: "--" };

  const endSeconds = status.completedAt ?? nowSeconds;
  const elapsedSeconds = Math.max(0, endSeconds - status.startedAt);
  const elapsed = formatDuration(elapsedSeconds);

  if (status.state !== "building") return { elapsed, eta: "--" };

  const clampedProgress = Math.min(1, Math.max(0, progress));
  if (clampedProgress <= 0) {
    return { elapsed, eta: "estimating" };
  }

  const totalSeconds = elapsedSeconds / clampedProgress;
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
  return { elapsed, eta: formatDuration(remainingSeconds) };
}

export function getSearchIndexPresentation(
  status: SearchIndexStatusLike | null | undefined,
  progress: number,
) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const label = status?.state === "building"
    ? `Index ${percent}%`
    : status?.state === "error"
      ? "Index error"
      : status?.state === "ready"
        ? "Index ready"
        : "Index";
  const totalMessages = status?.totalMessages ?? 0;
  const messageText = totalMessages > 0
    ? `${Math.min(status?.processedMessages ?? 0, totalMessages)}/${totalMessages} messages`
    : `${status?.processedMessages ?? 0} messages`;
  const title = status?.state === "building"
    ? `${messageText} · ${status?.processedSessions ?? 0}/${status?.totalSessions ?? 0} sessions`
    : status?.error || label;

  return { percent, label, title };
}
