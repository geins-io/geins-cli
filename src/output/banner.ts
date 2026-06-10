import { bold, cyan, dim, blue, green } from './color.ts';

const LOGO = [
  ' ███████╗██╗   ██╗███╗   ██╗ █████╗ ██████╗ ███████╗███████╗',
  '██╔════╝╚██╗ ██╔╝████╗  ██║██╔══██╗██╔══██╗██╔════╝██╔════╝',
  '███████╗ ╚████╔╝ ██╔██╗ ██║███████║██████╔╝███████╗█████╗  ',
  '╚════██║  ╚██╔╝  ██║╚██╗██║██╔══██║██╔═══╝ ╚════██║██╔══╝  ',
  '███████║   ██║   ██║ ╚████║██║  ██║██║     ███████║███████╗',
  ' ╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝     ╚══════╝╚══════╝',
];

const GRADIENT = [cyan, cyan, blue, blue, green, green];

export function printBanner(version: string, user?: string, account?: string): void {
  const cols = Math.min(process.stderr.columns || 60, 60);
  const innerWidth = cols - 4; // padding for "│ " and " │"

  function pad(text: string, raw: string): string {
    const padding = innerWidth - raw.length;
    return padding > 0 ? text + ' '.repeat(padding) : text;
  }

  const top = `╭${'─'.repeat(cols - 2)}╮`;
  const bot = `╰${'─'.repeat(cols - 2)}╯`;
  const empty = `│${' '.repeat(cols - 2)}│`;

  const titleRaw = `✻ Welcome to Synapse v${version}`;
  const title = `${cyan('✻')} Welcome to ${bold('Synapse')} ${dim(`v${version}`)}`;

  const lines: { display: string; raw: string }[] = [
    { display: title, raw: titleRaw },
  ];

  if (user) {
    const userRaw = `  ${user}`;
    lines.push({ display: `  ${bold(user)}`, raw: userRaw });
  }

  if (account) {
    const accRaw = `  account: ${account}`;
    lines.push({ display: `  ${dim('account:')} ${dim(account)}`, raw: accRaw });
  }

  const helpRaw = '  /help for commands';
  lines.push({ display: `  ${dim('/help for commands')}`, raw: helpRaw });

  console.error('');
  for (let i = 0; i < LOGO.length; i++) {
    console.error(GRADIENT[i]!(LOGO[i]!));
  }
  console.error('');
  console.error(dim(top));
  console.error(dim(empty));
  for (const line of lines) {
    console.error(`${dim('│')} ${pad(line.display, line.raw)} ${dim('│')}`);
  }
  console.error(dim(empty));
  console.error(dim(bot));
  console.error('');
}

export async function animateStartup(): Promise<void> {
  if (!process.stderr.isTTY) return;

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'];
  for (const frame of frames) {
    process.stderr.write(`\r  ${cyan(frame)} ${dim('Connecting...')}`);
    await Bun.sleep(50);
  }
  process.stderr.write('\r\x1b[K');
}
