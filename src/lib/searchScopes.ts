import type { Session } from "../types";

export type SearchScope =
  | "content"
  | "title"
  | "summary"
  | "prompt"
  | "assistant"
  | "project"
  | "id"
  | "source";

export interface ScopedSearchTerm {
  scope: SearchScope | null;
  text: string;
}

export interface ParsedScopedSearchQuery {
  raw: string;
  terms: ScopedSearchTerm[];
  defaultScopes: SearchScope[];
  highlightQuery: string;
  hasScopes: boolean;
}

const SEARCH_SCOPE_ALIASES: Record<string, SearchScope> = {
  body: "content",
  content: "content",
  message: "content",
  messages: "content",
  text: "content",
  name: "title",
  title: "title",
  summary: "summary",
  latestprompt: "prompt",
  lastprompt: "prompt",
  prompt: "prompt",
  prompts: "prompt",
  question: "prompt",
  user: "prompt",
  userprompt: "prompt",
  userprompts: "prompt",
  ai: "assistant",
  answer: "assistant",
  assistant: "assistant",
  reply: "assistant",
  response: "assistant",
  cwd: "project",
  directory: "project",
  path: "project",
  project: "project",
  projectpath: "project",
  id: "id",
  session: "id",
  sessionid: "id",
  source: "source",
};

const METADATA_SCOPES: SearchScope[] = ["title", "summary", "prompt", "project", "id", "source"];
const SEARCH_OPERATORS = new Set(["AND", "OR", "NOT"]);

function tokenizeSearchQuery(query: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  for (const ch of query) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      current += ch;
      quote = quote === ch ? null : quote ?? ch;
      continue;
    }

    if (/\s/.test(ch) && !quote) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

function normalizeScopeName(scope: string) {
  return scope.toLowerCase().replace(/[-_]/g, "");
}

function canonicalSearchScope(scope: string): SearchScope | null {
  return SEARCH_SCOPE_ALIASES[normalizeScopeName(scope)] ?? null;
}

function splitQualifier(token: string): [string, string] | null {
  const colon = token.indexOf(":");
  if (colon <= 0 || colon === token.length - 1) return null;

  const field = token.slice(0, colon);
  if (!/^[a-z0-9_-]+$/i.test(field)) return null;

  return [field, token.slice(colon + 1)];
}

function stripQueryValue(value: string) {
  return value
    .replace(/^[-+]+/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function uniqueScopes(scopes: SearchScope[]) {
  return scopes.filter((scope, index) => scopes.indexOf(scope) === index);
}

export function parseScopedSearchQuery(query: string): ParsedScopedSearchQuery {
  const raw = query.trim();
  const tokens = tokenizeSearchQuery(raw);
  const defaultScopes = uniqueScopes(tokens.flatMap((token) => {
    const qualifier = splitQualifier(token);
    if (!qualifier || normalizeScopeName(qualifier[0]) !== "in") return [];
    return qualifier[1]
      .split(",")
      .map((scope) => canonicalSearchScope(scope.trim()))
      .filter((scope): scope is SearchScope => Boolean(scope));
  }));

  const terms: ScopedSearchTerm[] = [];
  let hasScopes = defaultScopes.length > 0;

  for (const token of tokens) {
    const qualifier = splitQualifier(token);
    if (qualifier) {
      const [field, value] = qualifier;
      if (normalizeScopeName(field) === "in") continue;

      const scope = canonicalSearchScope(field);
      if (scope) {
        const text = stripQueryValue(value);
        if (text) terms.push({ scope, text });
        hasScopes = true;
        continue;
      }
    }

    const text = stripQueryValue(token);
    if (text && !SEARCH_OPERATORS.has(text.toUpperCase())) {
      terms.push({ scope: null, text });
    }
  }

  const highlightQuery = terms.map((term) => term.text).join(" ").trim() || raw;
  return { raw, terms, defaultScopes, highlightQuery, hasScopes };
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function compactSearchValue(value: string) {
  return value.replace(/[-_\s]/g, "");
}

function getProjectName(session: Session) {
  return session.project_path?.split("/").filter(Boolean).pop() ?? "";
}

function scopedSessionValues(session: Session, scope: SearchScope) {
  switch (scope) {
    case "title":
      return [session.title];
    case "summary":
      return [session.summary];
    case "prompt":
      return [session.last_prompt];
    case "project":
      return [session.project_path, getProjectName(session), session.project_id];
    case "id":
      return [session.id];
    case "source":
      return [session.source];
    case "content":
    case "assistant":
      return [];
  }
}

function termMatchesScope(session: Session, scope: SearchScope, text: string) {
  const normalizedText = normalizeSearchValue(text);
  if (!normalizedText) return true;

  if (scope === "id") {
    const sessionId = normalizeSearchValue(session.id);
    const compactText = compactSearchValue(normalizedText);
    return sessionId.includes(normalizedText)
      || (compactText.length > 0 && compactSearchValue(sessionId).includes(compactText));
  }

  return scopedSessionValues(session, scope).some((value) =>
    normalizeSearchValue(value).includes(normalizedText)
  );
}

export function matchesScopedSessionMetadata(session: Session, parsed: ParsedScopedSearchQuery) {
  if (parsed.terms.length === 0) return false;

  return parsed.terms.every((term) => {
    const scopes = term.scope
      ? [term.scope]
      : parsed.defaultScopes.length > 0
        ? parsed.defaultScopes
        : METADATA_SCOPES;

    return scopes.some((scope) => termMatchesScope(session, scope, term.text));
  });
}
