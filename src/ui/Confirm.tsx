/** @jsxImportSource react */
import React from 'react';
import { Box, Text, useInput } from 'ink';

interface ConfirmProps {
  message: string;
  onYes: () => void;
  onNo: () => void;
  yesLabel?: string;
  noLabel?: string;
}

/** A minimal yes/no prompt: y or enter confirms, n or esc declines. */
export function Confirm({ message, onYes, onNo, yesLabel = 'yes', noLabel = 'no' }: ConfirmProps) {
  useInput((input, key) => {
    if (key.return || input.toLowerCase() === 'y') { onYes(); return; }
    if (key.escape || input.toLowerCase() === 'n') { onNo(); return; }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>{message}</Text>
      <Text dimColor>  y/enter {yesLabel} · n/esc {noLabel}</Text>
    </Box>
  );
}
