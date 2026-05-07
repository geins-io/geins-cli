import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const COMMANDS: Record<string, string> = {
  help: 'Show available commands',
  login: 'Authenticate with Geins',
  logout: 'Clear credentials',
  whoami: 'Show current user',
  api: 'Raw API request',
  ping: 'Check service health',
  theme: 'Switch dark/light mode',
  clear: 'Clear the screen',
  exit: 'Exit the CLI',
};

const COMMAND_NAMES = Object.keys(COMMANDS);

interface ChatInputProps {
  disabled?: boolean;
  onSubmit: (message: string) => void;
  onCancel?: () => void;
}

export function ChatInput({ disabled = false, onSubmit, onCancel }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [showMenu, setShowMenu] = useState(false);

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
    if (key.tab && showMenu && matches.length > 0) {
      const selected = matches[menuIndex]!;
      setValue(`/${selected} `);
      setShowMenu(false);
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
      <Box paddingX={1}>
        <Text color="cyan" bold>{'❯ '}</Text>
        {disabled ? (
          <Text dimColor>processing...</Text>
        ) : (
          <TextInput value={value} onChange={handleChange} onSubmit={handleSubmit} />
        )}
      </Box>
    </Box>
  );
}
