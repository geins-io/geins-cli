// The agent harnesses this machine can run, whether the user is signed in to
// each, and their browser sign-in, for the Studio panel's onboarding.
import { createRequire } from 'node:module';
import { codexBinary, isCodexAvailable } from './harness/codex.ts';
import type { AgentProvider, AgentProviderInfo } from './protocol.ts';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/**
 * The Agent SDK's own Claude Code binary (resolved the way the SDK does), else
 * `claude` on PATH: a compiled `geins` has no node_modules, so there it needs
 * the user's Claude Code install.
 */
export function claudeBinary(): string | undefined {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const variants =
    process.platform === 'linux'
      ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
      : [`${process.platform}-${process.arch}`];
  const require = createRequire(import.meta.url);
  for (const variant of variants) {
    try {
      return require.resolve(`@anthropic-ai/claude-agent-sdk-${variant}/claude${ext}`);
    } catch {
      // Not installed for this platform; try the next variant.
    }
  }
  return Bun.which('claude') ?? undefined;
}

async function run(command: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const proc = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { code, stdout };
  } catch {
    return { code: -1, stdout: '' };
  }
}

async function claudeStatus(): Promise<{ available: boolean; signedIn: boolean }> {
  const binary = claudeBinary();
  if (!binary) return { available: false, signedIn: false };
  // Exits 1 when signed out, but still prints the JSON.
  const { code, stdout } = await run([binary, 'auth', 'status']);
  if (code === -1) return { available: false, signedIn: false };
  try {
    return { available: true, signedIn: JSON.parse(stdout).loggedIn === true };
  } catch {
    return { available: true, signedIn: false };
  }
}

async function codexStatus(): Promise<{ available: boolean; signedIn: boolean }> {
  if (!(await isCodexAvailable())) return { available: false, signedIn: false };
  return { available: true, signedIn: (await run([codexBinary(), 'login', 'status'])).code === 0 };
}

const STATUS_TTL_MS = 30_000;
let cachedProviders: { at: number; providers: Promise<AgentProviderInfo[]> } | undefined;

/**
 * Cached briefly: every Studio tab load asks, and each check starts several
 * CLI processes. `fresh` for a user action that depends on the answer.
 */
export function availableProviders({ fresh = false } = {}): Promise<AgentProviderInfo[]> {
  if (fresh || !cachedProviders || Date.now() - cachedProviders.at > STATUS_TTL_MS) {
    cachedProviders = { at: Date.now(), providers: checkProviders() };
  }
  return cachedProviders.providers;
}

async function checkProviders(): Promise<AgentProviderInfo[]> {
  const [claude, codex] = await Promise.all([claudeStatus(), codexStatus()]);
  return [
    {
      id: 'claude',
      name: 'Claude',
      ...claude,
      supportsPermissionModes: true,
      installUrl: 'https://claude.com/product/claude-code',
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      ...codex,
      supportsPermissionModes: false,
      installUrl: 'https://developers.openai.com/codex/cli',
    },
  ];
}

/**
 * Runs the provider's own sign-in, which opens the browser and finishes
 * through a local callback. Resolves with whether the user is signed in after.
 */
export async function signIn(provider: AgentProvider): Promise<boolean> {
  const binary = provider === 'claude' ? claudeBinary() : codexBinary();
  if (!binary) return false;
  const args = provider === 'claude' ? ['auth', 'login'] : ['login'];
  try {
    const proc = Bun.spawn([binary, ...args], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    const timer = setTimeout(() => proc.kill(), SIGN_IN_TIMEOUT_MS);
    await proc.exited;
    clearTimeout(timer);
  } catch {
    return false;
  }
  cachedProviders = undefined;
  const status = provider === 'claude' ? await claudeStatus() : await codexStatus();
  return status.signedIn;
}
