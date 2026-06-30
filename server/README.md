# Arena Relay (PvP WebSocket server)

A dumb room relay for client-authoritative PvP. No game state, no game logic — it
groups connections by `?room=CODE` and forwards every message to the other room
members.

## Run locally

```
cd server
npm install
npm start            # listens on :8080  (PORT env to override)
```

Clients connect to `ws://localhost:8080/?room=CODE`.

## Deploy to Render (free, always-on `wss://`)

1. Push this repo to GitHub.
2. Render → **New → Web Service** → connect the repo.
3. Settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - Instance type: **Free**
4. Deploy. Render gives a URL like `https://arena-relay.onrender.com`.
   The WebSocket URL is the same host with `wss://`:
   `wss://arena-relay.onrender.com/?room=CODE`.
5. Put that `wss://…` origin in the client config (`SERVER_URL` in
   `src/config.ts`, or a `VITE_SERVER_URL` env at build time), rebuild the
   client, redeploy the static site.

**Note:** the Render free tier sleeps after ~15 min idle, so the first connection
after a lull takes ~30 s to wake. Fine for testing.

## Protocol

Client → server (relayed verbatim to the peer): `state`, `hit`, `projectile`
(see `src/net/protocol.ts`). Server → client housekeeping: `assign`, `join`,
`leave`, `full`.
