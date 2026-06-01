"use strict";

const http = require("http");
const httpProxy = require("http-proxy");

const TARGET_HOST = process.env.TARGET_HOST || "127.0.0.1";
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "3001", 10);
const ROOM_HOST = process.env.ROOM_HOST || "excalidraw-room";
const ROOM_PORT = parseInt(process.env.ROOM_PORT || "80", 10);
const STORAGE_HOST = process.env.STORAGE_HOST || "excalidraw-storage-backend";
const STORAGE_PORT = parseInt(process.env.STORAGE_PORT || "8080", 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "8080", 10);
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;

if (!AUTH_USER || !AUTH_PASS) {
  console.error("[PROXY] FATAL: AUTH_USER and AUTH_PASS must be set");
  process.exit(1);
}

function cryptoSafeToken(value) {
  return Buffer.from(value).toString("base64url");
}

const EXPECTED_AUTH =
  "Basic " + Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64");
const SESSION_COOKIE =
  "excalidraw_session=" + cryptoSafeToken(`${AUTH_USER}:${AUTH_PASS}`);

console.log(`[PROXY] Target    : http://${TARGET_HOST}:${TARGET_PORT}`);
console.log(`[PROXY] Room      : http://${ROOM_HOST}:${ROOM_PORT}`);
console.log(`[PROXY] Storage   : http://${STORAGE_HOST}:${STORAGE_PORT}`);
console.log(`[PROXY] Listening : ${BIND_HOST}:${PROXY_PORT}`);
console.log("[PROXY] Basic Auth: enabled");

function isAuthenticated(req) {
  return (
    req.headers.authorization === EXPECTED_AUTH ||
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .includes(SESSION_COOKIE)
  );
}

function setSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function makeErrorPage(message) {
  const isStarting = message.includes("starting up");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Excalidraw</title>
  ${isStarting ? '<meta http-equiv="refresh" content="3">' : ""}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      align-items: center;
      background: #202124;
      color: #f1f3f4;
      display: flex;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #2b2d31;
      border: 1px solid #3c4043;
      border-radius: 8px;
      max-width: 480px;
      padding: 32px;
      text-align: center;
      width: 90%;
    }
    h2 { font-size: 18px; font-weight: 650; margin-bottom: 10px; }
    p { color: #bdc1c6; font-size: 14px; margin-bottom: 18px; }
    .bar-wrap {
      background: #3c4043;
      border-radius: 999px;
      height: 4px;
      margin-bottom: 18px;
      overflow: hidden;
    }
    .bar {
      animation: slide 1.4s ease-in-out infinite;
      background: #8ab4f8;
      border-radius: 999px;
      height: 100%;
      width: 40%;
    }
    @keyframes slide {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(350%); }
    }
    button {
      background: #8ab4f8;
      border: 0;
      border-radius: 6px;
      color: #17181a;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
      padding: 10px 22px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>${message}</h2>
    ${
      isStarting
        ? '<p>This page refreshes automatically every 3 seconds.</p><div class="bar-wrap"><div class="bar"></div></div>'
        : ""
    }
    <button onclick="location.reload()">Refresh now</button>
  </div>
</body>
</html>`;
}

const proxy = httpProxy.createProxyServer({
  target: `http://${TARGET_HOST}:${TARGET_PORT}`,
  ws: true,
  xfwd: false,
  timeout: 0,
  proxyTimeout: 0,
});

proxy.on("error", (err, req, res) => {
  const isDown = err.code === "ECONNREFUSED" || err.code === "ECONNRESET";
  if (res && typeof res.writeHead === "function" && !res.headersSent) {
    res.writeHead(isDown ? 503 : 502, {
      "Content-Type": "text/html; charset=utf-8",
    });
    res.end(
      makeErrorPage(
        isDown
          ? "Excalidraw is still starting up. Please wait a moment and refresh."
          : `Proxy error: ${err.message}`,
      ),
    );
  }
});

const server = http.createServer((req, res) => {
  if (!isAuthenticated(req)) {
    res.writeHead(401, {
      "Cache-Control": "no-store, no-cache",
      "Content-Type": "text/plain",
      "WWW-Authenticate": 'Basic realm="Excalidraw Secure Session"',
    });
    res.end("Access denied. Please provide valid credentials.");
    return;
  }

  setSessionCookie(res);

  if (req.url && req.url.startsWith("/socket.io/")) {
    proxy.web(req, res, { target: `http://${ROOM_HOST}:${ROOM_PORT}` });
  } else if (req.url && req.url.startsWith("/api/v2/")) {
    proxy.web(req, res, {
      target: `http://${STORAGE_HOST}:${STORAGE_PORT}`,
    });
  } else {
    proxy.web(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (!isAuthenticated(req)) {
    socket.write(
      "HTTP/1.1 401 Unauthorized\r\n" +
        'WWW-Authenticate: Basic realm="Excalidraw Secure Session"\r\n' +
        "Connection: close\r\n\r\n",
    );
    socket.destroy();
    return;
  }

  if (req.url && req.url.startsWith("/socket.io/")) {
    proxy.ws(
      req,
      socket,
      head,
      { target: `http://${ROOM_HOST}:${ROOM_PORT}` },
      (err) => {
        if (err) {
          console.error("[PROXY] websocket collab error:", err.message);
        }
      },
    );
  } else {
    proxy.ws(req, socket, head, {}, (err) => {
      if (err) {
        console.error("[PROXY] websocket error:", err.message);
      }
    });
  }
});

server.on("error", (err) => {
  console.error("[PROXY] server error:", err.message);
});

server.listen(PROXY_PORT, BIND_HOST, () => {
  console.log("[PROXY] ready");
});

function shutdown(signal) {
  console.log(`[PROXY] ${signal}: shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
