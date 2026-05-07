export type CliRuntime = "claude" | "codex";

export const AGENT_CLI_RUNTIME_CONFIG: Record<
  CliRuntime,
  {
    id: CliRuntime;
    label: string;
    iconSrc: string;
    command: string;
    packageName: string;
  }
> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    iconSrc: "/agent-icons/claude.png",
    command: "claude",
    packageName: "@anthropic-ai/claude-code",
  },
  codex: {
    id: "codex",
    label: "Codex",
    iconSrc: "/agent-icons/openai.png",
    command: "codex",
    packageName: "@openai/codex",
  },
};

export const AGENT_CLI_RUNTIME_OPTIONS = Object.values(AGENT_CLI_RUNTIME_CONFIG);
