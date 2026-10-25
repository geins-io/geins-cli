// Claude via the Agent SDK: one streaming-input query per conversation, with
// approvals, clarifying questions, model and permission-mode switching.
import { isAbsolute, relative, resolve } from 'node:path';
import {
  query,
  type CanUseTool,
  type HookCallback,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { SUMMARY_MAX, WORKSPACE } from '../context.ts';
import { createUiMcpServer } from '../ui-mcp.ts';
import { claudeBinary } from '../providers.ts';
import type { AgentPermissionMode } from '../protocol.ts';
import type { Harness, HarnessContext } from './types.ts';
import { VERSION } from '../../version.ts';

// Run without asking. Everything else (Write, Edit, WebFetch, …) goes through
// canUseTool → an approval card in the tab.
const AUTO_APPROVED_TOOLS = [
  'mcp__studio__get_context',
  'mcp__studio__list_entities',
  'mcp__studio__get_entity',
  'mcp__studio__get_workflow_manifest',
  'mcp__studio__validate_workflow',
  // Every ui tool only changes what the user's tab shows; fill_form never
  // saves, the user still has to click Save.
  'mcp__ui__*',
  'Read',
  'Glob',
  'Grep',
];

function insideWorkspace(path: unknown): boolean {
  if (path === undefined) return true; // Glob/Grep default to the cwd
  if (typeof path !== 'string') return false;
  const rel = relative(WORKSPACE, resolve(WORKSPACE, path));
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/** A relative glob that stays below its base directory. */
const isLocalGlob = (glob: unknown) =>
  glob === undefined || (typeof glob === 'string' && !isAbsolute(glob) && !/(^|[\\/])\.\.([\\/]|$)/.test(glob));

/**
 * Standard mode promises files in the workspace only, but `allowedTools`
 * approves Read/Glob/Grep on any path, and auto mode would too. Reads outside
 * the workspace go to the approval card instead, so injected text in Studio
 * data can't quietly read e.g. ~/.ssh and pass it on through the ui tools.
 */
const askOutsideWorkspace: HookCallback = async (hookInput) => {
  if (hookInput.hook_event_name !== 'PreToolUse') return {};
  const args = (hookInput.tool_input ?? {}) as Record<string, unknown>;
  const inside =
    hookInput.tool_name === 'Read'
      ? insideWorkspace(args.file_path)
      : insideWorkspace(args.path) && isLocalGlob(hookInput.tool_name === 'Glob' ? args.pattern : args.glob);
  return inside
    ? {}
    : {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: 'Outside the agent workspace',
        },
      };
};

/** Async input stream for the SDK's streaming-input mode. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiter?: (result: IteratorResult<SDKUserMessage>) => void;
  private ended = false;

  push(text: string) {
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    };
    if (this.waiter) {
      this.waiter({ value: message, done: false });
      this.waiter = undefined;
    } else {
      this.items.push(message);
    }
  }

  end() {
    this.ended = true;
    this.waiter?.({ value: undefined, done: true });
    this.waiter = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiter = resolve));
      },
    };
  }
}

export function createClaudeHarness(ctx: HarnessContext): Harness {
  const { send } = ctx;
  const input = new InputQueue();
  let permissionMode = ctx.permissionMode;
  let model = ctx.model;
  let closed = false;

  // Clarifying questions arrive through the permission callback too.
  const canUseTool: CanUseTool = async (toolName, toolInput, { signal }): Promise<PermissionResult> => {
    if (toolName === 'AskUserQuestion') {
      const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
      const answers = await ctx.requestAnswers(questions, signal);
      return answers
        ? { behavior: 'allow', updatedInput: { ...toolInput, answers } }
        : { behavior: 'deny', message: 'The user dismissed the question without answering.' };
    }
    return (await ctx.requestApproval(toolName, toolInput, signal))
      ? { behavior: 'allow', updatedInput: toolInput }
      : { behavior: 'deny', message: 'The user denied this action.' };
  };

  const session = query({
    prompt: input,
    options: {
      ...(model && model !== 'default' && { model }),
      cwd: WORKSPACE,
      pathToClaudeCodeExecutable: claudeBinary(),
      ...(ctx.full
        ? {
            // Claude Code's own prompt and toolset, plus the Studio guidance;
            // settings, plugins, skills and MCP servers load as in the CLI.
            systemPrompt: { type: 'preset', preset: 'claude_code', append: ctx.instructions },
            settingSources: ['user', 'project', 'local'],
            tools: { type: 'preset', preset: 'claude_code' },
            skills: 'all',
          }
        : {
            systemPrompt: ctx.instructions,
            // Keep the user's own ~/.claude settings, hooks and CLAUDE.md out.
            settingSources: [],
            tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'AskUserQuestion'],
            hooks: { PreToolUse: [{ matcher: 'Read|Glob|Grep', hooks: [askOutsideWorkspace] }] },
          }),
      allowedTools: AUTO_APPROVED_TOOLS,
      permissionMode,
      // Still needed in auto mode: questions, `ask` rules, and the prompts
      // auto mode falls back to after repeated classifier blocks.
      canUseTool,
      includePartialMessages: true,
      mcpServers: {
        studio: { type: 'http', url: ctx.mcp.studioUrl },
        ui: createUiMcpServer(ctx.uiCall),
      },
      env: { ...process.env, ...ctx.env, CLAUDE_AGENT_SDK_CLIENT_APP: `geins-cli/${VERSION}` },
    },
  });

  function forward(message: SDKMessage) {
    switch (message.type) {
      case 'stream_event': {
        const event = message.event;
        if (
          message.parent_tool_use_id === null &&
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          send({ type: 'text', text: event.delta.text });
        }
        break;
      }
      case 'assistant':
        if (message.parent_tool_use_id !== null) break;
        for (const block of message.message.content) {
          if (block.type === 'tool_use' || block.type === 'mcp_tool_use') {
            send({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          }
        }
        break;
      case 'user': {
        const content = message.message.content;
        if (message.parent_tool_use_id !== null || typeof content === 'string') break;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const text =
            typeof block.content === 'string'
              ? block.content
              : (block.content ?? [])
                  .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
                  .join(' ');
          send({
            type: 'tool_result',
            id: block.tool_use_id,
            isError: block.is_error === true,
            summary: text.slice(0, SUMMARY_MAX),
          });
        }
        break;
      }
      case 'system':
        // Claude Code drops out of auto mode on its own, e.g. for a model auto
        // mode doesn't support; keep the tab's toggle honest.
        if (message.subtype === 'status' && message.permissionMode) {
          const mode: AgentPermissionMode = message.permissionMode === 'auto' ? 'auto' : 'default';
          if (mode !== permissionMode) {
            permissionMode = mode;
            send({ type: 'permission_mode', mode });
          }
        }
        break;
      case 'result':
        send({
          type: 'turn_end',
          error: message.subtype === 'success' ? undefined : message.subtype,
          costUsd: message.total_cost_usd,
        });
        send({ type: 'status', state: 'ready', sessionId: message.session_id });
        break;
    }
  }

  void (async () => {
    try {
      for await (const message of session) forward(message);
      if (!closed) send({ type: 'error', message: 'The Claude session ended unexpectedly.' });
    } catch (err) {
      if (!closed) send({ type: 'error', message: String((err as Error).message ?? err) });
    }
    if (closed) return;
    // Nothing reads the input any more: free the tab and let the host start
    // a fresh session for the next message.
    send({ type: 'status', state: 'ready' });
    ctx.onEnded();
  })();

  return {
    prompt: (text) => input.push(text),
    // Rejects once the query has ended; there is nothing left to stop then.
    interrupt: () => void session.interrupt().catch(() => {}),
    async models() {
      const list = await session.supportedModels();
      return {
        models: list.map(({ value, displayName, description, supportsAutoMode }) => ({
          value,
          displayName,
          description,
          supportsAutoMode,
        })),
        current: model ?? list[0]?.value ?? 'default',
      };
    },
    async setModel(value) {
      // setModel resets to the default for `undefined` / "default".
      await session.setModel(value === 'default' ? undefined : value);
      model = value;
    },
    async setPermissionMode(mode) {
      await session.setPermissionMode(mode);
      permissionMode = mode;
    },
    close() {
      closed = true;
      input.end();
      session.close();
    },
  };
}
