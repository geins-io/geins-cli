import { getApiUrl } from '../config/env.ts';
import { AuthError } from '../api/errors.ts';

export interface AuthAccounts {
  accountKey: string;
  displayName: string;
  roles: string[];
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  mfaRequired?: boolean;
  mfaMethod?: string;
  loginToken?: string;
  accounts?: AuthAccounts[];
}

async function authFetch<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${getApiUrl()}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new AuthError(res.status, await res.text().catch(() => ''));
  }

  return res.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  return authFetch<AuthResponse>('auth', { username, password });
}

export async function verify(loginToken: string, mfaCode: string): Promise<AuthResponse> {
  return authFetch<AuthResponse>('auth/verify', { loginToken, mfaCode });
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  return authFetch<AuthResponse>('auth/refresh', { refreshToken });
}

export interface UserInfo {
  email?: string | null;
  firstName?: string;
  lastName?: string;
  name?: string;
  roles?: string[];
}

export async function fetchUser(accessToken: string): Promise<UserInfo> {
  const res = await fetch(`${getApiUrl()}/user/me?fields=accounts`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new AuthError(res.status, await res.text().catch(() => ''));
  }

  return res.json() as Promise<UserInfo>;
}
