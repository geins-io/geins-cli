import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.tsx';
import { loadConfig } from './config/store.ts';
import { request } from './api/client.ts';
import { loadSession } from './auth/session.ts';
import { formatError, exitWithError, notLoggedIn } from './api/errors.ts';
import { getApiUrl } from './config/env.ts';

const VERSION = '0.1.0';

export async function run(argv: string[]): Promise<void> {
  const args = argv.slice(2);

  // Direct mode — no TUI
  if (args.length > 0) {
    await runDirect(args);
    return;
  }

  // Interactive TUI mode requires a TTY
  if (!process.stdin.isTTY) {
    console.error('Interactive mode requires a terminal. Run geins --help for usage.');
    process.exit(1);
  }

  const app = render(React.createElement(App, { version: VERSION }), {
    exitOnCtrlC: true,
  });

  await app.waitUntilExit();
}

async function runDirect(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === 'help') {
    console.log(`geins v${VERSION}`);
    console.log('CLI for Geins Commerce Backend\n');
    console.log('Usage: geins <command> [args] [flags]');
    console.log('       geins (interactive mode)\n');
    console.log('Commands:');
    console.log('  login     Authenticate with Geins Management API');
    console.log('  logout    Clear stored credentials');
    console.log('  whoami    Show current user and account');
    console.log('  api       Raw API request');
    console.log('  ping      Check service health\n');
    console.log('Global flags:');
    console.log('  --json      Force JSON output');
    console.log('  --help      Show help');
    console.log('  --version   Show version');
    return;
  }

  if (args[0] === '--version' || args[0] === 'version') {
    console.log(VERSION);
    return;
  }

  const commandName = args[0]!;
  const commandArgs = args.slice(1);

  if (commandArgs.includes('--help')) {
    console.log(`${commandName} — CLI command`);
    return;
  }

  try {
    switch (commandName) {
      case 'whoami': {
        const session = await loadSession();
        if (!session) notLoggedIn();
        console.log(`${session.user.name} <${session.user.email}>`);
        if (session.accountKey) {
          const label = session.accountName
            ? `${session.accountName} (${session.accountKey})`
            : session.accountKey;
          console.log(`Account: ${label}`);
        }
        if (session.user.roles.length > 0) console.log(`Roles: ${session.user.roles.join(', ')}`);
        break;
      }
      case 'api': {
        const method = commandArgs[0]?.toUpperCase() ?? 'GET';
        const path = commandArgs[1];
        if (!path) {
          console.error('Usage: geins api <METHOD> <path>');
          process.exit(1);
        }
        let body: unknown;
        const bodyIdx = commandArgs.indexOf('--body');
        if (bodyIdx !== -1 && commandArgs[bodyIdx + 1]) {
          body = JSON.parse(commandArgs[bodyIdx + 1]!);
        }
        const apiPath = path.startsWith('/') ? path : `/${path}`;
        const data = await request(apiPath, { method, body });
        console.log(JSON.stringify(data, null, 2));
        break;
      }
      case 'ping': {
        const services = commandArgs.length > 0 ? commandArgs : ['auth', 'account', 'order', 'product'];
        for (const svc of services) {
          const start = Date.now();
          try {
            const res = await fetch(`${getApiUrl()}/${svc}/ping`);
            const ms = Date.now() - start;
            console.log(res.ok ? `✓ ${svc} ${ms}ms` : `✗ ${svc} ${res.status} ${ms}ms`);
          } catch {
            console.log(`✗ ${svc} unreachable ${Date.now() - start}ms`);
          }
        }
        break;
      }
      default:
        console.error(`Unknown command: ${commandName}. Run geins --help for usage.`);
        process.exit(1);
    }
  } catch (err) {
    exitWithError(err);
  }
}
