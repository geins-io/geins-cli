import type { CommandContext } from './types.ts';
import { PATHS, readJsonSafe, writeJsonSafe } from './store.ts';

const MAX_RECENT_IDS = 10;
const MAX_RECENT_RESPONSES = 5;
const MAX_RESPONSE_SUMMARY = 500;

export async function loadContext(): Promise<CommandContext> {
  return (await readJsonSafe<CommandContext>(PATHS.commandContext)) ?? {
    recentWorkflowIds: [],
    recentApiResponses: [],
    updatedAt: Date.now(),
  };
}

export async function trackWorkflow(id: string): Promise<void> {
  const ctx = await loadContext();
  ctx.lastWorkflowId = id;
  ctx.recentWorkflowIds = [...ctx.recentWorkflowIds.filter(x => x !== id), id].slice(-MAX_RECENT_IDS);
  ctx.updatedAt = Date.now();
  await writeJsonSafe(PATHS.commandContext, ctx);
}

export async function trackApiResponse(command: string, response: string): Promise<void> {
  const ctx = await loadContext();
  ctx.recentApiResponses = [
    ...ctx.recentApiResponses,
    {
      command,
      timestamp: Date.now(),
      summary: response.slice(0, MAX_RESPONSE_SUMMARY),
    },
  ].slice(-MAX_RECENT_RESPONSES);
  ctx.updatedAt = Date.now();
  await writeJsonSafe(PATHS.commandContext, ctx);
}

export function buildContextPromptSection(ctx: CommandContext): string {
  const parts: string[] = [];
  if (ctx.lastWorkflowId) parts.push(`Last workflow: ${ctx.lastWorkflowId}`);
  if (ctx.lastProductId) parts.push(`Last product: ${ctx.lastProductId}`);
  if (ctx.recentWorkflowIds.length) parts.push(`Recent workflows: ${ctx.recentWorkflowIds.join(', ')}`);
  for (const r of ctx.recentApiResponses.slice(-2)) {
    parts.push(`Recent ${r.command}: ${r.summary}`);
  }
  if (parts.length === 0) return '';
  return '[Command Context]\n' + parts.join('\n');
}
