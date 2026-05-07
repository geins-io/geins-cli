import { describe, expect, test } from 'bun:test';
import { getApiUrl } from '../src/config/env.ts';

describe('getApiUrl', () => {
  test('returns default URL when env not set', () => {
    const original = process.env['GEINS_API_URL'];
    delete process.env['GEINS_API_URL'];
    expect(getApiUrl()).toBe('https://mgmtapi.geins.services/v2');
    if (original) process.env['GEINS_API_URL'] = original;
  });

  test('returns env URL when set', () => {
    const original = process.env['GEINS_API_URL'];
    process.env['GEINS_API_URL'] = 'https://custom.api/v2';
    expect(getApiUrl()).toBe('https://custom.api/v2');
    if (original) {
      process.env['GEINS_API_URL'] = original;
    } else {
      delete process.env['GEINS_API_URL'];
    }
  });
});
