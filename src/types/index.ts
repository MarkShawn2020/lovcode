// ============================================================================
// Feature Types
// ============================================================================

export type FeatureType =
  | "chat"
  | "workspace"
  | "features"
  | "settings"
  | "statusline"
  | "commands"
  | "mcp"
  | "skills"
  | "hooks"
  | "sub-agents"
  | "output-styles"
  | "marketplace"
  | "kb-distill"
  | "kb-reference";

export interface FeatureConfig {
  type: FeatureType;
  label: string;
  description: string;
  available: boolean;
  group: "history" | "config" | "marketplace" | "knowledge";
}

// ============================================================================
// Data Types
// ============================================================================

export interface Project {
  id: string;
  path: string;
  session_count: number;
  last_active: number;
}

export interface Session {
  id: string;
  project_id: string;
  project_path: string | null;
  summary: string | null;
  message_count: number;
  last_modified: number;
}

export interface Message {
  uuid: string;
  role: string;
  content: string;
  timestamp: string;
  is_meta: boolean;
  is_tool: boolean;
  line_number: number;
}

export interface ChatMessage {
  uuid: string;
  role: string;
  content: string;
  timestamp: string;
  project_id: string;
  project_path: string;
  session_id: string;
  session_summary: string | null;
}

export interface SearchResult {
  uuid: string;
  content: string;
  role: string;
  project_id: string;
  project_path: string;
  session_id: string;
  session_summary: string | null;
  timestamp: string;
  score: number;
}

export interface ChatsResponse {
  items: ChatMessage[];
  total: number;
}

export interface LocalCommand {
  name: string;
  path: string;
  description: string | null;
  allowed_tools: string | null;
  argument_hint: string | null;
  content: string;
  version: string | null;
  status: "active" | "deprecated" | "archived";
  deprecated_by: string | null;
  changelog: string | null;
  aliases: string[];
  frontmatter: string | null;
}

export interface LocalAgent {
  name: string;
  path: string;
  description: string | null;
  model: string | null;
  tools: string | null;
  content: string;
}

export interface LocalSkill {
  name: string;
  path: string;
  description: string | null;
  content: string;
}

export interface DistillDocument {
  date: string;
  file: string;
  title: string;
  tags: string[];
  session: string | null;
}

export interface McpServer {
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ClaudeSettings {
  raw: Record<string, unknown> | null;
  permissions: Record<string, unknown> | null;
  hooks: Record<string, unknown[]> | null;
  mcp_servers: McpServer[];
}

export interface ContextFile {
  name: string;
  path: string;
  scope: string;
  content: string;
  last_modified: number;
}

export interface TemplateComponent {
  name: string;
  path: string;
  category: string;
  component_type: string;
  description: string | null;
  downloads: number | null;
  content: string | null;
  source_id?: string | null;
  source_name?: string | null;
  source_icon?: string | null;
  plugin_name?: string | null;
  author?: string | null;
}

export interface SourceInfo {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface TemplatesCatalog {
  settings: TemplateComponent[];
  commands: TemplateComponent[];
  mcps: TemplateComponent[];
  skills: TemplateComponent[];
  hooks: TemplateComponent[];
  agents: TemplateComponent[];
  statuslines: TemplateComponent[];
  "output-styles": TemplateComponent[];
  sources?: SourceInfo[];
}

export type TemplateCategory =
  | "settings"
  | "commands"
  | "mcps"
  | "skills"
  | "hooks"
  | "agents"
  | "output-styles";

// ============================================================================
// View State Types
// ============================================================================

export type View =
  | { type: "home" }
  | { type: "workspace" }
  | { type: "features" }
  | { type: "chat-projects" }
  | { type: "chat-sessions"; projectId: string; projectPath: string }
  | { type: "chat-messages"; projectId: string; sessionId: string; summary: string | null }
  | { type: "settings" }
  | { type: "commands" }
  | { type: "command-detail"; command: LocalCommand; scrollToChangelog?: boolean }
  | { type: "mcp" }
  | { type: "skills" }
  | { type: "skill-detail"; skill: LocalSkill }
  | { type: "hooks" }
  | { type: "sub-agents" }
  | { type: "sub-agent-detail"; agent: LocalAgent }
  | { type: "output-styles" }
  | { type: "statusline" }
  | { type: "kb-distill" }
  | { type: "kb-distill-detail"; document: DistillDocument }
  | { type: "kb-reference" }
  | { type: "kb-reference-doc"; source: string; docIndex: number }
  | { type: "marketplace"; category?: TemplateCategory }
  | { type: "template-detail"; template: TemplateComponent; category: TemplateCategory }
  | { type: "feature-todo"; feature: FeatureType };

// ============================================================================
// User Types
// ============================================================================

export interface UserProfile {
  nickname: string;
  avatarUrl: string;
}

// ============================================================================
// Sort & Filter Types
// ============================================================================

export type SortKey = "recent" | "sessions" | "name";
export type SortDirection = "asc" | "desc";
export type CommandSortKey = "usage" | "name";
export type ChatViewMode = "projects" | "sessions" | "chats";
export type ExportFormat = "markdown" | "json";
export type MarkdownStyle = "full" | "bullet" | "qa";

// ============================================================================
// Reference Types
// ============================================================================

export interface ReferenceSource {
  name: string;
  icon: string;
  docs: ReferenceDoc[];
}

export interface ReferenceDoc {
  title: string;
  description: string;
  path: string;
}

// ============================================================================
// Version Types
// ============================================================================

export interface VersionWithDownloads {
  version: string;
  downloads: number;
  date: string;
}

export interface ClaudeCodeVersionInfo {
  current_version: string | null;
  available_versions: VersionWithDownloads[];
  autoupdater_disabled: boolean;
}
