import { describe, expect, test, beforeEach } from 'bun:test';
import { setTheme, getTheme } from '../src/output/color.ts';

describe('color', () => {
  beforeEach(() => {
    setTheme('dark');
  });

  test('getTheme returns current theme', () => {
    expect(getTheme()).toBe('dark');
    setTheme('light');
    expect(getTheme()).toBe('light');
  });

  test('setTheme toggles between dark and light', () => {
    setTheme('light');
    expect(getTheme()).toBe('light');
    setTheme('dark');
    expect(getTheme()).toBe('dark');
  });
});
