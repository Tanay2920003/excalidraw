# Defense Collaboration Plan

## Goal

Turn the local Excalidraw + Tailscale launcher into a controlled collaboration room for small trusted teams. The target behavior is:

- one secure invite link from the Excalidraw share dialog
- visible active profiles and named cursors
- host approval before a new participant can enter
- explicit deny/remove controls
- self-hosted room, storage, and logs
- no plaintext canvas data on the relay server

## Current Foundation

- The launcher starts Excalidraw, the room server, storage, proxy, and Tailscale.
- The proxy protects the private Tailscale endpoint with generated Basic Auth credentials.
- Excalidraw collaboration data remains encrypted in the browser.
- Remote cursor names already render on the canvas when users set a name.

## Phase 1: Reliable Secure Session

- Always rebuild changed launcher images with Docker cache during session start.
- Inject the authenticated Tailscale URL into Excalidraw as `VITE_APP_PUBLIC_URL`.
- Generate collaboration room links from that authenticated private URL.
- Route `/socket.io/` through the protected proxy to the room server.
- Show active profiles, room status, and encrypted-data status in the share dialog.
- Keep the host machine Docker-only; the `tailscale/tailscale` client runs as a sidecar container.

## Phase 2: Admission Control

This requires a custom room server. Frontend-only approval is not sufficient, because an unapproved browser could still connect directly to Socket.IO.

Server changes:

- add pending join state per room
- require each client to send a join request with display name and nonce
- notify the room host over a host-only socket event
- hold the pending client outside the room until approved
- emit approved/denied responses to the pending client
- support host kick/remove events
- expire pending requests automatically

Client changes:

- show a Google Meet-style approval popup to the host
- show a waiting-room screen to the requester
- show deny and remove controls in the active profiles list
- block scene sync until approval is confirmed

## Phase 3: Identity And Policy

- Replace shared Basic Auth links with per-user invite tokens.
- Add signed room tokens with expiry, room ID, role, and display name.
- Support roles: host, editor, viewer.
- Optional allowlist by email, device, or Tailscale identity.
- Optional per-room policy based on tailnet users, groups, or devices.

## Phase 4: Operational Controls

- Audit events: room created, join requested, approved, denied, removed, left.
- Host-visible network metadata without exposing drawing content.
- Session expiry and one-click room teardown.
- Local-only log retention policy.
- Exportable incident log for room lifecycle events.

## Phase 5: Defense Hardening

- Prefer VPN-only access for sensitive use.
- Pin container image versions.
- Add TLS termination under controlled domain names.
- Add CSP and strict proxy headers.
- Document data-flow boundaries and residual metadata exposure.
