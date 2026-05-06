import type {
  EnvironmentAction,
  EnvironmentConfig,
  EnvironmentPlatform,
} from "@/types/agent";

export const ENVIRONMENT_PLATFORMS: Array<{ key: EnvironmentPlatform; label: string }> = [
  { key: "default", label: "Default" },
  { key: "macos", label: "macOS" },
  { key: "linux", label: "Linux" },
  { key: "windows", label: "Windows" },
];

const DEFAULT_SESSION_ENVIRONMENT_PREFIX = "session-default:";

export function normalizeEnvironmentKey(path?: string | null): string {
  return path ? path.replace(/[/\\]+$/, "") : "";
}

export function getDefaultSessionEnvironmentKey(projectPath?: string | null): string {
  const projectKey = normalizeEnvironmentKey(projectPath);
  return projectKey ? `${DEFAULT_SESSION_ENVIRONMENT_PREFIX}${projectKey}` : "";
}

export function isDefaultSessionEnvironmentKey(key?: string | null): boolean {
  return Boolean(key?.startsWith(DEFAULT_SESSION_ENVIRONMENT_PREFIX));
}

export function getProjectPathFromDefaultSessionEnvironmentKey(key: string): string {
  return isDefaultSessionEnvironmentKey(key)
    ? key.slice(DEFAULT_SESSION_ENVIRONMENT_PREFIX.length)
    : "";
}

export function getProjectName(path?: string | null): string {
  const normalized = normalizeEnvironmentKey(path);
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized || "Project";
}

export function getCurrentEnvironmentPlatform(): EnvironmentPlatform {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.includes("mac") || userAgent.includes("mac os")) return "macos";
  if (platform.includes("win") || userAgent.includes("windows")) return "windows";
  if (platform.includes("linux") || userAgent.includes("linux")) return "linux";
  return "default";
}

export function createEmptyEnvironmentAction(command = ""): EnvironmentAction {
  return {
    id: crypto.randomUUID(),
    name: "Run",
    scripts: { default: command },
    platformSpecific: false,
  };
}

export function createEmptyEnvironmentConfig(name: string, actionCommand = ""): EnvironmentConfig {
  return {
    name,
    setupScripts: { default: "" },
    cleanupScripts: { default: "" },
    actions: [createEmptyEnvironmentAction(actionCommand)],
    updatedAt: null,
  };
}

export function ensureEnvironmentConfig(
  config: EnvironmentConfig | null | undefined,
  name: string,
): EnvironmentConfig {
  if (!config) return createEmptyEnvironmentConfig(name);
  return {
    name: config.name || name,
    setupScripts: config.setupScripts ?? { default: "" },
    cleanupScripts: config.cleanupScripts ?? { default: "" },
    actions: config.actions?.length ? config.actions : [createEmptyEnvironmentAction()],
    updatedAt: config.updatedAt ?? null,
  };
}

export function getEnvironmentScript(
  scripts: Partial<Record<EnvironmentPlatform, string>>,
  platform: EnvironmentPlatform,
): string {
  const platformScript = scripts[platform]?.trim();
  if (platform !== "default" && platformScript) return platformScript;
  return scripts.default?.trim() ?? "";
}

export function hasEnvironmentScript(
  scripts: Partial<Record<EnvironmentPlatform, string>>,
  platform: EnvironmentPlatform,
): boolean {
  return getEnvironmentScript(scripts, platform).length > 0;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildEnvironmentCommand(
  script: string,
  cwd: string,
  env: Record<string, string | null | undefined>,
): string {
  const exports = Object.entries(env)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`);

  return [
    "set -e",
    `cd ${shellQuote(cwd)}`,
    ...exports,
    script.trim(),
  ].join("\n");
}
