// Terminal window/tab title (OSC 0). Out-of-band, so it doesn't disturb Ink's rendering.
// The "base" title is what shows at rest; `setWorking(true)` appends a suffix while a copilot
// request is in flight so the user can tell the agent is busy from the tab alone.

let baseTitle = 'Synapse';

function write(title: string): void {
  if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${title}\x07`);
}

/** Set the resting window title and display it. */
export function setBaseTitle(title: string): void {
  baseTitle = title;
  write(title);
}

/** Toggle the "working..." suffix on the current base title (e.g. during a copilot run). */
export function setWorking(working: boolean): void {
  write(working ? `${baseTitle} - working...` : baseTitle);
}
