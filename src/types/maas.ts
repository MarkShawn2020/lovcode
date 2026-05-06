export interface Vendor {
  id: string;
  name: string;
  iconUrl?: string;
  description?: string;
  websiteUrl?: string;
}

export interface MaasModel {
  id: string;
  displayName: string;
  modelName: string;
  /** References Vendor.id on the parent MaasProvider's vendors list. */
  vendor?: string;
  description?: string;
  iconUrl?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  contextWindow?: number;
}

export interface MaasProvider {
  key: string;
  label: string;
  baseUrl: string;
  /** API key / bearer token in plaintext. */
  authToken: string;
  models: MaasModel[];
  vendors?: Vendor[];
  fetchCommand?: string;
  /** ISO timestamp of the most recent successful Verify. */
  lastVerifiedAt?: string;
  /** Fingerprint of the token at the moment of the last successful Verify. */
  lastVerifiedTokenHash?: string;
}

export type MaasRegistry = MaasProvider[];

export interface ClaudeStatusComponent {
  id: string;
  name: string;
  status: string;
  updatedAt?: string | null;
}

export interface ClaudeStatusIncident {
  id: string;
  name: string;
  status: string;
  impact?: string | null;
  createdAt?: string | null;
  resolvedAt?: string | null;
  shortlink?: string | null;
  affectedComponents: string[];
}

export interface ClaudeRealtimeStatus {
  pageName: string;
  pageUrl?: string | null;
  indicator?: string | null;
  description?: string | null;
  updatedAt?: string | null;
  components: ClaudeStatusComponent[];
  incidents: ClaudeStatusIncident[];
}

export interface ZenmuxRealtimeModel {
  id: string;
  displayName?: string | null;
  ownedBy?: string | null;
  createdAt?: string | null;
  contextLength?: number | null;
  inputModalities: string[];
  outputModalities: string[];
  promptPrice?: string | null;
  completionPrice?: string | null;
}

export interface ZenmuxRealtimeStatus {
  fetchedAt: string;
  models: ZenmuxRealtimeModel[];
}

export interface MaasRealtimeStatus {
  fetchedAt: string;
  claude?: ClaudeRealtimeStatus | null;
  claudeError?: string | null;
  zenmux?: ZenmuxRealtimeStatus | null;
  zenmuxError?: string | null;
}
