import type { CommandContext, ManifestCache } from './types.ts';
import { PATHS, readJsonSafe, writeJsonSafe } from './store.ts';
import { trackEntity, loadKnowledge } from './knowledge.ts';

const MAX_RECENT_IDS = 10;
const MAX_RECENT_RESPONSES = 5;
const MAX_RESPONSE_SUMMARY = 500;
const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;

export async function loadContext(): Promise<CommandContext> {
  return (await readJsonSafe<CommandContext>(PATHS.commandContext)) ?? {
    recentWorkflowIds: [],
    recentApiResponses: [],
    updatedAt: Date.now(),
  };
}

export async function clearCommandContext(): Promise<void> {
  await writeJsonSafe(PATHS.commandContext, {
    recentWorkflowIds: [],
    recentApiResponses: [],
    updatedAt: Date.now(),
  });
}

export async function trackWorkflow(id: string, data?: Record<string, unknown>): Promise<void> {
  const ctx = await loadContext();
  ctx.lastWorkflowId = id;
  ctx.recentWorkflowIds = [...ctx.recentWorkflowIds.filter(x => x !== id), id].slice(-MAX_RECENT_IDS);
  ctx.updatedAt = Date.now();
  await writeJsonSafe(PATHS.commandContext, ctx);

  if (data && (data.name || data.Name)) {
    const name = String(data.name ?? data.Name ?? id);
    const attrs: Record<string, string> = {};
    if (data.type) attrs.type = String(data.type);
    if (data.enabled !== undefined) attrs.enabled = String(data.enabled);
    if (data.trigger && typeof data.trigger === 'object') {
      const trigger = data.trigger as Record<string, unknown>;
      if (trigger.cronExpression) attrs.cron = String(trigger.cronExpression);
      if (trigger.eventName) attrs.event = String(trigger.eventName);
    }
    await trackEntity({ type: 'workflow', name, externalId: id, attributes: attrs });
  }
}

export async function trackWorkflowList(items: Array<Record<string, unknown>>): Promise<void> {
  for (const item of items) {
    const id = String(item.id ?? item.Id ?? '');
    if (id) await trackWorkflow(id, item);
  }
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

  try {
    const parsed = JSON.parse(response);
    if (parsed?.items && Array.isArray(parsed.items)) {
      for (const item of parsed.items.slice(0, 20)) {
        if (item.id && item.name) {
          const type = command.includes('workflow') ? 'workflow'
            : command.includes('product') ? 'product'
            : command.includes('variable') ? 'variable'
            : null;
          if (type) {
            await trackEntity({ type, name: String(item.name), externalId: String(item.id), attributes: {} });
          }
        }
      }
    }
  } catch { /* not JSON or no items — skip */ }
}

export async function cacheManifest(manifest: unknown): Promise<void> {
  const data = manifest as Record<string, unknown>;
  const actionNames: string[] = [];
  const triggerTypes: string[] = [];
  const nodeTypes: string[] = [];

  if (Array.isArray(data.Actions)) {
    for (const a of data.Actions) {
      if (typeof a === 'object' && a && 'name' in a) actionNames.push(String(a.name));
      else if (typeof a === 'string') actionNames.push(a);
    }
  }
  if (Array.isArray(data.TriggerTypes)) {
    for (const t of data.TriggerTypes) {
      if (typeof t === 'object' && t && 'name' in t) triggerTypes.push(String(t.name));
      else if (typeof t === 'string') triggerTypes.push(t);
    }
  }
  if (Array.isArray(data.NodeTypes)) {
    for (const n of data.NodeTypes) {
      if (typeof n === 'string') nodeTypes.push(n);
    }
  }

  const cache: ManifestCache = { data: manifest, cachedAt: Date.now(), actionNames, triggerTypes, nodeTypes };
  await writeJsonSafe(PATHS.manifestCache, cache);
}

export async function loadManifestCache(): Promise<ManifestCache | null> {
  const cache = await readJsonSafe<ManifestCache>(PATHS.manifestCache);
  if (!cache) return null;
  if (Date.now() - cache.cachedAt > MANIFEST_TTL_MS) return null;
  return cache;
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

export function buildManifestPromptSection(cache: ManifestCache | null): string {
  if (!cache) return '';
  const parts: string[] = ['[Available Capabilities]'];
  if (cache.nodeTypes.length) parts.push(`Node types: ${cache.nodeTypes.join(', ')}`);
  if (cache.triggerTypes.length) parts.push(`Trigger types: ${cache.triggerTypes.join(', ')}`);
  if (cache.actionNames.length) {
    const display = cache.actionNames.length > 30
      ? cache.actionNames.slice(0, 30).join(', ') + ` ... and ${cache.actionNames.length - 30} more`
      : cache.actionNames.join(', ');
    parts.push(`Actions: ${display}`);
  }
  return parts.length > 1 ? parts.join('\n') : '';
}
