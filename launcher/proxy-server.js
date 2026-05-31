'use strict';

const crypto    = require('crypto');
const http      = require('http');
const httpProxy = require('http-proxy');

// ── Config ────────────────────────────────────────────────────────────────────
const TARGET_HOST    = process.env.TARGET_HOST    || '127.0.0.1';
const TARGET_PORT    = parseInt(process.env.TARGET_PORT    || '3001',  10);
const PROXY_PORT     = parseInt(process.env.PROXY_PORT     || '19234', 10);
const BIND_HOST      = process.env.BIND_HOST      || '127.0.0.1'; // 0.0.0.0 inside Docker
const AUTH_TOKEN     = process.env.AUTH_TOKEN;      // secret embedded in the URL
const SESSION_SECRET = process.env.SESSION_SECRET;  // HMAC key for cookie signing

if (!AUTH_TOKEN || !SESSION_SECRET) {
  console.error('[PROXY] FATAL: AUTH_TOKEN and SESSION_SECRET must be set');
  process.exit(1);
}

// Derive a deterministic session value by HMAC-SHA256(token, secret).
// This is stateless — no in-memory session store needed.
const SESSION_VALUE = crypto
  .createHmac('sha256', SESSION_SECRET)
  .update(AUTH_TOKEN)
  .digest('hex');

const COOKIE_NAME = '__exc_sess';

console.log(`[PROXY] Target     : http://${TARGET_HOST}:${TARGET_PORT}`);
console.log(`[PROXY] Listening  : ${BIND_HOST}:${PROXY_PORT}`);
console.log(`[PROXY] Token path : /${AUTH_TOKEN}`);

// ── Cookie helpers ────────────────────────────────────────────────────────────
function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    jar[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return jar;
}

/** Constant-time string comparison to resist timing attacks. */
function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers['cookie']);
  const val = cookies[COOKIE_NAME];
  return !!val && safeEqual(val, SESSION_VALUE);
}

/**
 * If the URL starts with /{AUTH_TOKEN}, strip it and return the remaining path.
 * e.g.  /TOKEN      → /
 *       /TOKEN/     → /
 *       /TOKEN/foo  → /foo
 * Returns null if the URL is NOT a token URL.
 */
function matchTokenPath(url) {
  // Strip query string for matching, keep it for the redirect
  const qIdx  = url.indexOf('?');
  const path  = qIdx >= 0 ? url.slice(0, qIdx) : url;
  const query = qIdx >= 0 ? url.slice(qIdx)     : '';

  const prefix = `/${AUTH_TOKEN}`;
  if (!path.startsWith(prefix)) return null;

  const rest = path.slice(prefix.length) || '/';
  const redirectTo = (rest.startsWith('/') ? rest : '/' + rest) + query;
  return redirectTo || '/';
}

function buildSessionCookie(req) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https';
  return [
    `${COOKIE_NAME}=${SESSION_VALUE}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    isHttps ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

// ── Pages ─────────────────────────────────────────────────────────────────────
const DENY_BODY = Buffer.from(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Excalidraw — Access Denied</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #1e1e2e;
      color: #cdd6f4;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 20px;
      padding: 3rem 4rem;
      text-align: center;
      box-shadow: 0 25px 80px rgba(0,0,0,0.6);
      max-width: 500px;
      width: 90%;
    }
    .icon { font-size: 3.5rem; margin-bottom: 1.5rem; display: block; }
    h1 { font-size: 1.75rem; margin-bottom: 0.75rem; color: #f38ba8; font-weight: 600; }
    p { color: #a6adc8; line-height: 1.65; font-size: 0.95rem; }
    .hint { margin-top: 1.25rem; font-size: 0.8rem; color: #6c7086; }
  </style>
</head>
<body>
  <div class="card">
    <span class="icon">🚫</span>
    <h1>Access Denied</h1>
    <p>This Excalidraw session is private.<br>
       You need the <strong>magic link</strong> provided by the session owner.</p>
    <p class="hint">Direct access to this URL is not permitted.</p>
  </div>
</body>
</html>`, 'utf8');

function makeErrorPage(msg) {
  const isStarting = msg.includes('starting up');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Excalidraw</title>
  ${isStarting ? '<meta http-equiv="refresh" content="3">' : ''}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #1e1e2e; color: #cdd6f4;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .card {
      text-align: center; padding: 2.5rem 3rem;
      background: #313244; border-radius: 1.25rem;
      box-shadow: 0 20px 60px rgba(0,0,0,.5);
      max-width: 480px; width: 90%;
    }
    h2 { margin: 0 0 0.75rem; font-size: 1.2rem; font-weight: 600; }
    p  { color: #a6adc8; font-size: 0.85rem; margin-bottom: 1.25rem; }
    .bar-wrap { background: #45475a; border-radius: 99px; height: 4px; overflow: hidden; margin-bottom: 1.25rem; }
    .bar {
      height: 100%; width: 40%; border-radius: 99px;
      background: linear-gradient(90deg, #89b4fa, #cba6f7);
      animation: slide 1.4s ease-in-out infinite;
    }
    @keyframes slide {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
    button {
      padding: .55rem 1.6rem; background: #89b4fa; color: #1e1e2e;
      border: none; border-radius: .5rem; cursor: pointer;
      font-size: 0.95rem; font-weight: 600;
    }
    button:hover { background: #b4d0fe; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${msg}</h2>
    ${isStarting
      ? '<p>This page refreshes automatically every 3 seconds.</p><div class="bar-wrap"><div class="bar"></div></div>'
      : ''}
    <button onclick="location.reload()">↺ Refresh now</button>
  </div>
</body>
</html>`;
}


// ── Proxy instance ────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({
  target: `http://${TARGET_HOST}:${TARGET_PORT}`,
  ws: true,
  xfwd: false,
  timeout: 0,
  proxyTimeout: 0,
});

proxy.on('error', (err, req, res) => {
  const isDown = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET';
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(isDown ? 503 : 502, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(makeErrorPage(
      isDown
        ? '⏳ Excalidraw is still starting up — please wait a moment and refresh.'
        : `❌ Proxy error: ${err.message}`
    ));
  }
});

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // 1. Magic-link token in URL → grant session cookie, redirect to actual path
  const redirectTo = matchTokenPath(req.url);
  if (redirectTo !== null) {
    res.writeHead(302, {
      'Set-Cookie':     buildSessionCookie(req),
      'Location':       redirectTo,
      'Cache-Control':  'no-store, no-cache',
      'Content-Length': '0',
    });
    res.end();
    return;
  }

  // 2. Valid session cookie → pass through to Vite
  if (isAuthenticated(req)) {
    proxy.web(req, res);
    return;
  }

  // 3. No token, no valid cookie → deny
  res.writeHead(403, {
    'Content-Type':   'text/html; charset=utf-8',
    'Content-Length': DENY_BODY.length,
    'Cache-Control':  'no-store, no-cache',
  });
  res.end(DENY_BODY);
});

// ── WebSocket upgrade (Vite HMR + Excalidraw collab socket.io) ───────────────
// Browsers automatically send cookies with WS upgrades to the same origin,
// so authenticated users connect seamlessly after the initial magic-link visit.
server.on('upgrade', (req, socket, head) => {
  if (!isAuthenticated(req)) {
    socket.write(
      'HTTP/1.1 403 Forbidden\r\n' +
      'Content-Length: 0\r\n' +
      'Connection: close\r\n\r\n'
    );
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, {}, (err) => {
    if (err) console.error('[PROXY] WS error:', err.message);
  });
});

server.on('error', (err) => console.error('[PROXY] Server error:', err.message));

server.listen(PROXY_PORT, BIND_HOST, () => {
  console.log('[PROXY] ✓ Ready');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(sig) {
  console.log(`[PROXY] ${sig} — shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
