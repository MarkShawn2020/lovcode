export function restoreSlashCommand(content: string): string {
  const pattern = /(?:<command-(?:message|name|args)>[\s\S]*?<\/command-(?:message|name|args)>\s*){1,4}/g;
  const restored = content.replace(pattern, (block) => {
    const name = block.match(/<command-name>(\/[^\n<]+)<\/command-name>/)?.[1];
    if (!name) return block;
    const args = block.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return args ? `${name} ${args}` : name;
  });
  return restored
    .replace(/<local-command-(?:caveat|stdout|stderr)>[\s\S]*?<\/local-command-(?:caveat|stdout|stderr)>\s*/g, "")
    .trim();
}

export function formatRelativeTime(timestamp: number): string {
  const seconds = Date.now() / 1000 - timestamp;
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("zh-CN");
}
