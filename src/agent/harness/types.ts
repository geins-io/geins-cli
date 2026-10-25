// The contract between a Studio agent session (host.ts) and the agent harness
// that runs it: the Claude Agent SDK, or a CLI such as Codex.
import type { AgentModel, AgentPermissionMode, AgentQuestion, AgentServerMessage } from '../protocol.ts';
import type { UiCall } from '../ui-mcp.ts';

export interface HarnessContext {
  /** Events for the tab; the host drops them once this harness is replaced. */
  send(message: AgentServerMessage): void;
  /** The user's own setup (settings, plugins, MCP servers) and all tools. */
  full: boolean;
  permissionMode: AgentPermissionMode;
  /** The user's model pick for this provider; undefined = the harness default. */
  model?: string;
  /** Studio guidance plus the account lines for this session. */
  instructions: string;
  /** Extra environment for the harness process (e.g. the Sonora profile). */
  env: Record<string, string>;
  /** Local MCP endpoints: Studio data (via the token proxy) and the tab's ui tools. */
  mcp: { studioUrl: string; uiUrl: string };
  uiCall: UiCall;
  /** The harness died on its own; the host starts a new one on the next message. */
  onEnded(): void;
  requestApproval(tool: string, input: unknown, signal: AbortSignal): Promise<boolean>;
  requestAnswers(
    questions: AgentQuestion[],
    signal: AbortSignal,
  ): Promise<Record<string, string> | undefined>;
}

export interface Harness {
  /** Queue one user turn (already prefixed with the page reference). */
  prompt(text: string): void;
  interrupt(): void;
  models(): Promise<{ models: AgentModel[]; current: string }>;
  setModel(model: string): Promise<void>;
  /** Rejects when the harness has no permission modes. */
  setPermissionMode(mode: AgentPermissionMode): Promise<void>;
  close(): void;
}
