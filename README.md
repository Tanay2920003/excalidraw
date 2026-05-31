# Excalidraw Secure Session Launcher

> An ultra-secure, one-click local Excalidraw deployment that runs entirely in Docker. Share a single **Magic Link** with your internet collaborators to let them join instantly—no password dialogs, no complex router setup.

![Excalidraw GUI Launcher UI](https://github.com/excalidraw/excalidraw/assets/placeholder.png) *(The Launcher GUI)*

---

## 🚀 Features

- **Zero Host Dependencies**: You do not need Node.js, npm, or Yarn installed. If you don't have Docker, the launcher will automatically prompt and install it for you!
- **Web Control Panel**: A slick dark-mode GUI to control the Excalidraw session and copy your shareable link.
- **Instant Magic Links**: One click and your collaborators are in. No password dialogs. Unauthenticated access is hard-blocked (HTTP 403).
- **Secure ngrok Tunneling**: Traffic is end-to-end encrypted; no open ports on your home router.
- **Live Logs**: Watch the Docker build process directly in your browser.

---

## 🛠 Prerequisites

Nothing!

Literally just run the script. If Docker Desktop is missing, the script will automatically download the installer for you. 

*You will need a free [ngrok.com](https://ngrok.com) Authtoken when you launch the GUI, which takes 30 seconds to copy/paste.*

---

## 🎮 Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/excalidraw/excalidraw.git
cd excalidraw
```

### 2. Start the Control Panel

**On Windows:**
Double-click the `ExcalidrawLauncher.bat` file in the `launcher` folder, or run:
```powershell
powershell -ExecutionPolicy Bypass -File "launcher\launch.ps1"
```

**On Linux / macOS:**
```bash
chmod +x launcher/launch.sh
./launcher/launch.sh
```

### 3. Share & Collaborate

1. The script will automatically open your web browser to `http://localhost:7842`.
2. Paste your ngrok Authtoken (it saves automatically).
3. Click **Start Secure Session**.
4. Send the **Magic Link** shown on the screen to your friends. They click it and are instantly securely connected!
5. When finished, press **Stop Session**. Everything spins down cleanly.

---

## 🛡 How Secure Is It?

```
Desktop shortcut  ──▶  GUI Control Panel (localhost:7842)
                         │
                         ▼ (Starts Docker Compose)
                 Excalidraw dev container (port 3001)
                         ▲
                 Token + cookie auth proxy container
                         ▲
                 ngrok HTTPS tunnel container
                         ▲
               https://xxxx.ngrok-free.app/TOKEN  ← magic link
```

1. **64-character hex token**: Infeasible to brute force. Generated fresh every session.
2. **HMAC Session Cookies**: Once the token is visited, a signed cookie is created. All subsequent WebSockets (collaboration) are protected by this cookie.
3. **Container Isolation**: Excalidraw binds to `0.0.0.0` but only exists on an internal Docker network. Nothing on your host network can hit the unauthenticated dev server directly.

---

## 🧰 Troubleshooting

- **The build is taking forever?** The very first time you click "Start Session", Docker has to download the Node.js image and run `yarn install`. The GUI features a live log viewer so you can see exactly what it's downloading. Subsequent starts take less than 5 seconds.
- **Docker auto-install on Windows asks for a reboot:** Docker Desktop requires virtualization features. Let it reboot, then run the launcher script again.
