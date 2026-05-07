import { bold, cyan, dim, green, red, gray, blue } from './color.ts';

const ESC = '\x1b';

// --- Terminal state ---
let rows = 0;
let cols = 0;
let initialized = false;

const HEADER_LINES = 3;  // top border + status bar + bottom border
const FOOTER_LINES = 3;  // separator + hints + prompt

let scrollTop = HEADER_LINES + 1;
let scrollBottom = 0;

// Status bar state
let statusUser = '';
let statusAccount = '';
let statusVersion = '';
let statusConnected = false;

// --- Low-level terminal ops ---

function write(s: string): void {
  process.stderr.write(s);
}

function moveTo(row: number, col: number): void {
  write(`${ESC}[${row};${col}H`);
}

function setScrollRegion(top: number, bottom: number): void {
  write(`${ESC}[${top};${bottom}r`);
}

function clearLine(): void {
  write(`${ESC}[2K`);
}

function clearScreen(): void {
  write(`${ESC}[2J`);
}

function saveCursor(): void { write(`${ESC}7`); }
function restoreCursor(): void { write(`${ESC}8`); }
function hideCursor(): void { write(`${ESC}[?25l`); }
function showCursor(): void { write(`${ESC}[?25h`); }

// Background/foreground helpers
function bg(code: number): string { return `${ESC}[48;5;${code}m`; }
function fg(code: number): string { return `${ESC}[38;5;${code}m`; }
function reset(): string { return `${ESC}[0m`; }

// --- Layout rendering ---

function calculateLayout(): void {
  rows = process.stderr.rows || 24;
  cols = process.stderr.columns || 80;
  scrollTop = HEADER_LINES + 1;
  scrollBottom = rows - FOOTER_LINES;
}

function drawHeader(): void {
  saveCursor();
  hideCursor();

  const barBg = bg(236); // dark gray background
  const barFg = fg(252); // light text
  const accentFg = fg(81); // cyan accent
  const mutedFg = fg(245); // muted text
  const sepFg = fg(240); // separator color

  // Top border
  moveTo(1, 1);
  clearLine();
  write(`${fg(240)}╭${'─'.repeat(cols - 2)}╮${reset()}`);

  // Status bar content on row 2
  moveTo(2, 1);
  clearLine();

  const sep = `${sepFg}│${reset()}${barBg}`;

  let content = `${barBg}${fg(240)}│${reset()}`;
  content += `${barBg} ${accentFg}✻${reset()}${barBg} ${barFg}${ESC}[1mgeins${reset()}${barBg} ${mutedFg}v${statusVersion}${reset()}${barBg}`;

  if (statusUser) {
    content += ` ${sep} ${barFg}${ESC}[1m${statusUser}${reset()}${barBg}`;
  }

  if (statusAccount) {
    content += ` ${sep} ${mutedFg}${statusAccount}${reset()}${barBg}`;
  }

  const statusDot = statusConnected
    ? `${fg(78)}●${reset()}${barBg} ${mutedFg}connected${reset()}`
    : `${fg(203)}●${reset()}${barBg} ${fg(203)}disconnected${reset()}`;
  content += ` ${sep} ${barBg}${statusDot}${barBg}`;

  // Calculate raw length and pad
  const rawContent = stripAnsi(content);
  const pad = cols - rawContent.length - 1; // -1 for closing border
  if (pad > 0) {
    content += ' '.repeat(pad);
  }
  content += `${reset()}${fg(240)}│${reset()}`;

  write(content);

  // Bottom border
  moveTo(3, 1);
  clearLine();
  write(`${fg(240)}╰${'─'.repeat(cols - 2)}╯${reset()}`);

  restoreCursor();
  showCursor();
}

function drawFooter(): void {
  saveCursor();
  hideCursor();

  const sepRow = rows - 2;
  const hintsRow = rows - 1;
  const promptRow = rows;

  // Separator
  moveTo(sepRow, 1);
  clearLine();
  write(`${fg(240)}${'─'.repeat(cols)}${reset()}`);

  // Hints row
  moveTo(hintsRow, 1);
  clearLine();

  const hints = [
    `${fg(81)}/${reset()} ${fg(245)}commands${reset()}`,
    `${fg(81)}tab${reset()} ${fg(245)}complete${reset()}`,
    `${fg(81)}↑↓${reset()} ${fg(245)}navigate${reset()}`,
    `${fg(81)}ctrl+c${reset()} ${fg(245)}exit${reset()}`,
  ];
  write(` ${hints.join(`  ${fg(240)}·${reset()}  `)}`);

  // Prompt
  moveTo(promptRow, 1);
  clearLine();
  write(`${cyan('❯')} `);

  restoreCursor();
  showCursor();
}

function drawFull(): void {
  clearScreen();
  calculateLayout();
  setScrollRegion(scrollTop, scrollBottom);
  drawHeader();
  drawFooter();
  cursorToPrompt();
}

// --- Public API ---

export function isTerminalActive(): boolean {
  return initialized;
}

export function getVisibleRows(): number {
  return scrollBottom - scrollTop + 1;
}

export function initTerminal(version: string, user?: string, account?: string): void {
  if (initialized) return;
  initialized = true;

  statusVersion = version;
  statusUser = user ?? '';
  statusAccount = account ?? '';
  statusConnected = true;

  calculateLayout();

  // Enter alternate screen
  write(`${ESC}[?1049h`);

  drawFull();

  // Handle resize
  process.stderr.on('resize', () => {
    calculateLayout();
    setScrollRegion(scrollTop, scrollBottom);
    drawHeader();
    drawFooter();
    cursorToPrompt();
  });
}

export function exitTerminal(): void {
  if (!initialized) return;
  setScrollRegion(1, rows);
  showCursor();
  // Leave alternate screen
  write(`${ESC}[?1049l`);
  initialized = false;
}

export function printToOutput(text: string): void {
  if (!initialized) {
    process.stderr.write(text + '\n');
    return;
  }

  saveCursor();
  hideCursor();

  const lines = text.split('\n');
  for (const line of lines) {
    moveTo(scrollBottom, 1);
    write('\n');
    clearLine();
    const stripped = stripAnsi(line);
    if (stripped.length > cols) {
      write(line.substring(0, cols));
    } else {
      write(line);
    }
  }

  restoreCursor();
  showCursor();
}

export function cursorToPrompt(): void {
  moveTo(rows, 3);
  showCursor();
}

export function clearPromptInput(): void {
  moveTo(rows, 1);
  clearLine();
  write(`${cyan('❯')} `);
}

export function clearContent(): void {
  if (!initialized) return;
  drawFull();
}

export function setConnectionStatus(connected: boolean): void {
  statusConnected = connected;
  if (initialized) drawHeader();
}

export function updateStatus(user?: string, account?: string): void {
  if (user !== undefined) statusUser = user;
  if (account !== undefined) statusAccount = account;
  if (initialized) drawHeader();
}

// --- Menu overlay ---

let menuLines = 0;

export function drawMenuOverlay(lines: string[]): void {
  if (!initialized) return;
  clearMenuOverlay();

  saveCursor();
  hideCursor();

  const count = lines.length;
  const totalHeight = count + 2; // top border + items + bottom border
  menuLines = totalHeight;
  const startRow = rows - FOOTER_LINES - totalHeight;

  // Find max line width for the box
  const maxRaw = Math.max(...lines.map((l) => stripAnsi(l).length));
  const boxWidth = Math.min(maxRaw + 4, cols - 4); // padding + border

  // Top border
  moveTo(startRow, 2);
  write(`${fg(240)}╭${'─'.repeat(boxWidth)}╮${reset()}`);

  // Menu items
  for (let i = 0; i < count; i++) {
    moveTo(startRow + 1 + i, 2);
    clearLine();
    const rawLen = stripAnsi(lines[i]!).length;
    const itemPad = boxWidth - rawLen;
    write(`${fg(240)}│${reset()}${lines[i]}${itemPad > 0 ? ' '.repeat(itemPad) : ''}${fg(240)}│${reset()}`);
  }

  // Bottom border
  moveTo(startRow + 1 + count, 2);
  write(`${fg(240)}╰${'─'.repeat(boxWidth)}╯${reset()}`);

  restoreCursor();
  showCursor();
}

export function clearMenuOverlay(): void {
  if (!initialized || menuLines === 0) return;

  saveCursor();
  hideCursor();

  const startRow = rows - FOOTER_LINES - menuLines;
  for (let i = 0; i < menuLines; i++) {
    moveTo(startRow + i, 1);
    clearLine();
  }
  menuLines = 0;

  restoreCursor();
  showCursor();
}

// --- Helpers ---

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[\?[0-9]*[hl]/g, '').replace(/\x1b[78]/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}
