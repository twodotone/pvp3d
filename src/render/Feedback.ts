import * as THREE from "three";
import type { Combatant } from "../combat/Combatant.ts";

/**
 * Reusable combat-juice layer. Combat events (hit/death/spawn) fire into this
 * singleton, which handles the "feel": sprite hit-flash, floating damage
 * numbers, ground bursts, screen shake, and a kill/death feed. Game inits it
 * with the scene + local player, pumps `update`, and applies `cameraShake`.
 */
interface DamageNum {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  tex: THREE.Texture;
  age: number;
  life: number;
}
interface Burst {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
}

class Feedback {
  private scene: THREE.Scene | null = null;
  private local: Combatant | null = null;
  private feedEl: HTMLElement | null = null;
  private numbers: DamageNum[] = [];
  private bursts: Burst[] = [];
  private shakeAmt = 0;

  init(scene: THREE.Scene, local: Combatant): void {
    this.scene = scene;
    this.local = local;
    this.feedEl = document.getElementById("killfeed");
  }

  // --- Events -----------------------------------------------------------

  hit(target: Combatant, damage: number): void {
    target.char.flash();
    const isLocal = target === this.local;
    this.damageNumber(target.position, damage, isLocal);
    this.shakeAmt = Math.max(this.shakeAmt, isLocal ? 0.32 : 0.12);
  }

  death(target: Combatant): void {
    this.burst(target.position, 0xffb056);
    this.shakeAmt = Math.max(this.shakeAmt, 0.5);
    this.feed(target === this.local ? "You were defeated" : "Enemy down");
  }

  spawn(target: Combatant): void {
    this.burst(target.position, 0x66b7ff);
  }

  // --- Per-frame --------------------------------------------------------

  update(dt: number): void {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);

    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      n.sprite.position.y += dt * 1.6;
      n.mat.opacity = 1 - n.age / n.life;
      if (n.age >= n.life) {
        this.scene?.remove(n.sprite);
        n.tex.dispose();
        n.mat.dispose();
        this.numbers.splice(i, 1);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const t = b.age / b.life;
      const s = 0.4 + t * 2.4;
      b.mesh.scale.set(s, s, s);
      b.mat.opacity = 1 - t;
      if (b.age >= b.life) {
        this.scene?.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  /** Jitter the camera after lookAt for a punchy screen shake. */
  cameraShake(camera: THREE.Camera): void {
    if (this.shakeAmt <= 0) return;
    camera.position.x += (Math.random() * 2 - 1) * this.shakeAmt;
    camera.position.z += (Math.random() * 2 - 1) * this.shakeAmt;
  }

  // --- Builders ---------------------------------------------------------

  private damageNumber(pos: THREE.Vector3, dmg: number, taken: boolean): void {
    if (!this.scene) return;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 44px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#0a0c12";
    const big = dmg >= 25;
    ctx.fillStyle = taken ? "#ff5b5b" : big ? "#ffd24a" : "#ffffff";
    const s = String(Math.round(dmg));
    ctx.strokeText(s, 64, 34);
    ctx.fillText(s, 64, 34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(mat);
    const sc = big ? 1.5 : 1.05;
    sprite.scale.set(sc, sc * 0.5, 1);
    sprite.position.set(pos.x + (Math.random() - 0.5) * 0.6, 2.4, pos.z);
    sprite.renderOrder = 3e6;
    this.scene.add(sprite);
    this.numbers.push({ sprite, mat, tex, age: 0, life: 0.75 });
  }

  private burst(pos: THREE.Vector3, color: number): void {
    if (!this.scene) return;
    const geo = new THREE.RingGeometry(0.3, 0.5, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, 0.1, pos.z);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.bursts.push({ mesh, mat, age: 0, life: 0.45 });
  }

  private feed(text: string): void {
    if (!this.feedEl) return;
    const line = document.createElement("div");
    line.className = "feed-line";
    line.textContent = text;
    this.feedEl.appendChild(line);
    setTimeout(() => line.remove(), 2600);
    while (this.feedEl.childElementCount > 5) {
      this.feedEl.firstElementChild?.remove();
    }
  }
}

export const feedback = new Feedback();
