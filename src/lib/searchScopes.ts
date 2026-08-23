import type { Session } from "../types";

export type SearchScope =
  | "content"
  | "title"
  | "summary"
  | "run"
  | "prompt"
  | "assistant"
  | "project"
  | "id"
  | "source";

export interface ScopedSearchTerm {
  scope: SearchScope | null;
  text: string;
}

type SearchExpression =
  | { type: "term"; term: ScopedSearchTerm }
  | { type: "and"; children: SearchExpression[] }
  | { type: "or"; children: SearchExpression[] }
  | { type: "not"; child: SearchExpression };

export interface ParsedScopedSearchQuery {
  raw: string;
  terms: ScopedSearchTerm[];
  positiveTerms: ScopedSearchTerm[];
  defaultScopes: SearchScope[];
  highlightQuery: string;
  hasScopes: boolean;
  expression: SearchExpression | null;
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
  run: "run",
  runprompt: "run",
  round: "run",
  roundprompt: "run",
  turn: "content",
  turnprompt: "run",
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

    if (!quote && (ch === "(" || ch === ")")) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(ch);
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

function normalizeSearchOperator(token: string) {
  if (token === "&&") return "AND";
  if (token === "|" || token === "||") return "OR";
  if (SEARCH_OPERATORS.has(token)) return token;
  return null;
}

function combineExpression(
  type: "and" | "or",
  children: Array<SearchExpression | null>
): SearchExpression | null {
  const compact = children.filter((child): child is SearchExpression => Boolean(child));
  if (compact.length === 0) return null;
  if (compact.length === 1) return compact[0];
  return { type, children: compact };
}

function negateExpression(child: SearchExpression | null): SearchExpression | null {
  if (!child) return null;
  if (child.type === "not") return child.child;
  return { type: "not", child };
}

function parseScopedGroupToken(token: string) {
  let value = token;
  let negated = false;

  while (value.startsWith("+") || value.startsWith("-")) {
    if (value.startsWith("-")) negated = !negated;
    value = value.slice(1);
  }

  if (!value.endsWith(":")) return null;
  const scope = canonicalSearchScope(value.slice(0, -1));
  if (!scope) return null;
  return { scope, negated };
}

function parseTermToken(token: string, groupScope: SearchScope | null): SearchExpression | null {
  let value = token;
  let negated = false;

  while (value.startsWith("+") || value.startsWith("-")) {
    if (value.startsWith("-")) negated = !negated;
    value = value.slice(1);
  }

  const qualifier = splitQualifier(value);
  if (qualifier) {
    const [field, qualifierValue] = qualifier;
    if (normalizeScopeName(field) === "in") return null;

    const scope = canonicalSearchScope(field);
    if (scope) {
      const text = stripQueryValue(qualifierValue);
      if (!text) return null;
      const expression: SearchExpression = { type: "term", term: { scope, text } };
      return negated ? negateExpression(expression) : expression;
    }
  }

  const text = stripQueryValue(value);
  if (!text || normalizeSearchOperator(value)) return null;

  const expression: SearchExpression = { type: "term", term: { scope: groupScope, text } };
  return negated ? negateExpression(expression) : expression;
}

class SearchExpressionParser {
  private index = 0;
  private readonly tokens: string[];

  constructor(tokens: string[]) {
    this.tokens = tokens;
  }

  parse() {
    return this.parseOr(null);
  }

  private peek() {
    return this.tokens[this.index];
  }

  private advance() {
    return this.tokens[this.index++];
  }

  private matchOperator(operator: "AND" | "OR" | "NOT") {
    if (normalizeSearchOperator(this.peek() ?? "") !== operator) return false;
    this.index += 1;
    return true;
  }

  private parseOr(groupScope: SearchScope | null): SearchExpression | null {
    const children: Array<SearchExpression | null> = [this.parseAnd(groupScope)];

    while (this.matchOperator("OR")) {
      children.push(this.parseAnd(groupScope));
    }

    return combineExpression("or", children);
  }

  private parseAnd(groupScope: SearchScope | null): SearchExpression | null {
    const children: Array<SearchExpression | null> = [];

    while (this.index < this.tokens.length) {
      const token = this.peek();
      if (!token || token === ")" || normalizeSearchOperator(token) === "OR") break;
      if (this.matchOperator("AND")) continue;
      children.push(this.parseUnary(groupScope));
    }

    return combineExpression("and", children);
  }

  private parseUnary(groupScope: SearchScope | null): SearchExpression | null {
    if (this.matchOperator("NOT")) {
      return negateExpression(this.parseUnary(groupScope));
    }

    if (this.peek() === "-") {
      this.advance();
      return negateExpression(this.parseUnary(groupScope));
    }

    if (this.peek() === "+") {
      this.advance();
      return this.parseUnary(groupScope);
    }

    return this.parsePrimary(groupScope);
  }

  private parsePrimary(groupScope: SearchScope | null): SearchExpression | null {
    const token = this.peek();
    if (!token) return null;

    const scopedGroup = parseScopedGroupToken(token);
    if (scopedGroup && this.tokens[this.index + 1] === "(") {
      this.index += 2;
      const expression = this.parseOr(scopedGroup.scope);
      if (this.peek() === ")") this.advance();
      return scopedGroup.negated ? negateExpression(expression) : expression;
    }

    if (token === "(") {
      this.advance();
      const expression = this.parseOr(groupScope);
      if (this.peek() === ")") this.advance();
      return expression;
    }

    if (token === ")") return null;

    return parseTermToken(this.advance(), groupScope);
  }
}

function isDefaultScopeDirective(token: string) {
  const qualifier = splitQualifier(token);
  return Boolean(qualifier && normalizeScopeName(qualifier[0]) === "in");
}

function collectExpressionTerms(
  expression: SearchExpression | null,
  options: { positiveOnly?: boolean } = {},
  positive = true
): ScopedSearchTerm[] {
  if (!expression) return [];

  switch (expression.type) {
    case "term":
      return !options.positiveOnly || positive ? [expression.term] : [];
    case "not":
      return collectExpressionTerms(expression.child, options, !positive);
    case "and":
    case "or":
      return expression.children.flatMap((child) =>
        collectExpressionTerms(child, options, positive)
      );
  }
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

  const expressionTokens = tokens.filter((token) => !isDefaultScopeDirective(token));
  const expression = new SearchExpressionParser(expressionTokens).parse();
  const terms = collectExpressionTerms(expression);
  const positiveTerms = collectExpressionTerms(expression, { positiveOnly: true });
  const hasScopes = defaultScopes.length > 0 || terms.some((term) => Boolean(term.scope));

  const highlightQuery = (positiveTerms.length > 0 ? positiveTerms : terms)
    .map((term) => term.text)
    .join(" ")
    .trim() || raw;

  return { raw, terms, positiveTerms, defaultScopes, highlightQuery, hasScopes, expression };
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
    case "run":
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

type MetadataMatchState = "match" | "miss" | "unknown";

function invertMetadataMatchState(state: MetadataMatchState): MetadataMatchState {
  if (state === "unknown") return "unknown";
  return state === "match" ? "miss" : "match";
}

function combineAndMatchState(states: MetadataMatchState[]): MetadataMatchState {
  if (states.some((state) => state === "miss")) return "miss";
  if (states.some((state) => state === "unknown")) return "unknown";
  return "match";
}

function combineOrMatchState(states: MetadataMatchState[]): MetadataMatchState {
  if (states.some((state) => state === "match")) return "match";
  if (states.some((state) => state === "unknown")) return "unknown";
  return "miss";
}

function termMatchesMetadata(
  session: Session,
  parsed: ParsedScopedSearchQuery,
  term: ScopedSearchTerm
): MetadataMatchState {
  const scopes = term.scope
    ? [term.scope]
    : parsed.defaultScopes.length > 0
      ? parsed.defaultScopes
      : METADATA_SCOPES;

  const canMatchContent = term.scope === null
    ? parsed.defaultScopes.length === 0
      || parsed.defaultScopes.some((scope) => scope === "content" || scope === "run" || scope === "assistant")
    : term.scope === "content" || term.scope === "run" || term.scope === "assistant";

  const matched = scopes.some((scope) => {
    if (scope === "content" || scope === "run" || scope === "assistant") return false;
    return termMatchesScope(session, scope, term.text);
  });

  if (matched) return "match";
  return canMatchContent ? "unknown" : "miss";
}

function evaluateMetadataExpression(
  session: Session,
  parsed: ParsedScopedSearchQuery,
  expression: SearchExpression
): MetadataMatchState {
  switch (expression.type) {
    case "term":
      return termMatchesMetadata(session, parsed, expression.term);
    case "not":
      return invertMetadataMatchState(
        evaluateMetadataExpression(session, parsed, expression.child)
      );
    case "and":
      return combineAndMatchState(
        expression.children.map((child) => evaluateMetadataExpression(session, parsed, child))
      );
    case "or":
      return combineOrMatchState(
        expression.children.map((child) => evaluateMetadataExpression(session, parsed, child))
      );
  }
}

export function matchesScopedSessionMetadata(session: Session, parsed: ParsedScopedSearchQuery) {
  if (!parsed.expression) return false;
  return evaluateMetadataExpression(session, parsed, parsed.expression) === "match";
}

const SEMANTIC_SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "or",
  "please",
  "session",
  "sessions",
  "the",
  "to",
  "with",
  "一下",
  "一个",
  "之前",
  "会话",
  "对应",
  "帮",
  "帮我",
  "想",
  "找",
  "找出",
  "把",
  "提到",
  "搜索",
  "查",
  "查找",
  "筛选",
  "给",
  "聊过",
  "讨论",
  "讨论过",
  "请",
  "这个",
  "这些",
  "那个",
  "那些",
  "相关",
  "能",
  "能够",
  "可以",
  "的",
  "了",
  "和",
  "与",
  "是",
  "在",
  "有",
]);

function normalizeSemanticSearchTerm(term: string) {
  return term
    .replace(/^[\s"'`.,:;!?，。、“”‘’（）()[\]{}<>《》【】+-]+/, "")
    .replace(/[\s"'`.,:;!?，。、“”‘’（）()[\]{}<>《》【】+-]+$/, "")
    .toLowerCase();
}

function semanticSearchTerms(query: string) {
  return (query.match(/"[^"]+"|'[^']+'|[A-Za-z0-9][A-Za-z0-9._-]*|[\p{Script=Han}]{2,}|\S+/gu) ?? [])
    .map((term) => normalizeSemanticSearchTerm(term.replace(/^["']|["']$/g, "")))
    .filter((term) => term.length > 0 && !SEMANTIC_SEARCH_STOPWORDS.has(term));
}

export function shouldUseSemanticSessionSearch(
  query: string,
  parsed: ParsedScopedSearchQuery = parseScopedSearchQuery(query)
) {
  const raw = query.trim();
  if (!raw || parsed.hasScopes) return false;
  if (/\b(?:AND|OR|NOT)\b|[()]/.test(raw)) return false;
  if (/(^|\s)[+-]\S/.test(raw)) return false;

  const terms = semanticSearchTerms(raw);
  if (terms.length >= 2) return true;

  const compact = raw.replace(/\s+/g, "");
  return /[\p{Script=Han}]/u.test(compact) && compact.length >= 4;
}
