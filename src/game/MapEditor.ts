import * as THREE from "three";
import "./MapEditorUI.css"; // bundled by Vite (works in dev + production build)
import { TILES as TILE_CFG } from "../config.ts";
import { TILE_CATEGORIES, tileDef, tileFile, tileRotations, type Rot } from "./tiles.ts";
import {
  TileWorld,
  type MapData,
  type MapCell,
  type PlacedTile,
} from "../world/TileWorld.ts";
import { Input } from "../core/Input.ts";

const STORAGE_KEY = "iso_map_v2";

type SpawnTool =
  | "spawn_player"
  | "spawn_enemy_knight"
  | "spawn_enemy_archer"
  | "spawn_enemy_wizard"
  | "spawn_enemy_deathknight";
type Tool = "brush" | "erase" | SpawnTool;

/**
 * DOM-based tile-map editor. Palette is grouped by category and lists one
 * entry per tile (rotations collapsed); placement writes `{tileId, rot}` into
 * the map grid, which `TileWorld` renders as billboards.
 */
export class MapEditor {
  active = false;
  private activeCategory = "floor";
  private selectedTileId: string | null = null;
  private selectedRot: Rot = "S";
  private selectedTool: Tool = "brush";

  private mapData: MapData = { grid: {}, playerSpawn: { x: 0, z: 6 }, enemySpawns: [] };
  private isMouseDown = false;

  private previewMesh: THREE.Mesh;
  private spawnVisualsGroup = new THREE.Group();
  private containerEl: HTMLDivElement | null = null;
  private openBtnEl: HTMLButtonElement | null = null;
  private onModeToggleCallback: ((playMode: boolean) => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private input: Input,
    private tileWorld: TileWorld,
  ) {
    const g = TILE_CFG.spacing;
    const previewGeo = new THREE.PlaneGeometry(g * 0.95, g * 0.95);
    previewGeo.rotateX(-Math.PI / 2);
    this.previewMesh = new THREE.Mesh(
      previewGeo,
      new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.previewMesh.renderOrder = 5e5;
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);
    this.scene.add(this.spawnVisualsGroup);

    this.loadFromStorage();
    this.buildUI();
    this.setupMouseEvents();
    this.setupKeyboardEvents();
  }

  onModeToggle(cb: (playMode: boolean) => void): void {
    this.onModeToggleCallback = cb;
  }
  getMapData(): MapData {
    return this.mapData;
  }

  show(): void {
    this.active = true;
    this.previewMesh.visible = true;
    this.spawnVisualsGroup.visible = true;
    this.containerEl?.classList.remove("hidden");
    this.openBtnEl?.classList.add("hidden");
    this.updateSpawnVisuals();
    void this.tileWorld.load(this.mapData);
  }

  hide(): void {
    this.active = false;
    this.previewMesh.visible = false;
    this.spawnVisualsGroup.visible = false;
    this.isMouseDown = false;
    this.containerEl?.classList.add("hidden");
    this.openBtnEl?.classList.remove("hidden");
  }

  private spacing(): number {
    return TILE_CFG.spacing;
  }

  /** Which map-cell layer a tile occupies (from its manifest layer). */
  private layerForTile(id: string): keyof MapCell {
    const layer = tileDef(id)?.layer ?? "object";
    return layer as keyof MapCell;
  }

  // --- UI ---------------------------------------------------------------

  private buildUI(): void {
    const openBtn = document.createElement("button");
    openBtn.className = "editor-open-btn";
    openBtn.textContent = "⚙️ Open Map Editor";
    openBtn.onclick = () => this.show();
    document.body.appendChild(openBtn);
    this.openBtnEl = openBtn;

    const container = document.createElement("div");
    container.className = "editor-container hidden";
    document.body.appendChild(container);
    this.containerEl = container;
    this.renderUI();
  }

  private renderUI(): void {
    if (!this.containerEl) return;
    const cats = Object.keys(TILE_CATEGORIES);
    this.containerEl.innerHTML = `
      <div class="editor-header">
        <div class="editor-title">MAP EDITOR</div>
        <button class="mode-toggle-btn play-mode" id="btn-toggle-play">⚔️ Test Map</button>
      </div>
      <div class="editor-tabs">
        ${cats
          .map(
            (c) =>
              `<button class="editor-tab ${this.activeCategory === c ? "active" : ""}" data-cat="${c}">${c}</button>`,
          )
          .join("")}
        <button class="editor-tab ${this.activeCategory === "Spawns" ? "active" : ""}" data-cat="Spawns">Spawns</button>
      </div>
      <div class="editor-content" id="editor-tile-list"></div>
      <div class="editor-tools">
        <div class="tool-row">
          <button class="tool-btn ${this.selectedTool === "brush" ? "active" : ""}" id="tool-brush">🎨 Brush</button>
          <button class="tool-btn ${this.selectedTool === "erase" ? "active" : ""}" id="tool-erase">🧹 Erase</button>
          <button class="tool-btn" id="tool-rot">↻ ${this.selectedRot}</button>
        </div>
        <div class="action-grid">
          <button class="action-btn" id="act-clear">Clear Map</button>
          <button class="action-btn" id="act-export">Export JSON</button>
          <button class="action-btn" id="act-import">Import JSON</button>
          <button class="action-btn" id="act-save">Save Map</button>
          <button class="action-btn" id="act-close" style="color:#ff5252;">Close Editor</button>
        </div>
      </div>
      <div class="editor-help">
        <b>[L-Click / Drag]</b> Paint / Erase &nbsp; <b>[R]</b> Rotate &nbsp;<br>
        <b>[WASD]</b> Pan &nbsp; <b>[Test Map]</b> Play
      </div>`;

    this.containerEl.querySelector("#btn-toggle-play")!.addEventListener("click", () => {
      this.hide();
      this.saveToStorage();
      this.onModeToggleCallback?.(true);
    });
    this.containerEl.querySelectorAll(".editor-tab").forEach((tab) =>
      tab.addEventListener("click", (e) => {
        this.activeCategory = (e.currentTarget as HTMLElement).dataset.cat!;
        this.renderUI();
      }),
    );
    this.containerEl.querySelector("#tool-brush")!.addEventListener("click", () => {
      this.selectedTool = "brush";
      this.renderUI();
    });
    this.containerEl.querySelector("#tool-erase")!.addEventListener("click", () => {
      this.selectedTool = "erase";
      this.renderUI();
    });
    this.containerEl.querySelector("#tool-rot")!.addEventListener("click", () => this.cycleRotation());
    this.containerEl.querySelector("#act-clear")!.addEventListener("click", () => {
      if (confirm("Clear the whole map?")) {
        this.mapData.grid = {};
        this.mapData.enemySpawns = [];
        void this.tileWorld.load(this.mapData);
        this.updateSpawnVisuals();
      }
    });
    this.containerEl.querySelector("#act-save")!.addEventListener("click", () => {
      this.saveToStorage();
      alert("Map saved to browser storage.");
    });
    this.containerEl.querySelector("#act-close")!.addEventListener("click", () => {
      this.hide();
      this.onModeToggleCallback?.(false);
    });
    this.containerEl.querySelector("#act-export")!.addEventListener("click", () => this.exportMapJSON());
    this.containerEl.querySelector("#act-import")!.addEventListener("click", () => this.importMapJSON());

    this.renderCategoryContent();
  }

  private renderCategoryContent(): void {
    const listEl = this.containerEl?.querySelector("#editor-tile-list");
    if (!listEl) return;

    if (this.activeCategory === "Spawns") {
      const spawns = [
        { id: "spawn_player", label: "Player Spawn", color: "#4facfe" },
        { id: "spawn_enemy_knight", label: "Enemy: Knight", color: "#ff5e62" },
        { id: "spawn_enemy_archer", label: "Enemy: Archer", color: "#ff9966" },
        { id: "spawn_enemy_wizard", label: "Enemy: Wizard", color: "#b06ab3" },
        { id: "spawn_enemy_deathknight", label: "Enemy: Death Knight", color: "#434343" },
      ];
      listEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">${spawns
        .map(
          (s) =>
            `<div class="tool-btn ${this.selectedTool === s.id ? "active" : ""}" style="border-left:4px solid ${s.color};cursor:pointer;text-align:left;padding:10px;" data-spawn="${s.id}">${s.label}</div>`,
        )
        .join("")}</div>`;
      listEl.querySelectorAll("[data-spawn]").forEach((el) =>
        el.addEventListener("click", (e) => {
          this.selectedTool = (e.currentTarget as HTMLElement).dataset.spawn as Tool;
          this.renderUI();
        }),
      );
      return;
    }

    const ids = TILE_CATEGORIES[this.activeCategory] ?? [];
    listEl.innerHTML = `<div class="tile-grid">${ids
      .map(
        (id) =>
          `<div class="tile-item ${this.selectedTileId === id ? "selected" : ""}" data-id="${id}">
             <img src="${tileFile(id, "S") ?? ""}" loading="lazy" />
             <div class="tile-label">${id}</div>
           </div>`,
      )
      .join("")}</div>`;
    listEl.querySelectorAll(".tile-item").forEach((item) =>
      item.addEventListener("click", (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id!;
        this.selectedTileId = id;
        const rots = tileRotations(id);
        if (!rots.includes(this.selectedRot)) this.selectedRot = rots[0] ?? "N";
        this.selectedTool = "brush";
        this.renderUI();
      }),
    );
  }

  // --- Input ------------------------------------------------------------

  private setupMouseEvents(): void {
    const dom: HTMLElement = this.scene.userData.domElement ?? document.body;
    dom.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button === 0 && this.active) {
        if (this.containerEl?.contains(e.target as Node)) return;
        this.isMouseDown = true;
        this.paintAtCursor();
      }
    });
    dom.addEventListener("pointerup", (e: PointerEvent) => {
      if (e.button === 0) this.isMouseDown = false;
    });
    dom.addEventListener("pointermove", () => {
      if (!this.active) return;
      this.updatePreviewMesh();
      if (this.isMouseDown) this.paintAtCursor();
    });
  }

  private setupKeyboardEvents(): void {
    window.addEventListener("keydown", (e) => {
      if (this.active && e.code === "KeyR") this.cycleRotation();
    });
  }

  private cell(): { c: number; r: number; key: string } | null {
    const p = _v;
    if (!this.input.cursorGroundPoint(this.camera, p)) return null;
    const g = this.spacing();
    const c = Math.round(p.x / g);
    const r = Math.round(p.z / g);
    return { c, r, key: `${c},${r}` };
  }

  private updatePreviewMesh(): void {
    const cell = this.cell();
    if (!cell) {
      this.previewMesh.visible = false;
      return;
    }
    const g = this.spacing();
    this.previewMesh.position.set(cell.c * g, 0.02, cell.r * g);
    this.previewMesh.visible = true;
  }

  private paintAtCursor(): void {
    const cell = this.cell();
    if (!cell) return;
    const g = this.spacing();
    const { c, r, key } = cell;

    if (this.selectedTool.startsWith("spawn_")) {
      if (this.selectedTool === "spawn_player") {
        this.mapData.playerSpawn = { x: c * g, z: r * g };
      } else {
        this.mapData.enemySpawns = (this.mapData.enemySpawns ?? []).filter(
          (s) => Math.round(s.x / g) !== c || Math.round(s.z / g) !== r,
        );
        const type =
          this.selectedTool === "spawn_enemy_archer" ? "2Archer"
          : this.selectedTool === "spawn_enemy_wizard" ? "3Wizard"
          : this.selectedTool === "spawn_enemy_deathknight" ? "7DeathKnight"
          : "1Knight";
        this.mapData.enemySpawns.push({ type, x: c * g, z: r * g });
      }
      this.updateSpawnVisuals();
      return;
    }

    if (this.selectedTool === "erase") {
      const existing = this.mapData.grid[key];
      if (existing) {
        // Erase top-most occupied layer.
        for (const layer of ["roof", "object", "wall", "floor"] as (keyof MapCell)[]) {
          if (existing[layer]) {
            delete existing[layer];
            break;
          }
        }
        if (Object.keys(existing).length === 0) delete this.mapData.grid[key];
        void this.tileWorld.load(this.mapData);
      }
      return;
    }

    if (this.selectedTool === "brush" && this.selectedTileId) {
      const layer = this.layerForTile(this.selectedTileId);
      const placed: PlacedTile = { tileId: this.selectedTileId, rot: this.selectedRot };
      (this.mapData.grid[key] ??= {})[layer] = placed;
      void this.tileWorld.load(this.mapData);
    }
  }

  /** Rotate the hovered placed tile if any, else the palette selection. */
  private cycleRotation(): void {
    const cell = this.cell();
    if (cell && this.selectedTileId) {
      const placed = this.mapData.grid[cell.key]?.[this.layerForTile(this.selectedTileId)];
      if (placed) {
        placed.rot = this.nextRot(placed.tileId, placed.rot);
        void this.tileWorld.load(this.mapData);
        return;
      }
    }
    if (this.selectedTileId) {
      this.selectedRot = this.nextRot(this.selectedTileId, this.selectedRot);
      this.renderUI();
    }
  }

  private nextRot(id: string, rot: Rot): Rot {
    const rots = tileRotations(id);
    if (rots.length === 0) return rot;
    const i = rots.indexOf(rot);
    return rots[(i + 1) % rots.length];
  }

  // --- Spawn visuals ----------------------------------------------------

  private updateSpawnVisuals(): void {
    this.spawnVisualsGroup.clear();
    if (!this.active) return;

    const marker = (x: number, z: number, color: number, letter: string) => {
      const geo = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 8);
      geo.translate(0, 0.6, 0);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.6, depthTest: false }),
      );
      mesh.position.set(x, 0, z);
      mesh.renderOrder = 5e5;
      const text = this.spawnSprite(letter, `#${color.toString(16).padStart(6, "0")}`);
      text.position.set(x, 1.4, z);
      this.spawnVisualsGroup.add(mesh, text);
    };

    if (this.mapData.playerSpawn) marker(this.mapData.playerSpawn.x, this.mapData.playerSpawn.z, 0x4facfe, "P");
    for (const e of this.mapData.enemySpawns ?? []) {
      const [color, letter] =
        e.type === "2Archer" ? [0xff9966, "A"]
        : e.type === "3Wizard" ? [0xb06ab3, "W"]
        : e.type === "7DeathKnight" ? [0x434343, "D"]
        : [0xff5e62, "E"];
      marker(e.x, e.z, color as number, letter as string);
    }
  }

  private spawnSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(10,12,18,0.75)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(32, 32, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = "bold 28px sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 32);
    const mat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.8, 0.8, 1);
    sprite.renderOrder = 5e5;
    return sprite;
  }

  // --- Persistence ------------------------------------------------------

  private saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mapData));
  }
  private loadFromStorage(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      this.mapData = JSON.parse(saved);
    } catch (err) {
      console.error("Failed to parse saved map:", err);
    }
  }

  private exportMapJSON(): void {
    const blob = new Blob([JSON.stringify(this.mapData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "custom_map.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  private importMapJSON(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const imported = JSON.parse(evt.target?.result as string);
          if (imported?.grid) {
            this.mapData = imported;
            void this.tileWorld.load(this.mapData);
            this.updateSpawnVisuals();
            this.renderUI();
            this.saveToStorage();
          } else {
            alert("Invalid map file.");
          }
        } catch (err) {
          alert("Error parsing file: " + (err as Error).message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
}

const _v = new THREE.Vector3();
