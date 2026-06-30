// Dumb WebSocket room relay for Arena Combat PvP.
//
// Client-authoritative: this server holds NO game state and runs NO game logic.
// It groups connections by room code and forwards every game message to the
// other members of that room. It only generates connection housekeeping
// (assign / join / leave).
//
//   Connect:  wss://host/?room=CODE
//   Run:      npm start   (PORT from env, default 8080)

import { WebSocketServer } from "ws";
import { createServer } from "node:http";

const PORT = process.env.PORT || 8080;
const ROOM_CAP = Number(process.env.ROOM_CAP) || 4; // players per room (FFA)

/** roomCode -> Map<id, ws> */
const rooms = new Map();
let nextId = 1;

// A tiny HTTP server so health checks (and Render) get a 200 on GET /.
const http = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("arena-relay ok\n");
});

const wss = new WebSocketServer({ server: http });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const room = (url.searchParams.get("room") || "lobby").slice(0, 24);
  const id = `p${nextId++}`;

  let members = rooms.get(room);
  if (!members) {
    members = new Map();
    rooms.set(room, members);
  }
  if (members.size >= ROOM_CAP) {
    send(ws, { t: "full" });
    ws.close();
    return;
  }

  // Assign the lowest free spawn slot in the room (so spawns don't collide).
  const usedSlots = new Set([...members.values()].map((w) => w.slot));
  let slot = 0;
  while (usedSlots.has(slot)) slot++;

  ws.id = id;
  ws.slot = slot;
  ws.room = room;
  members.set(id, ws);

  // Tell the newcomer its id + slot + who's already here; tell the others it joined.
  send(ws, { t: "assign", id, slot, peers: [...members.keys()].filter((p) => p !== id) });
  for (const [pid, pws] of members) {
    if (pid !== id) send(pws, { t: "join", id });
  }
  console.log(`+ ${id} -> room "${room}" (${members.size}/${ROOM_CAP})`);

  // Relay every game message verbatim to the other room members.
  ws.on("message", (data) => {
    const m = rooms.get(ws.room);
    if (!m) return;
    const text = data.toString();
    for (const [pid, pws] of m) {
      if (pid !== ws.id && pws.readyState === pws.OPEN) pws.send(text);
    }
  });

  ws.on("close", () => {
    const m = rooms.get(ws.room);
    if (!m) return;
    m.delete(ws.id);
    for (const [, pws] of m) send(pws, { t: "leave", id: ws.id });
    if (m.size === 0) rooms.delete(ws.room);
    console.log(`- ${ws.id} left room "${ws.room}"`);
  });
});

http.listen(PORT, () => console.log(`arena-relay listening on :${PORT}`));
