const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');

const PORT = 7842;
const COMPOSE_DIR = path.join(__dirname, '..');
const STATE_DIR = path.join(COMPOSE_DIR, 'state');
if (!fs.existsSync(STATE_DIR)) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (e) {}
}
const USERS_FILE = path.join(STATE_DIR, 'users.json');
const REQUESTS_FILE = path.join(STATE_DIR, 'requests.json');

let sessionActive = false;
let currentNgrokUrl = '';
let currentNgrokToken = '';
let isStarting = false;
let hasError = false;
let buildLogs = [];

// Initialize files if they don't exist
function initJsonFiles() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(REQUESTS_FILE)) {
      fs.writeFileSync(REQUESTS_FILE, JSON.stringify([], null, 2));
    }
  } catch (err) {
    console.error('Error initializing state files:', err.message);
  }
}
initJsonFiles();

// Check if Docker images already exist so we can skip rebuilding
function imagesExist() {
  try {
    const { execSync } = require('child_process');
    const result = execSync('docker images --format "{{.Repository}}" launcher-excalidraw launcher-proxy', { encoding: 'utf8', timeout: 5000 });
    return result.includes('launcher-excalidraw') && result.includes('launcher-proxy');
  } catch {
    return false;
  }
}

// Helper to poll ngrok API (from within docker, it's accessible via the ngrok container)
async function getNgrokUrl() {
  return new Promise((resolve) => {
    const req = http.get('http://ngrok:4040/api/tunnels', { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const tunnel = json.tunnels.find(t => t.proto === 'https') || json.tunnels[0];
          if (tunnel) resolve(tunnel.public_url);
          else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    let requests = [];
    let users = [];
    try {
      if (fs.existsSync(REQUESTS_FILE)) requests = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
      if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {}

    res.end(JSON.stringify({
      ngrokTokenConfigured: !!currentNgrokToken,
      ngrokToken: currentNgrokToken,
      sessionActive,
      isStarting,
      hasError,
      magicLink: currentNgrokUrl,
      localLink: 'http://localhost:8080',
      requests,
      users,
      ngrokUrl: currentNgrokUrl
    }));
    return;
  }

  if (req.url === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: buildLogs.join('') }));
    return;
  }

  if (req.url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { ngrokToken } = JSON.parse(body);
        if (ngrokToken && ngrokToken.trim()) {
          currentNgrokToken = ngrokToken.trim();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/api/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      // Allow overriding the ngrok token at start time
      try {
        const parsed = JSON.parse(body);
        if (parsed.ngrokToken && parsed.ngrokToken.trim()) {
          currentNgrokToken = parsed.ngrokToken.trim();
        }
      } catch {}

      if (!currentNgrokToken) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Ngrok token missing' }));
        return;
      }

      currentNgrokUrl = '';

      // Clear old requests and users on start
      try {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
        fs.writeFileSync(REQUESTS_FILE, JSON.stringify([], null, 2));
      } catch (err) {
        console.error('Error clearing state files on start:', err.message);
      }

      isStarting = true;
      hasError = false;
      buildLogs = [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Starting...' }));

      const composeEnv = Object.assign({}, process.env, {
        NGROK_AUTHTOKEN: currentNgrokToken
      });

      // ── PHASE 1: Start proxy + ngrok, then wait for public URL ─────────────
      const hasImages = imagesExist();
      const phase1Args = ['compose', '--project-directory', COMPOSE_DIR, '--profile', 'session', 'up', '-d'];
      if (!hasImages) phase1Args.push('--build');
      phase1Args.push('proxy', 'ngrok');

      buildLogs.push(hasImages
        ? '✓ Using cached images (skipping build)\n\n'
        : '⏳ Building images for the first time (this may take a few minutes)...\n\n'
      );
      buildLogs.push('▶ Phase 1: Starting proxy + ngrok...\n');

      const phase1 = spawn('docker', phase1Args, { env: composeEnv });

      phase1.stdout.on('data', data => {
        const str = data.toString();
        process.stdout.write(str);
        buildLogs.push(str);
        if (buildLogs.length > 500) buildLogs.shift();
      });

      phase1.stderr.on('data', data => {
        const str = data.toString();
        process.stderr.write(str);
        buildLogs.push(str);
        if (buildLogs.length > 500) buildLogs.shift();
      });

      phase1.on('close', code => {
        if (code !== 0) {
          isStarting = false;
          hasError = true;
          buildLogs.push('\n✗ Phase 1 failed with exit code ' + code);
          sessionActive = false;
          return;
        }

        buildLogs.push('\n✓ Proxy + ngrok are up. Waiting for public URL...\n');

        // Poll for the ngrok public URL (up to 60s)
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          const url = await getNgrokUrl();
          if (url) {
            clearInterval(poll);
            currentNgrokUrl = url;
            buildLogs.push(`✓ Got public URL: ${url}\n`);

            // ── PHASE 2: Start excalidraw with PUBLIC_URL ──────────
            buildLogs.push('\n▶ Phase 2: Starting excalidraw with injected WS URL...\n');

            const phase2Env = Object.assign({}, composeEnv, {
              PUBLIC_URL: url
            });

            const phase2Args = ['compose', '--project-directory', COMPOSE_DIR, '--profile', 'session', 'up', '-d'];
            if (!hasImages) phase2Args.push('--build');
            phase2Args.push('excalidraw');

            const phase2 = spawn('docker', phase2Args, { env: phase2Env });

            phase2.stdout.on('data', data => {
              const str = data.toString();
              process.stdout.write(str);
              buildLogs.push(str);
              if (buildLogs.length > 500) buildLogs.shift();
            });

            phase2.stderr.on('data', data => {
              const str = data.toString();
              process.stderr.write(str);
              buildLogs.push(str);
              if (buildLogs.length > 500) buildLogs.shift();
            });

            phase2.on('close', code2 => {
              isStarting = false;
              if (code2 !== 0) {
                buildLogs.push('\n✗ Phase 2 (excalidraw) failed with exit code ' + code2);
                sessionActive = false;
                hasError = true;
              } else {
                buildLogs.push('\n✓ All containers up. Session is live!\n');
                sessionActive = true;
              }
            });

          } else if (attempts > 60) {
            clearInterval(poll);
            isStarting = false;
            hasError = true;
            buildLogs.push('\n✗ Timed out waiting for ngrok public URL after 60s.');
            sessionActive = false;
          }
        }, 1000);
      });
    });
    return;
  }


  if (req.url === '/api/stop' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Stopping...' }));

    exec(`docker compose --project-directory ${COMPOSE_DIR} rm -f -s excalidraw proxy ngrok`, (err) => {
      sessionActive = false;
      isStarting = false;
      hasError = false;
      currentNgrokUrl = '';
      // Reset state files
      try {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
        fs.writeFileSync(REQUESTS_FILE, JSON.stringify([], null, 2));
      } catch (e) {}
    });
    return;
  }

  if (req.url === '/api/requests' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const data = fs.readFileSync(REQUESTS_FILE, 'utf8');
      res.end(data);
    } catch (e) {
      res.end(JSON.stringify([]));
    }
    return;
  }

  if (req.url === '/api/requests/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { requestId, action, role } = JSON.parse(body);
        
        if (!requestId || !action) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing requestId or action' }));
          return;
        }

        let requests = [];
        if (fs.existsSync(REQUESTS_FILE)) {
          requests = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
        }

        const reqIdx = requests.findIndex(r => r.requestId === requestId);
        if (reqIdx === -1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request not found' }));
          return;
        }

        const targetRequest = requests[reqIdx];

        if (action === 'approve') {
          const sessionToken = 'sess_' + crypto.randomBytes(16).toString('hex');
          targetRequest.status = 'approved';
          targetRequest.role = role || 'viewer';
          targetRequest.sessionToken = sessionToken;

          // Add to users.json
          let users = [];
          if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
          }
          users = users.filter(u => u.username !== targetRequest.name);
          users.push({
            username: targetRequest.name,
            password: sessionToken,
            role: role || 'viewer',
            token: sessionToken
          });
          fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        } else {
          targetRequest.status = 'denied';
        }

        fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Force rebuild endpoint — use when you've changed source code
  if (req.url === '/api/rebuild' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Rebuilding...' }));

    isStarting = true;
    hasError = false;
    buildLogs = ['⏳ Force rebuilding images...\n\n'];

    const child = spawn('docker', ['compose', '--project-directory', COMPOSE_DIR, '--profile', 'session', 'build', '--no-cache', 'excalidraw', 'proxy', 'ngrok']);

    child.stdout.on('data', data => {
      const str = data.toString();
      process.stdout.write(str);
      buildLogs.push(str);
      if (buildLogs.length > 500) buildLogs.shift();
    });

    child.stderr.on('data', data => {
      const str = data.toString();
      process.stderr.write(str);
      buildLogs.push(str);
      if (buildLogs.length > 500) buildLogs.shift();
    });

    child.on('close', code => {
      isStarting = false;
      if (code !== 0) {
        buildLogs.push('\n✗ Rebuild failed with code ' + code);
        hasError = true;
      } else {
        buildLogs.push('\n✓ Rebuild complete. You can now Start a session.');
        hasError = false;
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GUI Server running on http://0.0.0.0:${PORT}`);
});

