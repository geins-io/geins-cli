// Ambient AbortSignal for the in-flight interactive operation.
//
// The TUI runs one command at a time. Rather than thread an AbortSignal through every
// command/API function, the TUI registers a signal here before running a command and
// clears it after. fetch-based API calls and the copilot subprocess read it, so a single
// Ctrl-C can cancel whatever is in flight. In non-interactive (direct CLI) use nothing
// registers a signal, so this is a no-op.

let activeSignal: AbortSignal | undefined;

/** Register (or clear, with undefined) the signal for the current operation. */
export function setActiveSignal(signal: AbortSignal | undefined): void {
  activeSignal = signal;
}

/** The current operation's signal, if any — pass to fetch as `signal`. */
export function getActiveSignal(): AbortSignal | undefined {
  return activeSignal;
}

/** True once the current operation has been cancelled. */
export function isAborted(): boolean {
  return activeSignal?.aborted ?? false;
}
