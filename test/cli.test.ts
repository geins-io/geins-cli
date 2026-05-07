import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dir, '../src/bin.ts');

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', BIN, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe('CLI direct mode', () => {
  test('--version prints version', async () => {
    const { stdout, exitCode } = await run('--version');
    expect(stdout).toBe('0.1.0');
    expect(exitCode).toBe(0);
  });

  test('--help shows usage', async () => {
    const { stdout, exitCode } = await run('--help');
    expect(stdout).toContain('geins');
    expect(stdout).toContain('Commands');
    expect(stdout).toContain('api');
    expect(exitCode).toBe(0);
  });

  test('unknown command exits with error', async () => {
    const { stderr, exitCode } = await run('nonexistent');
    expect(stderr).toContain('Unknown command');
    expect(exitCode).toBe(1);
  });

  test('whoami without session exits with code 2', async () => {
    const { stderr, exitCode } = await run('whoami');
    expect(stderr).toContain('Not logged in');
    expect(exitCode).toBe(2);
  });

  test('api --help shows help', async () => {
    const { stdout, exitCode } = await run('api', '--help');
    expect(stdout).toContain('api');
    expect(exitCode).toBe(0);
  });

  test('ping --help shows help', async () => {
    const { stdout, exitCode } = await run('ping', '--help');
    expect(stdout).toContain('ping');
    expect(exitCode).toBe(0);
  });
});
