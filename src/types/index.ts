export interface SessionUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  model?: string;
  context_tokens: number;
}

export type TitleSource = "custom" | "ai" | "slug" | "summary" | "prompt" | "none";

export interface Session {
  id: string;
  project_id: string;
  project_path: string | null;
  title: string | null;
  summary: string | null;
  last_prompt?: string | null;
  title_source?: TitleSource | null;
  rounds: number;
  message_count: number;
  created_at: number;
  last_modified: number;
  usage?: SessionUsage;
  source: "cli" | "app-code" | "app-web" | "app-cowork" | "codex";
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; summary: string; input?: string }
  | { type: "tool_result"; tool_use_id: string; content: string; images?: ToolResultImage[]; raw?: string }
  | { type: "thinking"; thinking: string };

export interface ToolResultImage {
  media_type: string;
  data: string;
  original_size?: number | null;
}

export interface Message {
  uuid: string;
  role: string;
  content: string;
  timestamp: string;
  is_meta: boolean;
  is_tool: boolean;
  line_number: number;
  content_blocks?: ContentBlock[];
}
