const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");

const PORT = 7842;
const COMPOSE_DIR = path.join(__dirname, "..");
const DEFAULT_HOSTNAME = "excalidraw-secure";

let sessionActive = false;
let currentAuthUser = "";
let currentAuthPass = "";
let currentTailscaleAuthKey = "";
let currentTailscaleHostname = DEFAULT_HOSTNAME;
let currentTailscaleIp = "";
let isStarting = false;
let hasError = false;
let buildLogs = [];

function sanitizeHostname(value) {
  const hostname = String(value || DEFAULT_HOSTNAME)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");

  return hostname || DEFAULT_HOSTNAME;
}

function rememberLog(data) {
  const str = data.toString();
  process.stdout.write(str);
  buildLogs.push(str);
  if (buildLogs.length > 500) {
    buildLogs.shift();
  }
}

function composeArgs(args) {
  return ["compose", "--project-directory", COMPOSE_DIR, ...args];
}

function tailscaleUrl() {
  return `http://${currentTailscaleIp || currentTailscaleHostname}:8080`;
}

function tailscaleUrlWithAuth() {
  return tailscaleUrl().replace(
    "http://",
    `http://${currentAuthUser}:${currentAuthPass}@`,
  );
}

function composeEnv() {
  return Object.assign({}, process.env, {
    TAILSCALE_AUTHKEY: currentTailscaleAuthKey,
    TAILSCALE_HOSTNAME: currentTailscaleHostname,
    AUTH_USER: currentAuthUser,
    AUTH_PASS: currentAuthPass,
    PUBLIC_URL_WITH_AUTH: tailscaleUrlWithAuth(),
  });
}

function runDocker(args, env, onClose) {
  const child = spawn("docker", args, { env });
  child.stdout.on("data", rememberLog);
  child.stderr.on("data", rememberLog);
  child.on("close", onClose);
}

function readTailscaleIp(callback) {
  execFile(
    "docker",
    composeArgs(["exec", "-T", "tailscale", "tailscale", "ip", "-4"]),
    { env: composeEnv() },
    (err, stdout) => {
      if (err) {
        callback(err);
        return;
      }

      const ip = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^100\.\d+\.\d+\.\d+$/.test(line));

      if (!ip) {
        callback(new Error("Tailscale did not return a 100.x IP address"));
        return;
      }

      currentTailscaleIp = ip;
      callback(null, ip);
    },
  );
}

function recoverRunningSession(callback) {
  execFile(
    "docker",
    composeArgs(["exec", "-T", "proxy-tailscale", "printenv"]),
    { env: composeEnv() },
    (err, stdout) => {
      if (err) {
        sessionActive = false;
        currentAuthUser = "";
        currentAuthPass = "";
        callback();
        return;
      }

      const env = Object.fromEntries(
        stdout
          .split(/\r?\n/)
          .filter((line) => line.includes("="))
          .map((line) => {
            const index = line.indexOf("=");
            return [line.slice(0, index), line.slice(index + 1)];
          }),
      );

      if (env.AUTH_USER && env.AUTH_PASS && currentTailscaleIp) {
        currentAuthUser = env.AUTH_USER;
        currentAuthPass = env.AUTH_PASS;
        sessionActive = true;
      } else {
        sessionActive = false;
      }

      callback();
    },
  );
}

function waitForTailscaleIp(attempt = 1) {
  readTailscaleIp((err, ip) => {
    if (!err && ip) {
      buildLogs.push(`Tailscale IP detected: ${ip}\n`);
      startAppContainers();
      return;
    }

    if (attempt >= 30) {
      isStarting = false;
      hasError = true;
      sessionActive = false;
      buildLogs.push(
        "\nTimed out waiting for Tailscale IP. Check the auth key and Tailscale container logs.\n",
      );
      return;
    }

    setTimeout(() => waitForTailscaleIp(attempt + 1), 1000);
  });
}

function startAppContainers() {
  const args = composeArgs([
    "--profile",
    "session",
    "up",
    "-d",
    "--build",
    "excalidraw",
    "proxy-tailscale",
  ]);

  buildLogs.push("Starting Excalidraw with Tailscale IP links...\n");
  runDocker(args, composeEnv(), (code) => {
    isStarting = false;
    if (code !== 0) {
      hasError = true;
      sessionActive = false;
      buildLogs.push(`\nTailscale session failed with exit code ${code}.\n`);
      return;
    }

    sessionActive = true;
    hasError = false;
    buildLogs.push(`\nPrivate Tailscale session is live: ${tailscaleUrl()}\n`);
  });
}

function startDockerSession() {
  currentTailscaleIp = "";
  buildLogs.push("Starting Tailscale sidecar...\n");

  const args = composeArgs(["--profile", "session", "up", "-d", "tailscale"]);

  runDocker(args, composeEnv(), (code) => {
    if (code !== 0) {
      isStarting = false;
      hasError = true;
      sessionActive = false;
      buildLogs.push(`\nTailscale sidecar failed with exit code ${code}.\n`);
      return;
    }

    buildLogs.push("Waiting for Tailscale IP...\n");
    waitForTailscaleIp();
  });
}

function startSessionResponse(res) {
  currentAuthUser = crypto.randomBytes(6).toString("hex");
  currentAuthPass = crypto.randomBytes(12).toString("hex");
  sessionActive = false;
  isStarting = true;
  hasError = false;
  buildLogs = [];

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, message: "Starting..." }));
  startDockerSession();
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");

  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    return;
  }

  if (req.url === "/api/status" && req.method === "GET") {
    const finishStatus = () => recoverRunningSession(() => sendStatus(res));

    if (!currentTailscaleIp) {
      readTailscaleIp((err, ip) => {
        if (!err && ip) {
          currentTailscaleIp = ip;
        }
        finishStatus();
      });
      return;
    }

    finishStatus();
    return;
  }

  function sendStatus(res) {
    const magicLink =
      currentAuthUser && sessionActive ? tailscaleUrlWithAuth() : null;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        accessMode: "tailscale",
        tailscaleConfigured: !!currentTailscaleAuthKey || !!currentTailscaleIp,
        tailscaleHostname: currentTailscaleHostname,
        tailscaleIp: currentTailscaleIp,
        sessionActive,
        isStarting,
        hasError,
        magicLink,
        localLink: currentAuthUser
          ? `http://${currentAuthUser}:${currentAuthPass}@localhost:8080`
          : null,
      }),
    );
  }

  if (req.url === "/api/logs" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ logs: buildLogs.join("") }));
    return;
  }

  if (req.url === "/api/config" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");

        if (parsed.tailscaleAuthKey && parsed.tailscaleAuthKey.trim()) {
          currentTailscaleAuthKey = parsed.tailscaleAuthKey.trim();
        }
        currentTailscaleHostname = sanitizeHostname(parsed.tailscaleHostname);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === "/api/start" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (parsed.tailscaleAuthKey && parsed.tailscaleAuthKey.trim()) {
          currentTailscaleAuthKey = parsed.tailscaleAuthKey.trim();
        }
        currentTailscaleHostname = sanitizeHostname(parsed.tailscaleHostname);
      } catch {}

      if (currentTailscaleAuthKey) {
        startSessionResponse(res);
        return;
      }

      readTailscaleIp((err, ip) => {
        if (err || !ip) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error:
                "Tailscale auth key missing and no connected Tailscale sidecar was found",
            }),
          );
          return;
        }

        currentTailscaleIp = ip;
        startSessionResponse(res);
      });
    });
    return;
  }

  if (req.url === "/api/stop" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Stopping..." }));

    execFile(
      "docker",
      [
        "compose",
        "--project-directory",
        COMPOSE_DIR,
        "rm",
        "-f",
        "-s",
        "excalidraw",
        "proxy-tailscale",
        "tailscale",
        "excalidraw-room",
        "excalidraw-storage-backend",
        "redis",
      ],
      () => {
        sessionActive = false;
        isStarting = false;
        hasError = false;
        currentAuthUser = "";
        currentAuthPass = "";
        currentTailscaleIp = "";
      },
    );
    return;
  }

  if (req.url === "/api/rebuild" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, message: "Rebuilding..." }));

    isStarting = true;
    hasError = false;
    buildLogs = ["Force rebuilding images...\n\n"];

    const child = spawn("docker", [
      "compose",
      "--project-directory",
      COMPOSE_DIR,
      "--profile",
      "session",
      "build",
      "--no-cache",
      "excalidraw",
      "proxy-tailscale",
    ]);

    child.stdout.on("data", rememberLog);
    child.stderr.on("data", rememberLog);
    child.on("close", (code) => {
      isStarting = false;
      if (code !== 0) {
        buildLogs.push(`\nRebuild failed with code ${code}.\n`);
        hasError = true;
      } else {
        buildLogs.push("\nRebuild complete. You can now start a session.\n");
        hasError = false;
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GUI server running on http://0.0.0.0:${PORT}`);
});
