export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatTimestamp(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function formatSessionTime(value: number): string {
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  return formatTimestamp(new Date(milliseconds).toISOString());
}

export function projectName(path: string | null | undefined): string {
  const parts = (path ?? "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "Unknown project";
}

export function roleLabel(role: string | null | undefined): string {
  if (role === "user") return "你";
  if (role === "assistant") return "AI";
  return role ?? "";
}

const STRUCTURED_TEXT_FIELD = /"text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
const QUOTED_PATH = /(['"`])(?:[A-Za-z]:[\\/]+|\/(?:Users|home|private|var|tmp)\/)[^'"`]+\1/g;
const ABSOLUTE_PATH = /(?:^|\s)(?:[A-Za-z]:[\\/]+|\/(?:Users|home|private|var|tmp)\/)[^\s]+/g;

function decodeStructuredText(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function decodeBasicHtmlEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => {
    switch (entity) {
      case "&amp;": return "&";
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return '"';
      case "&#39;": return "'";
      default: return entity;
    }
  });
}

function hidePathNoise(value: string): string {
  return value
    .replace(QUOTED_PATH, " ")
    .replace(ABSOLUTE_PATH, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPathQuery(query: string): boolean {
  return /(?:[\\/]|[A-Za-z]:)/.test(query);
}

/**
 * Rollout providers sometimes store tool protocol envelopes as the message
 * body (for example `input_text: {"text":"..."}`). That is useful in the
 * raw transcript, but it is distracting in a recall card. Pull the readable
 * text out while leaving ordinary code, Markdown and paths untouched.
 */
export function cleanMessageText(value: string): string {
  const hasStructuredEnvelope = /\b(?:input_text|output_text)\s*:/i.test(value)
    || /"type"\s*:\s*"(?:input_text|output_text)"/i.test(value);
  const structuredText = hasStructuredEnvelope
    ? [...value.matchAll(STRUCTURED_TEXT_FIELD)]
      .map((match) => decodeStructuredText(match[1]))
      .filter((text) => text.trim().length > 0)
    : [];
  const source = structuredText.length > 0 ? structuredText.join("\n") : value;

  return source
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*Script completed\b[\s\S]*?\bOutput:\s*/i, "")
    .replace(/\b(?:input_text|output_text)\s*:\s*/gi, "")
    .replace(/<meta\b[^>]*>/gi, " ")
    .replace(/&(amp|lt|gt|quot|#39);/g, decodeBasicHtmlEntities)
    .trim();
}

/** Keep the result card useful by centering a longer snippet on the query. */
export function cleanSearchExcerpt(value: string, query: string, maxChars = 420): string {
  const raw = cleanMessageText(value);
  const cleaned = (hasPathQuery(query) ? raw : hidePathNoise(raw)).replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;

  const needle = query.trim().toLocaleLowerCase();
  const matchIndex = needle ? cleaned.toLocaleLowerCase().indexOf(needle) : -1;
  if (matchIndex < 0) return `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;

  const contextPadding = Math.max(40, Math.floor((maxChars - needle.length) / 2));
  const start = Math.max(0, matchIndex - contextPadding);
  const end = Math.min(cleaned.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < cleaned.length ? "…" : "";
  return `${prefix}${cleaned.slice(start, end).trim()}${suffix}`;
}

/**
 * Titles should identify the turn, not repeat an attachment or workspace path.
 * Keep path searches intact, but hide path-shaped noise for normal language
 * queries and fall back to a short, explicit label when nothing remains.
 */
export function cleanSearchTitle(value: string, query: string, fallback = "未命名对话", maxChars = 120): string {
  const cleaned = cleanSearchExcerpt(value, query, maxChars);
  return cleaned || fallback;
}

/** Preserve intentional code indentation while removing transcript-wide padding. */
export function cleanTranscriptText(value: string): string {
  const cleaned = cleanMessageText(value);
  const lines = cleaned.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return lines
    .map((line) => (commonIndent > 0 ? line.slice(Math.min(commonIndent, line.length)) : line.trimEnd()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
