export const SEARCH_LEVELS = ["turn", "session", "project"] as const;

export type SearchLevel = (typeof SEARCH_LEVELS)[number];

export const SEARCH_MODES = ["auto", "keyword", "semantic", "hybrid"] as const;

export type SearchMode = (typeof SEARCH_MODES)[number];

export interface SearchRequest {
  query: string;
  level: SearchLevel;
  mode: SearchMode;
  limit: number;
  projectId?: string | null;
}

export interface SearchSignals {
  lexical?: number;
  semantic?: number;
  fusion: number;
}

export interface SearchHit {
  id: string;
  level: SearchLevel;
  title: string;
  snippet: string;
  projectId: string;
  projectPath: string;
  sessionId?: string;
  sessionTitle?: string;
  turnIndex?: number;
  turnPrompt?: string;
  messageId?: string;
  lineNumber?: number;
  role?: string;
  timestamp?: string;
  matchCount: number;
  sessionCount: number;
  score: number;
  signals: SearchSignals;
}

export interface SearchResponse {
  version: number;
  query: string;
  level: SearchLevel;
  requestedMode: SearchMode;
  mode: SearchMode;
  semanticAvailable: boolean;
  tookMs: number;
  total: number;
  hits: SearchHit[];
  warnings: string[];
}
