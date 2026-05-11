import type { PersistedChatMessage } from './types.ts';
import { PATHS, appendJsonl, readJsonl, writeJsonl, getFileSize } from './store.ts';

const MAX_HISTORY_SIZE = 512 * 1024;
const MAX_MESSAGES = 200;

export async function appendMessage(msg: Omit<PersistedChatMessage, 'timestamp' | 'tokenEstimate'>): Promise<void> {
  const record: PersistedChatMessage = {
    ...msg,
    timestamp: Date.now(),
    tokenEstimate: Math.ceil(msg.content.length / 4),
  };
  await appendJsonl(PATHS.chatHistory, record);
  await maybeRotate();
}

export async function loadRecentMessages(maxTokenBudget: number): Promise<PersistedChatMessage[]> {
  const all = await readJsonl<PersistedChatMessage>(PATHS.chatHistory);
  const result: PersistedChatMessage[] = [];
  let tokens = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const msg = all[i]!;
    const est = msg.tokenEstimate ?? Math.ceil(msg.content.length / 4);
    if (tokens + est > maxTokenBudget) break;
    tokens += est;
    result.unshift(msg);
  }
  return result;
}

export async function getMessageCount(): Promise<number> {
  const all = await readJsonl<PersistedChatMessage>(PATHS.chatHistory);
  return all.length;
}

export async function clearHistory(): Promise<void> {
  await writeJsonl(PATHS.chatHistory, []);
}

async function maybeRotate(): Promise<void> {
  const size = await getFileSize(PATHS.chatHistory);
  if (size <= MAX_HISTORY_SIZE) return;
  const all = await readJsonl<PersistedChatMessage>(PATHS.chatHistory);
  if (all.length <= 2) return;
  const keep = all.slice(Math.floor(all.length / 2));
  await writeJsonl(PATHS.chatHistory, keep);
}
