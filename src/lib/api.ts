import { invoke } from "@tauri-apps/api/core";

export type Role = "user" | "assistant" | "system" | "tool" | "other";

export interface SearchResult {
  conversation_id: string;
  source: string;
  project: string | null;
  title: string | null;
  snippet: string;
  score: number;
  timestamp: string | null;
}

export interface SourceSummary {
  id: string;
  name: string;
  count: number;
}

export function listSources(): Promise<SourceSummary[]> {
  return invoke<SourceSummary[]>("list_sources");
}

export function search(args: {
  q: string;
  source?: string;
  project?: string;
  since?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search", args);
}

export function rebuildIndex(): Promise<number> {
  return invoke<number>("rebuild_index");
}
