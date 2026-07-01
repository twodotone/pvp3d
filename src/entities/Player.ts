import * as THREE from "three";
import { Input } from "../core/Input.ts";
import { PLAYER, WORLD, COMBAT, RESOURCE } from "../config.ts";
import { Combatant, type HitInfo } from "../combat/Combatant.ts";
import { resolveCharacter, type Archetype } from "../game/characters.ts";
import type { ProjectileType } from "../game/projectiles.ts";
import {
  SKILLS,
  LOADOUTS,
  DEFAULT_LOADOUT,
  SKILL_KEYS,
  SKILL_KEY_LABELS,
  type SkillDef,
  type SkillEffect,
} from "../game/skills.ts";
import { dirFromAngle, arcCos, screenToWorldDir } from "../core/mathx.ts";
import { feedback } from "../render/Feedback.ts";
import { sound } from "../audio/Sound.ts";

type State = "idle" | "run" | "attack" | "roll" | "block" | "hurt" | "dead" | "ability";

const COMBO = COMBAT.player.combo;

/**
 * The locally-controlled fighter. Movement + the attack/dodge/block triangle.
 * Shaped so the same entity could later be driven by network input for PvP.
 */
export class Player extends Combatant {
  private state: State = "idle";
  private stateTime = 0;
  private rollCooldown = 0;
  private rollDir = new THREE.Vector3(0, 0, 1);

  private comboStep = 0;
  private comboDidHit = false;
  private comboBuffered = false;
  private blockMidStarted = false;

  private spawnPoint = new THREE.Vector3();
  characterId = "1Knight";
  private archetype: Archetype = "melee";
  private projectileType?: ProjectileType;

  // Equipped skills (one per SKILL_KEYS slot) + per-slot cooldown timers.
  private skills: (SkillDef | null)[] = [null, null, null, null];
  private cooldowns = [0, 0, 0, 0];
  private activeSkill: SkillDef | null = null;
  private abilityDidEffect = false;
  private dashDir = new THREE.Vector3();

  /** Soft-locked enemy (set by Game from the aim direction); aiming snaps to it. */
  softTarget: Combatant | null = null;

  // Action economy (stamina for melee, mana for ranged).
  resource = 100;
  maxResource = 100;
  private resourceRegen = 0;
  private resourceRegenDelay = 0;
  private regenTimer = 0;
  private resourceName = "stamina";
  private resourceColor = "#5ad06a";
  private attackCost = 0;
  private rollCost = 0;
  private moveSpeed = PLAYER.moveSpeed;

  constructor() {
    super();
    this.maxHealth = COMBAT.player.maxHealth;
    this.health = this.maxHealth;
    this.radius = PLAYER.radius;
    this.blockArcCos = arcCos(COMBAT.player.block.arcDeg);
    this.poiseWindow = COMBAT.player.poiseWindow;
  }

  private spend(cost: number): boolean {
    if (this.resource < cost) return false;
    this.resource -= cost;
    this.regenTimer = this.resourceRegenDelay;
    return true;
  }

  /** Resource-bar view model for the HUD. */
  get resourceInfo(): { frac: number; color: string; name: string } {
    return {
      frac: this.maxResource > 0 ? this.resource / this.maxResource : 0,
      color: this.resourceColor,
      name: this.resourceName,
    };
  }

  async load(): Promise<void> {
    await this.setCharacter(this.characterId);
  }

  /** Load (or hot-swap to) a different character from the roster. */
  async setCharacter(id: string): Promise<void> {
    const rc = resolveCharacter(id);
    this.characterId = id;
    this.archetype = rc.archetype;
    this.projectileType = rc.projectile;
    this.skills = (LOADOUTS[id] ?? DEFAULT_LOADOUT).map((sid) => SKILLS[sid]);

    const rs = RESOURCE[rc.archetype];
    const st = rc.stats;
    this.maxHealth = st.health ?? COMBAT.player.maxHealth;
    this.health = this.maxHealth;
    this.moveSpeed = PLAYER.moveSpeed * (st.speed ?? 1);
    this.maxResource = st.resourceMax ?? rs.max;
    this.resource = this.maxResource;
    this.resourceRegen = st.resourceRegen ?? rs.regen;
    this.resourceRegenDelay = rs.regenDelay;
    this.resourceName = rs.name;
    this.resourceColor = rs.color;
    this.attackCost = rs.attackCost;
    this.rollCost = rs.rollCost;

    await this.char.loadCharacter(rc);
  }

  /** Place at a spawn point and remember it for respawns. */
  spawn(pos: THREE.Vector3): void {
    this.spawnPoint.copy(pos);
    this.position.copy(pos);
  }

  update(dt: number, camera: THREE.Camera, input: Input): void {
    this.stateTime += dt;
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    for (let i = 0; i < this.cooldowns.length; i++) {
      this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    }
    // Resource regen (paused briefly after spending).
    if (this.regenTimer > 0) this.regenTimer -= dt;
    else this.resource = Math.min(this.maxResource, this.resource + this.resourceRegen * dt);
    this.stepPhysics(dt);

    const move = this.readMoveInput(camera, input);

    switch (this.state) {
      case "idle":
      case "run":
        this.updateGrounded(dt, move, camera, input);
        break;
      case "attack":
        this.updateAttack(dt, camera, input);
        break;
      case "ability":
        this.updateAbility(dt);
        break;
      case "roll":
        this.updateRoll(dt);
        break;
      case "block":
        this.updateBlock(camera, input);
        break;
      case "hurt":
        if (this.stateTime >= COMBAT.player.hurtDuration || this.char.isFinished) {
          this.enter("idle");
        }
        break;
      case "dead":
        this.updateDead();
        break;
    }

    this.applyBounds();
    this.char.update(dt, camera);
  }

  // --- Grounded (free) --------------------------------------------------

  private updateGrounded(
    dt: number,
    move: THREE.Vector3,
    camera: THREE.Camera,
    input: Input,
  ): void {
    if (input.blockHeld) {
      this.startBlock();
      return;
    }
    for (let i = 0; i < SKILL_KEYS.length; i++) {
      const sk = this.skills[i];
      if (input.wasPressed(SKILL_KEYS[i]) && this.cooldowns[i] <= 0 && sk && this.resource >= sk.cost) {
        this.spend(sk.cost);
        this.startAbility(i, move, camera, input);
        return;
      }
    }
    if (input.primaryDown && this.resource >= this.attackCost) {
      this.spend(this.attackCost);
      this.startCombo(camera, input);
      return;
    }
    if (input.wasPressed("Space") && this.rollCooldown <= 0 && this.resource >= this.rollCost) {
      this.spend(this.rollCost);
      this.startRoll(move);
      return;
    }

    if (move.lengthSq() > 1e-4) {
      this.position.addScaledVector(move, this.moveSpeed * dt);
      this.faceTowards(move, dt);
      this.enter("run");
      this.char.play("run");
    } else {
      this.faceTargetIfLocked(); // at rest, turn to face the locked enemy
      this.enter("idle");
      this.char.play("idle");
    }
  }

  // --- Attack combo -----------------------------------------------------

  private startCombo(camera: THREE.Camera, input: Input): void {
    this.comboStep = 0;
    this.comboDidHit = false;
    this.comboBuffered = false;
    this.faceCursor(camera, input);
    this.enter("attack");
    this.char.play(COMBO[0].anim, true);
    if (this.archetype !== "ranged") sound.swing(this);
  }

  private updateAttack(dt: number, camera: THREE.Camera, input: Input): void {
    this.faceTargetIfLocked(); // keep the swing tracking the locked enemy
    // Cancel into a roll for responsiveness.
    if (input.wasPressed("Space") && this.rollCooldown <= 0 && this.resource >= this.rollCost) {
      this.spend(this.rollCost);
      this.startRoll(this.readMoveInput(camera, input));
      return;
    }

    // Ranged characters fire a single shot instead of chaining a melee combo.
    if (this.archetype === "ranged") {
      if (!this.comboDidHit && this.char.currentFrame >= COMBAT.ranged.activeFrame) {
        this.postProjectile();
        this.comboDidHit = true;
      }
      if (this.char.isFinished) this.enter("idle");
      return;
    }

    // Buffer the next chain link.
    if (input.primaryDown) this.comboBuffered = true;

    const def = COMBO[this.comboStep];

    // Small forward lunge at the start of each swing.
    if (this.stateTime < PLAYER.attack.lungeSeconds) {
      const dir = dirFromAngle(this.char.facing, _v);
      this.position.addScaledVector(dir, PLAYER.attack.lungeSpeed * dt);
    }

    // Register the hit once, on the active frame.
    if (!this.comboDidHit && this.char.currentFrame >= def.activeFrame) {
      this.postMelee(def);
      this.comboDidHit = true;
    }

    if (this.char.isFinished) {
      if (this.comboBuffered && this.comboStep < COMBO.length - 1) {
        this.comboStep++;
        this.comboDidHit = false;
        this.comboBuffered = false;
        this.faceCursor(camera, input);
        this.char.play(COMBO[this.comboStep].anim, true);
        this.stateTime = 0;
        sound.swing(this);
      } else {
        this.enter("idle");
      }
    }
  }

  private postMelee(def: (typeof COMBO)[number]): void {
    this.pendingMelee = {
      source: this,
      origin: this.position.clone(),
      facing: this.char.facing,
      range: def.range,
      arcCos: arcCos(def.arcDeg),
      damage: def.damage,
      knockback: def.knockback,
    };
  }

  private postProjectile(): void {
    if (!this.projectileType) return;
    const r = COMBAT.ranged;
    const fwd = dirFromAngle(this.char.facing, _v);
    const origin = this.position.clone().addScaledVector(fwd, r.muzzleForward);
    origin.y = r.muzzleHeight;
    this.pendingProjectile = {
      source: this,
      type: this.projectileType,
      origin,
      dir: fwd.clone(),
      speed: r.speed,
      damage: r.damage,
      knockback: r.knockback,
      radius: r.radius,
      lifetime: r.lifetime,
    };
  }

  // --- Skills (equipped abilities) -------------------------------------

  private startAbility(
    slot: number,
    move: THREE.Vector3,
    camera: THREE.Camera,
    input: Input,
  ): void {
    const skill = this.skills[slot];
    if (!skill) return;
    this.activeSkill = skill;
    this.abilityDidEffect = false;
    this.cooldowns[slot] = skill.cooldown;
    this.enter("ability");
    if (skill.effect.kind === "dash") {
      this.dashDir.copy(
        move.lengthSq() > 1e-4 ? move : dirFromAngle(this.char.facing, _v),
      );
      this.faceInstant(this.dashDir);
      this.setIFrames(skill.effect.iframes);
    } else {
      this.faceCursor(camera, input); // aim toward the cursor
    }
    this.char.play(skill.action, true);
    sound.skill(skill.effect.kind, this);
  }

  private updateAbility(dt: number): void {
    const skill = this.activeSkill;
    if (!skill) {
      this.enter("idle");
      return;
    }
    const eff = skill.effect;
    if (eff.kind !== "dash") this.faceTargetIfLocked(); // track for aimed skills

    if (eff.kind === "dash") {
      this.position.addScaledVector(this.dashDir, eff.speed * dt);
      if (this.stateTime >= eff.duration || this.char.isFinished) this.enter("idle");
      return;
    }

    if (!this.abilityDidEffect && this.char.currentFrame >= eff.activeFrame) {
      if (eff.kind === "melee") this.postSkillMelee(eff);
      else if (eff.kind === "projectile") this.postSkillProjectile(eff);
      else if (eff.kind === "heal") {
        this.health = Math.min(this.maxHealth, this.health + eff.amount);
      }
      this.abilityDidEffect = true;
    }
    if (this.char.isFinished) this.enter("idle");
  }

  private postSkillMelee(eff: Extract<SkillEffect, { kind: "melee" }>): void {
    this.pendingMelee = {
      source: this,
      origin: this.position.clone(),
      facing: this.char.facing,
      range: eff.range,
      arcCos: arcCos(eff.arcDeg),
      damage: eff.damage,
      knockback: eff.knockback,
    };
  }

  private postSkillProjectile(
    eff: Extract<SkillEffect, { kind: "projectile" }>,
  ): void {
    const type = eff.projectile ?? this.projectileType;
    if (!type) return;
    const fwd = dirFromAngle(this.char.facing, _v);
    const origin = this.position
      .clone()
      .addScaledVector(fwd, COMBAT.ranged.muzzleForward);
    origin.y = COMBAT.ranged.muzzleHeight;
    this.pendingProjectile = {
      source: this,
      type,
      origin,
      dir: fwd.clone(),
      speed: eff.speed,
      damage: eff.damage,
      knockback: eff.knockback,
      radius: eff.radius,
      lifetime: eff.lifetime,
    };
  }

  /** Skill-bar view model for the HUD. */
  get skillBar(): {
    key: string;
    name: string;
    color: string;
    cd: number;
    cdMax: number;
  }[] {
    return this.skills.map((s, i) => ({
      key: SKILL_KEY_LABELS[i],
      name: s?.name ?? "—",
      color: s?.color ?? "#445",
      cd: this.cooldowns[i],
      cdMax: s?.cooldown ?? 1,
    }));
  }

  // --- Roll (dodge) -----------------------------------------------------

  private startRoll(move: THREE.Vector3): void {
    this.rollDir.copy(
      move.lengthSq() > 1e-4 ? move : dirFromAngle(this.char.facing, _v),
    );
    this.faceInstant(this.rollDir);
    this.enter("roll");
    this.char.play("roll", true);
    this.rollCooldown = PLAYER.roll.cooldown;
    this.setIFrames(COMBAT.player.rollIFrames);
    sound.roll(this);
  }

  private updateRoll(dt: number): void {
    this.position.addScaledVector(this.rollDir, PLAYER.roll.speed * dt);
    if (this.stateTime >= PLAYER.roll.duration || this.char.isFinished) {
      this.enter("idle");
    }
  }

  // --- Block ------------------------------------------------------------

  private startBlock(): void {
    if (this.state === "block") return;
    this.blockMidStarted = false;
    this.enter("block");
    this.char.play("blockStart", true);
  }

  private updateBlock(camera: THREE.Camera, input: Input): void {
    this.faceCursor(camera, input);
    if (!input.blockHeld) {
      this.enter("idle");
      return;
    }
    if (!this.blockMidStarted && this.char.isFinished) {
      this.blockMidStarted = true;
      this.char.play("blockMid");
    }
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

  private updateDead(): void {
    if (this.stateTime >= 3) this.respawn();
  }

  private respawn(): void {
    this.health = this.maxHealth;
    this.alive = true;
    this.knockVel.set(0, 0, 0);
    this.position.copy(this.spawnPoint);
    this.enter("idle");
    this.char.play("idle", true);
    this.setIFrames(1.0);
    feedback.spawn(this);
    sound.spawn(this);
  }

  // --- Helpers ----------------------------------------------------------

  private enter(state: State): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
    this.blocking = state === "block";
  }

  private readMoveInput(camera: THREE.Camera, input: Input): THREE.Vector3 {
    input.getMoveAxis(_axis);
    if (_axis.lengthSq() < 1e-4) return _move.set(0, 0, 0);
    screenToWorldDir(camera, _axis.x, _axis.y, _move);
    if (_move.lengthSq() > 1) _move.normalize(); // keyboard clamps; sticks stay analog
    return _move;
  }

  /** Aim at the soft-locked target if we have one, else along the raw aim. */
  private faceCursor(camera: THREE.Camera, input: Input): void {
    if (this.faceTargetIfLocked()) return;
    if (input.getAimDir(camera, this.position, _aim)) this.faceInstant(_aim);
  }

  /** Snap to face the soft-locked enemy (for mid-action tracking). */
  private faceTargetIfLocked(): boolean {
    const t = this.softTarget;
    if (!t || !t.alive) return false;
    _aim.copy(t.position).sub(this.position);
    _aim.y = 0;
    if (_aim.lengthSq() <= 1e-4) return false;
    this.faceInstant(_aim);
    return true;
  }

  private faceTowards(dir: THREE.Vector3, dt: number): void {
    const target = Math.atan2(dir.x, dir.z);
    let delta = target - this.char.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.char.facing += delta * Math.min(1, PLAYER.turnLerp * dt);
  }

  private faceInstant(dir: THREE.Vector3): void {
    this.char.facing = Math.atan2(dir.x, dir.z);
  }

  private applyBounds(): void {
    const b = WORLD.playBound;
    const p = this.position;
    p.x = THREE.MathUtils.clamp(p.x, -b, b);
    p.z = THREE.MathUtils.clamp(p.z, -b, b);
    p.y = 0;
  }

  get debugState(): string {
    return this.state + (this.state === "attack" ? `:${this.comboStep + 1}` : "");
  }

  /** Snapshot for network broadcast. */
  netState(): {
    x: number; z: number; facing: number; action: string;
    hp: number; alive: boolean; charId: string;
  } {
    return {
      x: this.position.x,
      z: this.position.z,
      facing: this.char.facing,
      action: this.char.currentAnim,
      hp: this.health,
      alive: this.alive,
      charId: this.characterId,
    };
  }
}

const _move = new THREE.Vector3();
const _axis = new THREE.Vector2();
const _aim = new THREE.Vector3();
const _v = new THREE.Vector3();
