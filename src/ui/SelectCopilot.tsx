import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { COPILOT_OPTIONS, testCli, saveCopilotChoice, listOllamaModels, type CopilotOption } from '../commands/copilot.ts';

const PROVIDER_META: Record<string, { icon: string; desc: string }> = {
  claude: { icon: '◆', desc: 'Anthropic Claude Code CLI' },
  codex: { icon: '◇', desc: 'OpenAI Codex CLI' },
  gemini: { icon: '△', desc: 'Google Gemini CLI' },
  ollama: { icon: '○', desc: 'Local models via Ollama' },
  lms: { icon: '□', desc: 'Local models via LM Studio' },
};

// One-line hints for the Claude Code tier picker (static `models` list on the option).
const MODEL_HINTS: Record<string, string> = {
  auto: 'route each ask to the cheapest sufficient model (recommended)',
  haiku: 'fastest & cheapest — simple lookups',
  sonnet: 'balanced speed and capability',
  opus: 'most capable — complex multi-step work',
};

interface SelectCopilotProps {
  onComplete: (option: CopilotOption) => void;
  onCancel: () => void;
  onLog: (text: string) => void;
}

export function SelectCopilot({ onComplete, onCancel, onLog }: SelectCopilotProps) {
  const [index, setIndex] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const [pendingOption, setPendingOption] = useState<CopilotOption | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelIndex, setModelIndex] = useState(0);

  const allItems = [...COPILOT_OPTIONS.map(o => o.cli), 'cancel'];

  useEffect(() => {
    if (!pendingOption) return;
    // Providers with a static tier list (claude) skip the probe; ollama is probed.
    if (pendingOption.models) {
      setModels(pendingOption.models);
      return;
    }
    listOllamaModels().then(m => setModels(m));
  }, [pendingOption]);

  const handleProviderSelect = async (cli: string) => {
    if (cli === 'cancel') { onCancel(); return; }
    const option = COPILOT_OPTIONS.find(o => o.cli === cli)!;
    setTesting(option.name);
    const result = await testCli(option);
    if (!result.ok) {
      onLog(`✗ ${option.name} not found. Make sure '${option.cli}' is installed and in your PATH.`);
      setTesting(null);
      return;
    }
    if (option.supportsModels) {
      setTesting(null);
      setPendingOption(option);
      return;
    }
    await saveCopilotChoice(option);
    onLog(`✓ ${option.name} configured (${result.version})`);
    onComplete(option);
  };

  const handleModelConfirm = async (model: string) => {
    if (model === 'cancel' || !pendingOption) {
      setPendingOption(null);
      setModels(null);
      setModelIndex(0);
      return;
    }
    await saveCopilotChoice(pendingOption, model);
    onLog(`✓ ${pendingOption.name} configured (model: ${model})`);
    onComplete(pendingOption);
  };

  useInput((input, key) => {
    if (testing) return;

    if (pendingOption && models) {
      const total = models.length + 1;
      if (key.upArrow) setModelIndex(i => (i <= 0 ? total - 1 : i - 1));
      if (key.downArrow) setModelIndex(i => (i >= total - 1 ? 0 : i + 1));
      if (key.return) {
        const val = modelIndex < models.length ? models[modelIndex]! : 'cancel';
        handleModelConfirm(val);
      }
      if (key.escape) { setPendingOption(null); setModels(null); setModelIndex(0); }
      return;
    }

    if (key.upArrow) setIndex(i => (i <= 0 ? allItems.length - 1 : i - 1));
    if (key.downArrow) setIndex(i => (i >= allItems.length - 1 ? 0 : i + 1));
    if (key.return) handleProviderSelect(allItems[index]!);
    if (key.escape) onCancel();
  });

  if (testing) {
    return (
      <Box paddingX={2} gap={1}>
        <Spinner type="dots" />
        <Text dimColor>Testing {testing}...</Text>
      </Box>
    );
  }

  if (pendingOption && models === null) {
    return (
      <Box paddingX={2} gap={1}>
        <Spinner type="dots" />
        <Text dimColor>Loading models...</Text>
      </Box>
    );
  }

  if (pendingOption && models) {
    if (models.length === 0) {
      onLog('✗ No models found. Pull a model first: ollama pull llama3.2');
      setPendingOption(null);
      setModels(null);
      return null;
    }
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan"> Select a model</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {models.map((m, i) => {
            const selected = i === modelIndex;
            const hint = pendingOption.models ? MODEL_HINTS[m] : undefined;
            return (
              <Box key={m} gap={1}>
                <Text color={selected ? 'cyan' : 'gray'}>{selected ? '▸' : ' '}</Text>
                <Text color={selected ? 'white' : 'gray'} bold={selected}>{m}</Text>
                {hint ? <Text dimColor>{hint}</Text> : null}
              </Box>
            );
          })}
          <Box gap={1} marginTop={1}>
            <Text color={modelIndex === models.length ? 'red' : 'gray'}>
              {modelIndex === models.length ? '▸' : ' '}
            </Text>
            <Text color={modelIndex === models.length ? 'red' : 'gray'} dimColor={modelIndex !== models.length}>
              Cancel
            </Text>
          </Box>
        </Box>
        <Text dimColor> ↑↓ navigate · enter select · esc cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan"> Select a copilot provider</Text>
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {COPILOT_OPTIONS.map((o, i) => {
          const selected = i === index;
          const meta = PROVIDER_META[o.cli] ?? { icon: '·', desc: '' };
          return (
            <Box key={o.cli} gap={1}>
              <Text color={selected ? 'cyan' : 'gray'}>{selected ? '▸' : ' '}</Text>
              <Text color={selected ? 'cyan' : 'white'}>{meta.icon}</Text>
              <Text color={selected ? 'white' : undefined} bold={selected}>{o.name}</Text>
              <Text dimColor>{meta.desc}</Text>
            </Box>
          );
        })}
        <Box gap={1} marginTop={1}>
          <Text color={index === COPILOT_OPTIONS.length ? 'red' : 'gray'}>
            {index === COPILOT_OPTIONS.length ? '▸' : ' '}
          </Text>
          <Text color={index === COPILOT_OPTIONS.length ? 'red' : 'gray'} dimColor={index !== COPILOT_OPTIONS.length}>
            Cancel
          </Text>
        </Box>
      </Box>
      <Text dimColor> ↑↓ navigate · enter select · esc cancel</Text>
    </Box>
  );
}
