import type { SearchHit } from "@/modules/sdk/search";
import { parseScopedSearchQuery } from "../../../lib/searchScopes.ts";

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

/** Keep copied Agent references aligned with the SDK's stable search identity. */
function searchHitIndexTarget(hit: SearchHit) {
  return {
    id: hit.id,
    level: hit.level,
    projectId: hit.projectId,
    projectPath: hit.projectPath,
    ...(hit.sessionId ? { sessionId: hit.sessionId } : {}),
    ...(hit.runIndex != null ? { runIndex: hit.runIndex } : {}),
    ...(hit.messageId ? { messageId: hit.messageId } : {}),
    ...(hit.lineNumber != null ? { lineNumber: hit.lineNumber } : {}),
  };
}

export function searchHitIndexAsJson(hit: SearchHit): string {
  return JSON.stringify({
    schema: "ataru-search-hit/v1",
    operation: "inspect_search_hit",
    target: searchHitIndexTarget(hit),
  }, null, 2);
}

export function searchHitIndexesAsJson(hits: SearchHit[], query: string): string {
  return JSON.stringify({
    schema: "ataru-search-hits/v1",
    operation: "inspect_search_hits",
    query,
    count: hits.length,
    targets: hits.map(searchHitIndexTarget),
  }, null, 2);
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
  const clean = (candidate: string) => candidate
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*Script completed\b[\s\S]*?\bOutput:\s*/i, "")
    .replace(/\b(?:input_text|output_text)\s*:\s*/gi, "")
    .replace(/<meta\b[^>]*>/gi, " ")
    .replace(/&(amp|lt|gt|quot|#39);/g, decodeBasicHtmlEntities)
    .trim();
  const cleaned = clean(source);
  return cleaned || clean(value) || value.trim();
}

/** Keep query parsing consistent between snippet extraction and <mark> rendering. */
export function searchTerms(query: string): string[] {
  const uniqueTerms = new Map<string, string>();
  parseScopedSearchQuery(query).positiveTerms
    .map((term) => term.text.trim())
    .filter(Boolean)
    .forEach((term) => {
      const normalized = term.toLocaleLowerCase();
      if (!uniqueTerms.has(normalized)) uniqueTerms.set(normalized, term);
    });

  return [...uniqueTerms.values()]
    .sort((left, right) => right.length - left.length)
    .slice(0, 12);
}

export interface SearchHighlightSegment {
  text: string;
  highlighted: boolean;
}

interface SearchTextMatch {
  index: number;
  length: number;
}

function hasCompleteIdentifierBoundary(text: string, index: number, length: number): boolean {
  const before = [...text.slice(0, index)].at(-1);
  const after = [...text.slice(index + length)].at(0);
  const isIdentifierCharacter = (character: string) => /[\p{L}\p{N}_-]/u.test(character);
  return (!before || !isIdentifierCharacter(before)) && (!after || !isIdentifierCharacter(after));
}

function findSearchTextMatches(text: string, query: string): SearchTextMatch[] {
  const escapedTerms = searchTerms(query)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escapedTerms.length === 0) return [];

  const pattern = new RegExp(escapedTerms.join("|"), "giu");
  return [...text.matchAll(pattern)]
    .filter((match) => {
      if (!/[_-]/.test(match[0])) return true;
      return hasCompleteIdentifierBoundary(text, match.index, match[0].length);
    })
    .map((match) => ({ index: match.index, length: match[0].length }));
}

/** Return render-ready ranges while keeping compound identifiers whole. */
export function getSearchHighlightSegments(text: string, query: string): SearchHighlightSegment[] {
  const matches = findSearchTextMatches(text, query);
  if (matches.length === 0) return [{ text, highlighted: false }];

  const segments: SearchHighlightSegment[] = [];
  let cursor = 0;

  const append = (value: string, highlighted: boolean) => {
    if (!value) return;
    const previous = segments.at(-1);
    if (previous?.highlighted === highlighted) {
      previous.text += value;
    } else {
      segments.push({ text: value, highlighted });
    }
  };

  for (const match of matches) {
    append(text.slice(cursor, match.index), false);
    append(text.slice(match.index, match.index + match.length), true);
    cursor = match.index + match.length;
  }
  append(text.slice(cursor), false);

  return segments.length > 0 ? segments : [{ text, highlighted: false }];
}

function firstSearchMatch(value: string, query: string): { index: number; length: number } | null {
  return findSearchTextMatches(value, query)[0] ?? null;
}

/** Keep the actual match inside the two visible result-card lines. */
export function cleanSearchExcerpt(value: string, query: string, maxChars = 420): string {
  const raw = cleanMessageText(value);
  const cleaned = (hasPathQuery(query) ? raw : hidePathNoise(raw, query)).replace(/\s+/g, " ").trim();
  const visible = cleaned || raw.replace(/\s+/g, " ").trim();
  if (visible.length <= maxChars) return visible;

  const match = firstSearchMatch(visible, query);
  if (!match) return `${visible.slice(0, maxChars - 1).trimEnd()}…`;

  const leadingContext = Math.min(72, Math.max(24, Math.floor((maxChars - match.length) / 4)));
  const start = Math.max(0, match.index - leadingContext);
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
