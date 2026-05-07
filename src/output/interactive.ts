import * as readline from 'node:readline';
import { dim, cyan, bold, gray } from './color.ts';
import { printToOutput, clearPromptInput, isTerminalActive, drawMenuOverlay, clearMenuOverlay, cursorToPrompt, getVisibleRows } from './terminal.ts';

// --- Raw stdin reader for TUI mode ---

function rawLineRead(opts?: { secret?: boolean }): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    const wasRaw = process.stdin.isRaw;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const onData = (ch: string) => {
      const c = ch.toString();

      // Enter
      if (c === '\r' || c === '\n') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(wasRaw ?? false);
        resolve(buf.trim());
        return;
      }

      // Ctrl+C — cancel
      if (c === '\x03') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(wasRaw ?? false);
        resolve('');
        return;
      }

      // Backspace
      if (c === '\x7f' || c === '\b') {
        buf = buf.slice(0, -1);
      } else if (c.charCodeAt(0) >= 32) {
        buf += c;
      }

      // Redraw prompt with current input
      clearPromptInput();
      if (opts?.secret) {
        process.stderr.write('•'.repeat(buf.length));
      } else {
        process.stderr.write(buf);
      }
    };

    process.stdin.on('data', onData);
  });
}

// --- Prompt (single-line text input) ---

export async function prompt(message: string): Promise<string> {
  if (isTerminalActive()) {
    printToOutput(`  ${message}`);
    clearPromptInput();
    return rawLineRead();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Secret prompt (masked input) ---

export async function promptSecret(message: string): Promise<string> {
  if (isTerminalActive()) {
    printToOutput(`  ${message}`);
    clearPromptInput();
    return rawLineRead({ secret: true });
  }

  process.stderr.write(`${message} `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  return new Promise((resolve) => {
    let input = '';
    const onData = (ch: string) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r' || c === '\x04') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(input);
      } else if (c === '\x03') {
        process.stdin.setRawMode(false);
        process.exit(130);
      } else if (c === '\x7f' || c === '\b') {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

// --- Choice prompt ---

export async function promptChoice(message: string, choices: { label: string; value: string }[]): Promise<string> {
  if (isTerminalActive()) {
    return tuiChoice(message, choices);
  }

  console.error(message);
  for (let i = 0; i < choices.length; i++) {
    console.error(`  ${dim(`${i + 1}.`)} ${choices[i]!.label}`);
  }

  const answer = await prompt(`Select [1]:`);
  const index = answer === '' ? 0 : parseInt(answer, 10) - 1;

  if (index < 0 || index >= choices.length) {
    console.error(dim('  Invalid selection, using first option.'));
    return choices[0]!.value;
  }

  return choices[index]!.value;
}

function tuiChoice(message: string, choices: { label: string; value: string }[]): Promise<string> {
  return new Promise((resolve) => {
    let selected = 0;
    let filter = '';
    let filtered = choices.map((c, i) => ({ ...c, idx: i }));

    const maxVisible = Math.min(getVisibleRows() - 4, 20);
    const selBg = '\x1b[48;5;238m';
    const rst = '\x1b[0m';

    function applyFilter() {
      if (!filter) {
        filtered = choices.map((c, i) => ({ ...c, idx: i }));
      } else {
        const q = filter.toLowerCase();
        filtered = choices
          .map((c, i) => ({ ...c, idx: i }))
          .filter((c) => c.label.toLowerCase().includes(q));
      }
      selected = Math.min(selected, Math.max(0, filtered.length - 1));
    }

    function render() {
      const total = filtered.length;
      if (total === 0) {
        drawMenuOverlay([`  ${dim('No matches')}`]);
        return;
      }

      // Scroll window around selected
      let scrollStart = 0;
      if (total > maxVisible) {
        scrollStart = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), total - maxVisible));
      }
      const visibleSlice = filtered.slice(scrollStart, scrollStart + maxVisible);

      const lines: string[] = [];

      // Header
      const filterHint = filter ? `  ${dim(`filter: "${filter}"`)}` : '';
      lines.push(` ${bold(message)}${filterHint}  ${dim(`${total} item${total !== 1 ? 's' : ''}`)}`);

      for (let i = 0; i < visibleSlice.length; i++) {
        const item = visibleSlice[i]!;
        const globalIdx = scrollStart + i;
        const isSel = globalIdx === selected;
        const prefix = isSel ? cyan('▸') : ' ';
        const label = isSel ? bold(cyan(item.label)) : gray(item.label);
        const content = ` ${prefix} ${label}`;
        lines.push(isSel ? `${selBg}${content}${rst}` : content);
      }

      // Scroll indicators
      if (total > maxVisible) {
        const pos = Math.round((selected / (total - 1)) * 100);
        lines.push(` ${dim(`↑↓ navigate · ${pos}%`)}`);
      }

      drawMenuOverlay(lines);
      cursorToPrompt();
    }

    function finish(value: string) {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      clearMenuOverlay();
      resolve(value);
    }

    function onData(ch: string) {
      const c = ch.toString();

      // Enter — accept
      if (c === '\r' || c === '\n') {
        if (filtered.length > 0) {
          finish(filtered[selected]!.value);
        }
        return;
      }

      // Ctrl+C — cancel, use first
      if (c === '\x03') {
        finish(choices[0]!.value);
        return;
      }

      // Up arrow
      if (c === '\x1b[A') {
        selected = selected <= 0 ? filtered.length - 1 : selected - 1;
        render();
        return;
      }

      // Down arrow
      if (c === '\x1b[B') {
        selected = selected >= filtered.length - 1 ? 0 : selected + 1;
        render();
        return;
      }

      // Backspace — edit filter
      if (c === '\x7f' || c === '\b') {
        if (filter.length > 0) {
          filter = filter.slice(0, -1);
          applyFilter();
          render();
        }
        return;
      }

      // Ctrl+U — clear filter
      if (c === '\x15') {
        filter = '';
        applyFilter();
        render();
        return;
      }

      // Escape sequences (ignore others)
      if (c === '\x1b' || (c.startsWith('\x1b') && c !== '\x1b[A' && c !== '\x1b[B')) {
        return;
      }

      // Tab — ignore
      if (c === '\t') return;

      // Printable character — type-to-filter
      if (c.charCodeAt(0) >= 32) {
        filter += c;
        applyFilter();
        render();
      }
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', onData);

    printToOutput('');
    render();
  });
}

// --- Spinner ---

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinner(message: string): { stop: (finalMessage?: string) => void } {
  if (isTerminalActive()) {
    // In TUI mode, show a single line — no animation (scroll region can't update in-place)
    printToOutput(`  ${dim('⠿')} ${dim(message)}`);

    return {
      stop(finalMessage?: string) {
        if (finalMessage) printToOutput(finalMessage);
      },
    };
  }

  let i = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${message}`);
  }, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      process.stderr.write('\r\x1b[K');
      if (finalMessage) {
        console.error(finalMessage);
      }
    },
  };
}
