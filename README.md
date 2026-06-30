# pvp3d — 2.5D web arena combat

A browser arena fighter: pre-rendered 8-directional sprite characters rendered as
camera-facing billboards in a 3D three.js scene, with skill-based combat and
online 1v1 PvP.

- **Client:** Vite + TypeScript + three.js (static site).
- **Server:** a tiny WebSocket relay for PvP (`server/`).

## Run locally

```bash
npm install
npm run dev          # client at the printed URL

# in another terminal, for PvP:
cd server && npm install && npm start   # relay on :8080
```

Open two browser windows, enter the same room code in the top-right **netbar**,
and click **Play Online**.

## Controls

`WASD` move · `L-Click` attack · `R-Mouse` block · `Space` roll ·
`Q E R F` skills · `1–9` swap character.

## Build & deploy

```bash
npm run build        # static client -> dist/
```

- **Client:** host `dist/` on any static host (it's a pure static site).
- **Server:** deploy `server/` to any Node host (Render/Railway/Fly) — see
  [server/README.md](server/README.md). Build the client with
  `VITE_SERVER_URL=wss://your-server npm run build` so it points at the relay.

## Assets

The large third-party source art packs live in `assets/` and are **not committed**
(licensed packs — not redistributed). The game-ready WebP under `public/` *is*
committed, so the app runs straight from a clone. To regenerate `public/` after
changing art, drop the packs back into `assets/` and run `npm run sheets`.
