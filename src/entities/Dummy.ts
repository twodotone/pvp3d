import * as THREE from "three";
import { WORLD, COMBAT } from "../config.ts";
import { Combatant, type HitInfo } from "../combat/Combatant.ts";
import { resolveCharacter, type Archetype } from "../game/characters.ts";
import type { ProjectileType } from "../game/projectiles.ts";
import { angleFromDir, dirFromAngle, arcCos } from "../core/mathx.ts";
import { feedback } from "../render/Feedback.ts";
import { sound } from "../audio/Sound.ts";

type State = "idle" | "attack" | "hurt" | "dead";

const CFG = COMBAT.dummy;

/**
 * A stationary training enemy. Faces the player, takes hits (with reactions),
 * and swings back when you get close — enough to make blocking and dodging
 * meaningful — then respawns so the practice loop never stops. Deliberately
 * has no navigation: it holds its ground.
 */
export class Dummy extends Combatant {
  private state: State = "idle";
  private stateTime = 0;
  private cooldown = 0;
  private didHit = false;
  private spawnPoint = new THREE.Vector3();
  private characterId: string;
  private archetype: Archetype = "melee";
  private projectileType?: ProjectileType;

  constructor(pos: THREE.Vector3, characterId = "1Knight") {
    super();
    this.maxHealth = CFG.maxHealth;
    this.health = this.maxHealth;
    this.radius = CFG.radius;
    this.characterId = characterId;
    this.spawnPoint.copy(pos);
    this.position.copy(pos);
  }

  async load(): Promise<void> {
    const rc = resolveCharacter(this.characterId);
    this.archetype = rc.archetype;
    this.projectileType = rc.projectile;
    await this.char.loadCharacter(rc);
    this.char.play("idle", true);
  }

  update(dt: number, player: Combatant, camera: THREE.Camera): void {
    this.stateTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stepPhysics(dt);

    switch (this.state) {
      case "idle": {
        this.facePlayer(player);
        this.char.play("idle");
        const aggro =
          this.archetype === "ranged" ? CFG.rangedAggro : CFG.aggroRange;
        if (
          this.alive &&
          player.alive &&
          this.cooldown <= 0 &&
          this.distanceTo(player) <= aggro
        ) {
          this.startAttack(player);
        }
        break;
      }

      case "attack": {
        const active =
          this.archetype === "ranged"
            ? COMBAT.ranged.activeFrame
            : CFG.attack.activeFrame;
        if (!this.didHit && this.char.currentFrame >= active) {
          if (this.archetype === "ranged") this.postProjectile();
          else this.postMelee();
          this.didHit = true;
        }
        if (this.char.isFinished) {
          this.cooldown = CFG.attack.cooldown;
          this.enter("idle");
        }
        break;
      }

      case "hurt":
        if (this.char.isFinished) this.enter("idle");
        break;

      case "dead":
        if (this.stateTime >= CFG.respawnDelay) this.respawn();
        break;
    }

    this.applyBounds();
    this.char.update(dt, camera);
  }

  private startAttack(player: Combatant): void {
    this.facePlayer(player);
    this.didHit = false;
    this.enter("attack");
    this.char.play(CFG.attack.anim, true);
    if (this.archetype !== "ranged") sound.swing(this);
  }

  private postMelee(): void {
    this.pendingMelee = {
      source: this,
      origin: this.position.clone(),
      facing: this.char.facing,
      range: CFG.attack.range,
      arcCos: arcCos(CFG.attack.arcDeg),
      damage: CFG.attack.damage,
      knockback: CFG.attack.knockback,
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

  protected override onHurt(_info: HitInfo): void {
    if (this.state === "dead") return;
    this.enter("hurt");
    this.cooldown = Math.max(this.cooldown, 0.4);
    this.char.play("hurt", true);
  }

  protected override onDeath(_info: HitInfo): void {
    this.enter("dead");
    this.char.play("die", true);
  }

  private respawn(): void {
    this.health = this.maxHealth;
    this.alive = true;
    this.knockVel.set(0, 0, 0);
    this.position.copy(this.spawnPoint);
    this.enter("idle");
    this.char.play("idle", true);
    this.setIFrames(0.5);
    feedback.spawn(this);
    sound.spawn(this);
  }

  private enter(state: State): void {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
  }

  private facePlayer(player: Combatant): void {
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    if (dx * dx + dz * dz > 1e-4) this.char.facing = angleFromDir(dx, dz);
  }

  private distanceTo(c: Combatant): number {
    const dx = c.position.x - this.position.x;
    const dz = c.position.z - this.position.z;
    return Math.hypot(dx, dz);
  }

  private applyBounds(): void {
    const b = WORLD.playBound;
    const p = this.position;
    p.x = THREE.MathUtils.clamp(p.x, -b, b);
    p.z = THREE.MathUtils.clamp(p.z, -b, b);
    p.y = 0;
  }
}

const _v = new THREE.Vector3();
