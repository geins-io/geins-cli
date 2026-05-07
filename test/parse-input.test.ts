import { describe, expect, test } from 'bun:test';
import { parseInput } from '../src/repl.ts';

describe('parseInput', () => {
  test('returns null for empty input', () => {
    expect(parseInput('')).toBeNull();
    expect(parseInput('   ')).toBeNull();
  });

  test('parses slash command', () => {
    expect(parseInput('/help')).toEqual({ command: 'help', args: [] });
  });

  test('parses command without slash', () => {
    expect(parseInput('help')).toEqual({ command: 'help', args: [] });
  });

  test('lowercases command name', () => {
    expect(parseInput('/HELP')).toEqual({ command: 'help', args: [] });
    expect(parseInput('Help')).toEqual({ command: 'help', args: [] });
  });

  test('parses command with args', () => {
    expect(parseInput('/api GET /products')).toEqual({
      command: 'api',
      args: ['GET', '/products'],
    });
  });

  test('handles quoted args', () => {
    expect(parseInput('/api POST /products --body "some value"')).toEqual({
      command: 'api',
      args: ['POST', '/products', '--body', 'some value'],
    });
  });

  test('trims whitespace', () => {
    expect(parseInput('  /help  ')).toEqual({ command: 'help', args: [] });
  });

  test('handles multiple spaces between args', () => {
    expect(parseInput('/ping   service1   service2')).toEqual({
      command: 'ping',
      args: ['service1', 'service2'],
    });
  });
});
