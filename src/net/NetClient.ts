import type {
  NetMsg,
  StateMsg,
  HitMsg,
  ProjectileMsg,
} from "./protocol.ts";

export type NetStatus = "connecting" | "open" | "closed" | "full" | "error";

export interface NetHandlers {
  onAssign?: (selfId: string, slot: number, peers: string[]) => void;
  onJoin?: (id: string) => void;
  onLeave?: (id: string) => void;
  onState?: (m: StateMsg) => void;
  onHit?: (m: HitMsg) => void;
  onProjectile?: (m: ProjectileMsg) => void;
  onStatus?: (s: NetStatus) => void;
}

/** Thin WebSocket client for the relay. Owns the socket; Game owns the logic. */
export class NetClient {
  selfId = "";
  private ws: WebSocket | null = null;

  constructor(private handlers: NetHandlers = {}) {}

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(serverUrl: string, room: string): void {
    this.disconnect();
    this.handlers.onStatus?.("connecting");
    const url = `${serverUrl.replace(/\/$/, "")}/?room=${encodeURIComponent(room)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.handlers.onStatus?.("open");
    ws.onclose = () => {
      this.handlers.onStatus?.("closed");
      if (this.ws === ws) this.ws = null;
    };
    ws.onerror = () => this.handlers.onStatus?.("error");
    ws.onmessage = (ev) => {
      let m: NetMsg;
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      switch (m.t) {
        case "assign":
          this.selfId = m.id;
          this.handlers.onAssign?.(m.id, m.slot, m.peers);
          break;
        case "join": this.handlers.onJoin?.(m.id); break;
        case "leave": this.handlers.onLeave?.(m.id); break;
        case "full": this.handlers.onStatus?.("full"); break;
        case "state": this.handlers.onState?.(m); break;
        case "hit": this.handlers.onHit?.(m); break;
        case "projectile": this.handlers.onProjectile?.(m); break;
      }
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private send(m: NetMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendState(s: Omit<StateMsg, "t" | "id">): void {
    this.send({ t: "state", id: this.selfId, ...s });
  }

  sendHit(target: string, damage: number, knockback: number, dx: number, dz: number): void {
    this.send({ t: "hit", id: this.selfId, target, damage, knockback, dx, dz });
  }

  sendProjectile(p: Omit<ProjectileMsg, "t" | "id">): void {
    this.send({ t: "projectile", id: this.selfId, ...p });
  }
}
