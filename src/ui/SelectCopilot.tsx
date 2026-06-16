/** @jsxImportSource react */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { COPILOT_OPTIONS, testCli, saveCopilotChoice, type CopilotOption } from '../commands/copilot.ts';

const PROVIDER_META: Record<string, { icon: string; desc: string }> = {
  claude: { icon: '◆', desc: 'Anthropic Claude Code CLI' },
  codex: { icon: '◇', desc: 'OpenAI Codex CLI' },
  agy: { icon: '△', desc: 'Google Antigravity CLI' },
  ollama: { icon: '○', desc: 'Local models via Ollama' },
  lms: { icon: '□', desc: 'Local models via LM Studio' },
};

// One-line hints for the static tier pickers (claude + agy). The shared 'auto' router entry is
// first; probed model ids (ollama) carry no hint. agy keys must match AGY_MODELS in model-router.ts.
const MODEL_HINTS: Record<string, string> = {
  // Shared across providers: claude/agy route to the cheapest sufficient tier; codex routes
  // coding asks to gpt-5-codex and the rest to gpt-5.5. Keep the wording provider-agnostic.
  auto: 'pick the right model per ask automatically — instant (recommended)',
  'auto-smart': 'a cheap model picks the model + effort per ask (smarter, slower)',
  // Claude tiers
  haiku: 'fastest & cheapest — simple lookups',
  sonnet: 'balanced speed and capability',
  opus: 'most capable — complex multi-step work',
  // Antigravity models (AGY_MODELS) — 'auto' routes among the Flash-Low / Flash-High / Pro-High tiers
  'Gemini 3.5 Flash (Low)': 'fastest & cheapest — simple lookups',
  'Gemini 3.5 Flash (Medium)': 'fast — light tasks',
  'Gemini 3.5 Flash (High)': 'fast with more reasoning — default',
  'Gemini 3.1 Pro (Low)': 'capable — moderate effort',
  'Gemini 3.1 Pro (High)': 'most capable Gemini — complex multi-step work',
  'Claude Sonnet 4.6 (Thinking)': 'Anthropic mid tier',
  'Claude Opus 4.6 (Thinking)': 'Anthropic top tier',
  'GPT-OSS 120B (Medium)': 'open-weights GPT',
  // Codex model ids (axis 1) and reasoning-effort tiers (axis 2). Models/efforts and their
  // descriptions mirror `codex debug models` for a ChatGPT-auth account.
  'gpt-5.5': 'frontier — coding, research, real work',
  'gpt-5.4': 'previous generation',
  'gpt-5.4-mini': 'cheapest & fastest',
  low: 'fast responses, lighter reasoning',
  medium: 'balanced (default)',
  high: 'greater reasoning depth — complex problems',
  xhigh: 'maximum reasoning depth',
};

interface SelectCopilotProps {
  onComplete: (option: CopilotOption) => void;
  onCancel: () => void;
  onLog: (text: string) => void;
  /** When set, skip the provider list and open the model picker for this provider directly
   *  (the `/model` command — change model within the already-selected provider). */
  lockedProvider?: CopilotOption;
  /** The currently-configured model, pre-highlighted in the picker (used with lockedProvider). */
  currentModel?: string;
}

export function SelectCopilot({ onComplete, onCancel, onLog, lockedProvider, currentModel }: SelectCopilotProps) {
  const [index, setIndex] = useState(0);
  const [testing, setTesting] = useState<string | null>(null);
  const [pendingOption, setPendingOption] = useState<CopilotOption | null>(lockedProvider ?? null);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  // For two-axis providers (codex: model id → reasoning effort): the model id chosen in stage 1.
  // null = still on stage 1 (or single-axis provider). Set → render the effort list as stage 2.
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  const allItems = [...COPILOT_OPTIONS.map(o => o.cli), 'cancel'];

  // 'auto'/'auto-smart' route per-ask — the router/classifier supplies the effort, so these never
  // go to the (codex) effort stage; they save straight from stage 1.
  const META_MODELS = new Set(['auto', 'auto-smart']);

  // Stage 2 (effort) is active once a model id is locked in for a provider that has a second axis.
  const effortStage = !!pendingOption?.effortChoices && pendingModel !== null;
  // The list the picker is currently showing: effort choices in stage 2, else the model list.
  const activeList = effortStage ? pendingOption!.effortChoices! : models;

  useEffect(() => {
    if (!pendingOption) return;
    const { probeModels, metaModels, models: staticModels } = pendingOption;
    // Prepend routing sentinels (codex: auto/auto-smart) to whatever real models we end up with.
    const withMeta = (list: string[]) => [...(metaModels ?? []), ...list];
    // Probed providers (codex, ollama) query the installed CLI so the menu matches the account;
    // a failed/empty probe falls back to the static list. Static providers (claude, agy) use theirs.
    if (probeModels) {
      setModels(null); // show the loading state while the probe runs
      let cancelled = false;
      probeModels()
        .then(probed => { if (!cancelled) setModels(withMeta(probed.length ? probed : (staticModels ?? []))); })
        .catch(() => { if (!cancelled) setModels(withMeta(staticModels ?? [])); });
      return () => { cancelled = true; };
    }
    setModels(staticModels ? withMeta(staticModels) : []);
  }, [pendingOption]);

  // Pre-highlight the current model once the list is loaded (for the /model picker). For two-axis
  // providers `currentModel` is the combined "<model>:<effort>" token — match stage 1 on its model
  // part (stage 2 pre-highlights the effort part when the model is confirmed).
  useEffect(() => {
    if (!models || !currentModel) return;
    const modelPart = currentModel.split(':')[0] ?? currentModel;
    const i = models.indexOf(modelPart);
    if (i >= 0) setModelIndex(i);
  }, [models, currentModel]);

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

  const handleModelConfirm = async (choice: string) => {
    if (choice === 'cancel' || !pendingOption) {
      // In stage 2, cancel steps back to the model list rather than leaving the picker.
      if (effortStage) { setPendingModel(null); setModelIndex(0); return; }
      // Locked to one provider (/model): there's no provider list to fall back to — just exit.
      if (lockedProvider) { onCancel(); return; }
      setPendingOption(null);
      setModels(null);
      setModelIndex(0);
      return;
    }
    // Two-axis provider, stage 1: the meta selections ('auto'/'auto-smart') have no second axis
    // (the router/classifier picks the effort per ask), so save straight away rather than advancing.
    if (pendingOption.effortChoices && pendingModel === null && !META_MODELS.has(choice)) {
      const effortPart = currentModel?.split(':')[1];
      const ei = effortPart ? pendingOption.effortChoices.indexOf(effortPart) : -1;
      const fallback = pendingOption.effortChoices.indexOf('medium');
      setPendingModel(choice);
      setModelIndex(ei >= 0 ? ei : Math.max(0, fallback));
      return;
    }
    const finalModel = pendingModel !== null ? `${pendingModel}:${choice}` : choice;
    await saveCopilotChoice(pendingOption, finalModel);
    onLog(`✓ ${pendingOption.name} configured (model: ${finalModel})`);
    onComplete(pendingOption);
  };

  useInput((input, key) => {
    if (testing) return;

    if (pendingOption && activeList) {
      const total = activeList.length + 1;
      if (key.upArrow) setModelIndex(i => (i <= 0 ? total - 1 : i - 1));
      if (key.downArrow) setModelIndex(i => (i >= total - 1 ? 0 : i + 1));
      if (key.return) {
        const val = modelIndex < activeList.length ? activeList[modelIndex]! : 'cancel';
        handleModelConfirm(val);
      }
      if (key.escape) {
        // Stage 2 → back to the model list; stage 1 → back to providers (or exit if locked).
        if (effortStage) { setPendingModel(null); setModelIndex(0); return; }
        if (lockedProvider) { onCancel(); return; }
        setPendingOption(null); setModels(null); setModelIndex(0);
      }
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

  if (pendingOption && activeList === null) {
    return (
      <Box paddingX={2} gap={1}>
        <Spinner type="dots" />
        <Text dimColor>Loading models...</Text>
      </Box>
    );
  }

  if (pendingOption && activeList) {
    if (activeList.length === 0) {
      onLog('✗ No models found. Pull a model first: ollama pull llama3.2');
      if (lockedProvider) { onCancel(); return null; }
      setPendingOption(null);
      setModels(null);
      return null;
    }
    // Stage-aware heading: the effort step names the model it applies to; the cancel row steps
    // back to the model list (rather than leaving the picker) so its label says "Back".
    const heading = effortStage ? `Select reasoning effort · ${pendingModel}` : 'Select a model';
    const cancelLabel = effortStage ? 'Back' : 'Cancel';
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan"> {heading}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {activeList.map((m, i) => {
            const selected = i === modelIndex;
            // Hint any known tier name (claude's static tiers, agy's 'auto', codex models/efforts);
            // probed model ids have no hint.
            const hint = MODEL_HINTS[m];
            return (
              <Box key={m} gap={1}>
                <Text color={selected ? 'cyan' : 'gray'}>{selected ? '▸' : ' '}</Text>
                <Text color={selected ? 'white' : 'gray'} bold={selected}>{m}</Text>
                {hint ? <Text dimColor>{hint}</Text> : null}
              </Box>
            );
          })}
          <Box gap={1} marginTop={1}>
            <Text color={modelIndex === activeList.length ? 'red' : 'gray'}>
              {modelIndex === activeList.length ? '▸' : ' '}
            </Text>
            <Text color={modelIndex === activeList.length ? 'red' : 'gray'} dimColor={modelIndex !== activeList.length}>
              {cancelLabel}
            </Text>
          </Box>
        </Box>
        <Text dimColor> ↑↓ navigate · enter select · esc {effortStage ? 'back' : 'cancel'}</Text>
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
