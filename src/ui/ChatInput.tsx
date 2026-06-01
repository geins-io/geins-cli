import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';
import { existsSync } from 'node:fs';

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
  product: ['get', 'list', 'query', 'items', 'variants', 'images', 'brands', 'categories', 'relation-types', 'relations', 'parameters', 'help'],
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
    items: '<productId>',
    variants: '<productId> | create | labels [add|remove|rename]',
    images: '<productId> | add <id> <file|url> | delete | set-primary | reorder',
    brands: '[list | get <id> | create --name <n> [--external-id <id>] | update <id> | delete <id>]',
    categories: '[list | get <id> | create --name <code>:<text> [--parent <id>] | update <id> | assign/unassign <productId> <categoryId>]',
    'relation-types': '[list | get <id> | add <name> | update <id> | delete <id>]',
    relations: '<productId> | link <id> <typeId> <relatedId...> | unlink ...',
    parameters: '<productId> | get <id> <paramId> | set <id> <paramId> <value> | remove | batch | defs | groups | predefined',
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

// Matches an absolute path as terminals insert it on drag-and-drop (with backslash-escaped
// spaces, optional file:// scheme) that ends in a file extension. Used to show a compact chip
// for any dropped file — images get an [image] chip, everything else a [file: name] chip.
const DROPPED_PATH_RE = /(?:file:\/\/)?(?:~\/|\/)(?:\\ |[^\s])*\.[A-Za-z0-9]{1,12}/gi;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|heic|svg)$/i;

/** Strip surrounding quotes/escapes and resolve file:// and ~ to a real filesystem path. */
function normalizeDroppedPath(match: string): string {
  let p = match.replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
  if (/^file:\/\//i.test(p)) {
    try { p = decodeURIComponent(new URL(p).pathname); } catch { /* leave as-is */ }
  } else if (p.startsWith('~/') && process.env.HOME) {
    p = process.env.HOME + p.slice(1);
  }
  return p;
}

interface ChatInputProps {
  disabled?: boolean;
  /** An operation is in flight; Ctrl-C is reserved for cancelling it (handled by App). */
  busy?: boolean;
  copilotActive?: boolean;
  copilotProvider?: string;
  onSubmit: (message: string) => void;
  onCancel?: () => void;
  onToggleCopilot?: () => void;
}

export function ChatInput({ disabled = false, busy = false, copilotActive = false, copilotProvider, onSubmit, onCancel, onToggleCopilot }: ChatInputProps) {
  const { exit } = useApp();
  const [value, setValue] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  // While toggling through commands with Tab, keep the FULL command list visible
  // (instead of the prefix-filtered subset) so the user sees what they're cycling.
  const [cycleAll, setCycleAll] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const historyRef = useRef<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Dropped-file chips: placeholder text shown in the input → real path used on submit.
  const attachmentsRef = useRef<Map<string, string>>(new Map());
  const attachCounter = useRef(0);
  const prevValueRef = useRef('');

  // Commands offerable right now (`/new` only makes sense once a copilot is active).
  const available = copilotActive ? COMMAND_NAMES : COMMAND_NAMES.filter(c => c !== 'new');

  const getMatches = (input: string): string[] => {
    const query = input.startsWith('/') ? input.slice(1) : input;
    if (!query && input === '/') return available;
    return available.filter(c => c.startsWith(query.toLowerCase()));
  };

  const matches = showMenu ? (cycleAll ? available : getMatches(value)) : [];

  useInput((input, key) => {
    // While an operation is in flight, Ctrl-C is reserved for cancelling it — App's
    // handler aborts the running command; don't also clear/exit here.
    if (key.ctrl && input === 'c' && busy) return;
    // Ctrl-C clears the current input; if it's already empty, exit.
    if (key.ctrl && input === 'c') {
      if (value) {
        setValue('');
        setShowMenu(false);
        setCycleAll(false);
        setHistoryIndex(-1);
        setInputKey(k => k + 1);
      } else {
        exit();
      }
      return;
    }
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
    if (key.tab && value.startsWith('/')) {
      const tokens = value.slice(1).split(/\s+/);
      // ── Command level: no space yet (still typing the command name) ──
      if (!value.includes(' ')) {
        const typed = tokens[0]!.toLowerCase();
        const exactIdx = available.indexOf(typed);
        if (exactIdx !== -1) {
          // A complete command is typed → toggle to the next available command.
          const nextIdx = (exactIdx + 1) % available.length;
          setValue(`/${available[nextIdx]!}`);
          setCycleAll(true);
          setShowMenu(true);
          setMenuIndex(nextIdx);
          setInputKey(k => k + 1);
          return;
        }
        // A partial command → autocomplete to the highlighted (or first) match.
        const ms = getMatches(value);
        if (ms.length > 0) {
          setValue(`/${ms[menuIndex] ?? ms[0]!}`);
          setCycleAll(false);
          setShowMenu(true);
          setMenuIndex(0);
          setInputKey(k => k + 1);
          return;
        }
        return;
      }
      // ── Subcommand level: "/cmd " or "/cmd <partial>" (not deeper than one arg) ──
      const cmd = tokens[0]!.toLowerCase();
      const subs = SUBCOMMANDS[cmd];
      if (subs && tokens.length <= 2) {
        const typedSub = (tokens[1] ?? '').toLowerCase();
        const exactSub = subs.findIndex(s => s.toLowerCase() === typedSub);
        if (exactSub !== -1) {
          // Complete subcommand → toggle to the next one.
          const next = subs[(exactSub + 1) % subs.length]!;
          setValue(`/${cmd} ${next}`);
          setInputKey(k => k + 1);
          return;
        }
        // Partial (or empty) subcommand → autocomplete to the first match.
        const matchSub = typedSub
          ? subs.filter(s => s.toLowerCase().startsWith(typedSub))
          : subs;
        if (matchSub.length > 0) {
          setValue(`/${cmd} ${matchSub[0]!}`);
          setInputKey(k => k + 1);
          return;
        }
      }
      return;
    }
  });

  const handleChange = (raw: string) => {
    // Single-line field: collapse newlines/tabs (e.g. from a multiline paste) to spaces
    // so the layout and the prompt icon don't break.
    let next = raw.replace(/[\r\n\t]+/g, ' ');
    // A drag-drop/paste inserts many chars at once; only then collapse dropped file paths
    // into a chip (and guard the regex behind a cheap check so big pastes don't stall).
    const jumped = next.length - prevValueRef.current.length > 1;
    if (jumped && /(?:~\/|\/)[^\s]*\.[A-Za-z0-9]/.test(next)) {
      next = next.replace(DROPPED_PATH_RE, (match) => {
        const realPath = normalizeDroppedPath(match);
        // Only collapse paths that point at a real local file — leaves pasted URLs and
        // incidental "/foo.bar" text untouched.
        if (!existsSync(realPath)) return match;
        const name = realPath.split('/').pop() || realPath;
        const placeholder = IMAGE_EXT_RE.test(name)
          ? `[image #${++attachCounter.current}]`
          : `[file #${++attachCounter.current}: ${name}]`;
        attachmentsRef.current.set(placeholder, realPath);
        return placeholder;
      });
    }
    prevValueRef.current = next;
    setValue(next);
    setCycleAll(false); // typing resumes prefix-filtered matches
    if (next !== raw) setInputKey(k => k + 1); // remount so the field shows the cleaned value/chip
    if (next.startsWith('/') && !next.includes(' ')) {
      const m = getMatches(next);
      setShowMenu(m.length > 0);
      setMenuIndex(0);
    } else {
      setShowMenu(false);
    }
  };

  const handleSubmit = (input: string) => {
    let submitted = showMenu && matches.length > 0 ? `/${matches[menuIndex]!}` : input;
    // Expand chips back to the real path (quoted so spaces survive tokenization).
    for (const [placeholder, realPath] of attachmentsRef.current) {
      if (submitted.includes(placeholder)) submitted = submitted.split(placeholder).join(`"${realPath}"`);
    }
    attachmentsRef.current.clear();
    attachCounter.current = 0;
    if (submitted.trim()) {
      historyRef.current.push(submitted.trim());
    }
    onSubmit(submitted);
    setValue('');
    prevValueRef.current = '';
    setHistoryIndex(-1);
    setShowMenu(false);
    setMenuIndex(0);
    setCycleAll(false);
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

  const menuVisible = showMenu && matches.length > 0;

  return (
    <Box flexDirection="column">
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
      {menuVisible ? (
        <>
          <Box flexDirection="column" paddingX={1}>
            {matches.map((cmd, i) => (
              <Box key={cmd} gap={2}>
                <Text color={i === menuIndex ? 'cyan' : undefined} bold={i === menuIndex}>
                  {i === menuIndex ? '▸' : ' '} /{cmd}
                </Text>
                <Text dimColor>{COMMANDS[cmd]}</Text>
              </Box>
            ))}
          </Box>
          <Text dimColor>{separator}</Text>
        </>
      ) : null}
      <Box paddingX={1}>
        <Text color={copilotActive ? 'magenta' : 'cyan'}>
          {copilotActive ? `⏵⏵ copilot mode on` : '⏵⏵ cli mode on'}
        </Text>
        {copilotActive && copilotProvider && (
          <Text dimColor>{` · ${copilotProvider}`}</Text>
        )}
        <Text dimColor>{busy ? ' · ctrl-c to cancel' : ' (shift+tab to cycle)'}</Text>
      </Box>
    </Box>
  );
}
