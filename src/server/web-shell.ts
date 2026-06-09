// The minimal desktop web shell, served by `geins serve` and loaded by the Tauri
// webview. Kept as a single self-contained HTML string (inline CSS+JS) so it
// bundles reliably into the `bun build --compile` binary with no asset pipeline.
//
// Mirrors the TUI: the same gradient GEINS/SYNAPSE logo, and the same mode model
// — default is command mode, Shift+Tab (or `/copilot`) toggles copilot. Scope:
// login + command/copilot REPL; rich per-command screens are deferred.
import { LOGO_FULL, PROMPT, SUFFIX } from '../ui/logos.ts';

// Compose the banner exactly like Welcome.tsx: PROMPT ("/") + GEINS + SUFFIX ("SYNAPSE").
const LOGO_LINES = LOGO_FULL.map((line, i) => `${PROMPT[i] ?? ''}${line}${SUFFIX[i] ?? ''}`).join('\n');

export const WEB_SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Geins</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #0b0e14; color: #d6deeb;
  }
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
  <header class="hidden" id="topbar">
    <span class="brand">geins</span>
    <span class="mode command" id="modePill">command</span>
    <span class="who" id="who"></span>
    <button id="logout">logout</button>
  </header>

  <div id="login">
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

  var out = document.getElementById('out');
  function el(tag, cls, text) { var d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; }
  function add(text, cls) {
    var d = el('div', 'line' + (cls ? ' ' + cls : ''), text);
    out.appendChild(d); out.scrollTop = out.scrollHeight; return d;
  }

  // --- Login (unchanged flow) ---
  var loginEl = document.getElementById('login');
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

  // Boot: skip login if a session already exists.
  api('/session').then(function (s) { if (s.loggedIn) enterApp(); }).catch(function () {});
})();
</script>
</body>
</html>`;
