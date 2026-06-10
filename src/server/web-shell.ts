// The desktop web shell, served by `geins serve` and loaded by the Tauri webview.
// Kept as a single self-contained HTML string (inline CSS+JS, xterm.js inlined
// from node_modules at bundle time) so it compiles reliably into the
// `bun build --compile` binary with no asset pipeline.
//
// Primary mode — TERMINAL: a fullscreen xterm.js connected to the server's /tty
// endpoint, which runs the real Ink TUI in a PTY. The desktop app therefore
// works and looks EXACTLY like running `geins` in a terminal (logo, login flow,
// copilot/command modes, keybindings — same bytes, same renderer).
//
// Fallback — LEGACY SHELL: the previous HTML login + command/copilot REPL, used
// only when the server reports `tty: false` (Windows, where PTY support isn't
// wired up yet).
import { PROMPT, WORDMARK } from '../ui/logos.ts';
import XTERM_JS from '@xterm/xterm/lib/xterm.js' with { type: 'text' };
import FIT_JS from '@xterm/addon-fit/lib/addon-fit.js' with { type: 'text' };
import XTERM_CSS from '@xterm/xterm/css/xterm.css' with { type: 'text' };

// Compose the banner exactly like Welcome.tsx: PROMPT ("❯_") + the SYNAPSE wordmark.
const LOGO_LINES = WORDMARK.map((line, i) => `${PROMPT[i] ?? ''}${line}`).join('\n');

// A literal `</script>` inside the inlined libraries would terminate the HTML
// <script> tag early; escape it (no-op inside JS strings).
const escapeScript = (src: string) => String(src).replace(/<\/script/g, '<\\/script');

export const WEB_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Synapse</title>
<style>
${XTERM_CSS}
</style>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #0b0e14; color: #d6deeb;
  }
  /* --- Terminal mode (primary): fullscreen xterm --- */
  #term { position: fixed; inset: 0; padding: 8px 0 4px 10px; background: #0b0e14; }
  #term .xterm, #term .xterm-viewport { background: #0b0e14 !important; }
  /* --- Legacy shell (fallback when the server has no PTY) --- */
  header {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border-bottom: 1px solid #1c2230; background: #0e131c;
  }
  header .brand { font-weight: 700; color: #7fdbca; letter-spacing: .5px; }
  /* Mode pill mirrors the TUI: magenta = copilot, cyan = command. */
  header .mode { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid #2a3346; }
  header .mode.copilot { color: #c792ea; border-color: #4a3a5e; }
  header .mode.command { color: #7fdbca; border-color: #2a4a44; }
  header .who { margin-left: auto; color: #7e8aa3; font-size: 12px; }
  header button {
    background: #1c2230; color: #d6deeb; border: 1px solid #2a3346;
    border-radius: 5px; padding: 3px 8px; cursor: pointer; font: inherit;
  }
  header button:hover { background: #24304a; }
  #out { flex: 1; overflow-y: auto; padding: 12px 14px; white-space: pre-wrap; word-break: break-word; }
  /* Gradient logo, same cyan -> blue -> green as Welcome.tsx, left to right. */
  .logo {
    margin: 6px 0 2px; white-space: pre; line-height: 1.05; font-size: 11px;
    background: linear-gradient(90deg, #00e5ff, #3b82f6, #22c55e);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .ident { margin: 4px 0; }
  .ident .star { color: #00e5ff; }
  .ident .name { font-weight: 700; }
  .ident .dim { color: #7e8aa3; }
  .ident .api { color: #22c55e; }
  .hint { color: #7e8aa3; margin: 6px 0 2px; }
  .hint .mag { color: #c792ea; }
  .hint .cy { color: #7fdbca; }
  .line { margin: 0 0 2px; }
  .line.cmd { color: #82aaff; }
  .line.err { color: #ef5350; }
  .line.dim { color: #7e8aa3; }
  .line.tool { color: #c792ea; }
  form#bar { display: flex; gap: 8px; padding: 10px 14px 4px; border-top: 1px solid #1c2230; background: #0e131c; }
  #foot { padding: 0 14px 8px; background: #0e131c; color: #7e8aa3; font-size: 12px; }
  #foot .mag { color: #c792ea; } #foot .cy { color: #7fdbca; }
  select, input[type=text], input[type=password] {
    background: #0b0e14; color: #d6deeb; border: 1px solid #2a3346;
    border-radius: 5px; padding: 6px 8px; font: inherit;
  }
  #prompt { flex: 1; }
  #login { max-width: 360px; margin: 60px auto; display: flex; flex-direction: column; gap: 10px; }
  #login h2 { color: #7fdbca; margin: 0 0 6px; }
  #login input, #login button, #login select { width: 100%; padding: 8px; }
  #login button { background: #2a3346; color: #fff; border: none; border-radius: 5px; cursor: pointer; }
  .hidden { display: none !important; }
</style>
</head>
<body>
  <div id="term" class="hidden"></div>

  <header class="hidden" id="topbar">
    <span class="brand">synapse</span>
    <span class="mode command" id="modePill">command</span>
    <span class="who" id="who"></span>
    <button id="logout">logout</button>
  </header>

  <div id="login" class="hidden">
    <h2>Sign in</h2>
    <div id="loginMsg" class="line dim"></div>
    <div id="step-credentials">
      <input id="email" type="text" placeholder="Email" autocomplete="username" />
      <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
      <button id="doLogin">Sign in</button>
    </div>
    <div id="step-mfa" class="hidden">
      <input id="mfa" type="text" placeholder="MFA code" />
      <button id="doVerify">Verify</button>
    </div>
    <div id="step-account" class="hidden">
      <select id="account"></select>
      <button id="doAccount">Continue</button>
    </div>
  </div>

  <div id="out" class="hidden"></div>
  <form id="bar" class="hidden">
    <input id="prompt" type="text" placeholder="Type a command, or shift+tab for copilot…" autocomplete="off" />
    <button type="submit">Send</button>
  </form>
  <div id="foot" class="hidden"></div>

<script>
${escapeScript(XTERM_JS)}
</script>
<script>
${escapeScript(FIT_JS)}
</script>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var token = q.get('token') || '';
  var port = q.get('port');
  var base = port ? ('http://127.0.0.1:' + port) : location.origin;
  var wsBase = base.replace(/^http/, 'ws');
  var LOGO = ${JSON.stringify(LOGO_LINES)};

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    return fetch(base + path, opts).then(function (r) { return r.json(); });
  }

  // ========== Terminal mode: the real TUI over /tty, rendered by xterm ==========
  function initTerm() {
    var host = document.getElementById('term');
    host.classList.remove('hidden');
    var term = new Terminal({
      cursorBlink: true,
      fontFamily: "Menlo, Monaco, 'SF Mono', 'Courier New', monospace",
      fontSize: 13,
      scrollback: 10000,
      macOptionIsMeta: true,
      theme: {
        background: '#0b0e14',
        foreground: '#d6deeb',
        cursor: '#7fdbca',
        cursorAccent: '#0b0e14',
        selectionBackground: '#2a3346'
      }
    });
    var fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    term.focus();

    var ws = null, opened = false, ended = true;
    function connect() {
      ended = false; opened = false;
      term.reset();
      ws = new WebSocket(wsBase + '/tty?cols=' + term.cols + '&rows=' + term.rows + (token ? '&token=' + encodeURIComponent(token) : ''));
      ws.binaryType = 'arraybuffer';
      ws.onopen = function () { opened = true; };
      ws.onmessage = function (ev) {
        if (typeof ev.data === 'string') {
          var m = {};
          try { m = JSON.parse(ev.data); } catch (e) {}
          if (m.t === 'exit') showEnd('synapse exited' + (m.code != null ? ' (' + m.code + ')' : ''));
          else if (m.t === 'error') showEnd(m.message || 'error');
          return;
        }
        term.write(new Uint8Array(ev.data));
      };
      ws.onclose = function () {
        showEnd(opened ? 'connection closed' : 'could not reach the geins backend');
      };
    }
    function showEnd(reason) {
      if (ended) return;
      ended = true;
      term.write('\\r\\n\\x1b[2m— ' + reason + ' · press ⏎ to relaunch —\\x1b[0m\\r\\n');
    }
    term.onData(function (d) {
      if (ended) { if (d.indexOf('\\r') !== -1) connect(); return; }
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', d: d }));
    });
    term.onResize(function (s) {
      if (!ended && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'r', cols: s.cols, rows: s.rows }));
    });
    // Native file drops, forwarded by the Tauri host (window.eval) — type the paths into
    // the TUI exactly like a terminal does: backslash-escaped spaces, space-separated.
    window.__synapseDrop = function (paths) {
      if (!paths || !paths.length) return;
      var text = paths.map(function (p) { return String(p).replace(/ /g, '\\\\ '); }).join(' ') + ' ';
      if (!ended && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', d: text }));
      term.focus();
    };
    window.addEventListener('resize', function () { fit.fit(); });
    window.addEventListener('focus', function () { term.focus(); });
    connect();
  }

  // ========== Legacy shell (no PTY on this platform): login + REPL ==========
  function initLegacy() {
    var out = document.getElementById('out');
    function el(tag, cls, text) { var d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; }
    function add(text, cls) {
      var d = el('div', 'line' + (cls ? ' ' + cls : ''), text);
      out.appendChild(d); out.scrollTop = out.scrollHeight; return d;
    }

    // --- Login ---
    var loginEl = document.getElementById('login');
    loginEl.classList.remove('hidden');
    var msg = document.getElementById('loginMsg');
    var pendingId = null, loginToken = null, accounts = null;
    function show(id) {
      ['step-credentials', 'step-mfa', 'step-account'].forEach(function (s) {
        document.getElementById(s).classList.toggle('hidden', s !== id);
      });
    }
    function handleStage(res) {
      if (res.error) { msg.textContent = res.error; return; }
      if (res.stage === 'mfa') { loginToken = res.loginToken; show('step-mfa'); msg.textContent = 'MFA required (' + (res.mfaMethod || '') + ')'; return; }
      if (res.stage === 'account') {
        pendingId = res.pendingId; accounts = res.accounts;
        var sel = document.getElementById('account'); sel.innerHTML = '';
        accounts.forEach(function (a) { var o = el('option', null, a.displayName || a.accountKey); o.value = a.accountKey; sel.appendChild(o); });
        show('step-account'); msg.textContent = 'Choose an account'; return;
      }
      if (res.stage === 'done') { enterApp(); }
    }
    document.getElementById('doLogin').onclick = function () {
      msg.textContent = 'Authenticating…';
      api('/login', { method: 'POST', body: JSON.stringify({ username: document.getElementById('email').value, password: document.getElementById('password').value }) }).then(handleStage).catch(function (e) { msg.textContent = String(e); });
    };
    document.getElementById('doVerify').onclick = function () {
      msg.textContent = 'Verifying…';
      api('/login/verify', { method: 'POST', body: JSON.stringify({ loginToken: loginToken, mfaCode: document.getElementById('mfa').value }) }).then(handleStage).catch(function (e) { msg.textContent = String(e); });
    };
    document.getElementById('doAccount').onclick = function () {
      api('/login/account', { method: 'POST', body: JSON.stringify({ pendingId: pendingId, accountKey: document.getElementById('account').value }) }).then(handleStage).catch(function (e) { msg.textContent = String(e); });
    };

    // --- Mode (mirror the TUI: default command, Shift+Tab / /copilot toggles) ---
    var copilotActive = false;
    var prompt = document.getElementById('prompt');
    var pill = document.getElementById('modePill');
    var foot = document.getElementById('foot');
    function renderMode() {
      pill.textContent = copilotActive ? 'copilot' : 'command';
      pill.className = 'mode ' + (copilotActive ? 'copilot' : 'command');
      prompt.placeholder = copilotActive ? 'Ask copilot anything, shift+tab for command…' : 'Type a command, or shift+tab for copilot…';
      foot.innerHTML = copilotActive
        ? 'In <span class="mag">copilot</span> mode · <span class="mag">/copilot</span> or <span class="mag">shift+tab</span> to switch back'
        : 'Switch to <span class="mag">copilot</span> mode with <span class="cy">/copilot</span> or <span class="cy">shift+tab</span>';
    }
    function toggleMode() { copilotActive = !copilotActive; renderMode(); prompt.focus(); }

    // --- App ---
    function enterApp() {
      Promise.all([api('/session'), api('/version').catch(function () { return {}; })]).then(function (r) {
        var s = r[0], v = r[1] || {};
        loginEl.classList.add('hidden');
        document.getElementById('topbar').classList.remove('hidden');
        out.classList.remove('hidden');
        document.getElementById('bar').classList.remove('hidden');
        foot.classList.remove('hidden');

        // Gradient logo + identity line, like the TUI welcome.
        if (out.childElementCount === 0) {
          out.appendChild(el('div', 'logo', LOGO));
          var ident = el('div', 'ident line');
          var bits = ['<span class="star">✻</span> <span class="name">Synapse</span> <span class="dim">v' + (v.version || '') + '</span>'];
          if (s.loggedIn) {
            if (s.user && (s.user.email || s.user.name)) bits.push('<span class="dim">·</span> ' + (s.user.email || s.user.name));
            if (s.accountName || s.accountKey) bits.push('<span class="dim">·</span> <span class="dim">' + (s.accountName ? s.accountName + ' (' + s.accountKey + ')' : s.accountKey) + '</span>');
          }
          ident.innerHTML = bits.join(' ');
          out.appendChild(ident);
          var hint = el('div', 'hint');
          hint.innerHTML = 'ℹ Switch to <span class="mag">copilot</span> mode with <span class="cy">/copilot</span> or <span class="cy">shift+tab</span>.';
          out.appendChild(hint);
        }
        var who = (s.user && (s.user.email || s.user.name)) || '';
        document.getElementById('who').textContent = who + (s.accountName ? '  ·  ' + s.accountName : '');
        renderMode();
        prompt.focus();
      });
    }

    document.getElementById('logout').onclick = function () {
      api('/logout', { method: 'POST' }).then(function () { location.reload(); });
    };

    var ws = null;
    function ensureWs() {
      if (ws && ws.readyState === 1) return ws;
      ws = new WebSocket(wsBase + '/copilot' + (token ? '?token=' + encodeURIComponent(token) : ''));
      var current = null;
      ws.onmessage = function (ev) {
        var m = JSON.parse(ev.data);
        if (m.kind === 'text') {
          if (!current) current = add('', '');
          current.textContent += m.text; out.scrollTop = out.scrollHeight;
        } else if (m.kind === 'tool_start') { add('• ' + (m.label || m.toolName || 'tool'), 'tool'); current = null; }
        else if (m.kind === 'tool_end' || m.kind === 'done') { current = null; }
        else if (m.kind === 'error') { add(m.text, 'err'); current = null; }
      };
      ws.onclose = function () { ws = null; };
      return ws;
    }

    // Shift+Tab toggles mode (preventDefault so focus doesn't move).
    prompt.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); toggleMode(); }
    });

    document.getElementById('bar').onsubmit = function (e) {
      e.preventDefault();
      var text = prompt.value.trim();
      if (!text) return;
      // /copilot toggles mode, matching the TUI slash command.
      if (text === '/copilot') { prompt.value = ''; toggleMode(); return; }
      prompt.value = '';
      if (copilotActive) {
        add('› ' + text, 'cmd');
        var sock = ensureWs();
        var send = function () { sock.send(JSON.stringify({ prompt: text })); };
        if (sock.readyState === 1) send(); else sock.addEventListener('open', send, { once: true });
      } else {
        add('$ geins ' + text.replace(/^geins\\s+/, ''), 'cmd');
        api('/command', { method: 'POST', body: JSON.stringify({ command: text }) })
          .then(function (r) { add(r.output || '(no output)', r.exitCode ? 'err' : ''); })
          .catch(function (er) { add(String(er), 'err'); });
      }
    };

    // Native file drops (Tauri host): append the paths to the input.
    window.__synapseDrop = function (paths) {
      if (!paths || !paths.length) return;
      var sep = prompt.value && !/\\s$/.test(prompt.value) ? ' ' : '';
      prompt.value += sep + paths.join(' ') + ' ';
      prompt.focus();
    };

    // Boot: skip login if a session already exists.
    api('/session').then(function (s) { if (s.loggedIn) enterApp(); }).catch(function () {});
  }

  // Boot: terminal when the server can run the TUI in a PTY, legacy shell otherwise.
  fetch(base + '/health')
    .then(function (r) { return r.json(); })
    .then(function (h) { if (h && h.tty) initTerm(); else initLegacy(); })
    .catch(initLegacy);
})();
</script>
</body>
</html>`;
