const enabled = !process.env['NO_COLOR'] && process.stdout.isTTY;

let theme: 'dark' | 'light' = 'dark';

export function setTheme(t: 'dark' | 'light'): void {
  theme = t;
}

export function getTheme(): 'dark' | 'light' {
  return theme;
}

function wrap(darkCode: string, lightCode: string, reset: string) {
  return (text: string) => {
    if (!enabled) return text;
    const code = theme === 'dark' ? darkCode : lightCode;
    return `\x1b[${code}m${text}\x1b[${reset}m`;
  };
}

export const bold = wrap('1', '1', '22');
export const dim = wrap('2', '2', '22');
export const red = wrap('91', '31', '39');
export const green = wrap('92', '32', '39');
export const yellow = wrap('93', '33', '39');
export const blue = wrap('94', '34', '39');
export const cyan = wrap('96', '36', '39');
export const gray = wrap('37', '90', '39');
