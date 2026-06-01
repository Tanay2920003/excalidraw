# Excalidraw Tailscale Launcher

This repo includes a Docker-only launcher for private Excalidraw collaboration over Tailscale. It does not require Node, Yarn, ngrok, or router port forwarding on the host system. Docker runs the control panel, Excalidraw app, room server, storage backend, auth proxy, and Tailscale sidecar.

## Features

- Docker-hosted web control panel at `http://localhost:7842`
- Private Tailscale sharing with `tailscale/tailscale` running as a container
- Self-hosted Excalidraw room server and storage backend
- Generated Basic Auth credentials embedded in the copied share link
- Live Docker build/start logs in the control panel

## Prerequisites

- Docker Desktop
- A Tailscale auth key from the Tailscale admin console
- Collaborators signed into the same tailnet and allowed by your Tailscale ACLs

For the container pattern, Tailscale documents `TS_AUTHKEY`, `TS_STATE_DIR`, and `TS_USERSPACE=false` for Docker Compose sidecars that expose another container through the Tailscale network.

## Start On Windows

Run:

```powershell
.\launcher\launch.ps1
```

The script starts only the Docker-hosted control panel and opens `http://localhost:7842`. Paste your Tailscale auth key, keep or change the hostname, then start the secure session.

## Start Manually

```powershell
docker compose -f launcher/docker-compose.yml up gui -d --build
```

Then open:

```text
http://localhost:7842
```

## Stop Everything

From the launcher window, press Enter after you are finished. Or run:

```powershell
docker compose -f launcher/docker-compose.yml down
```

## Notes

- First start can take several minutes while Docker builds the Excalidraw image.
- Tailscale state is persisted in `launcher/tailscale-state` so repeated starts can reuse the same node identity.
- Redis data is persisted in `launcher/redis-data`.
- The shared link uses the configured Tailscale hostname on port `8080`.

## Screenshots

![Screenshot 1](projectimages/Screenshot%202026-05-31%20010804.png) ![Screenshot 2](projectimages/Screenshot%202026-05-31%20194334.png) ![Screenshot 3](projectimages/Screenshot%202026-05-31%20194437.png) ![Screenshot 4](projectimages/Screenshot%202026-05-31%20194457.png) ![Screenshot 5](projectimages/Screenshot%202026-05-31%20194514.png)
