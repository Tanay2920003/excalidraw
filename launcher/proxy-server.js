'use strict';

const http      = require('http');
const httpProxy = require('http-proxy');
const fs        = require('fs');
const path      = require('path');
const { URL }   = require('url');

// ── Config ────────────────────────────────────────────────────────────────────
const TARGET_HOST = process.env.TARGET_HOST    || '127.0.0.1';
const TARGET_PORT = parseInt(process.env.TARGET_PORT    || '3001',  10);
const PROXY_PORT  = parseInt(process.env.PROXY_PORT     || '19234', 10);
const BIND_HOST   = process.env.BIND_HOST      || '127.0.0.1';

const STATE_DIR = path.join(__dirname, 'state');
if (!fs.existsSync(STATE_DIR)) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (e) {}
}
const USERS_FILE = path.join(STATE_DIR, 'users.json');
const REQUESTS_FILE = path.join(STATE_DIR, 'requests.json');
const WAITING_ROOM_FILE = path.join(__dirname, 'waiting-room.html');

let users = [];

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      users = JSON.parse(data);
      console.log(`[PROXY] Loaded ${users.length} users from users.json`);
    } else {
      users = [];
    }
  } catch (err) {
    console.error('[PROXY] Error loading users.json:', err.message);
    users = [];
  }
}

// Watch users.json for changes
if (fs.existsSync(USERS_FILE)) {
  fs.watchFile(USERS_FILE, () => {
    console.log('[PROXY] users.json changed, reloading...');
    loadUsers();
  });
} else {
  setInterval(() => {
    if (users.length === 0 && fs.existsSync(USERS_FILE)) {
      loadUsers();
      fs.watchFile(USERS_FILE, () => {
        console.log('[PROXY] users.json changed, reloading...');
        loadUsers();
      });
    }
  }, 5000);
}

loadUsers();

// ── Auth helpers ───────────────────────────────────────────────────────────────
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;

  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }

  return list;
}

function isLocalRequest(req) {
  const host = req.headers.host || '';
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

function getAuthenticatedUser(req) {
  // 1. Automatically trust local connection from the host machine
  if (isLocalRequest(req)) {
    return { username: 'Host', role: 'editor', token: 'sess_local_host' };
  }

  // 2. Check Cookie Session Token for external guests
  const cookies = parseCookies(req);
  const sessionToken = cookies['excalidraw_session'];
  if (sessionToken && sessionToken.startsWith('sess_')) {
    const matched = users.find(u => u.token === sessionToken);
    if (matched) {
      return matched;
    }
  }

  return null;
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
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Dynamic Join Request API
  if (req.url === '/api/request-join' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name || !name.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Name is required' }));
          return;
        }

        const requestId = 'req_' + require('crypto').randomBytes(8).toString('hex');
        
        let requests = [];
        if (fs.existsSync(REQUESTS_FILE)) {
          requests = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
        }

        requests.push({
          requestId,
          name: name.trim(),
          status: 'pending',
          timestamp: Date.now()
        });
        fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, requestId }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.url && req.url.startsWith('/api/request-status') && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const requestId = url.searchParams.get('requestId');

    if (!requestId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing requestId' }));
      return;
    }

    try {
      let requests = [];
      if (fs.existsSync(REQUESTS_FILE)) {
        requests = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
      }

      const match = requests.find(r => r.requestId === requestId);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: match.status,
        sessionToken: match.sessionToken || null,
        role: match.role || null
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Verify Authentication
  const user = getAuthenticatedUser(req);
  if (!user) {
    // If it's a direct browser load, serve the waiting room instead of a 401 prompt
    const isPage = req.url === '/' || req.url === '/index.html' || !req.url.includes('.');
    if (isPage) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      try {
        res.end(fs.readFileSync(WAITING_ROOM_FILE));
      } catch (e) {
        res.end('<h1>Excalidraw Waiting Room</h1><p>Waiting room file missing. Please contact the administrator.</p>');
      }
      return;
    }

    // API or Static files access -> block with 401
    res.writeHead(401, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store, no-cache'
    });
    res.end('Access Denied. Session not approved.');
    return;
  }

  // Set the dynamic role & session cookies in the response
  const role = user.role || 'editor';
  res.setHeader('Set-Cookie', [
    `excalidraw_role=${role}; Path=/; SameSite=Lax; Max-Age=86400`,
    `excalidraw_session=${user.token || ''}; Path=/; SameSite=Lax; Max-Age=86400`
  ]);

  // Block viewers from modifying drawings (POST/PUT/DELETE to backend storage api)
  if (role === 'viewer') {
    const isWrite = req.method !== 'GET' && req.method !== 'OPTIONS' && req.method !== 'HEAD';
    if (isWrite && req.url && req.url.startsWith('/api/v2/')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: View-only access.');
      return;
    }
  }

  // Proxy requests
  if (req.url && req.url.startsWith('/socket.io/')) {
    proxy.web(req, res, { target: 'http://excalidraw-room:3002' });
  } else if (req.url && req.url.startsWith('/api/v2/')) {
    proxy.web(req, res, { target: 'http://excalidraw-storage-backend:8080' });
  } else {
    proxy.web(req, res);
  }
});

// ── WebSocket upgrade (Vite HMR + Excalidraw collab socket.io) ───────────────
server.on('upgrade', (req, socket, head) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
      'Connection: close\r\n\r\n'
    );
    socket.destroy();
    return;
  }
  if (req.url && req.url.startsWith('/socket.io/')) {
    proxy.ws(req, socket, head, { target: 'http://excalidraw-room:3002' }, (err) => {
      if (err) console.error('[PROXY] WS (collab) error:', err.message);
    });
  } else {
    proxy.ws(req, socket, head, {}, (err) => {
      if (err) console.error('[PROXY] WS error:', err.message);
    });
  }
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


