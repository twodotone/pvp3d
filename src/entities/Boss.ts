import * as THREE from "three";
import { COMBAT } from "../config.ts";
import type { Combatant } from "../combat/Combatant.ts";
import { arcCos, dirFromAngle } from "../core/mathx.ts";
import { feedback } from "../render/Feedback.ts";
import { sound } from "../audio/Sound.ts";
import { Enemy } from "./Enemy.ts";

type Attack = "fan" | "aoe";

/**
 * The Death Lord. A scaled-up Enemy that trades the basic single shot for a
 * rotation of telegraphed attacks — a spread fan of death bolts and a ground
 * AoE nova that warns before it lands (so it stays dodgeable) — and enrages at
 * half health (faster, wider). Reuses the base chase/kite AI and the shared
 * post-intent combat seam (pendingMelee for the AoE, pendingProjectiles for the
 * fan).
 */
export class Boss extends Enemy {
  private phase2 = false;
  private attackNo = 0;
  private current: Attack = "fan";

  private aoeTimer = 0;
  private aoeRadius = 0;
  private aoeDamage = 0;
  private aoeCenter = new THREE.Vector3();

  override update(
    dt: number,
    combatants: readonly Combatant[],
    camera: THREE.Camera,
    blocked?: (x: number, y: number, z: number) => boolean,
  ): void {
    if (!this.phase2 && this.alive && this.health <= this.maxHealth * 0.5) {
      this.phase2 = true;
      feedback.banner("The Death Lord rages!");
    }
    if (this.aoeTimer > 0) {
      this.aoeTimer -= dt;
      if (this.aoeTimer <= 0) this.detonateAoE();
    }
    super.update(dt, combatants, camera, blocked);
  }

  protected override startAttack(): void {
    this.didHit = false;
    this.enter("attack");
    this.attackNo++;
    this.current = this.attackNo % 2 === 0 ? "aoe" : "fan";
    this.char.play(this.current === "aoe" ? "special1" : "cast", true);
    sound.skill(this.current === "aoe" ? "melee" : "projectile", this);
  }

  protected override doAttack(dt: number): void {
    if (this.target) this.faceTarget(this.target, dt * 2);
    if (!this.didHit && this.char.currentFrame >= 8) {
      if (this.current === "aoe") this.beginAoE();
      else this.fireFan();
      this.didHit = true;
    }
    if (this.char.isFinished) {
      this.cooldown = (this.phase2 ? 1.1 : 1.7) * this.cooldownMul;
      this.enter("chase");
    }
  }

  /** A spread of death bolts fanned toward the target. */
  private fireFan(): void {
    if (!this.projectileType || !this.target) return;
    const count = this.phase2 ? 5 : 3;
    const spread = THREE.MathUtils.degToRad(this.phase2 ? 52 : 34);
    const r = COMBAT.ranged;
    for (let i = 0; i < count; i++) {
      const a = this.char.facing + spread * (i / (count - 1) - 0.5);
      const fwd = dirFromAngle(a, new THREE.Vector3());
      const origin = this.position.clone().addScaledVector(fwd, r.muzzleForward);
      origin.y = r.muzzleHeight;
      this.pendingProjectiles.push({
        source: this,
        type: this.projectileType,
        origin,
        dir: fwd.clone(),
        speed: r.speed,
        damage: r.damage * this.damageMul,
        knockback: r.knockback,
        radius: r.radius,
        lifetime: r.lifetime,
      });
    }
  }

  /** Mark a danger zone on the target, then detonate after the wind-up. */
  private beginAoE(): void {
    if (!this.target) return;
    this.aoeRadius = this.phase2 ? 4.5 : 3.5;
    this.aoeDamage = 24 * this.damageMul;
    this.aoeCenter.copy(this.target.position);
    const delay = 0.9;
    feedback.telegraph(this.aoeCenter, this.aoeRadius, delay);
    this.aoeTimer = delay;
  }

  /** The boss doesn't flinch — hits flash + tick damage, but never interrupt a
   * telegraphed attack, so its moves stay readable and can't be stun-locked. */
  protected override onHurt(): void {}

  private detonateAoE(): void {
    this.pendingMelee = {
      source: this,
      origin: this.aoeCenter.clone(),
      facing: this.char.facing,
      range: this.aoeRadius,
      arcCos: arcCos(360), // full circle
      damage: this.aoeDamage,
      knockback: 13,
    };
    sound.skill("melee", this);
  }
}
