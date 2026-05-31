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

Please ensure you have **Docker** installed on your system.
You can download and install Docker Desktop from the [official Docker website](https://docs.docker.com/get-docker/).

---

## 🎮 Getting Started

### 1. Clone the repo

First, download the repository and navigate into the **`excalidraw/launcher`** directory from the start:

```bash
git clone https://github.com/excalidraw/excalidraw.git
cd excalidraw/launcher
```

### 2. Setup and Run with Docker

Here are the setup and run commands for your operating system. We will use Docker to build and start the application easily.

**On Windows (PowerShell):**
```powershell
# docker-compose up: Starts the containers
# -d: Runs the containers in the background (detached mode)
# --build: Forces a rebuild of the Docker image to ensure you have the latest changes
docker-compose up -d --build
```

**On Linux / macOS:**
```bash
# docker-compose up: Starts the containers
# -d: Runs the containers in the background (detached mode)
# --build: Forces a rebuild of the Docker image to ensure you have the latest changes
docker-compose up -d --build
```

### 3. Open the Launcher

Once the Docker container is running, open your web browser and navigate to the Control Panel at:
`http://localhost:7842`

### 4. Stopping the Application

When you are finished, you can stop the server and clean up the containers by running:

```bash
# docker-compose down: Stops and removes the containers and networks created by 'up'
docker-compose down
```

---

## 🧰 Troubleshooting

- **The build is taking forever?** The first time you run `docker-compose up -d --build`, Docker needs to download the necessary images and install dependencies. This may take a few minutes. Subsequent starts will be much faster!

---

## 📸 Screenshots

![Screenshot 1](projectimages/Screenshot%202026-05-31%20010804.png)
![Screenshot 2](projectimages/Screenshot%202026-05-31%20194334.png)
![Screenshot 3](projectimages/Screenshot%202026-05-31%20194437.png)
![Screenshot 4](projectimages/Screenshot%202026-05-31%20194457.png)
![Screenshot 5](projectimages/Screenshot%202026-05-31%20194514.png)
