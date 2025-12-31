export function restoreSlashCommand(content: string): string {
  // Use [\s\S]*? to match any chars including newlines between tags
  const pattern = /<command-message>[\s\S]*?<\/command-message>[\s\S]*?<command-name>(\/[^\n<]+)<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/g;
  return content.replace(pattern, (_match, cmd, args) => {
    const trimmedArgs = (args || "").trim();
    return trimmedArgs ? `${cmd} ${trimmedArgs}` : cmd;
  });
}

export function formatRelativeTime(ts: number): string {
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}
