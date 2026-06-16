/** @jsxImportSource react */
import React, { useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import type { AuthAccounts } from '../auth/login.ts';

interface SelectAccountProps {
  accounts: AuthAccounts[];
  onSelect: (accountKey: string) => void;
  onCancel: () => void;
}

export function SelectAccount({ accounts, onSelect, onCancel }: SelectAccountProps) {
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState('');
  const { rows } = useWindowSize();

  const filtered = filter
    ? accounts.filter(a => a.displayName.toLowerCase().includes(filter.toLowerCase()))
    : accounts;

  const maxVisible = Math.min(filtered.length, Math.max(5, rows - 10));
  let scrollStart = 0;
  if (filtered.length > maxVisible) {
    scrollStart = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), filtered.length - maxVisible));
  }
  const visible = filtered.slice(scrollStart, scrollStart + maxVisible);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(s => (s <= 0 ? filtered.length - 1 : s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected(s => (s >= filtered.length - 1 ? 0 : s + 1));
      return;
    }
    if (key.return) {
      if (filtered.length > 0) {
        onSelect(filtered[selected]!.accountKey);
      }
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.backspace || key.delete) {
      setFilter(f => f.slice(0, -1));
      setSelected(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setFilter(f => f + input);
      setSelected(0);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>  Select account</Text>
      <Box gap={2}>
        <Text dimColor>  {filtered.length} accounts</Text>
        {filter ? <Text dimColor>filter: &quot;{filter}&quot;</Text> : null}
        <Text dimColor>type to filter · ↑↓ navigate · enter select</Text>
      </Box>
      <Text> </Text>

      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        {visible.map((account, i) => {
          const globalIdx = scrollStart + i;
          const isSel = globalIdx === selected;
          return (
            <Box key={account.accountKey} gap={1}>
              <Text color={isSel ? 'cyan' : undefined} bold={isSel}>
                {isSel ? '▸' : ' '}
              </Text>
              <Text color={isSel ? 'cyan' : undefined} bold={isSel}>
                {account.displayName}
              </Text>
              <Text dimColor>({account.roles.join(', ')})</Text>
            </Box>
          );
        })}
      </Box>

      {filtered.length > maxVisible ? (
        <Text dimColor>  {Math.round((selected / (filtered.length - 1)) * 100)}% · {selected + 1}/{filtered.length}</Text>
      ) : null}
    </Box>
  );
}
