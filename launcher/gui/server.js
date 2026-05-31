const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');

const PORT = 7842;
const ENV_PATH = path.join(__dirname, '..', '.env');
const COMPOSE_DIR = path.join(__dirname, '..');

let sessionActive = false;
let currentAuthToken = '';
let currentNgrokUrl = '';
let isStarting = false;
let hasError = false;
let buildLogs = [];

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });
  return env;
}

function writeEnv(env) {
  let content = '';
  for (const [k, v] of Object.entries(env)) {
    content += `${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

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
    const env = readEnv();
    res.end(JSON.stringify({
      ngrokTokenConfigured: !!env.NGROK_AUTHTOKEN,
      ngrokToken: env.NGROK_AUTHTOKEN || '',
      sessionActive,
      isStarting,
      hasError,
      magicLink: currentAuthToken && currentNgrokUrl ? `${currentNgrokUrl}/${currentAuthToken}` : null
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
        const env = readEnv();
        env.NGROK_AUTHTOKEN = ngrokToken;
        writeEnv(env);
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
      const env = readEnv();

      // Allow overriding the ngrok token at start time
      try {
        const parsed = JSON.parse(body);
        if (parsed.ngrokToken && parsed.ngrokToken.trim()) {
          env.NGROK_AUTHTOKEN = parsed.ngrokToken.trim();
        }
      } catch {}

      if (!env.NGROK_AUTHTOKEN) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Ngrok token missing' }));
        return;
      }

      currentAuthToken = crypto.randomBytes(32).toString('hex');
      const sessionSecret = crypto.randomBytes(32).toString('hex');
      env.AUTH_TOKEN = currentAuthToken;
      env.SESSION_SECRET = sessionSecret;
      writeEnv(env);

      isStarting = true;
      hasError = false;
      buildLogs = [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Starting...' }));

      // If images already exist, skip build for faster startup
      const hasImages = imagesExist();
      const args = ['compose', '--project-directory', COMPOSE_DIR, '--profile', 'session', 'up', '-d'];
      if (!hasImages) {
        args.push('--build');
      }
      args.push('excalidraw', 'proxy', 'ngrok');

      buildLogs.push(hasImages
        ? '✓ Using cached images (skipping build)\n\n'
        : '⏳ Building images for the first time (this may take a few minutes)...\n\n'
      );

      const child = spawn('docker', args);

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
          console.error('Docker compose exited with code ' + code);
          buildLogs.push('\n✗ Process failed with exit code ' + code);
          sessionActive = false;
          hasError = true;
          return;
        }

        sessionActive = true;
        // Poll for ngrok URL
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          const url = await getNgrokUrl();
          if (url) {
            currentNgrokUrl = url;
            clearInterval(interval);
          } else if (attempts > 60) {
            clearInterval(interval);
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
      currentAuthToken = '';
      currentNgrokUrl = '';
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
