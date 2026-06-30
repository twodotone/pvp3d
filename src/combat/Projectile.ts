import * as THREE from "three";
import { Combatant, type ProjectileSpawn } from "./Combatant.ts";
import {
  PROJECTILE_VISUALS,
  PROJECTILE_ANGLE_OFFSET,
  projectileAspect,
  projectileStart,
} from "../game/projectiles.ts";
import { frames as projFrames } from "../render/projectileTextures.ts";

/**
 * A travelling projectile drawn as a camera-facing Sprite, rotated in screen
 * space to point along its flight. Animates through its frame sequence; the
 * owning ProjectileSystem handles collision and culling.
 */
export class Projectile {
  readonly sprite: THREE.Sprite;
  readonly source: Combatant;
  readonly dir = new THREE.Vector3(); // normalized travel direction
  alive = true;

  readonly damage: number;
  readonly knockback: number;
  readonly radius: number;
  /** Visual-only (opponent's mirrored shot) — skip collision locally. */
  readonly ghost: boolean;

  private mat: THREE.SpriteMaterial;
  private texFrames: THREE.Texture[];
  private fps: number;
  private loop: boolean;
  private baseAngle: number;
  private start: number;
  private vel = new THREE.Vector3();
  private lifetime: number;
  private age = 0;

  constructor(spawn: ProjectileSpawn) {
    const vis = PROJECTILE_VISUALS[spawn.type];
    this.texFrames = projFrames(spawn.type);
    this.fps = vis.fps;
    this.loop = vis.loop;
    this.baseAngle = vis.baseAngle;
    this.start = projectileStart(spawn.type);

    this.mat = new THREE.SpriteMaterial({
      map: this.texFrames[0],
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.sprite = new THREE.Sprite(this.mat);
    const aspect = projectileAspect(spawn.type);
    this.sprite.scale.set(vis.length, vis.length * aspect, 1);
    this.sprite.position.copy(spawn.origin);

    this.dir.copy(spawn.dir).normalize();
    this.vel.copy(this.dir).multiplyScalar(spawn.speed);
    this.source = spawn.source;
    this.damage = spawn.damage;
    this.knockback = spawn.knockback;
    this.radius = spawn.radius;
    this.lifetime = spawn.lifetime;
    this.ghost = !!spawn.ghost;
  }

  get position(): THREE.Vector3 {
    return this.sprite.position;
  }
  get expired(): boolean {
    return this.age >= this.lifetime;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.age += dt;
    this.sprite.position.addScaledVector(this.vel, dt);

    // Step the frame, skipping the near-empty launch frames.
    const n = this.texFrames.length;
    const usable = Math.max(1, n - this.start);
    const step = Math.floor(this.age * this.fps);
    const idx = this.loop
      ? this.start + (step % usable)
      : Math.min(this.start + step, n - 1);
    this.mat.map = this.texFrames[idx];

    // Aim along the travel direction projected onto the camera's screen basis
    // (right/up). Aspect-independent, so diagonals aren't skewed.
    const e = camera.matrixWorld.elements;
    const sx = this.dir.x * e[0] + this.dir.y * e[1] + this.dir.z * e[2];
    const sy = this.dir.x * e[4] + this.dir.y * e[5] + this.dir.z * e[6];
    this.mat.rotation =
      Math.atan2(sy, sx) + this.baseAngle + PROJECTILE_ANGLE_OFFSET.value;
  }

  dispose(): void {
    this.mat.dispose();
  }
}

/**
 * Owns all in-flight projectiles: spawns them, advances them, resolves hits
 * against combatants (blocking/i-frames handled by receiveHit) and culls the
 * dead/expired/out-of-bounds.
 */
export class ProjectileSystem {
  private group = new THREE.Group();
  private active: Projectile[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  spawn(s: ProjectileSpawn): void {
    const p = new Projectile(s);
    this.group.add(p.sprite);
    this.active.push(p);
  }

  update(
    dt: number,
    camera: THREE.Camera,
    combatants: readonly Combatant[],
    bound: number,
  ): void {
    for (const p of this.active) {
      if (!p.alive) continue;
      p.update(dt, camera);

      const pos = p.position;
      if (p.expired || Math.abs(pos.x) > bound || Math.abs(pos.z) > bound) {
        p.alive = false;
        continue;
      }

      if (p.ghost) continue; // visual-only; owner's client resolves the hit

      for (const c of combatants) {
        if (c === p.source || !c.alive) continue;
        const dx = c.position.x - pos.x;
        const dz = c.position.z - pos.z;
        const r = p.radius + c.radius;
        if (dx * dx + dz * dz <= r * r) {
          c.receiveHit({
            damage: p.damage,
            knockback: p.knockback,
            fromDir: p.dir.clone(),
          });
          p.alive = false;
          break;
        }
      }
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (!p.alive) {
        this.group.remove(p.sprite);
        p.dispose();
        this.active.splice(i, 1);
      }
    }
  }

  get count(): number {
    return this.active.length;
  }
}
