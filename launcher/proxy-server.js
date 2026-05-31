'use strict';

const http      = require('http');
const httpProxy = require('http-proxy');

// ── Config ────────────────────────────────────────────────────────────────────
const TARGET_HOST = process.env.TARGET_HOST    || '127.0.0.1';
const TARGET_PORT = parseInt(process.env.TARGET_PORT    || '3001',  10);
const PROXY_PORT  = parseInt(process.env.PROXY_PORT     || '19234', 10);
const BIND_HOST   = process.env.BIND_HOST      || '127.0.0.1';
const AUTH_USER   = process.env.AUTH_USER;
const AUTH_PASS   = process.env.AUTH_PASS;

if (!AUTH_USER || !AUTH_PASS) {
  console.error('[PROXY] FATAL: AUTH_USER and AUTH_PASS must be set');
  process.exit(1);
}

// Precompute the expected Basic Auth header
const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64');

console.log(`[PROXY] Target    : http://${TARGET_HOST}:${TARGET_PORT}`);
console.log(`[PROXY] Listening : ${BIND_HOST}:${PROXY_PORT}`);
console.log(`[PROXY] Basic Auth: Enabled`);

// ── Auth helper ───────────────────────────────────────────────────────────────
function isAuthenticated(req) {
  return req.headers.authorization === EXPECTED_AUTH;
}

// ── Pages ─────────────────────────────────────────────────────────────────────
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
  if (isAuthenticated(req)) {
    proxy.web(req, res);
    return;
  }

  // Not authenticated -> prompt for basic auth
  res.writeHead(401, {
    'Content-Type': 'text/plain',
    'WWW-Authenticate': 'Basic realm="Excalidraw Secure Session"',
    'Cache-Control': 'no-store, no-cache'
  });
  res.end('Access Denied. Please provide valid credentials.');
});

// ── WebSocket upgrade (Vite HMR + Excalidraw collab socket.io) ───────────────
server.on('upgrade', (req, socket, head) => {
  if (!isAuthenticated(req)) {
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
      'WWW-Authenticate: Basic realm="Excalidraw Secure Session"\r\n' +
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

