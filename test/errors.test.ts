import { describe, expect, test } from 'bun:test';
import { AuthError, ApiError, NotLoggedInError, formatError } from '../src/api/errors.ts';

describe('formatError', () => {
  test('formats NotLoggedInError', () => {
    const err = new NotLoggedInError();
    const msg = formatError(err);
    expect(msg).toContain('Not logged in');
  });

  test('formats AuthError 401', () => {
    const err = new AuthError(401, 'bad creds');
    const msg = formatError(err);
    expect(msg).toContain('Authentication failed');
  });

  test('formats AuthError non-401', () => {
    const err = new AuthError(403, 'forbidden');
    const msg = formatError(err);
    expect(msg).toContain('403');
    expect(msg).toContain('forbidden');
  });

  test('formats ApiError with JSON body', () => {
    const err = new ApiError(404, 'GET', '/products', '{"error":"not found"}');
    const msg = formatError(err);
    expect(msg).toContain('GET /products');
    expect(msg).toContain('404');
    expect(msg).toContain('not found');
  });

  test('formats ApiError with plain body', () => {
    const err = new ApiError(500, 'POST', '/orders', 'internal error');
    const msg = formatError(err);
    expect(msg).toContain('POST /orders');
    expect(msg).toContain('500');
    expect(msg).toContain('internal error');
  });

  test('formats generic Error', () => {
    const err = new Error('something broke');
    const msg = formatError(err);
    expect(msg).toContain('something broke');
  });

  test('formats non-Error values', () => {
    expect(formatError('string error')).toContain('string error');
    expect(formatError(42)).toContain('42');
  });
});

describe('ApiError.fromResponse', () => {
  test('creates error from Response', async () => {
    const res = new Response('bad request', { status: 400 });
    const err = await ApiError.fromResponse(res, 'POST', '/test');
    expect(err.status).toBe(400);
    expect(err.method).toBe('POST');
    expect(err.path).toBe('/test');
    expect(err.body).toBe('bad request');
  });
});
