import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';

const COMMANDS: Record<string, string> = {
  help: 'Show available commands',
  login: 'Authenticate with Geins',
  logout: 'Clear credentials',
  whoami: 'Show current user',
  apikey: 'Set Geins API credentials',
  workflow: 'Workflow commands',
  product: 'Product commands',
  copilot: 'Toggle AI copilot mode',
  provider: 'Switch copilot provider',
  new: 'New conversation',
  api: 'Raw API request',
  management: 'Management API',
  output: 'Dump responses to a folder',
  theme: 'Switch dark/light mode',
  clear: 'Clear the screen',
  exit: 'Exit the CLI',
};

const SUBCOMMANDS: Record<string, string[]> = {
  workflow: ['list', 'get', 'run', 'create', 'update', 'logs', 'manifest', 'enable', 'disable', 'vars', 'help'],
  apikey: ['add', 'list', 'use', 'remove', 'clear'],
  product: ['get', 'list', 'query', 'help'],
  api: ['GET', 'POST', 'PUT', 'DELETE'],
  management: ['GET', 'POST', 'PUT', 'DELETE', 'help'],
  output: ['status', 'off'],
  copilot: ['set'],
};

const ARG_HINTS: Record<string, Record<string, string>> = {
  workflow: {
    get: '<id>',
    run: '<id> [--body \'<json>\'] [--watch]',
    update: '<id> [--file <path> | --body \'<json>\']',
    create: '[--file <path> | --body \'<json>\']',
    logs: '<id>',
    enable: '<id>',
    disable: '<id>',
    vars: 'list | get <name> | set <name> <value>',
  },
  apikey: {
    use: '[<name>]  (blank → arrow-key picker)',
    remove: '<name>',
  },
  product: {
    get: '<id>',
    list: '[--brand <id>] [--category <id>] [--article <n>] [--sellable] [--in-stock] [--page <n>]',
    query: '[--brand <id>] [--category <id>] [--article <n>] [--sellable] [--in-stock] [--page <n>]',
  },
  api: {
    GET: '<path>',
    POST: '<path> [--body \'<json>\']',
    PUT: '<path> [--body \'<json>\']',
    DELETE: '<path>',
  },
  management: {
    GET: '/API/...',
    POST: '/API/... [--body \'<json>\']',
    PUT: '/API/... [--body \'<json>\']',
    DELETE: '/API/...',
  },
  copilot: {
    set: 'claude | codex | gemini | ollama | lmstudio',
  },
};

// Positional-argument hint shown before the subcommand list for commands whose
// bare form takes a value (e.g. `/output <path>`).
const BARE_HINTS: Record<string, string> = {
  output: '<path>',
};

const COMMAND_NAMES = Object.keys(COMMANDS);

interface ChatInputProps {
  disabled?: boolean;
  copilotActive?: boolean;
  copilotProvider?: string;
  onSubmit: (message: string) => void;
  onCancel?: () => void;
  onToggleCopilot?: () => void;
}

export function ChatInput({ disabled = false, copilotActive = false, copilotProvider, onSubmit, onCancel, onToggleCopilot }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const historyRef = useRef<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const getMatches = (input: string): string[] => {
    const query = input.startsWith('/') ? input.slice(1) : input;
    const available = copilotActive ? COMMAND_NAMES : COMMAND_NAMES.filter(c => c !== 'new');
    if (!query && input === '/') return available;
    return available.filter(c => c.startsWith(query.toLowerCase()));
  };

  const matches = showMenu ? getMatches(value) : [];

  useInput((input, key) => {
    if (disabled) {
      if (key.escape && onCancel) onCancel();
      return;
    }
    if (key.upArrow && showMenu && matches.length > 0) {
      setMenuIndex(i => (i <= 0 ? matches.length - 1 : i - 1));
      return;
    }
    if (key.downArrow && showMenu && matches.length > 0) {
      setMenuIndex(i => (i >= matches.length - 1 ? 0 : i + 1));
      return;
    }
    if (key.upArrow && !showMenu && historyRef.current.length > 0) {
      const newIndex = historyIndex < historyRef.current.length - 1 ? historyIndex + 1 : historyIndex;
      setHistoryIndex(newIndex);
      setValue(historyRef.current[historyRef.current.length - 1 - newIndex]!);
      setInputKey(k => k + 1);
      return;
    }
    if (key.downArrow && !showMenu && historyIndex >= 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setValue(newIndex < 0 ? '' : historyRef.current[historyRef.current.length - 1 - newIndex]!);
      setInputKey(k => k + 1);
      return;
    }
    if (key.tab && key.shift && onToggleCopilot) {
      onToggleCopilot();
      return;
    }
    if (key.tab && showMenu && matches.length > 0) {
      const selected = matches[menuIndex]!;
      setValue(`/${selected} `);
      setShowMenu(false);
      setInputKey(k => k + 1);
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);
    if (newValue.startsWith('/') && !newValue.includes(' ')) {
      const m = getMatches(newValue);
      setShowMenu(m.length > 0);
      setMenuIndex(0);
    } else {
      setShowMenu(false);
    }
  };

  const handleSubmit = (input: string) => {
    const submitted = showMenu && matches.length > 0 ? `/${matches[menuIndex]!}` : input;
    if (submitted.trim()) {
      historyRef.current.push(submitted.trim());
    }
    onSubmit(submitted);
    setValue('');
    setHistoryIndex(-1);
    setShowMenu(false);
    setMenuIndex(0);
  };

  const { columns } = useWindowSize();
  const separator = '─'.repeat(columns - 2);

  const getHints = (): string | null => {
    if (showMenu) return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('/')) return null;
    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    if (!cmd) return null;
    const subs = SUBCOMMANDS[cmd];
    if (!subs) return null;
    const typed = parts[1];
    if (!typed) {
      const bare = BARE_HINTS[cmd];
      return (bare ? `${bare} | ` : '') + subs.join(' | ');
    }
    const typedLower = typed.toLowerCase();
    const exactMatch = subs.find(s => s.toLowerCase() === typedLower);
    if (exactMatch) {
      const argHint = ARG_HINTS[cmd]?.[exactMatch];
      return argHint ?? null;
    }
    const filtered = subs.filter(s => s.toLowerCase().startsWith(typedLower));
    return filtered.length > 0 ? filtered.join(' | ') : null;
  };

  const hints = getHints();

  return (
    <Box flexDirection="column">
      {showMenu && matches.length > 0 ? (
        <Box flexDirection="column" borderStyle="single" paddingX={1} marginX={1}>
          {matches.map((cmd, i) => (
            <Box key={cmd} gap={2}>
              <Text color={i === menuIndex ? 'cyan' : undefined} bold={i === menuIndex}>
                {i === menuIndex ? '▸' : ' '} /{cmd}
              </Text>
              <Text dimColor>{COMMANDS[cmd]}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      <Text dimColor>{separator}</Text>
      <Box paddingX={1}>
        <Text color={copilotActive ? 'magenta' : 'cyan'} bold>{copilotActive ? '✦ ' : '❯ '}</Text>
        {disabled ? (
          <Text dimColor>processing...</Text>
        ) : (
          <TextInput key={inputKey} value={value} onChange={handleChange} onSubmit={handleSubmit} />
        )}
        {hints && <Text dimColor>  {hints}</Text>}
      </Box>
      <Text dimColor>{separator}</Text>
      <Box paddingX={1}>
        <Text color={copilotActive ? 'magenta' : 'cyan'}>
          {copilotActive ? `⏵⏵ copilot mode on` : '⏵⏵ cli mode on'}
        </Text>
        {copilotActive && copilotProvider && (
          <Text dimColor>{` · ${copilotProvider}`}</Text>
        )}
        <Text dimColor> (shift+tab to cycle)</Text>
      </Box>
    </Box>
  );
}
