#!/usr/bin/env bun
import { loadSession, parseJwtExp } from './auth/session.ts';
import { loadConfig, saveConfig, saveSession, clearSession } from './config/store.ts';
import { login, verify, fetchUser, type AuthResponse } from './auth/login.ts';
import { request } from './api/client.ts';
import { getApiUrl } from './config/env.ts';

const PORT = 3100;

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Geins CLI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d1117;
      color: #c9d1d9;
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      font-size: 14px;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #output {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #output .dim { color: #484f58; }
    #output .cyan { color: #58a6ff; }
    #output .green { color: #3fb950; }
    #output .red { color: #f85149; }
    #output .yellow { color: #d29922; }
    #output .bold { font-weight: 700; }
    #output .logo { color: #58a6ff; }
    #output .logo-green { color: #3fb950; }
    #input-bar {
      border-top: 1px solid #21262d;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      background: #161b22;
    }
    #input-bar .prompt { color: #58a6ff; font-weight: 700; }
    #input-bar input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #c9d1d9;
      font-family: inherit;
      font-size: 14px;
    }
    #input-bar .hint { color: #484f58; font-size: 12px; }
    .line { min-height: 1.4em; }
  </style>
</head>
<body>
  <div id="output"></div>
  <div id="input-bar">
    <span class="prompt">&#10095;</span>
    <input id="cmd" type="text" placeholder="Type /help for commands..." autofocus autocomplete="off" spellcheck="false">
    <span class="hint">enter to send</span>
  </div>
  <script>
    const output = document.getElementById('output');
    const cmd = document.getElementById('cmd');
    let ws;

    function connect() {
      ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'clear') { output.innerHTML = ''; return; }
        const div = document.createElement('div');
        div.className = 'line';
        if (msg.html) { div.innerHTML = msg.html; }
        else { div.textContent = msg.text || ''; }
        output.appendChild(div);
        output.scrollTop = output.scrollHeight;
      };
      ws.onclose = () => setTimeout(connect, 1000);
    }
    connect();

    cmd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && cmd.value.trim()) {
        ws.send(JSON.stringify({ type: 'command', text: cmd.value }));
        cmd.value = '';
      }
    });
  </script>
</body>
</html>`;

function span(text: string, cls: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!cls) return esc;
  return '<span class="' + cls + '">' + esc + '</span>';
}

interface WSSend {
  send(data: string): void;
}

function sendText(ws: WSSend, text: string) {
  ws.send(JSON.stringify({ text }));
}

function sendHtml(ws: WSSend, markup: string) {
  ws.send(JSON.stringify({ html: markup }));
}

function sendClear(ws: WSSend) {
  ws.send(JSON.stringify({ type: 'clear' }));
}

async function handleCommand(input: string, ws: WSSend) {
  const trimmed = input.trim();
  if (!trimmed) return;

  const line = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const parts = line.match(/(?:[^\s"]+|"[^"]*")/g) ?? [];
  if (parts.length === 0) return;

  const command = parts[0]!.toLowerCase();
  const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''));

  sendHtml(ws, span('  > ' + trimmed, 'dim'));

  try {
    switch (command) {
      case 'help':
        sendText(ws, '');
        sendHtml(ws, '  ' + span('Commands', 'bold'));
        sendText(ws, '');
        sendText(ws, '  /help     Show available commands');
        sendText(ws, '  /login    Authenticate with Geins');
        sendText(ws, '  /logout   Clear credentials');
        sendText(ws, '  /whoami   Show current user');
        sendText(ws, '  /api      Raw API request          /api GET /products');
        sendText(ws, '  /ping     Check service health      /ping [service...]');
        sendText(ws, '  /theme    Switch dark/light mode');
        sendText(ws, '  /clear    Clear the screen');
        sendText(ws, '');
        break;

      case 'login':
        sendHtml(ws, span('  Login flow not available in browser mode. Use the terminal CLI.', 'yellow'));
        break;

      case 'logout':
        await clearSession();
        sendHtml(ws, span('  ✓ Logged out.', 'green'));
        break;

      case 'whoami': {
        const session = await loadSession();
        if (!session) {
          sendHtml(ws, span('  Not logged in. Run /login in the terminal CLI.', 'yellow'));
          break;
        }
        sendHtml(ws, '  ' + span(session.user.name, 'bold') + ' &lt;' + session.user.email + '&gt;');
        if (session.accountKey) sendText(ws, '  Account: ' + session.accountKey);
        if (session.user.roles.length > 0) sendText(ws, '  Roles: ' + session.user.roles.join(', '));
        break;
      }

      case 'api': {
        const method = args[0]?.toUpperCase() ?? 'GET';
        const path = args[1];
        if (!path) {
          sendText(ws, '  Usage: /api <METHOD> <path>');
          break;
        }
        const bodyIdx = args.indexOf('--body');
        let body: unknown;
        if (bodyIdx !== -1 && args[bodyIdx + 1]) {
          try { body = JSON.parse(args[bodyIdx + 1]!); } catch {
            sendHtml(ws, span('  Invalid JSON in --body', 'red'));
            break;
          }
        }
        sendHtml(ws, span('  ⣿ Requesting ' + method + ' ' + path + '...', 'dim'));
        const apiPath = path.startsWith('/') ? path : '/' + path;
        const data = await request(apiPath, { method, body });
        sendText(ws, '  ' + JSON.stringify(data, null, 2));
        break;
      }

      case 'ping': {
        const services = args.length > 0 ? args : ['auth', 'account', 'order', 'product'];
        for (const svc of services) {
          const start = Date.now();
          try {
            const res = await fetch(getApiUrl() + '/' + svc + '/ping');
            const ms = Date.now() - start;
            if (res.ok) {
              sendHtml(ws, span('  ✓ ' + svc + ' ' + ms + 'ms', 'green'));
            } else {
              sendHtml(ws, span('  ✗ ' + svc + ' ' + res.status + ' ' + ms + 'ms', 'red'));
            }
          } catch {
            sendHtml(ws, span('  ✗ ' + svc + ' unreachable ' + (Date.now() - start) + 'ms', 'red'));
          }
        }
        break;
      }

      case 'theme': {
        const config = await loadConfig();
        const newTheme = config.theme === 'dark' ? 'light' : 'dark';
        config.theme = newTheme;
        await saveConfig(config);
        sendHtml(ws, span('  ✓ Switched to ' + newTheme + ' mode', 'green'));
        break;
      }

      case 'clear':
        sendClear(ws);
        break;

      default:
        sendHtml(ws, span('  Unknown command: /' + command, 'red'));
        sendHtml(ws, span('  Type /help for available commands', 'dim'));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendHtml(ws, span('  ' + msg, 'red'));
  }
}

const LOGO_LINES = [
  '██████╗ ███████╗██╗███╗   ██╗███████╗',
  '██╔════╝ ██╔════╝██║████╗  ██║██╔════╝',
  '██║  ███╗█████╗  ██║██╔██╗ ██║███████╗',
  '██║   ██║██╔══╝  ██║██║╚██╗██║╚════██║',
  '╚██████╔╝███████╗██║██║ ╚████║███████║',
  ' ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝╚══════╝',
];

async function sendWelcome(ws: WSSend) {
  const session = await loadSession();
  sendText(ws, '');
  for (let i = 0; i < LOGO_LINES.length; i++) {
    const cls = i < 4 ? 'logo' : 'logo-green';
    sendHtml(ws, '<span class="' + cls + '">  ' + LOGO_LINES[i] + '</span>');
  }
  sendText(ws, '');
  let info = '  ' + span('✻', 'cyan') + ' ' + span('Geins CLI', 'bold') + ' ' + span('v0.1.0', 'dim');
  if (session) {
    info += ' ' + span('·', 'dim') + ' ' + session.user.email;
    if (session.accountKey) info += ' ' + span('·', 'dim') + ' ' + span(session.accountKey, 'dim');
  }
  sendHtml(ws, info);
  sendHtml(ws, span('  Type /help for commands', 'dim'));
  sendText(ws, '');
}

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }
    return new Response(HTML, { headers: { 'Content-Type': 'text/html' } });
  },
  websocket: {
    open(ws) {
      void sendWelcome(ws);
    },
    message(ws, message) {
      try {
        const msg = JSON.parse(String(message));
        if (msg.type === 'command') {
          void handleCommand(msg.text, ws);
        }
      } catch {}
    },
  },
});

console.log('Geins CLI browser view: http://localhost:' + PORT);
