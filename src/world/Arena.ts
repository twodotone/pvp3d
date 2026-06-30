import * as THREE from "three";
import { WORLD } from "../config.ts";

/**
 * The greybox playfield: flat ground, a reference grid, perimeter walls and a
 * scatter of cover boxes, plus lighting for the 3D geometry. (Characters are
 * unlit billboards, so these lights only shade the greybox itself.)
 */
interface ObstacleAABB {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export class Arena {
  readonly group = new THREE.Group();
  private grid: THREE.GridHelper;
  /** Solid box footprints (XZ) for movement collision. */
  private obstacles: ObstacleAABB[] = [];

  constructor(scene: THREE.Scene) {
    const size = WORLD.arenaSize;

    // --- Ground ---------------------------------------------------------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // --- Reference grid -------------------------------------------------
    this.grid = new THREE.GridHelper(size, size, 0x5c6370, 0x2a2e38);
    this.grid.position.y = 0.01;
    (this.grid.material as THREE.Material).opacity = 0.5;
    (this.grid.material as THREE.Material).transparent = true;
    this.group.add(this.grid);

    // --- Perimeter walls -----------------------------------------------
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x4a5060,
      roughness: 0.9,
    });
    const wallH = 2.2;
    const t = 0.6;
    const half = size / 2;
    const walls: [number, number, number, number][] = [
      [0, -half, size, t], // north
      [0, half, size, t], // south
      [-half, 0, t, size], // west
      [half, 0, t, size], // east
    ];
    for (const [x, z, w, d] of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      wall.position.set(x, wallH / 2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
    }

    // --- Cover boxes ----------------------------------------------------
    const coverMat = new THREE.MeshStandardMaterial({
      color: 0x6b7280,
      roughness: 0.8,
    });
    const covers: [number, number, number][] = [
      [-7, -6, 1.6],
      [8, 5, 2.0],
      [6, -9, 1.2],
      [-9, 9, 1.8],
      [0, 0, 1.0],
    ];
    for (const [x, z, s] of covers) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), coverMat);
      box.position.set(x, s / 2, z);
      box.castShadow = true;
      box.receiveShadow = true;
      this.group.add(box);
      this.obstacles.push({ x, z, hx: s / 2, hz: s / 2 });
    }

    // --- Lighting -------------------------------------------------------
    const hemi = new THREE.HemisphereLight(0xbcd0ff, 0x2a2418, 0.9);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2e0, 1.6);
    sun.position.set(14, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half;
    c.near = 1; c.far = 80;
    this.group.add(sun);
    this.group.add(sun.target);

    scene.add(this.group);
  }

  toggleGrid(): void {
    this.grid.visible = !this.grid.visible;
  }

  /** Push a body's circle out of any cover box it overlaps (call post-move). */
  resolveCollision(body: { position: THREE.Vector3; radius: number }): void {
    const p = body.position;
    const r = body.radius;
    for (const o of this.obstacles) {
      const closestX = Math.max(o.x - o.hx, Math.min(p.x, o.x + o.hx));
      const closestZ = Math.max(o.z - o.hz, Math.min(p.z, o.z + o.hz));
      const dx = p.x - closestX;
      const dz = p.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > 1e-6) {
        if (distSq < r * r) {
          const dist = Math.sqrt(distSq);
          const push = r - dist;
          p.x += (dx / dist) * push;
          p.z += (dz / dist) * push;
        }
      } else {
        // Center is inside the box — eject along the shallowest axis.
        const px = p.x - o.x;
        const pz = p.z - o.z;
        const ox = o.hx + r - Math.abs(px);
        const oz = o.hz + r - Math.abs(pz);
        if (ox < oz) p.x += px >= 0 ? ox : -ox;
        else p.z += pz >= 0 ? oz : -oz;
      }
    }
  }
}
