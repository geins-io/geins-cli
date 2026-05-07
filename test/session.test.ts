import { describe, expect, test } from 'bun:test';
import { parseJwtExp, isExpired, expiresSoon } from '../src/auth/session.ts';
import type { StoredSession } from '../src/config/store.ts';

function makeSession(tokenExpires: number): StoredSession {
  return {
    accessToken: '',
    refreshToken: '',
    accountKey: 'test',
    tokenExpires,
    user: { email: 'test@test.com', name: 'Test', roles: [] },
  };
}

describe('parseJwtExp', () => {
  test('extracts exp from valid JWT', () => {
    const payload = { sub: 'user', exp: 1700000000 };
    const encoded = btoa(JSON.stringify(payload));
    const token = `header.${encoded}.signature`;
    expect(parseJwtExp(token)).toBe(1700000000);
  });

  test('throws on invalid JWT format', () => {
    expect(() => parseJwtExp('not-a-jwt')).toThrow('Invalid JWT');
    expect(() => parseJwtExp('only.two')).toThrow('Invalid JWT');
  });
});

describe('isExpired', () => {
  test('returns true for past expiry', () => {
    const session = makeSession(Math.floor(Date.now() / 1000) - 60);
    expect(isExpired(session)).toBe(true);
  });

  test('returns false for future expiry', () => {
    const session = makeSession(Math.floor(Date.now() / 1000) + 3600);
    expect(isExpired(session)).toBe(false);
  });
});

describe('expiresSoon', () => {
  test('returns true when expiry is within threshold', () => {
    const session = makeSession(Math.floor(Date.now() / 1000) + 60);
    expect(expiresSoon(session, 5 * 60 * 1000)).toBe(true);
  });

  test('returns false when expiry is far out', () => {
    const session = makeSession(Math.floor(Date.now() / 1000) + 3600);
    expect(expiresSoon(session, 5 * 60 * 1000)).toBe(false);
  });

  test('uses default 5 minute threshold', () => {
    const session = makeSession(Math.floor(Date.now() / 1000) + 120);
    expect(expiresSoon(session)).toBe(true);
  });
});
