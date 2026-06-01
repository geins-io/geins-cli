export interface PersistedChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  provider?: string;
  model?: string;
  tokenEstimate?: number;
}

export interface CommandContext {
  lastWorkflowId?: string;
  lastProductId?: string;
  lastApiPath?: string;
  lastApiMethod?: string;
  recentWorkflowIds: string[];
  recentApiResponses: ApiResponseSummary[];
  updatedAt: number;
}

export interface ApiResponseSummary {
  command: string;
  timestamp: number;
  summary: string;
}

export interface SessionEntry {
  type: 'command' | 'output' | 'copilot-prompt' | 'copilot-response' | 'error' | 'system';
  timestamp: number;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SessionIndex {
  sessions: SessionIndexEntry[];
}

export interface SessionIndexEntry {
  id: string;
  startedAt: number;
  endedAt?: number;
  entryCount: number;
  account?: string;
  sizeBytes: number;
}

// --- Knowledge v2 ---

export interface KnowledgeBase {
  version: 2;
  entities: EntityRecord[];
  patterns: PatternRecord[];
  preferences: Record<string, string>;
  updatedAt: number;
}

export interface EntityRecord {
  id: string;
  type: 'workflow' | 'product' | 'variable' | 'endpoint';
  name: string;
  externalId?: string;
  attributes: Record<string, string>;
  lastSeenAt: number;
  seenCount: number;
}

export interface PatternRecord {
  id: string;
  type: 'workflow-pattern' | 'api-pattern' | 'naming' | 'common-action';
  description: string;
  confidence: number;
  examples: string[];
  createdAt: number;
  lastUsedAt: number;
}

// Legacy v1 types for migration
export interface KnowledgeBaseV1 {
  version: 1;
  facts: KnowledgeFact[];
  preferences: Record<string, string>;
  updatedAt: number;
}

export interface KnowledgeFact {
  id: string;
  category: 'project' | 'workflow' | 'api' | 'preference' | 'pattern';
  content: string;
  confidence: number;
  createdAt: number;
  lastUsedAt: number;
  source: string;
}

export interface ManifestCache {
  data: unknown;
  cachedAt: number;
  actionNames: string[];
  triggerTypes: string[];
  nodeTypes: string[];
}
