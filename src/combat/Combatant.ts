import * as THREE from "three";
import { BillboardCharacter } from "../render/BillboardCharacter.ts";
import { HealthBar } from "../render/HealthBar.ts";
import { dirFromAngle } from "../core/mathx.ts";
import { PLAYER } from "../config.ts";
import { feedback } from "../render/Feedback.ts";
import { sound } from "../audio/Sound.ts";
import type { ProjectileType } from "../game/projectiles.ts";

export type HitResult = "ignored" | "blocked" | "hit" | "killed";

export interface HitInfo {
  damage: number;
  knockback: number;
  /** Unit direction from attacker -> target (the way knockback pushes). */
  fromDir: THREE.Vector3;
}

/** A melee swing posted by an attacker for the resolver to test against. */
export interface MeleeQuery {
  source: Combatant;
  origin: THREE.Vector3;
  facing: number;
  range: number;
  arcCos: number;
  damage: number;
  knockback: number;
}

/** A projectile an attacker wants spawned (the game/system creates it). */
export interface ProjectileSpawn {
  source: Combatant;
  type: ProjectileType;
  origin: THREE.Vector3;
  dir: THREE.Vector3; // normalized travel direction (XZ plane)
  speed: number;
  damage: number;
  knockback: number;
  radius: number;
  lifetime: number;
  /** Visual-only mirror of a networked opponent's shot (no collision here). */
  ghost?: boolean;
}

/**
 * Shared base for everything that can fight: owns the billboard visual, a
 * health pool, knockback/i-frame physics and the hit/block resolution. Each
 * subclass reacts to outcomes by overriding the on* hooks (which drive its own
 * state machine) and posts its own attacks via `pendingMelee`.
 */
export abstract class Combatant {
  readonly char = new BillboardCharacter();
  readonly healthBar = new HealthBar(PLAYER.spriteHeight + 0.35);

  maxHealth = 100;
  health = 100;
  radius = PLAYER.radius;

  alive = true;
  /** Set true while a shield is actively raised. */
  blocking = false;
  protected blockArcCos = Math.cos(Math.PI / 2);

  protected iframeTimer = 0;
  protected knockVel = new THREE.Vector3();

  /** Stagger resistance: after a stagger, hits still hurt but don't re-stagger. */
  protected poiseTimer = 0;
  protected poiseWindow = 0.5;

  /** A swing waiting to be resolved this frame (consumed by the game). */
  protected pendingMelee: MeleeQuery | null = null;
  /** A projectile waiting to be spawned this frame (consumed by the game). */
  protected pendingProjectile: ProjectileSpawn | null = null;

  constructor() {
    this.char.object.add(this.healthBar.group);
  }

  get position(): THREE.Vector3 {
    return this.char.object.position;
  }
  get object(): THREE.Group {
    return this.char.object;
  }
  get invulnerable(): boolean {
    return this.iframeTimer > 0;
  }

  setIFrames(seconds: number): void {
    this.iframeTimer = Math.max(this.iframeTimer, seconds);
  }

  consumeMeleeQuery(): MeleeQuery | null {
    const q = this.pendingMelee;
    this.pendingMelee = null;
    return q;
  }

  consumeProjectile(): ProjectileSpawn | null {
    const s = this.pendingProjectile;
    this.pendingProjectile = null;
    return s;
  }

  /** Resolve an incoming hit. Returns what happened and fires a reaction hook. */
  receiveHit(info: HitInfo): HitResult {
    if (!this.alive || this.invulnerable) return "ignored";

    if (this.blocking) {
      // Threat lies opposite the knockback push direction.
      const facing = dirFromAngle(this.char.facing, _v);
      const threat = _w.copy(info.fromDir).negate();
      if (facing.dot(threat) >= this.blockArcCos) {
        this.knockVel.addScaledVector(info.fromDir, info.knockback * 0.25);
        sound.block(this);
        this.onBlocked(info);
        return "blocked";
      }
    }

    this.health -= info.damage;
    this.knockVel.addScaledVector(info.fromDir, info.knockback);

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      feedback.death(this);
      sound.death(this);
      this.onDeath(info);
      return "killed";
    }
    feedback.hit(this, info.damage);
    sound.hit(this, info.damage);
    // Only stagger if not still recovering poise — prevents chain stun-lock.
    if (this.poiseTimer <= 0) {
      this.poiseTimer = this.poiseWindow;
      this.onHurt(info);
    }
    return "hit";
  }

  /** Per-frame physics common to all combatants. Call from subclass update(). */
  protected stepPhysics(dt: number): void {
    if (this.iframeTimer > 0) this.iframeTimer -= dt;
    if (this.poiseTimer > 0) this.poiseTimer -= dt;
    if (this.knockVel.lengthSq() > 1e-5) {
      this.position.addScaledVector(this.knockVel, dt);
      this.knockVel.multiplyScalar(Math.pow(0.0002, dt));
      if (this.knockVel.lengthSq() < 1e-4) this.knockVel.set(0, 0, 0);
    }
  }

  /** Refresh the floating health bar (call after logic, with the camera). */
  refreshHealthBar(camera: THREE.Camera): void {
    this.healthBar.setFraction(this.health / this.maxHealth);
    this.healthBar.setVisible(this.alive);
    this.healthBar.faceCamera(camera);
  }

  // Reaction hooks — overridden by subclasses to enter hurt/dead/block states.
  protected onHurt(_info: HitInfo): void {}
  protected onBlocked(_info: HitInfo): void {}
  protected onDeath(_info: HitInfo): void {}
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
