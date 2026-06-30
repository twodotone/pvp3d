import type { ProjectileType } from "../game/projectiles.ts";

/**
 * Wire protocol for the client-authoritative relay. Client→client messages
 * (state/hit/projectile) carry the sender's `id`; the server forwards them
 * verbatim and generates the housekeeping messages (assign/join/leave/full).
 */

/** Broadcast ~20 Hz: a fighter's current snapshot. */
export interface StateMsg {
  t: "state";
  id: string;
  x: number;
  z: number;
  facing: number;
  action: string; // current animation (Action name)
  hp: number;
  alive: boolean;
  charId: string;
}

/** "I hit you" — the victim applies it to its own player. */
export interface HitMsg {
  t: "hit";
  id: string; // attacker
  target: string; // victim
  damage: number;
  knockback: number;
  dx: number; // knockback direction (XZ)
  dz: number;
}

/** A projectile spawn the peer should mirror visually. */
export interface ProjectileMsg {
  t: "projectile";
  id: string; // owner
  ptype: ProjectileType;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  damage: number;
  knockback: number;
  radius: number;
  lifetime: number;
}

// Server → client housekeeping.
export interface AssignMsg { t: "assign"; id: string; peers: string[]; }
export interface JoinMsg { t: "join"; id: string; }
export interface LeaveMsg { t: "leave"; id: string; }
export interface FullMsg { t: "full"; }

export type NetMsg =
  | StateMsg
  | HitMsg
  | ProjectileMsg
  | AssignMsg
  | JoinMsg
  | LeaveMsg
  | FullMsg;
