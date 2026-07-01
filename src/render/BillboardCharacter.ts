import * as THREE from "three";
import { SHEET, DIR, PLAYER, RENDER } from "../config.ts";
import type { Action, ResolvedCharacter } from "../game/characters.ts";
import { cloneFor } from "./textures.ts";
import { blobShadowTexture } from "./shadowTexture.ts";

interface LoadedAnim {
  tex: THREE.Texture;
  fps: number;
  loop: boolean;
  frames: number;
}

/**
 * A character drawn as a camera-facing billboard that samples one frame of a
 * directional spritesheet. Owns its own cloned textures (one per animation) so
 * it can scrub frames independently of other characters, and can swap its whole
 * animation set at runtime (character select).
 *
 *  - holds the quad + unlit material (lighting is baked into the sprites)
 *  - plays / steps animations using each animation's own frame count
 *  - picks the direction row from a world-space facing seen by the camera
 *  - keeps the quad yawed toward the camera (upright cylindrical billboard)
 *  - grounds itself via a per-character anchor (+ optional blob shadow)
 */
export class BillboardCharacter {
  readonly object = new THREE.Group();

  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private anims = new Map<Action, LoadedAnim>();

  private current: Action = "idle";
  private loaded: LoadedAnim | null = null;
  private elapsed = 0;
  private frame = 0;
  private row: number = DIR.rows[0];
  private finished = false;
  private spriteH = PLAYER.spriteHeight;
  private flashTimer = 0;

  /** World-space facing angle in radians (atan2(dirX, dirZ)); 0 = +Z. */
  facing = 0;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.35,
      depthWrite: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const h = this.spriteH;
    const geo = new THREE.PlaneGeometry(h, h); // cell is square (128x128)
    geo.translate(0, h / 2, 0); // bottom edge at the group origin
    this.mesh = new THREE.Mesh(geo, this.material);
    this.object.add(this.mesh);

    if (RENDER.blobShadow) this.addBlobShadow();
  }

  private addBlobShadow(): void {
    const w = this.spriteH * 0.5;
    const geo = new THREE.PlaneGeometry(w, w * 0.55); // ellipse, iso-foreshortened
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: RENDER.blobShadowOpacity,
      toneMapped: false,
    });
    const blob = new THREE.Mesh(geo, mat);
    blob.position.y = 0.02;
    blob.renderOrder = 1;
    this.object.add(blob);
  }

  /** Load (or swap to) a character's full animation set. */
  async loadCharacter(rc: ResolvedCharacter): Promise<void> {
    const next = new Map<Action, LoadedAnim>();
    await Promise.all(
      (Object.entries(rc.anims) as [Action, ResolvedCharacter["anims"][Action]][]).map(
        async ([action, def]) => {
          if (!def) return;
          const tex = await cloneFor(def.url);
          tex.repeat.set(1 / SHEET.cols, 1 / SHEET.rows);
          next.set(action, { tex, fps: def.fps, loop: def.loop, frames: def.frames });
        },
      ),
    );

    // Swap in the new set, dispose the old.
    for (const a of this.anims.values()) a.tex.dispose();
    this.anims = next;

    // Ground the sprite: drop it so the content bottom sits at y=0.
    this.mesh.position.y = -this.spriteH * (1 - rc.anchor);

    this.loaded = null;
    this.play("idle", true);
  }

  /** Start an animation. No-op if already playing it (unless `restart`). */
  play(action: Action, restart = false): void {
    if (this.current === action && !restart && this.loaded) return;
    const next = this.anims.get(action) ?? this.anims.get("idle");
    if (!next) return;
    this.current = this.anims.has(action) ? action : "idle";
    this.loaded = next;
    this.elapsed = 0;
    this.frame = 0;
    this.finished = false;
    this.material.map = next.tex;
    this.material.needsUpdate = true;
  }

  get currentAnim(): Action {
    return this.current;
  }

  /** Current animation column (0-based). Used for hit timing. */
  get currentFrame(): number {
    return this.frame;
  }

  /** True once a non-looping animation has reached its last frame. */
  get isFinished(): boolean {
    return this.finished;
  }

  /** Ground anchor (feet) used by the depth sorter. */
  get anchorWorld(): THREE.Vector3 {
    return this.object.position;
  }

  /**
   * Tile-map mode uses the unified painter's sort (depthTest off); the legacy
   * greybox arena keeps the z-buffer. Toggle the sprite's depth behaviour.
   */
  setSortMode(unified: boolean): void {
    this.material.depthTest = !unified;
    this.material.depthWrite = !unified;
  }

  /** Painter's-sort order — set on the quad only, leaving the health bar on top. */
  setRenderOrder(order: number): void {
    this.mesh.renderOrder = order;
  }

  /** Uniformly scale the whole billboard about its feet (for a big boss sprite). */
  setScale(mul: number): void {
    this.object.scale.setScalar(mul);
  }

  /** Briefly tint the sprite red-bright on taking a hit. */
  flash(): void {
    this.flashTimer = 0.14;
  }

  /**
   * Choose the direction row from this character's world facing, as seen by the
   * camera (projected to screen space so it holds for any camera orientation).
   */
  private updateDirection(camera: THREE.Camera): void {
    const origin = this.object.position;
    const ahead = _v1.copy(origin).addScaledVector(_facingVec(this.facing), 1);

    const a = _v2.copy(origin).project(camera);
    const b = _v3.copy(ahead).project(camera);

    const dx = b.x - a.x;
    const dy = b.y - a.y;

    let angle = Math.atan2(dx, dy); // clockwise from screen-up (North)
    if (angle < 0) angle += Math.PI * 2;

    const slot =
      (Math.round(angle / (Math.PI / 4)) + DIR_ROW_OFFSET.value) % SHEET.rows;
    this.row = DIR.rows[(slot + SHEET.rows) % SHEET.rows];
  }

  /** Advance the animation clock and refresh the visible frame. */
  update(dt: number, camera: THREE.Camera): void {
    this.updateDirection(camera);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const t = Math.max(0, this.flashTimer / 0.14);
      this.material.color.setRGB(1 + t * 0.9, 1 - t * 0.35, 1 - t * 0.35);
      if (this.flashTimer <= 0) this.material.color.setRGB(1, 1, 1);
    }

    const anim = this.loaded;
    if (anim) {
      this.elapsed += dt;
      const total = Math.max(1, anim.frames);
      let f = Math.floor(this.elapsed * anim.fps);
      if (anim.loop) {
        f %= total;
      } else if (f >= total - 1) {
        f = total - 1;
        this.finished = true;
      }
      this.frame = f;

      anim.tex.offset.set(
        this.frame / SHEET.cols,
        1 - (this.row + 1) / SHEET.rows,
      );
    }

    // Keep the quad facing the camera horizontally (upright billboard).
    const cam = camera.position;
    const p = this.object.position;
    this.mesh.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    for (const a of this.anims.values()) a.tex.dispose();
  }
}

/** Live-tunable rotation of the direction mapping (the [ and ] keys). */
export const DIR_ROW_OFFSET = { value: 0 };

// Scratch vectors to avoid per-frame allocation.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _fv = new THREE.Vector3();
function _facingVec(facing: number): THREE.Vector3 {
  return _fv.set(Math.sin(facing), 0, Math.cos(facing));
}
