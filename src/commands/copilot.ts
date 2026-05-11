import { loadConfig, saveConfig, type CopilotConfig } from '../config/store.ts';
import { $ } from 'bun';
import {
  appendMessage,
  loadRecentMessages,
  clearHistory,
  loadContext,
  trackApiResponse,
  buildContextPromptSection,
  loadKnowledge,
  buildKnowledgePromptSection,
  addFact,
  extractMemoryBlocks,
} from '../memory/index.ts';

export interface CopilotOption {
  name: string;
  cli: string;
  testCmd: string[];
  supportsModels?: boolean;
  contextWindow: number;
  buildCmd: (model?: string) => string[];
  useStdin: boolean;
}

export const COPILOT_OPTIONS: CopilotOption[] = [
  {
    name: 'Claude Code',
    cli: 'claude',
    testCmd: ['claude', '--version'],
    contextWindow: 200000,
    useStdin: true,
    buildCmd: () => ['claude', '-p'],
  },
  {
    name: 'OpenAI Codex',
    cli: 'codex',
    testCmd: ['codex', '--version'],
    contextWindow: 128000,
    useStdin: true,
    buildCmd: () => ['codex', 'exec', '--ephemeral', '--skip-git-repo-check', '-'],
  },
  {
    name: 'Google Gemini CLI',
    cli: 'gemini',
    testCmd: ['gemini', '--version'],
    contextWindow: 1000000,
    useStdin: true,
    buildCmd: () => ['gemini', '-p', ''],
  },
  {
    name: 'Ollama',
    cli: 'ollama',
    testCmd: ['ollama', '--version'],
    supportsModels: true,
    contextWindow: 8000,
    useStdin: true,
    buildCmd: (model) => ['ollama', 'run', model ?? 'llama3.2'],
  },
  {
    name: 'LM Studio',
    cli: 'lms',
    testCmd: ['lms', 'version'],
    contextWindow: 8000,
    useStdin: true,
    buildCmd: () => ['lms', 'chat'],
  },
];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function clearConversationHistory(): void {
  clearHistory();
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}


const SYSTEM_CONTEXT = [
  'You are an autonomous CLI agent for Geins Commerce Backend.',
  'You DO NOT explain how to run commands — you RUN them by outputting them in ```bash code blocks.',
  'The system will automatically execute any geins command you output in a code block and return the result.',
  '',
  'Available commands:',
  '  geins whoami',
  '  geins workflow list',
  '  geins workflow get <id>',
  '  geins workflow create --body \'<json>\'',
  '  geins workflow update <id> --body \'<json>\'',
  '  geins workflow run <id> [--body \'<json>\']',
  '  geins workflow manifest',
  '  geins workflow logs <id>',
  '  geins workflow enable <id>',
  '  geins workflow disable <id>',
  '  geins workflow vars [list|get <name>|set <name> <value>]',
  '',
  'RULES:',
  '- ALWAYS output commands in ```bash blocks. Never tell the user to run them manually.',
  '- To create a workflow, output: geins workflow create --body \'<full JSON>\'',
  '- If you need information first (e.g. manifest, existing workflows), run those commands first.',
  '- Global variables in workflows: {{vars.variableName}}',
  '- Keep responses concise. Act, don\'t explain.',
  '- If you learn something notable about this project, workflows, or user preferences, output it as: [MEMORY]category:fact[/MEMORY] where category is one of: project, workflow, api, preference, pattern.',
].join('\n');

function getMaxPromptTokens(option?: CopilotOption): number {
  const ctx = option?.contextWindow ?? 8000;
  return Math.floor(ctx * 0.75);
}

async function buildFullPrompt(userMessage: string, option?: CopilotOption): Promise<string> {
  const maxTokens = getMaxPromptTokens(option);
  const systemTokens = estimateTokens(SYSTEM_CONTEXT);
  const userMsgText = userMessage ? `User: ${userMessage}` : '';
  const userMsgTokens = estimateTokens(userMsgText);

  const [ctx, kb] = await Promise.all([loadContext(), loadKnowledge()]);
  const contextSection = buildContextPromptSection(ctx);
  const knowledgeSection = buildKnowledgePromptSection(kb);
  const contextTokens = estimateTokens(contextSection);
  const knowledgeTokens = estimateTokens(knowledgeSection);

  const historyBudget = maxTokens - systemTokens - userMsgTokens - contextTokens - knowledgeTokens;
  const recentMessages = await loadRecentMessages(Math.max(0, historyBudget));
  const historyParts = recentMessages.map(
    msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
  );

  const parts = [SYSTEM_CONTEXT];
  if (knowledgeSection) parts.push(knowledgeSection);
  if (contextSection) parts.push(contextSection);
  parts.push(...historyParts);
  if (userMsgText) parts.push(userMsgText);
  return parts.join('\n\n');
}

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

export async function getContextUsageAsync(): Promise<{ used: number; total: number; percent: number }> {
  const config = await getCopilotConfig();
  const option = config ? getCopilotOption(config.cli) : undefined;
  const total = option?.contextWindow ?? 8000;
  const fullPrompt = await buildFullPrompt('', option);
  const used = estimateTokens(fullPrompt);
  const percent = Math.min(100, Math.round((used / total) * 100));
  return { used, total, percent };
}

export async function chat(prompt: string): Promise<string> {
  const config = await getCopilotConfig();
  if (!config) throw new Error('No copilot configured. Run /copilot to set one up.');

  const option = getCopilotOption(config.cli);
  if (!option) throw new Error(`Unknown copilot CLI: ${config.cli}`);

  await appendMessage({ role: 'user', content: prompt, provider: config.cli, model: config.model });
  const fullPrompt = await buildFullPrompt(prompt, option);
  const cmd = option.buildCmd(config.model);

  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
    cwd: process.cwd(),
  });

  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Copilot exited with code ${exitCode}: ${stderr.trim()}`);
  }

  const cleaned = output.trim();
  await appendMessage({ role: 'assistant', content: cleaned, provider: config.cli, model: config.model });
  await processMemoryBlocks(cleaned);
  return cleaned;
}

export async function chatStream(
  prompt: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const config = await getCopilotConfig();
  if (!config) throw new Error('No copilot configured. Run /copilot to set one up.');

  const option = getCopilotOption(config.cli);
  if (!option) throw new Error(`Unknown copilot CLI: ${config.cli}`);

  await appendMessage({ role: 'user', content: prompt, provider: config.cli, model: config.model });
  const fullPrompt = await buildFullPrompt(prompt, option);
  const cmd = option.buildCmd(config.model);

  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
    cwd: process.cwd(),
  });

  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    onChunk(chunk);
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Copilot exited with code ${exitCode}: ${stderr.trim()}`);
  }

  const cleaned = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  await appendMessage({ role: 'assistant', content: cleaned, provider: config.cli, model: config.model });
  await processMemoryBlocks(cleaned);
  return buffer;
}

export function extractGeinsCommands(text: string): string[] {
  const commands: string[] = [];
  const codeBlockRegex = /```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const lines = match[1]!.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('geins ')) {
        commands.push(trimmed);
      }
    }
  }
  if (commands.length === 0) {
    const inlineRegex = /(?:^|\n)\s*(geins\s+\S[^\n]*)/g;
    while ((match = inlineRegex.exec(text)) !== null) {
      const cmd = match[1]!.trim();
      if (!cmd.includes('<') && !cmd.includes('>')) {
        commands.push(cmd);
      }
    }
  }
  return commands;
}

export async function executeGeinsCommand(command: string): Promise<{ output: string; exitCode: number }> {
  const args = command.replace(/^geins\s+/, '').split(/\s+/);
  const proc = Bun.spawn(['geins', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: process.cwd(),
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { output: (stdout || stderr).trim(), exitCode };
}

export async function addToolResult(command: string, output: string): Promise<void> {
  const content = `I ran \`${command}\` and got this output:\n\n${output}`;
  await appendMessage({ role: 'user', content });
  await trackApiResponse(command, output);
}

async function processMemoryBlocks(text: string): Promise<void> {
  const blocks = extractMemoryBlocks(text);
  for (const block of blocks) {
    await addFact({
      category: block.category,
      content: block.content,
      confidence: 0.7,
      source: 'copilot',
    });
  }
}
