import { loadConfig, saveConfig, type CopilotConfig } from '../config/store.ts';
import { $ } from 'bun';

export interface CopilotOption {
  name: string;
  cli: string;
  testCmd: string[];
  supportsModels?: boolean;
  buildCmd: (prompt: string, model?: string) => string[];
}

export const COPILOT_OPTIONS: CopilotOption[] = [
  {
    name: 'Claude Code',
    cli: 'claude',
    testCmd: ['claude', '--version'],
    buildCmd: (prompt) => ['claude', '-p', prompt],
  },
  {
    name: 'OpenAI Codex',
    cli: 'codex',
    testCmd: ['codex', '--version'],
    buildCmd: (prompt) => ['codex', 'exec', prompt],
  },
  {
    name: 'Google Gemini CLI',
    cli: 'gemini',
    testCmd: ['gemini', '--version'],
    buildCmd: (prompt) => ['gemini', '-p', prompt],
  },
  {
    name: 'Ollama',
    cli: 'ollama',
    testCmd: ['ollama', '--version'],
    supportsModels: true,
    buildCmd: (prompt, model) => ['ollama', 'run', model ?? 'llama3.2', prompt],
  },
  {
    name: 'LM Studio',
    cli: 'lms',
    testCmd: ['lms', 'version'],
    buildCmd: (prompt) => ['lms', 'chat', '--prompt', prompt],
  },
];

export async function testCli(option: CopilotOption): Promise<{ ok: boolean; version: string }> {
  try {
    const proc = Bun.spawn(option.testCmd, {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { ok: true, version: output.trim().split('\n')[0] ?? '' };
    }
    return { ok: false, version: '' };
  } catch {
    return { ok: false, version: '' };
  }
}

export async function listOllamaModels(): Promise<string[]> {
  try {
    const proc = Bun.spawn(['ollama', 'list'], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return [];
    return output.trim().split('\n').slice(1)
      .map(line => line.split(/\s+/)[0]!)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveCopilotChoice(option: CopilotOption, model?: string): Promise<void> {
  const config = await loadConfig();
  config.copilot = { cli: option.cli, command: option.name, model };
  await saveConfig(config);
}

export async function getCopilotConfig(): Promise<CopilotConfig | null> {
  const config = await loadConfig();
  return config.copilot ?? null;
}

export function getCopilotOption(cli: string): CopilotOption | undefined {
  return COPILOT_OPTIONS.find(o => o.cli === cli);
}

function buildCopilotPrompt(prompt: string): string {
  const systemContext = [
    'You have access to the geins CLI tool for managing Geins Commerce Backend.',
    'Available commands: geins whoami, geins workflow list, geins workflow get <id>,',
    'geins workflow create --body \'<json>\', geins workflow run <id>,',
    'geins workflow manifest (shows full schema), geins workflow logs <id>.',
    'geins workflow vars (list global variables), geins workflow vars get <name>,',
    'geins workflow vars set <name> <value> [description].',
    'Global variables are referenced in workflows with {{vars.variableName}}.',
    'Use geins workflow manifest to learn all node types, actions, and expressions.',
    'Use geins workflow get <id> to study existing workflow examples.',
  ].join(' ');
  return `${systemContext}\n\nUser request: ${prompt}`;
}

export async function chat(prompt: string): Promise<string> {
  const config = await getCopilotConfig();
  if (!config) throw new Error('No copilot configured. Run /copilot to set one up.');

  const option = getCopilotOption(config.cli);
  if (!option) throw new Error(`Unknown copilot CLI: ${config.cli}`);

  const cmd = option.buildCmd(buildCopilotPrompt(prompt), config.model);

  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Copilot exited with code ${exitCode}: ${stderr.trim()}`);
  }

  return output.trim();
}

export async function chatStream(
  prompt: string,
  onChunk: (text: string) => void,
): Promise<void> {
  const config = await getCopilotConfig();
  if (!config) throw new Error('No copilot configured. Run /copilot to set one up.');

  const option = getCopilotOption(config.cli);
  if (!option) throw new Error(`Unknown copilot CLI: ${config.cli}`);

  const cmd = option.buildCmd(buildCopilotPrompt(prompt), config.model);

  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Copilot exited with code ${exitCode}: ${stderr.trim()}`);
  }
}
