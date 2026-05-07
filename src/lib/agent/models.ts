const CLAUDE_CODE_MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-7-20251101": "claude-opus-4-7",
  "claude-sonnet-4-6-20251001": "claude-sonnet-4-6",
  "claude-haiku-4-5-20250930": "claude-haiku-4-5-20251001",
};

export function normalizeClaudeCodeModelName(modelName: string): string {
  const trimmed = modelName.trim();
  return CLAUDE_CODE_MODEL_ALIASES[trimmed] ?? trimmed;
}
