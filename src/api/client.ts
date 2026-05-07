import { getApiUrl } from '../config/env.ts';
import { refresh } from '../auth/login.ts';
import { loadSession, saveSession, expiresSoon, parseJwtExp, type StoredSession } from '../auth/session.ts';
import { ApiError, notLoggedIn } from './errors.ts';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
}

let cachedSession: StoredSession | null = null;

async function getSession(): Promise<StoredSession> {
  if (!cachedSession) {
    cachedSession = await loadSession();
  }
  if (!cachedSession) notLoggedIn();
  return cachedSession;
}

async function ensureFreshToken(session: StoredSession): Promise<StoredSession> {
  if (!expiresSoon(session)) return session;

  const auth = await refresh(session.refreshToken);
  session.accessToken = auth.accessToken;
  session.refreshToken = auth.refreshToken;
  session.tokenExpires = parseJwtExp(auth.accessToken);
  await saveSession(session);
  cachedSession = session;
  return session;
}

export async function request<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
  let session = await getSession();
  session = await ensureFreshToken(session);

  const url = new URL(`${getApiUrl()}${path}`);
  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, v);
    }
  }

  const method = options?.method ?? 'GET';

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Authorization': `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  // Retry once on 401
  if (res.status === 401) {
    const auth = await refresh(session.refreshToken);
    session.accessToken = auth.accessToken;
    session.refreshToken = auth.refreshToken;
    session.tokenExpires = parseJwtExp(auth.accessToken);
    await saveSession(session);
    cachedSession = session;

    const retry = await fetch(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!retry.ok) throw await ApiError.fromResponse(retry, method, path);
    return retry.json() as Promise<T>;
  }

  if (!res.ok) throw await ApiError.fromResponse(res, method, path);
  return res.json() as Promise<T>;
}
