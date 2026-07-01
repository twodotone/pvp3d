import * as THREE from "three";
import { Combatant, type HitInfo, type HitResult } from "../combat/Combatant.ts";
import { resolveCharacter, type Action } from "../game/characters.ts";
import { COMBAT, PLAYER } from "../config.ts";
import { lerpAngle } from "../core/mathx.ts";
import { feedback } from "../render/Feedback.ts";
import { sound } from "../audio/Sound.ts";
import type { StateMsg } from "../net/protocol.ts";

const INTERP_RATE = 14; // higher = snappier follow, lower = smoother

/**
 * A networked opponent. It's a full Combatant (so local attacks resolve against
 * it), but it's driven entirely by the peer's broadcast state — position/facing
 * are interpolated, the reported animation is played, and hp mirrors the peer.
 *
 * Crucially, `receiveHit` does NOT apply damage locally: the peer owns its own
 * health, so we just report the hit over the wire and let the peer's client
 * apply it and broadcast the new hp back.
 */
export class RemotePlayer extends Combatant {
  readonly netId: string;
  private reportHit: (info: HitInfo) => void;

  private targetPos = new THREE.Vector3();
  private targetFacing = 0;
  private lastAction = "idle";
  private charId = "";

  constructor(netId: string, reportHit: (info: HitInfo) => void) {
    super();
    this.netId = netId;
    this.reportHit = reportHit;
    this.maxHealth = COMBAT.player.maxHealth;
    this.health = this.maxHealth;
    this.radius = PLAYER.radius;
  }

  async setCharacter(id: string): Promise<void> {
    this.charId = id;
    await this.char.loadCharacter(resolveCharacter(id));
    this.char.play("idle", true);
  }

  /** Apply a snapshot from the peer. */
  applyState(m: StateMsg): void {
    this.targetPos.set(m.x, 0, m.z);
    this.targetFacing = m.facing;
    this.health = m.hp;
    const wasAlive = this.alive;
    this.alive = m.alive;
    if (wasAlive && !m.alive) {
      feedback.death(this);
      sound.death(this);
    } else if (!wasAlive && m.alive) {
      feedback.spawn(this);
      sound.spawn(this);
    }

    if (m.charId && m.charId !== this.charId) {
      void this.setCharacter(m.charId);
    }
    if (m.action !== this.lastAction) {
      this.char.play(m.action as Action, true);
      this.lastAction = m.action;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    const t = Math.min(1, dt * INTERP_RATE);
    this.position.lerp(this.targetPos, t);
    this.char.facing = lerpAngle(this.char.facing, this.targetFacing, t);
    this.char.update(dt, camera);
  }

  /**
   * Hit attribution is attacker-detected: instead of subtracting our (mirrored)
   * hp, report the hit to the peer, who applies it authoritatively.
   */
  override receiveHit(info: HitInfo): HitResult {
    if (!this.alive) return "ignored";
    feedback.hit(this, info.damage);
    sound.hit(this, info.damage);
    this.reportHit(info);
    return "hit";
  }
}
