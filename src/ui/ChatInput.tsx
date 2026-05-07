import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';

const COMMANDS: Record<string, string> = {
  help: 'Show available commands',
  login: 'Authenticate with Geins',
  logout: 'Clear credentials',
  whoami: 'Show current user',
  workflow: 'Workflow commands',
  copilot: 'Toggle AI copilot mode',
  provider: 'Switch copilot provider',
  api: 'Raw API request',
  theme: 'Switch dark/light mode',
  clear: 'Clear the screen',
  exit: 'Exit the CLI',
};

const SUBCOMMANDS: Record<string, string[]> = {
  workflow: ['list', 'get', 'run', 'create', 'update', 'logs', 'manifest', 'enable', 'disable', 'vars', 'help'],
  api: ['GET', 'POST', 'PUT', 'DELETE'],
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
  api: {
    GET: '<path>',
    POST: '<path> [--body \'<json>\']',
    PUT: '<path> [--body \'<json>\']',
    DELETE: '<path>',
  },
  copilot: {
    set: 'claude | codex | gemini | ollama | lmstudio',
  },
};

const COMMAND_NAMES = Object.keys(COMMANDS);

interface ChatInputProps {
  disabled?: boolean;
  copilotActive?: boolean;
  onSubmit: (message: string) => void;
  onCancel?: () => void;
  onToggleCopilot?: () => void;
}

export function ChatInput({ disabled = false, copilotActive = false, onSubmit, onCancel, onToggleCopilot }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const getMatches = (input: string): string[] => {
    const query = input.startsWith('/') ? input.slice(1) : input;
    if (!query && input === '/') return COMMAND_NAMES;
    return COMMAND_NAMES.filter(c => c.startsWith(query.toLowerCase()));
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
    if (showMenu && matches.length > 0) {
      onSubmit(`/${matches[menuIndex]!}`);
    } else {
      onSubmit(input);
    }
    setValue('');
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
    if (!typed) return subs.join(' | ');
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
        <Text dimColor>
          {copilotActive ? '⏵⏵ copilot mode on' : '⏵⏵ cli mode on'} (shift+tab to cycle)
        </Text>
      </Box>
    </Box>
  );
}
