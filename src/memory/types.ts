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

export interface KnowledgeBase {
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
