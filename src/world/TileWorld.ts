import * as THREE from "three";
import { TILES as TILE_CFG } from "../config.ts";
import { loadTexture } from "../render/textures.ts";
import { sortOrder, SORT_LAYER } from "../render/depthSort.ts";
import { tileDef, tileFile, type Rot } from "../game/tiles.ts";

export interface PlacedTile {
  tileId: string;
  rot: Rot;
}

export interface MapCell {
  floor?: PlacedTile;
  wall?: PlacedTile;
  object?: PlacedTile;
  roof?: PlacedTile;
}

export interface MapData {
  grid: Record<string, MapCell>; // key "c,r"
  playerSpawn?: { x: number; z: number };
  enemySpawns?: Array<{ type: string; x: number; z: number }>;
}

export const LAYER_NAMES: (keyof MapCell)[] = ["floor", "wall", "object", "roof"];

/** A tile mesh + the data the depth sorter needs. */
interface TileEntry {
  mesh: THREE.Mesh;
  anchor: THREE.Vector3; // cell ground point
  band: number; // SORT_LAYER value
}

/**
 * Renders a tile map as anchored, camera-facing billboards in the unified 2.5D
 * layer (depthTest off, sorted by ground-anchor depth). Also owns tile-grid
 * collision and chest/door interaction.
 */
export class TileWorld {
  readonly group = new THREE.Group();
  data: MapData = { grid: {} };

  private openDoors = new Set<string>();
  private openChests = new Set<string>();

  private entries: TileEntry[] = [];
  private meshes = new Map<string, THREE.Mesh>(); // "c,r,layer" -> mesh
  private materials = new Map<string, THREE.MeshBasicMaterial>();
  private geo: THREE.PlaneGeometry;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    const s = TILE_CFG.size;
    this.geo = new THREE.PlaneGeometry(s, s);
    // Anchor the cell's ground point (anchorFrac down the cell) at local origin.
    this.geo.translate(0, s * (TILE_CFG.anchorFrac - 0.5), 0);
  }

  get spacing(): number {
    return TILE_CFG.spacing;
  }

  private getMaterial(url: string, tex: THREE.Texture): THREE.MeshBasicMaterial {
    let mat = this.materials.get(url);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.1,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.materials.set(url, mat);
    }
    return mat;
  }

  private bandFor(layer: keyof MapCell): number {
    if (layer === "floor") return SORT_LAYER.floor;
    if (layer === "roof") return SORT_LAYER.roof;
    return SORT_LAYER.mid;
  }

  async load(mapData: MapData): Promise<void> {
    this.clearVisuals();
    this.data = mapData;
    this.openDoors.clear();
    this.openChests.clear();

    const jobs: Promise<void>[] = [];
    for (const [key, cell] of Object.entries(this.data.grid)) {
      const [c, r] = key.split(",").map((n) => parseInt(n, 10));
      for (const layer of LAYER_NAMES) {
        const placed = cell[layer];
        if (placed) jobs.push(this.createTile(c, r, layer, placed));
      }
    }
    await Promise.all(jobs);
    this.scene.add(this.group);
    this.applyDepthSort(this.camera);
  }

  private async createTile(
    c: number,
    r: number,
    layer: keyof MapCell,
    placed: PlacedTile,
  ): Promise<void> {
    const url = tileFile(placed.tileId, placed.rot);
    if (!url) return;
    try {
      const tex = await loadTexture(url);
      const mat = this.getMaterial(url, tex);
      const mesh = new THREE.Mesh(this.geo, mat);
      const anchor = new THREE.Vector3(c * this.spacing, 0, r * this.spacing);
      mesh.position.copy(anchor);
      mesh.quaternion.copy(this.camera.quaternion); // billboard (camera is fixed)

      this.group.add(mesh);
      this.meshes.set(`${c},${r},${layer}`, mesh);
      this.entries.push({ mesh, anchor, band: this.bandFor(layer) });
    } catch (err) {
      console.error(`Tile load failed: ${url}`, err);
    }
  }

  /** Assign renderOrder to every tile by ground-anchor depth (painter's). */
  applyDepthSort(camera: THREE.Camera): void {
    for (const e of this.entries) {
      e.mesh.renderOrder = sortOrder(e.anchor, camera, e.band);
    }
  }

  clearVisuals(): void {
    this.scene.remove(this.group);
    for (const e of this.entries) this.group.remove(e.mesh);
    this.entries = [];
    this.meshes.clear();
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
  }

  // --- Collision --------------------------------------------------------

  private placedSolid(placed: PlacedTile | undefined, key: string): boolean {
    if (!placed) return false;
    const def = tileDef(placed.tileId);
    if (!def) return false;
    if (def.interactable === "door") return !this.openDoors.has(key);
    return def.solid;
  }

  isSolid(c: number, r: number): boolean {
    const key = `${c},${r}`;
    const cell = this.data.grid[key];
    if (!cell) return false;
    return this.placedSolid(cell.wall, key) || this.placedSolid(cell.object, key);
  }

  resolveCollisions(body: {
    position: THREE.Vector3;
    radius: number;
    alive: boolean;
  }): void {
    if (!body.alive) return;
    const g = this.spacing;
    const curC = Math.round(body.position.x / g);
    const curR = Math.round(body.position.z / g);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (this.isSolid(curC + dc, curR + dr)) {
          this.pushOutOfCell(body.position, body.radius, curC + dc, curR + dr);
        }
      }
    }
  }

  private pushOutOfCell(
    pos: THREE.Vector3,
    radius: number,
    c: number,
    r: number,
  ): void {
    const g = this.spacing;
    const cx = c * g;
    const cz = r * g;
    const half = g / 2;
    const closestX = Math.max(cx - half, Math.min(pos.x, cx + half));
    const closestZ = Math.max(cz - half, Math.min(pos.z, cz + half));
    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > 1e-6 && distSq < radius * radius) {
      const dist = Math.sqrt(distSq);
      const overlap = radius - dist;
      pos.x += (dx / dist) * overlap;
      pos.z += (dz / dist) * overlap;
    }
  }

  // --- Interaction ------------------------------------------------------

  interactNear(playerPos: THREE.Vector3, range = 1.6): void {
    const g = this.spacing;
    const curC = Math.round(playerPos.x / g);
    const curR = Math.round(playerPos.z / g);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const c = curC + dc;
        const r = curR + dr;
        const key = `${c},${r}`;
        const cell = this.data.grid[key];
        const obj = cell?.object;
        if (!obj) continue;
        const def = tileDef(obj.tileId);
        if (!def?.interactable) continue;
        if (Math.hypot(playerPos.x - c * g, playerPos.z - r * g) > range) continue;

        if (def.interactable === "chest" && !this.openChests.has(key)) {
          this.openChest(c, r, key, obj);
        } else if (def.interactable === "door") {
          this.toggleDoor(c, r, key);
        }
      }
    }
  }

  private static CHEST_OPEN: Record<string, string> = {
    "Chest A1": "Chest A2",
    "Chest A3": "Chest A4",
    "Chest B1": "Chest B2",
  };

  private openChest(c: number, r: number, key: string, obj: PlacedTile): void {
    this.openChests.add(key);
    const openId = TileWorld.CHEST_OPEN[obj.tileId];
    const mesh = this.meshes.get(`${c},${r},object`);
    if (openId && mesh) {
      obj.tileId = openId;
      const url = tileFile(openId, obj.rot);
      if (url) loadTexture(url).then((tex) => (mesh.material = this.getMaterial(url, tex)));
    }
    const loots = ["+50 Gold!", "+100 Gold!", "Iron Sword!", "Elixir!", "Shield!"];
    this.floatingText(
      new THREE.Vector3(c * this.spacing, 0.5, r * this.spacing),
      loots[Math.floor(Math.random() * loots.length)],
      "#ffcc00",
    );
  }

  private toggleDoor(c: number, r: number, key: string): void {
    const mesh = this.meshes.get(`${c},${r},object`);
    if (!mesh || !(mesh.material instanceof THREE.MeshBasicMaterial)) return;
    const pos = new THREE.Vector3(c * this.spacing, 0.5, r * this.spacing);
    if (this.openDoors.has(key)) {
      this.openDoors.delete(key);
      mesh.material = mesh.material.clone();
      mesh.material.opacity = 1;
      this.floatingText(pos, "Door Closed", "#9aa0ab");
    } else {
      this.openDoors.add(key);
      mesh.material = mesh.material.clone();
      mesh.material.opacity = 0.25;
      this.floatingText(pos, "Door Opened", "#4cd964");
    }
  }

  private floatingText(pos: THREE.Vector3, text: string, color: string): void {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 26px sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#101216";
    ctx.lineWidth = 4;
    ctx.strokeText(text, 128, 32);
    ctx.fillText(text, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos).setY(pos.y + 1.2);
    sprite.scale.set(2.8, 0.7, 1);
    sprite.renderOrder = 2e6;
    this.scene.add(sprite);

    const start = performance.now();
    const dur = 1200;
    const tick = () => {
      const t = (performance.now() - start) / dur;
      if (t >= 1) {
        this.scene.remove(sprite);
        tex.dispose();
        mat.dispose();
      } else {
        sprite.position.y += 0.015;
        mat.opacity = 1 - t;
        requestAnimationFrame(tick);
      }
    };
    tick();
  }
}
