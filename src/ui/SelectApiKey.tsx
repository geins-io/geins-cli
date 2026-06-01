import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface SelectApiKeyProps {
  names: string[];
  active: string | null;
  onSelect: (name: string) => void;
  onCancel: () => void;
}

export function SelectApiKey({ names, active, onSelect, onCancel }: SelectApiKeyProps) {
  const initial = active ? Math.max(0, names.indexOf(active)) : 0;
  const [selected, setSelected] = useState(initial);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelected(s => (s <= 0 ? names.length - 1 : s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected(s => (s >= names.length - 1 ? 0 : s + 1));
      return;
    }
    if (key.return) {
      onSelect(names[selected]!);
      return;
    }
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>  Switch API account</Text>
      <Text dimColor>  ↑↓ navigate · enter activate · esc cancel</Text>
      <Text> </Text>

      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        {names.map((name, i) => {
          const isSel = i === selected;
          const isActive = name === active;
          return (
            <Box key={name} gap={1}>
              <Text color={isSel ? 'cyan' : undefined} bold={isSel}>
                {isSel ? '▸' : ' '}
              </Text>
              <Text color={isSel ? 'cyan' : isActive ? 'green' : undefined} bold={isSel}>
                {isActive ? '●' : '○'} {name}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
