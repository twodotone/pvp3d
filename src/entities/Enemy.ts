import * as THREE from "three";
import { WORLD, PLAYER, COMBAT, ENEMY, ENEMY_BEHAVIORS } from "../config.ts";
import { Combatant, type HitInfo } from "../combat/Combatant.ts";
import { resolveCharacter, type Archetype } from "../game/characters.ts";
import type { ProjectileType } from "../game/projectiles.ts";
import { angleFromDir, dirFromAngle, arcCos } from "../core/mathx.ts";
import { feedback } from "../render/Feedback.ts";
import { sound } from "../audio/Sound.ts";

type State = "spawn" | "chase" | "attack" | "block" | "hurt" | "dead";

/** Per-spawn stat scaling applied on top of the enemy's base stats. */
export interface EnemyProfile {
  healthMul?: number;
  damageMul?: number;
  speedMul?: number;
  cooldownMul?: number;
  scale?: number; // sprite scale (>1 for a boss)
}

/**
 * A mobile AI fighter (team "enemy"). It perceives the nearest hostile, steers
 * toward it (melee closes; ranged holds a band and kites), and swings/fires on
 * its own state machine — dropping into the same post-intent combat seam every
 * other Combatant uses. A horde spreads via boids-style separation. The
 * WaveDirector owns spawning/culling; enemies never self-respawn.
 */
export class Enemy extends Combatant {
  readonly characterId: string;
  protected profile: EnemyProfile;
  protected state: State = "spawn";
  protected stateTime = 0;
  protected cooldown = 0;
  protected didHit = false;
  protected archetype: Archetype = "melee";
  protected projectileType?: ProjectileType;
  protected moveSpeed: number = ENEMY.baseSpeed;
  protected damageMul = 1;
  protected cooldownMul = 1;
  protected target: Combatant | null = null;

  // Ranged repositioning: a short *committed* relocate (turn-to-move), never a
  // continuous backpedal. `backstepCd` gates how often they give ground.
  private repoTimer = 0;
  private backstepCd = 0;
  private repoDir = new THREE.Vector3();

  // Per-type personality (filled from ENEMY_BEHAVIORS in load()).
  protected atkRange: number = ENEMY.melee.attackRange;
  protected atkArc: number = ENEMY.melee.arcDeg;
  protected atkDamage: number = ENEMY.melee.damage;
  protected atkKnockback: number = ENEMY.melee.knockback;
  protected atkActiveFrame: number = ENEMY.melee.activeFrame;
  protected atkCooldown: number = ENEMY.melee.cooldown;
  protected comfortMax: number = ENEMY.ranged.comfortMax;
  protected personalSpace: number = ENEMY.ranged.personalSpace;
  protected fireCooldown: number = ENEMY.ranged.cooldown;
  protected backstepCdBase: number = ENEMY.ranged.backstepCd;
  protected lungeSpeed = 0;
  protected lungeRange = 0;
  protected blockChance = 0;
  private lungeTimer = 0;
  private blockStarted = false;
  private blockDuration = 0;

  constructor(pos: THREE.Vector3, characterId: string, profile: EnemyProfile = {}) {
    super();
    this.team = "enemy";
    this.characterId = characterId;
    this.profile = profile;
    this.radius = PLAYER.radius;
    this.position.copy(pos);
    this.object.visible = false; // stay hidden until the art is loaded (no white-quad pop)
  }

  async load(): Promise<void> {
    const rc = resolveCharacter(this.characterId);
    this.archetype = rc.archetype;
    this.projectileType = rc.projectile;
    const st = rc.stats;
    const p = this.profile;
    this.maxHealth = (st.health ?? 80) * (p.healthMul ?? 1);
    this.health = this.maxHealth;
    this.moveSpeed = ENEMY.baseSpeed * (st.speed ?? 1) * (p.speedMul ?? 1);
    this.damageMul = p.damageMul ?? 1;
    this.cooldownMul = p.cooldownMul ?? 1;
    this.applyBehavior();
    await this.char.loadCharacter(rc);
    if (p.scale && p.scale !== 1) {
      this.char.setScale(p.scale);
      this.radius = PLAYER.radius * p.scale;
      this.showFloatingBar = false; // a boss uses the DOM health bar instead
    }
    this.char.play("idle", true);
    this.object.visible = true;
    this.setIFrames(ENEMY.spawnIFrames);
    feedback.spawn(this);
    sound.spawn(this);
  }

  /** Pull this enemy type's personality out of the behavior table. */
  private applyBehavior(): void {
    const b = ENEMY_BEHAVIORS[this.characterId];
    if (!b) return;
    if (b.poiseWindow !== undefined) this.poiseWindow = b.poiseWindow;
    this.atkRange = b.attackRange ?? this.atkRange;
    this.atkArc = b.arcDeg ?? this.atkArc;
    this.atkDamage = b.damage ?? this.atkDamage;
    this.atkKnockback = b.knockback ?? this.atkKnockback;
    this.atkActiveFrame = b.activeFrame ?? this.atkActiveFrame;
    this.atkCooldown = b.cooldown ?? this.atkCooldown;
    this.lungeSpeed = b.lungeSpeed ?? 0;
    this.lungeRange = b.lungeRange ?? 0;
    this.blockChance = b.blockChance ?? 0;
    this.comfortMax = b.comfortMax ?? this.comfortMax;
    this.personalSpace = b.personalSpace ?? this.personalSpace;
    this.fireCooldown = b.fireCooldown ?? this.fireCooldown;
    this.backstepCdBase = b.backstepCd ?? this.backstepCdBase;
  }

  /** True once dead and its death animation has played out — safe to remove. */
  get readyToCull(): boolean {
    return this.state === "dead" && (this.char.isFinished || this.stateTime > ENEMY.cullSeconds);
  }

  update(
    dt: number,
    combatants: readonly Combatant[],
    camera: THREE.Camera,
    blocked?: (x: number, y: number, z: number) => boolean,
  ): void {
    this.stateTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stepPhysics(dt);
    this.acquireTarget(combatants);

    switch (this.state) {
      case "spawn":
        this.char.play("idle");
        if (this.stateTime >= 0.15) this.enter("chase");
        break;
      case "chase":
        this.doChase(dt, combatants, blocked);
        break;
      case "attack":
        this.doAttack(dt);
        break;
      case "block":
        this.doBlock(dt);
        break;
      case "hurt":
        if (this.char.isFinished || this.stateTime >= COMBAT.player.hurtDuration) {
          this.enter("chase");
        }
        break;
      case "dead":
        break; // frozen on the death frame until the director culls us
    }

    this.applyBounds();
    this.char.update(dt, camera);
  }

  // --- Perception + steering -------------------------------------------

  private acquireTarget(combatants: readonly Combatant[]): void {
    let best: Combatant | null = null;
    let bestD = Infinity;
    for (const c of combatants) {
      if (c.team === this.team || !c.alive) continue;
      const d = this.dist2(c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    this.target = best;
  }

  private doChase(
    dt: number,
    combatants: readonly Combatant[],
    blocked?: (x: number, y: number, z: number) => boolean,
  ): void {
    const t = this.target;
    if (!t) {
      this.char.play("idle");
      return;
    }
    if (this.archetype === "ranged") this.doRanged(dt, t, combatants, blocked);
    else this.doMelee(dt, t, combatants);
  }

  private doMelee(dt: number, t: Combatant, combatants: readonly Combatant[]): void {
    this.faceTarget(t, dt);
    const stop = this.atkRange + t.radius;
    const dist = this.distanceTo(t);

    // Mid-lunge (Berserker): sprint the last gap, then swing on arrival.
    if (this.lungeTimer > 0) {
      this.lungeTimer -= dt;
      _desired.copy(this.toward(t));
      _desired.normalize();
      this.position.addScaledVector(_desired, this.lungeSpeed * dt);
      this.char.play("run");
      if (this.lungeTimer <= 0 || dist <= stop) {
        this.lungeTimer = 0;
        this.startAttack();
      }
      return;
    }

    if (this.cooldown <= 0 && dist <= stop) {
      this.startAttack();
      return;
    }
    // Reckless leap into range from just outside it.
    if (this.lungeSpeed > 0 && this.cooldown <= 0 && dist > stop && dist <= this.lungeRange) {
      this.lungeTimer = 0.25;
      return;
    }

    _desired.set(0, 0, 0);
    if (dist > stop) _desired.copy(this.toward(t));
    this.addSeparation(_desired, combatants);
    this.applySteering(dt);
  }

  /**
   * Ranged fighters hold ground and fire; they run *toward* the target to close
   * a gap, but when crowded they take a single short backstep (turning to face
   * where they run) and then plant to shoot — no endless magnet-like backpedal.
   */
  private doRanged(
    dt: number,
    t: Combatant,
    combatants: readonly Combatant[],
    blocked?: (x: number, y: number, z: number) => boolean,
  ): void {
    this.backstepCd = Math.max(0, this.backstepCd - dt);
    const dist = this.distanceTo(t);

    // Mid-backstep: commit to the relocate, facing the way we move.
    if (this.repoTimer > 0) {
      this.repoTimer -= dt;
      this.faceMoveDir(this.repoDir, dt);
      _desired.copy(this.repoDir);
      this.addSeparation(_desired, combatants);
      this.applySteering(dt);
      return;
    }

    // Too far to shoot — close in, running forward toward the target.
    if (dist > this.comfortMax) {
      this.faceTarget(t, dt);
      _desired.copy(this.toward(t));
      this.addSeparation(_desired, combatants);
      this.applySteering(dt);
      return;
    }

    // Crowded — give ground once, then hold.
    if (dist < this.personalSpace && this.backstepCd <= 0) {
      this.startBackstep(t);
      return;
    }

    // Plant and fire.
    this.faceTarget(t, dt);
    this.char.play("idle");
    if (this.cooldown <= 0 && dist <= this.comfortMax + ENEMY.ranged.fireSlack && this.lineOfSight(t, blocked)) {
      this.startAttack();
    }
  }

  /** Normalize + apply the accumulated steering in `_desired` (run if moving). */
  private applySteering(dt: number): void {
    if (_desired.lengthSq() > 1e-5) {
      _desired.normalize();
      this.position.addScaledVector(_desired, this.moveSpeed * dt);
      this.char.play("run");
    } else {
      this.char.play("idle");
    }
  }

  /** Begin a short committed backstep away from `t`, with a sideways bias. */
  private startBackstep(t: Combatant): void {
    _away.copy(this.position).sub(t.position);
    _away.y = 0;
    if (_away.lengthSq() < 1e-4) _away.set(1, 0, 0);
    _away.normalize();
    const side = Math.random() < 0.5 ? 1 : -1; // strafe so they don't line up
    this.repoDir.set(_away.x - _away.z * 0.7 * side, 0, _away.z + _away.x * 0.7 * side).normalize();
    this.repoTimer = ENEMY.ranged.backstepTime;
    this.backstepCd = this.backstepCdBase + Math.random() * 0.6;
  }

  /** Ease facing toward a movement direction (turn-to-move, quicker than aiming). */
  protected faceMoveDir(dir: THREE.Vector3, dt: number): void {
    if (dir.lengthSq() < 1e-6) return;
    const target = angleFromDir(dir.x, dir.z);
    let delta = target - this.char.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.char.facing += delta * Math.min(1, ENEMY.turnLerp * 1.8 * dt);
  }

  /** Sum a push away from nearby same-team enemies into `out`. */
  private addSeparation(out: THREE.Vector3, combatants: readonly Combatant[]): void {
    const rad = ENEMY.separationRadius;
    for (const c of combatants) {
      if (c === this || c.team !== this.team || !c.alive) continue;
      const dx = this.position.x - c.position.x;
      const dz = this.position.z - c.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-4 && d2 < rad * rad) {
        const d = Math.sqrt(d2);
        const push = ((rad - d) / rad) * ENEMY.separationStrength;
        out.x += (dx / d) * push;
        out.z += (dz / d) * push;
      }
    }
  }

  private lineOfSight(t: Combatant, blocked?: (x: number, y: number, z: number) => boolean): boolean {
    if (!blocked) return true;
    const y = COMBAT.ranged.muzzleHeight;
    for (let i = 1; i <= 8; i++) {
      const f = i / 8;
      const x = this.position.x + (t.position.x - this.position.x) * f;
      const z = this.position.z + (t.position.z - this.position.z) * f;
      if (blocked(x, y, z)) return false;
    }
    return true;
  }

  // --- Attacks ----------------------------------------------------------

  protected startAttack(): void {
    this.didHit = false;
    this.enter("attack");
    this.char.play(this.archetype === "ranged" ? ENEMY.ranged.anim : ENEMY.melee.anim, true);
    if (this.archetype !== "ranged") sound.swing(this);
  }

  protected doAttack(dt: number): void {
    if (this.target) this.faceTarget(this.target, dt * 2); // track a little during wind-up
    const active = this.archetype === "ranged" ? COMBAT.ranged.activeFrame : this.atkActiveFrame;
    if (!this.didHit && this.char.currentFrame >= active) {
      if (this.archetype === "ranged") this.postProjectile();
      else this.postMelee();
      this.didHit = true;
    }
    if (this.char.isFinished) {
      const base = this.archetype === "ranged" ? this.fireCooldown : this.atkCooldown;
      this.cooldown = base * this.cooldownMul;
      // Defensive types raise a guard for a beat between swings.
      if (this.blockChance > 0 && Math.random() < this.blockChance) this.enterBlock();
      else this.enter("chase");
    }
  }

  protected postMelee(): void {
    this.pendingMelee = {
      source: this,
      origin: this.position.clone(),
      facing: this.char.facing,
      range: this.atkRange,
      arcCos: arcCos(this.atkArc),
      damage: this.atkDamage * this.damageMul,
      knockback: this.atkKnockback,
    };
  }

  // --- Block (defensive types) -----------------------------------------

  private enterBlock(): void {
    this.enter("block");
    this.blocking = true;
    this.blockStarted = false;
    this.blockDuration = 0.5 + Math.random() * 0.6;
    this.char.play("blockStart", true);
  }

  private doBlock(dt: number): void {
    if (this.target) this.faceTarget(this.target, dt);
    if (!this.blockStarted && this.char.isFinished) {
      this.blockStarted = true;
      this.char.play("blockMid");
    }
    if (this.stateTime >= this.blockDuration) {
      this.blocking = false;
      this.enter("chase");
    }
  }

  protected postProjectile(): void {
    if (!this.projectileType) return;
    const r = COMBAT.ranged;
    const fwd = dirFromAngle(this.char.facing, _muzzle);
    const origin = this.position.clone().addScaledVector(fwd, r.muzzleForward);
    origin.y = r.muzzleHeight;
    this.pendingProjectile = {
      source: this,
      type: this.projectileType,
      origin,
      dir: fwd.clone(),
      speed: r.speed,
      damage: r.damage * this.damageMul,
      knockback: r.knockback,
      radius: r.radius,
      lifetime: r.lifetime,
    };
  }

  // --- Reactions --------------------------------------------------------

  protected override onHurt(_info: HitInfo): void {
    if (this.state === "dead") return;
    this.enter("hurt");
    this.char.play("hurt", true);
  }

  protected override onDeath(_info: HitInfo): void {
    this.enter("dead");
    this.char.play("die", true);
  }

  // --- Helpers ----------------------------------------------------------

  protected enter(state: State): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
    if (state !== "block") this.blocking = false; // guard only stays up while blocking
  }

  protected faceTarget(t: Combatant, dt: number): void {
    const dx = t.position.x - this.position.x;
    const dz = t.position.z - this.position.z;
    if (dx * dx + dz * dz <= 1e-4) return;
    const target = angleFromDir(dx, dz);
    let delta = target - this.char.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.char.facing += delta * Math.min(1, ENEMY.turnLerp * dt);
  }

  /** Unit vector (XZ) from us toward `t`, written into a shared temp. */
  private toward(t: Combatant): THREE.Vector3 {
    _toward.copy(t.position).sub(this.position);
    _toward.y = 0;
    const len = _toward.length();
    if (len > 1e-4) _toward.multiplyScalar(1 / len);
    return _toward;
  }

  protected distanceTo(c: Combatant): number {
    const dx = c.position.x - this.position.x;
    const dz = c.position.z - this.position.z;
    return Math.hypot(dx, dz);
  }

  private dist2(c: Combatant): number {
    const dx = c.position.x - this.position.x;
    const dz = c.position.z - this.position.z;
    return dx * dx + dz * dz;
  }

  protected applyBounds(): void {
    const b = WORLD.playBound;
    const p = this.position;
    p.x = THREE.MathUtils.clamp(p.x, -b, b);
    p.z = THREE.MathUtils.clamp(p.z, -b, b);
    p.y = 0;
  }
}

const _desired = new THREE.Vector3();
const _toward = new THREE.Vector3();
const _away = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
