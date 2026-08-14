import type { SearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";
import { invoke } from "@/lib/tauri";
import type { Message } from "@/types";
import type { SearchRequest, SearchResponse } from "@/modules/sdk/search";

interface SearchResponseWire extends Omit<SearchResponse, "warnings"> {
  warnings?: string[];
}

export type { SearchIndexBuildStatus } from "@/hooks/useSearchIndexBuildStatus";
export type {
  SearchHit,
  SearchLevel,
  SearchMode,
  SearchRequest,
  SearchResponse,
  SearchSignals,
} from "@/modules/sdk/search";

export async function ataruSearch(
  request: SearchRequest,
): Promise<SearchResponse> {
  const response = await invoke<SearchResponseWire>("ataru_search", {
    request,
  });
  return {
    ...response,
    warnings: response.warnings ?? [],
  };
}

export function getSessionMessages(
  projectId: string,
  sessionId: string,
): Promise<Message[]> {
  return invoke<Message[]>("get_session_messages", { projectId, sessionId });
}

export function getSessionSourcePath(
  projectId: string,
  sessionId: string,
): Promise<string> {
  return invoke<string>("get_session_source_path", { projectId, sessionId });
}

export function revealSessionInFinder(
  projectId: string,
  sessionId: string,
): Promise<void> {
  return invoke<void>("reveal_session_in_finder", { projectId, sessionId });
}

export function copyText(text: string): Promise<void> {
  return invoke<void>("copy_to_clipboard", { text });
}

export function getSearchIndexStatus(): Promise<SearchIndexBuildStatus> {
  return invoke<SearchIndexBuildStatus>("get_search_index_status");
}

export function startSearchIndexBuild(
  force = false,
): Promise<SearchIndexBuildStatus> {
  return invoke<SearchIndexBuildStatus>("start_search_index_build", { force });
}

export function startIncrementalSearchIndexBuild(): Promise<SearchIndexBuildStatus> {
  return startSearchIndexBuild(false);
}

export interface SearchIndexWatchTarget {
  source: string;
  rootPath: string;
  files: string[];
}

export interface IncrementalSearchIndexSyncStatus {
  enabled: boolean;
  monitoring: boolean;
  targets: SearchIndexWatchTarget[];
  lastChangeAt?: number | null;
  lastSyncRequestedAt?: number | null;
}

export function getIncrementalSearchIndexSyncStatus(): Promise<IncrementalSearchIndexSyncStatus> {
  return invoke<IncrementalSearchIndexSyncStatus>("get_incremental_search_index_sync_status");
}

export function setIncrementalSearchIndexSyncEnabled(
  enabled: boolean,
): Promise<IncrementalSearchIndexSyncStatus> {
  return invoke<IncrementalSearchIndexSyncStatus>("set_incremental_search_index_sync_enabled", { enabled });
}

export interface SemanticSearchStatus {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  model?: string | null;
  baseUrl?: string | null;
  store: "sqlite";
  entries: number;
  error?: string | null;
}

export interface SemanticSearchInitializationPreview {
  sourceSessions: number;
  sampledSessions: number;
  sourceBytes: number;
  candidateChunks: number;
  candidateChars: number;
  embeddingBatches: number;
}

export function getSemanticSearchStatus(): Promise<SemanticSearchStatus> {
  return invoke<SemanticSearchStatus>("get_semantic_search_status");
}

export function setSemanticSearchEnabled(enabled: boolean): Promise<SemanticSearchStatus> {
  return invoke<SemanticSearchStatus>("set_semantic_search_enabled", { enabled });
}

export function initializeSemanticSearch(): Promise<SemanticSearchStatus> {
  return invoke<SemanticSearchStatus>("initialize_semantic_search");
}

export function previewSemanticSearchInitialization(): Promise<SemanticSearchInitializationPreview> {
  return invoke<SemanticSearchInitializationPreview>("preview_semantic_search_initialization");
}
