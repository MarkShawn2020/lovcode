import type { SearchHit } from "@/modules/sdk/search";

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

function containsSearchTerm(value: string, query: string): boolean {
  const normalized = value.toLocaleLowerCase();
  return searchTerms(query).some((term) => normalized.includes(term.toLocaleLowerCase()));
}

function hidePathNoise(value: string, query: string): string {
  return value
    .replace(QUOTED_PATH, (path) => containsSearchTerm(path, query) ? path : " ")
    .replace(ABSOLUTE_PATH, (path) => containsSearchTerm(path, query) ? path : " ")
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

const SEARCH_FIELD_PREFIX = /\b(?:title|project|turn|run|round|session|assistant|user|summary|prompt|content|path):/gi;

/** Keep query parsing consistent between snippet extraction and <mark> rendering. */
export function searchTerms(query: string): string[] {
  return [...new Set(
    query
      .replace(SEARCH_FIELD_PREFIX, " ")
      .replace(/[()\"']/g, " ")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0 && !/^(?:and|or|not)$/i.test(term)),
  )]
    .sort((left, right) => right.length - left.length)
    .slice(0, 12);
}

function firstSearchMatch(value: string, query: string): { index: number; length: number } | null {
  const normalized = value.toLocaleLowerCase();
  return searchTerms(query)
    .map((term) => ({
      index: normalized.indexOf(term.toLocaleLowerCase()),
      length: term.length,
    }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index || right.length - left.length)[0] ?? null;
}

/** Keep the result card useful by centering a longer snippet on the query. */
export function cleanSearchExcerpt(value: string, query: string, maxChars = 420): string {
  const raw = cleanMessageText(value);
  const cleaned = (hasPathQuery(query) ? raw : hidePathNoise(raw, query)).replace(/\s+/g, " ").trim();
  const visible = cleaned || raw.replace(/\s+/g, " ").trim();
  if (visible.length <= maxChars) return visible;

  const match = firstSearchMatch(visible, query);
  if (!match) return `${visible.slice(0, maxChars - 1).trimEnd()}…`;

  const contextPadding = Math.max(56, Math.floor((maxChars - match.length) / 2));
  const start = Math.max(0, match.index - contextPadding);
  const end = Math.min(visible.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < visible.length ? "…" : "";
  return `${prefix}${visible.slice(start, end).trim()}${suffix}`;
}

/**
 * Titles identify Run/Session/Project results. Turn is an atomic record and
 * intentionally has no title.
 * Keep path searches intact, but hide path-shaped noise for normal language
 * queries and fall back to a short, explicit label when nothing remains.
 */
export function cleanSearchTitle(value: string, query: string, fallback = "未命名对话", maxChars = 120): string {
  const cleaned = cleanSearchExcerpt(value, query, maxChars);
  return cleaned || fallback;
}

export function getSearchResultTitle(hit: SearchHit, query: string): string {
  if (hit.level === "turn") {
    return "";
  }

  if (hit.level === "run") {
    return cleanSearchTitle(
      hit.runPrompt ?? hit.title,
      query,
      `Run ${hit.runIndex ?? ""}`.trim(),
    );
  }

  return cleanSearchTitle(
    hit.sessionTitle ?? hit.title,
    query,
    hit.level === "project"
      ? "Project"
      : `Session ${hit.sessionId?.slice(0, 8) ?? ""}`.trim(),
  );
}

export function getSearchResultExcerpt(
  hit: SearchHit,
  query: string,
  title = getSearchResultTitle(hit, query),
): string {
  const candidates = hit.level === "turn"
    ? [hit.snippet]
    : hit.level === "run"
      ? [hit.snippet, hit.runPrompt]
      : [hit.snippet, hit.runPrompt, hit.sessionTitle, hit.title];
  const normalizedTitle = title.trim().toLocaleLowerCase();
  const excerpts = candidates.map((value) => cleanSearchExcerpt(value ?? "", query));
  const primaryExcerpt = excerpts[0];
  const excerpt = primaryExcerpt && (
    hit.level === "turn"
      || hit.level === "run"
      || hit.lineNumber != null
  )
    ? primaryExcerpt
    : excerpts.find((value) => {
      if (!value) return false;
      return value.trim().toLocaleLowerCase() !== normalizedTitle;
    });
  return excerpt || (
    hit.level === "turn"
      ? "这条 Turn 没有可显示的正文"
      : hit.level === "run"
        ? "打开上下文查看这次 Run"
        : "打开上下文查看命中内容"
  );
}

export function getSearchResultRoleLabel(role: string | null | undefined): string {
  if (role === "user") return "用户消息";
  if (role === "assistant") return "AI 回复";
  if (role === "tool") return "工具调用";
  return "原子消息";
}

export function getSearchResultContextLabel(hit: SearchHit): string {
  if (hit.level === "turn") {
    const run = hit.runIndex ? ` · Run ${hit.runIndex}` : "";
    return `Turn · ${getSearchResultRoleLabel(hit.role)}${run}`;
  }
  if (hit.level === "run") return `Run ${hit.runIndex ?? ""}`.trim();
  if (hit.level === "session") return "Session";
  return "Project";
}

export function getSearchResultMatchLabel(
  hit: SearchHit,
  query: string,
  excerpt: string,
): string {
  const semanticOnly = hit.signals.semantic != null && hit.signals.lexical == null;
  if (semanticOnly && !containsSearchTerm(excerpt, query)) {
    return hit.level === "turn" ? "语义命中" : "语义命中 Turn";
  }
  return hit.level === "turn" ? "命中内容" : "命中 Turn";
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
