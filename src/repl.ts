import { loadSession } from './auth/session.ts';
import { setMemoryAccount } from './memory/index.ts';
import { loadConfig, saveConfig } from './config/store.ts';
import { printBanner, animateStartup } from './output/banner.ts';
import { cyan, dim, red, green, bold, setTheme, gray } from './output/color.ts';
import { formatError } from './api/errors.ts';
import { promptChoice } from './output/interactive.ts';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/auth.ts';
import { apiCommand } from './commands/api.ts';
import { pingCommand } from './commands/ping.ts';
import {
  initTerminal,
  exitTerminal,
  printToOutput,
  cursorToPrompt,
  clearPromptInput,
  clearContent,
  setConnectionStatus,
  updateStatus,
  drawMenuOverlay,
  clearMenuOverlay,
} from './output/terminal.ts';

const VERSION = '0.1.0';

// --- Intercept console.error/log to route through scroll region ---

let useTerminal = false;

function patchConsole(): void {
  const origError = console.error.bind(console);
  const origLog = console.log.bind(console);

  console.error = (...args: unknown[]) => {
    if (useTerminal) {
      const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      printToOutput(text);
    } else {
      origError(...args);
    }
  };

  console.log = (...args: unknown[]) => {
    if (useTerminal) {
      const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      printToOutput(text);
    } else {
      origLog(...args);
    }
  };
}

// --- Commands ---

interface SlashCommand {
  description: string;
  usage?: string;
  hidden?: boolean;
  run: (args: string[]) => Promise<void>;
}

const commands: Record<string, SlashCommand> = {
  help: {
    description: 'Show available commands',
    run: async () => showHelp(),
  },
  login: {
    description: 'Authenticate with Geins',
    run: async () => {
      await loginCommand();
      const s = await loadSession();
      if (s) {
        updateStatus(s.user.email, s.accountKey);
        setConnectionStatus(true);
      }
    },
  },
  logout: {
    description: 'Clear credentials and exit',
    run: async () => {
      await logoutCommand();
      updateStatus('', '');
      setConnectionStatus(false);
    },
  },
  whoami: {
    description: 'Show current user',
    run: async () => whoamiCommand(),
  },
  api: {
    description: 'Raw API request',
    usage: '/api GET /products',
    run: apiCommand,
  },
  ping: {
    description: 'Check service health',
    usage: '/ping [service...]',
    run: pingCommand,
  },
  theme: {
    description: 'Switch dark/light mode',
    run: async () => {
      const config = await loadConfig();
      const newTheme = config.theme === 'dark' ? 'light' : 'dark';
      config.theme = newTheme;
      await saveConfig(config);
      setTheme(newTheme);
      console.error(green(`  ✓ Switched to ${newTheme} mode`));
    },
  },
  clear: {
    description: 'Clear the screen',
    run: async () => {
      clearContent();
    },
  },
  exit: {
    description: 'Exit the CLI',
    run: async () => {
      exitTerminal();
      process.stderr.write(dim('  👋 See you later\n'));
      process.exit(0);
    },
  },
  quit: {
    description: 'Exit the CLI',
    hidden: true,
    run: async () => {
      exitTerminal();
      process.stderr.write(dim('  👋 See you later\n'));
      process.exit(0);
    },
  },
};

const visibleCommands = Object.entries(commands).filter(([, cmd]) => !cmd.hidden);

function showHelp(): void {
  console.error('');
  console.error(bold('  Commands'));
  console.error('');

  const maxLen = Math.max(...visibleCommands.map(([k]) => k.length));
  for (const [name, cmd] of visibleCommands) {
    const usage = cmd.usage ? dim(`  ${cmd.usage}`) : '';
    console.error(`  ${cyan(`/${name.padEnd(maxLen)}`)}  ${cmd.description}${usage}`);
  }
  console.error('');
}

export function parseInput(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const line = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const parts = line.match(/(?:[^\s"]+|"[^"]*")/g) ?? [];

  if (parts.length === 0) return null;

  const command = parts[0]!.toLowerCase();
  const args = parts.slice(1).map((a) => a.replace(/^"|"$/g, ''));

  return { command, args };
}

async function ensureTheme(): Promise<void> {
  const config = await loadConfig();

  if (!config.theme) {
    console.error('');
    console.error(bold('  Welcome to Geins CLI!'));
    console.error('');
    const choice = await promptChoice('  What terminal theme are you using?', [
      { label: 'Dark mode', value: 'dark' },
      { label: 'Light mode', value: 'light' },
    ]);
    config.theme = choice as 'dark' | 'light';
    await saveConfig(config);
    console.error('');
    console.error(dim(`  Saved. Change anytime with /theme`));
    console.error('');
  }

  setTheme(config.theme);
}

// --- Autocomplete menu ---

interface MenuState {
  showing: boolean;
  matches: { name: string; description: string }[];
  selected: number;
}

function getMatches(input: string): { name: string; description: string }[] {
  const query = input.startsWith('/') ? input.slice(1) : input;
  return visibleCommands
    .filter(([name]) => name.startsWith(query.toLowerCase()))
    .map(([name, cmd]) => ({ name, description: cmd.description }));
}

function drawMenu(menu: MenuState): void {
  if (menu.matches.length === 0) {
    clearMenuOverlay();
    return;
  }

  const maxName = Math.max(...menu.matches.map((m) => m.name.length));
  const lines: string[] = [];

  const selBg = '\x1b[48;5;238m';
  const rst = '\x1b[0m';

  for (let i = 0; i < menu.matches.length; i++) {
    const m = menu.matches[i]!;
    const isSelected = i === menu.selected;
    const prefix = isSelected ? cyan('▸') : ' ';
    const name = isSelected
      ? bold(cyan(`/${m.name.padEnd(maxName)}`))
      : gray(`/${m.name.padEnd(maxName)}`);
    const desc = dim(m.description);
    const content = ` ${prefix} ${name}  ${desc}`;
    lines.push(isSelected ? `${selBg}${content}${rst}` : content);
  }

  drawMenuOverlay(lines);
}

// --- Raw stdin line reader ---
// No readline module — we fully own stdin in raw mode.
// This avoids all the readline/emitKeypressEvents listener leaks.

function readLine(menu: MenuState): Promise<string | null> {
  return new Promise((resolve) => {
    let buf = '';
    let ctrlCPressed = false;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    function redrawInput() {
      clearPromptInput();
      process.stderr.write(buf);
    }

    function updateMenu() {
      if (buf.startsWith('/') && !buf.includes(' ')) {
        const matches = buf === '/'
          ? visibleCommands.map(([name, cmd]) => ({ name, description: cmd.description }))
          : getMatches(buf);

        if (matches.length > 0) {
          menu.showing = true;
          menu.matches = matches;
          menu.selected = 0;
          drawMenu(menu);
          cursorToPrompt();
        } else {
          clearMenuOverlay();
          menu.showing = false;
          menu.matches = [];
          menu.selected = 0;
        }
      } else {
        clearMenuOverlay();
        menu.showing = false;
        menu.matches = [];
        menu.selected = 0;
      }
    }

    function finish(value: string | null) {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      clearMenuOverlay();
      menu.showing = false;
      menu.matches = [];
      menu.selected = 0;
      resolve(value);
    }

    function onData(ch: string) {
      const c = ch.toString();

      // Ctrl+C
      if (c === '\x03') {
        if (ctrlCPressed) {
          finish(null);
          return;
        }
        ctrlCPressed = true;
        console.error(dim('  Press Ctrl+C again or type /exit'));
        buf = '';
        redrawInput();
        setTimeout(() => { ctrlCPressed = false; }, 2000);
        return;
      }
      ctrlCPressed = false;

      // Enter
      if (c === '\r' || c === '\n') {
        // If menu is showing, accept selected item
        if (menu.showing && menu.matches.length > 0) {
          const accepted = `/${menu.matches[menu.selected]!.name}`;
          finish(accepted);
          return;
        }
        finish(buf);
        return;
      }

      // Tab — accept menu selection into input buffer
      if (c === '\t') {
        if (menu.showing && menu.matches.length > 0) {
          buf = `/${menu.matches[menu.selected]!.name} `;
          clearMenuOverlay();
          menu.showing = false;
          menu.matches = [];
          menu.selected = 0;
          redrawInput();
        }
        return;
      }

      // Escape sequences (arrow keys, etc.)
      if (c === '\x1b' || c.startsWith('\x1b[')) {
        // Up arrow: \x1b[A
        if (c === '\x1b[A' && menu.showing) {
          menu.selected = menu.selected <= 0 ? menu.matches.length - 1 : menu.selected - 1;
          drawMenu(menu);
          cursorToPrompt();
          return;
        }
        // Down arrow: \x1b[B
        if (c === '\x1b[B' && menu.showing) {
          menu.selected = menu.selected >= menu.matches.length - 1 ? 0 : menu.selected + 1;
          drawMenu(menu);
          cursorToPrompt();
          return;
        }
        return;
      }

      // Backspace
      if (c === '\x7f' || c === '\b') {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          redrawInput();
          updateMenu();
        }
        return;
      }

      // Ctrl+U — clear line
      if (c === '\x15') {
        buf = '';
        redrawInput();
        updateMenu();
        return;
      }

      // Ctrl+W — delete word
      if (c === '\x17') {
        buf = buf.replace(/\S+\s*$/, '');
        redrawInput();
        updateMenu();
        return;
      }

      // Regular character
      if (c.charCodeAt(0) >= 32) {
        buf += c;
        redrawInput();
        updateMenu();
      }
    }

    process.stdin.on('data', onData);
  });
}

export async function startRepl(): Promise<void> {
  await ensureTheme();
  await animateStartup();

  const session = await loadSession();
  setMemoryAccount(session?.accountKey);
  printBanner(
    VERSION,
    session?.user.email || undefined,
    session?.accountKey || undefined,
  );

  if (process.stderr.isTTY) {
    await Bun.sleep(800);
  }

  patchConsole();
  useTerminal = true;
  initTerminal(
    VERSION,
    session?.user.email || undefined,
    session?.accountKey || undefined,
  );

  console.error(dim('  Type /help for commands, /exit to quit'));
  console.error('');

  const menu: MenuState = {
    showing: false,
    matches: [],
    selected: 0,
  };

  // --- Main REPL loop ---
  cursorToPrompt();

  while (true) {
    const line = await readLine(menu);

    if (line === null) {
      exitTerminal();
      process.stderr.write(dim('  👋 See you later\n'));
      process.exit(0);
    }

    const parsed = parseInput(line);

    if (!parsed) {
      clearPromptInput();
      continue;
    }

    console.error(dim(`> ${line.trim()}`));
    clearPromptInput();

    // stdin is fully released (raw mode off, paused) — commands can use it freely
    try {
      const cmd = commands[parsed.command];
      if (cmd) {
        await cmd.run(parsed.args);
      } else {
        console.error(red(`  Unknown command: /${parsed.command}`));
        console.error(dim('  Type /help for available commands'));
      }
    } catch (err) {
      console.error(`  ${formatError(err)}`);
    }

    console.error('');
    clearPromptInput();
  }
}
