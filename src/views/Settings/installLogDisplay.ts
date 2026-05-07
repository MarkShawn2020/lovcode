export function getInstallLogDisplayText(log: string) {
  return log.replace(/^\[(?:error|warn)\]\s*/, "");
}

export function getInstallLogClassName(log: string, cancelledLog: string) {
  if (log === cancelledLog) return "text-destructive";

  const displayText = getInstallLogDisplayText(log).trimStart().toLowerCase();
  const isWarning =
    log.startsWith("[warn]") ||
    displayText.startsWith("npm warn") ||
    displayText.startsWith("npm notice") ||
    displayText.startsWith("warning") ||
    displayText.startsWith("warn ");

  if (isWarning) return "text-primary";
  if (log.startsWith("[error]")) return "text-destructive";
  return "";
}
