import { loadSession } from './session.ts';
import { request } from '../api/client.ts';
import { ApiError, AuthError } from '../api/errors.ts';

/**
 * Whether the v2 session is usable.
 * - `logged-in`  — a session exists and an authed call succeeded.
 * - `logged-out` — no stored session at all.
 * - `expired`    — a session exists but the token (or refresh token) was rejected; re-login needed.
 * - `unverified` — a session exists but we couldn't reach the API (offline/transient); not confirmed either way.
 */
export type AuthState = 'logged-in' | 'logged-out' | 'expired' | 'unverified';

export interface AuthStatus {
  state: AuthState;
  /** User email from the stored session, when one exists. */
  user?: string;
  /** Account key from the stored session, when one exists. */
  account?: string;
}

/**
 * Check whether the user is logged in to the v2 API. This makes a lightweight authed
 * request (`/user/me`); `request()` transparently refreshes the access token and retries
 * once, so a rejected refresh token surfaces here as `expired` rather than silently
 * failing on the first real command.
 */
export async function checkAuthStatus(): Promise<AuthStatus> {
  const session = await loadSession();
  if (!session) return { state: 'logged-out' };

  const base: AuthStatus = { user: session.user.email, account: session.accountKey, state: 'logged-in' };
  try {
    // Same lightweight, known-good authed endpoint the login flow uses to fetch the user.
    await request('/user/me', { query: { fields: 'accounts' } });
    return base;
  } catch (err) {
    if ((err instanceof ApiError || err instanceof AuthError) && (err.status === 401 || err.status === 403)) {
      return { ...base, state: 'expired' };
    }
    // Network error / offline / unexpected failure — we can't confirm the session is bad,
    // so don't claim the user is logged out.
    return { ...base, state: 'unverified' };
  }
}
