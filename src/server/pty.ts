// Minimal PTY support built directly on node-pty's NATIVE binding.
//
// Why not node-pty's JS API: under Bun, its UnixTerminal wraps the PTY master
// fd in a net.Socket, which never delivers data (Bun can't adopt a raw fd into
// a Socket). The native binding itself works fine, so we fork through it and do
// the fd I/O ourselves: fs.read with a short EAGAIN backoff (the master fd is
// non-blocking), fs.write for input, native.resize for SIGWINCH.
//
// This powers `geins serve`'s /tty endpoint — the desktop app runs the real
// Ink TUI inside this PTY and renders it with xterm.js, so desktop == terminal.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { resolvePtyAssets } from './pty-assets.ts';

export interface PtySpawnOptions {
  /** argv[0] is the executable; the rest are its arguments. */
  argv: string[];
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
  onData: (chunk: Uint8Array) => void;
  onExit: (exitCode: number) => void;
}

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface NativeBinding {
  fork(
    file: string, args: string[], env: string[], cwd: string,
    cols: number, rows: number, uid: number, gid: number,
    utf8: boolean, helperPath: string,
    onexit: (code: number, signal: number) => void,
  ): { fd: number; pid: number; pty: string };
  resize(fd: number, cols: number, rows: number): void;
}

let loaded: { native: NativeBinding; helperPath: string } | null | undefined;

/**
 * Mark the PTY master fd close-on-exec. node-pty doesn't, and `bun --watch`
 * (the desktop dev backend) restarts serve via exec — a non-CLOEXEC master
 * would survive the exec, leaving the old TUI running with no one reading it.
 * With CLOEXEC the exec closes the master, the kernel HUPs the TUI's session,
 * and nothing leaks. Best-effort: on failure the leak is bounded (all masters
 * close when the process finally exits).
 */
function setCloexec(fd: number): void {
  try {
    const { dlopen, suffix } = require('bun:ffi') as typeof import('bun:ffi');
    const libc = process.platform === 'darwin' ? 'libSystem.B.dylib' : `libc.${suffix}.6`;
    const { symbols } = dlopen(libc, {
      fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
    });
    symbols.fcntl(fd, 2 /* F_SETFD */, 1 /* FD_CLOEXEC */);
  } catch {
    /* non-fatal */
  }
}

async function loadNative(): Promise<{ native: NativeBinding; helperPath: string } | null> {
  if (loaded !== undefined) return loaded;
  if (process.platform === 'win32') return (loaded = null); // conpty not wired up yet
  const assets = await resolvePtyAssets();
  if (!assets) return (loaded = null);
  try {
    const native = createRequire(import.meta.url)(assets.ptyPath) as NativeBinding;
    loaded = { native, helperPath: assets.helperPath };
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Whether this platform/build can spawn a PTY (drives the desktop shell's UI choice). */
export async function ptyAvailable(): Promise<boolean> {
  return (await loadNative()) !== null;
}

export async function spawnPty(opts: PtySpawnOptions): Promise<PtyProcess | null> {
  const lib = await loadNative();
  if (!lib) return null;
  const { native, helperPath } = lib;

  const [file, ...args] = opts.argv;
  if (!file) throw new Error('spawnPty: empty argv');
  const envPairs = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);

  let exited = false;
  let exitCode = 0;
  let finished = false;
  const term = native.fork(
    file, args, envPairs, opts.cwd,
    Math.max(2, opts.cols | 0), Math.max(2, opts.rows | 0),
    -1, -1, true, helperPath,
    (code) => { exited = true; exitCode = code; },
  );
  setCloexec(term.fd);

  const finish = () => {
    if (finished) return;
    finished = true;
    try { fs.closeSync(term.fd); } catch { /* already closed */ }
    opts.onExit(exitCode);
  };

  // Pump the master fd. EAGAIN = no data right now; EIO/EOF = slave side gone.
  // After the child exits we keep reading until the buffer drains (EAGAIN).
  const buf = Buffer.alloc(64 * 1024);
  const readLoop = (): void => {
    if (finished) return;
    fs.read(term.fd, buf, 0, buf.length, null, (err, n) => {
      if (finished) return;
      if (err) {
        if (err.code === 'EAGAIN' && !exited) { setTimeout(readLoop, 8); return; }
        finish(); // EAGAIN-after-exit (drained) or EIO — either way we're done
        return;
      }
      if (n > 0) opts.onData(Uint8Array.from(buf.subarray(0, n)));
      if (n === 0) { finish(); return; }
      setImmediate(readLoop);
    });
  };
  readLoop();

  return {
    pid: term.pid,
    write(data: string) {
      if (finished) return;
      try { fs.writeSync(term.fd, data); } catch { /* racing exit */ }
    },
    resize(cols: number, rows: number) {
      if (finished) return;
      try { native.resize(term.fd, Math.max(2, cols | 0), Math.max(2, rows | 0)); } catch { /* racing exit */ }
    },
    kill() {
      // SIGHUP is what a closing terminal sends; escalate if the TUI ignores it.
      try { process.kill(term.pid, 'SIGHUP'); } catch { return; }
      const escalate = setTimeout(() => {
        try { process.kill(term.pid, 'SIGKILL'); } catch { /* already gone */ }
      }, 1500);
      escalate.unref?.();
    },
  };
}
