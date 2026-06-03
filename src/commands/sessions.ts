import { loadIndex, loadSessionEntries } from '../memory/index.ts';
import type { SessionEntry, SessionIndexEntry } from '../memory/types.ts';
import { bold, dim, red, cyan } from '../output/color.ts';

export type EntryStyle = 'prompt' | 'response' | 'output' | 'error' | 'dim';

/** Single source of truth for how a session entry maps to a display style + prefix. */
export function describeEntry(entry: SessionEntry): { prefix: string; style: EntryStyle } {
  switch (entry.type) {
    case 'command':
    case 'copilot-prompt':
      return { prefix: '❯ ', style: 'prompt' };
    case 'copilot-response':
      return { prefix: '', style: 'response' };
    case 'error':
      return { prefix: '', style: 'error' };
    case 'system':
      return { prefix: '', style: 'dim' };
    case 'output':
    default:
      return { prefix: '', style: 'output' };
  }
}

/** All sessions, newest first. */
export async function listSessions(): Promise<SessionIndexEntry[]> {
  const index = await loadIndex();
  return [...index.sessions].sort((a, b) => b.startedAt - a.startedAt);
}

/** Re-export so headless callers have a single import surface. */
export { loadSessionEntries };

/** The first user-typed line in a session — used as a one-line label. */
export function firstUserMessage(entries: SessionEntry[], maxLen = 60): string {
  const first = entries.find(e => e.type === 'command' || e.type === 'copilot-prompt');
  if (!first) return '(no messages)';
  const text = first.content.replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

/** Render a transcript as plain (optionally ANSI-colored) stdout lines for headless mode. */
export function formatTranscriptLines(entries: SessionEntry[], opts: { color?: boolean } = {}): string[] {
  const color = opts.color ?? false;
  const lines: string[] = [];
  for (const entry of entries) {
    const { prefix, style } = describeEntry(entry);
    const raw = `${prefix}${entry.content}`;
    if (!color) {
      lines.push(raw);
      continue;
    }
    switch (style) {
      case 'prompt': lines.push(bold(raw)); break;
      case 'error': lines.push(red(raw)); break;
      case 'dim': lines.push(dim(raw)); break;
      case 'response': lines.push(cyan(raw)); break;
      default: lines.push(raw);
    }
  }
  return lines;
}

/** Structured transcript payload for `--json`. */
export function transcriptJson(id: string, entries: SessionEntry[]): { id: string; entries: SessionEntry[] } {
  return { id, entries };
}
