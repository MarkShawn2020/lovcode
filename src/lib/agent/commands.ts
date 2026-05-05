import type { AgentProvider, AgentRuntime } from "@/types/agent";

export function runtimeForProvider(provider: AgentProvider): AgentRuntime {
  if (provider === "claude") return "claude-cli-pty";
  if (provider === "codex") return "codex-cli-pty";
  return "terminal-pty";
}

export function labelForProvider(provider: AgentProvider): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "codex") return "Codex";
  return "Terminal";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function prefixCommandEnv(command: string, env?: Record<string, string | undefined>): string {
  const envPrefix = Object.entries(env ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  return envPrefix ? `${envPrefix} ${command}` : command;
}

export function buildAgentCommand(
  provider: Exclude<AgentProvider, "terminal">,
  prompt: string,
  extraArgs?: string,
  env?: Record<string, string | undefined>,
): string {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const head = extraArgs ? `${provider} ${extraArgs}` : provider;
  const command = prompt.trim() ? `${head} "${escape(prompt.trim())}"` : head;
  return prefixCommandEnv(command, env);
}

export function makeSessionTitle(provider: AgentProvider, prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (trimmed) return trimmed.slice(0, 80);
  return provider === "terminal" ? "Shell" : "New session";
}
