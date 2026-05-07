import { loadSession, saveSession, clearSession, type StoredSession } from '../config/store.ts';

export type { StoredSession };

export function parseJwtExp(token: string): number {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = JSON.parse(atob(parts[1]!));
  return payload.exp as number;
}

export function isExpired(session: StoredSession): boolean {
  return Date.now() >= session.tokenExpires * 1000;
}

export function expiresSoon(session: StoredSession, thresholdMs = 5 * 60 * 1000): boolean {
  return Date.now() + thresholdMs >= session.tokenExpires * 1000;
}

export { loadSession, saveSession, clearSession };
