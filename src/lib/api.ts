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

export type ConversationRole = "user" | "assistant" | "system" | "tool" | "other";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  timestamp: string | null;
}

export interface Conversation {
  id: string;
  source: string;
  project: string | null;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
  messages: ConversationMessage[];
  raw_path: string | null;
}

export function getConversation(id: string): Promise<Conversation> {
  return invoke<Conversation>("get_conversation", { id });
}

export function focusMainWindow(conversationId?: string): Promise<void> {
  return invoke("focus_main_window", { conversationId: conversationId ?? null });
}
