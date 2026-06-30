import * as THREE from "three";
import { WORLD } from "../config.ts";

/**
 * The greybox playfield: flat ground, a reference grid, perimeter walls and a
 * scatter of cover boxes, plus lighting for the 3D geometry. (Characters are
 * unlit billboards, so these lights only shade the greybox itself.)
 */
export class Arena {
  readonly group = new THREE.Group();
  private grid: THREE.GridHelper;

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
}
