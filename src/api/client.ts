import { getApiUrl } from '../config/env.ts';
import { refresh } from '../auth/login.ts';
import { loadSession, saveSession, expiresSoon, parseJwtExp, type StoredSession } from '../auth/session.ts';
import { ApiError, notLoggedIn } from './errors.ts';
import { recordResponse } from '../output/sink.ts';
import { fetchLogged } from './fetch-logged.ts';
import { getActiveSignal } from './abort.ts';

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  signal?: AbortSignal;
}

let cachedSession: StoredSession | null = null;

// Per-invocation override for the x-account-key (the v2 account). When set, it takes
// precedence over the stored session's accountKey without rewriting the session — used by
// the headless `--account-name` flag so a single command can target another account.
let accountKeyOverride: string | null = null;

/** Override the v2 account (x-account-key) for subsequent requests. Pass null to clear. */
export function setAccountKeyOverride(accountKey: string | null): void {
  accountKeyOverride = accountKey;
}

async function getSession(): Promise<StoredSession> {
  if (!cachedSession) {
    cachedSession = await loadSession();
  }
  if (!cachedSession) notLoggedIn();
  return cachedSession;
}

/**
 * Drop the in-process session cache so the next request reloads it from disk. Call this
 * after the stored session changes out-of-band — e.g. switching the active account, which
 * rewrites accountKey and must take effect on the very next request's x-account-key header.
 */
export function resetSessionCache(): void {
  cachedSession = null;
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

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
  };
  const accountKey = accountKeyOverride ?? session.accountKey;
  if (accountKey) {
    headers['x-account-key'] = accountKey;
  }

  const signal = options?.signal ?? getActiveSignal();
  const res = await fetchLogged(url.toString(), {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal,
  }, { method, path, query: options?.query, body: options?.body });

  // Retry once on 401
  if (res.status === 401) {
    const auth = await refresh(session.refreshToken);
    session.accessToken = auth.accessToken;
    session.refreshToken = auth.refreshToken;
    session.tokenExpires = parseJwtExp(auth.accessToken);
    await saveSession(session);
    cachedSession = session;

    headers['Authorization'] = `Bearer ${session.accessToken}`;

    const retry = await fetchLogged(url.toString(), {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal,
    }, { method, path, query: options?.query, body: options?.body });

    if (!retry.ok) {
      const err = await ApiError.fromResponse(retry, method, path);
      await recordResponse({ method, path, query: options?.query, body: options?.body, status: retry.status, error: err.body || err.message });
      throw err;
    }
    const retryData = (await retry.json()) as T;
    await recordResponse({ method, path, query: options?.query, body: options?.body, status: retry.status, data: retryData });
    return retryData;
  }

  if (!res.ok) {
    const err = await ApiError.fromResponse(res, method, path);
    await recordResponse({ method, path, query: options?.query, body: options?.body, status: res.status, error: err.body || err.message });
    throw err;
  }
  const data = (await res.json()) as T;
  await recordResponse({ method, path, query: options?.query, body: options?.body, status: res.status, data });
  return data;
}
