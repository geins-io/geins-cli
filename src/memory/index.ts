export { appendMessage, loadRecentMessages, getMessageCount, clearHistory } from './chat-history.ts';
export { loadContext, trackWorkflow, trackApiResponse, buildContextPromptSection } from './command-context.ts';
export { startSession, logEntry, endSession, loadIndex, searchSessions } from './session-log.ts';
export { loadKnowledge, addFact, setPreference, clearKnowledge, buildKnowledgePromptSection, extractMemoryBlocks } from './knowledge.ts';
export { ensureMemoryDirs } from './store.ts';
export type * from './types.ts';
