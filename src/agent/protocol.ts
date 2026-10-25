// WebSocket protocol between a Geins Studio tab and `geins serve` → /agent.
// Mirror of geins-studio `shared/types/Agent.ts` — keep both in sync.

export type AgentUiTool =
  | 'navigate'
  | 'refresh'
  | 'get_page_context'
  | 'fill_form'
  | 'switch_tab'
  | 'highlight'
  | 'notify'
  | 'set_workflow_graph';

export interface AgentPageRef {
  path: string;
  title?: string;
  entityKey?: string;
  entityId?: string;
  createMode?: boolean;
}

/** `auto`: a classifier approves or blocks actions; `default`: ask for anything not pre-approved. */
export type AgentPermissionMode = 'default' | 'auto';

/** A model the user's Claude login can use (from the SDK's `supportedModels()`). */
export interface AgentModel {
  value: string;
  displayName: string;
  description?: string;
  supportsAutoMode?: boolean;
}

/** The agent harness running a session. */
export type AgentProvider = 'claude' | 'codex';

export interface AgentProviderInfo {
  id: AgentProvider;
  name: string;
  /** Installed (and runnable) on this machine. */
  available: boolean;
  /** The user is signed in to it (their own account runs the agent). */
  signedIn: boolean;
  /** Supports the Auto/default permission switch. */
  supportsPermissionModes: boolean;
  /** Where to get it when it isn't installed. */
  installUrl: string;
}

export type AgentClientMessage =
  | { type: 'permission_mode'; mode: AgentPermissionMode }
  /** Switching provider starts a new conversation. */
  | { type: 'set_provider'; provider: AgentProvider }
  /** Start the provider's browser sign-in on this machine; `providers` follows. */
  | { type: 'sign_in'; provider: AgentProvider }
  | { type: 'set_model'; model: string }
  /** Drop the conversation and start a fresh agent session. */
  | { type: 'reset' }
  | { type: 'auth'; accessToken: string; accountKey: string; accountName?: string }
  | { type: 'user_message'; text: string; page?: AgentPageRef }
  | { type: 'interrupt' }
  | { type: 'ui_result'; id: string; result?: unknown; error?: string }
  | { type: 'approval'; id: string; allow: boolean }
  /** `answers` keyed by question text; omitted when the user dismissed the card. */
  | { type: 'question_answer'; id: string; answers?: Record<string, string> };

export interface AgentQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export type AgentServerMessage =
  | { type: 'status'; state: 'ready' | 'busy'; sessionId?: string }
  | { type: 'permission_mode'; mode: AgentPermissionMode }
  | { type: 'models'; models: AgentModel[]; current: string }
  | { type: 'providers'; providers: AgentProviderInfo[]; current: AgentProvider }
  | { type: 'model'; model: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; isError: boolean; summary: string }
  | { type: 'turn_end'; error?: string; costUsd?: number }
  | { type: 'ui_call'; id: string; tool: AgentUiTool; input: Record<string, unknown> }
  | { type: 'approval_request'; id: string; tool: string; input: unknown }
  | { type: 'question_request'; id: string; questions: AgentQuestion[] }
  | { type: 'error'; message: string };
