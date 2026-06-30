import * as THREE from "three";
import { CAMERA, WORLD, NET } from "../config.ts";
import { Arena } from "../world/Arena.ts";
import { Player } from "../entities/Player.ts";
import { Dummy } from "../entities/Dummy.ts";
import { RemotePlayer } from "../entities/RemotePlayer.ts";
import { Combatant } from "../combat/Combatant.ts";
import { NetClient } from "../net/NetClient.ts";
import type { ProjectileMsg } from "../net/protocol.ts";
import { resolveMelee } from "../combat/melee.ts";
import { ProjectileSystem } from "../combat/Projectile.ts";
import { ROSTER } from "../game/characters.ts";
import {
  PROJECTILE_ANGLE_OFFSET,
  type ProjectileType,
} from "../game/projectiles.ts";
import { SKILL_PROJECTILES } from "../game/skills.ts";
import { preloadProjectiles } from "../render/projectileTextures.ts";
import { Input } from "./Input.ts";
import { DIR_ROW_OFFSET } from "../render/BillboardCharacter.ts";
import { TileWorld } from "../world/TileWorld.ts";
import { sortOrder, SORT_LAYER } from "../render/depthSort.ts";
import { MapEditor } from "../game/MapEditor.ts";

/**
 * Owns the renderer, scene, isometric camera and the main loop. Wires the
 * arena, the player and input together and drives the per-frame update.
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private clock = new THREE.Clock();

  private arena: Arena;
  private player: Player;
  private dummies: Dummy[] = [];
  private combatants: Combatant[] = [];
  private projectiles: ProjectileSystem;
  private input: Input;

  // Custom Isometric Map & Editor
  private tileWorld: TileWorld;
  private mapEditor: MapEditor;
  private customMapActive = false;

  private camTarget = new THREE.Vector3();
  private hud = document.getElementById("hud")!;
  private fpsSmoothed = 60;

  private skillBarEl = document.getElementById("skillbar")!;
  private skillSlots: {
    el: HTMLElement;
    key: HTMLElement;
    name: HTMLElement;
    cd: HTMLElement;
    cdText: HTMLElement;
  }[] = [];

  // Online PvP.
  private net?: NetClient;
  private remotes = new Map<string, RemotePlayer>();
  private online = false;
  private stateAccum = 0;
  private netBtn!: HTMLButtonElement;
  private netStatus!: HTMLElement;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14161c);
    this.scene.fog = new THREE.Fog(0x14161c, 40, 90);

    this.camera = new THREE.OrthographicCamera();
    this.applyCameraFrustum();

    this.arena = new Arena(this.scene);

    this.player = new Player();
    this.scene.add(this.player.object);

    const dummySpawns: [THREE.Vector3, string][] = [
      [new THREE.Vector3(-5, 0, -3), "2Archer"],
      [new THREE.Vector3(5, 0, -3), "3Wizard"],
      [new THREE.Vector3(0, 0, -8), "7DeathKnight"],
    ];
    for (const [p, id] of dummySpawns) {
      const d = new Dummy(p, id);
      this.dummies.push(d);
      this.scene.add(d.object);
    }

    this.combatants = [this.player, ...this.dummies];
    this.projectiles = new ProjectileSystem(this.scene);

    this.input = new Input(this.renderer.domElement);
    this.scene.userData.domElement = this.renderer.domElement;

    // Initialize custom map and editor
    this.tileWorld = new TileWorld(this.scene, this.camera);
    this.mapEditor = new MapEditor(this.scene, this.camera, this.input, this.tileWorld);

    this.mapEditor.onModeToggle((playMode) => {
      this.customMapActive = playMode;
      this.setWorldSortMode(playMode);
      if (playMode) {
        this.arena.group.visible = false;

        const data = this.mapEditor.getMapData();
        void this.tileWorld.load(data).then(() => {
          if (data.playerSpawn) {
            this.player.spawn(new THREE.Vector3(data.playerSpawn.x, 0, data.playerSpawn.z));
            this.camTarget.copy(this.player.object.position);
            this.updateCameraPosition();
          } else {
            this.player.spawn(new THREE.Vector3(0, 0, 7));
          }

          // Clear default dummies and respawn
          for (const d of this.dummies) {
            this.scene.remove(d.object);
          }
          this.dummies = [];

          if (data.enemySpawns && data.enemySpawns.length > 0) {
            for (const s of data.enemySpawns) {
              const d = new Dummy(new THREE.Vector3(s.x, 0, s.z), s.type);
              this.dummies.push(d);
              this.scene.add(d.object);
            }
          } else {
            const defaultSpawns: [THREE.Vector3, string][] = [
              [new THREE.Vector3(-5, 0, -3), "2Archer"],
              [new THREE.Vector3(5, 0, -3), "3Wizard"],
              [new THREE.Vector3(0, 0, -8), "7DeathKnight"],
            ];
            for (const [p, id] of defaultSpawns) {
              const d = new Dummy(p, id);
              this.dummies.push(d);
              this.scene.add(d.object);
            }
          }

          void Promise.all(this.dummies.map((d) => d.load())).then(() => {
            this.combatants = [this.player, ...this.dummies];
            this.setWorldSortMode(this.customMapActive);
          });
        });
      } else {
        this.arena.group.visible = true;
        this.tileWorld.clearVisuals();

        this.player.spawn(new THREE.Vector3(0, 0, 7));
        this.camTarget.copy(this.player.object.position);
        this.updateCameraPosition();

        for (const d of this.dummies) {
          this.scene.remove(d.object);
        }
        this.dummies = [];

        const defaultSpawns: [THREE.Vector3, string][] = [
          [new THREE.Vector3(-5, 0, -3), "2Archer"],
          [new THREE.Vector3(5, 0, -3), "3Wizard"],
          [new THREE.Vector3(0, 0, -8), "7DeathKnight"],
        ];
        for (const [p, id] of defaultSpawns) {
          const d = new Dummy(p, id);
          this.dummies.push(d);
          this.scene.add(d.object);
        }

        void Promise.all(this.dummies.map((d) => d.load())).then(() => {
          this.combatants = [this.player, ...this.dummies];
        });
      }
    });

    this.buildSkillBar();
    this.buildNetBar();
    window.addEventListener("resize", this.onResize);
  }

  // --- Online PvP -------------------------------------------------------

  private buildNetBar(): void {
    const bar = document.createElement("div");
    bar.id = "netbar";
    const input = document.createElement("input");
    input.id = "net-room";
    input.placeholder = "room";
    input.maxLength = 12;
    input.value =
      new URLSearchParams(location.search).get("room") ??
      Math.random().toString(36).slice(2, 6);
    const btn = document.createElement("button");
    btn.textContent = "Play Online";
    const status = document.createElement("span");
    status.id = "net-status";
    btn.onclick = () => {
      if (this.online) this.leaveOnline();
      else this.goOnline(input.value.trim() || "arena");
    };
    bar.append(input, btn, status);
    document.body.appendChild(bar);
    this.netBtn = btn;
    this.netStatus = status;
  }

  private goOnline(room: string): void {
    this.online = true;
    history.replaceState(null, "", `?room=${encodeURIComponent(room)}`);
    for (const d of this.dummies) d.object.visible = false;
    this.netStatus.textContent = "connecting…";
    this.net = new NetClient({
      onAssign: (_self, peers) => {
        peers.forEach((p) => this.ensureRemote(p));
        this.netStatus.textContent = peers.length ? "opponent here" : "waiting…";
      },
      onJoin: (id) => {
        this.ensureRemote(id);
        this.netStatus.textContent = "opponent joined";
      },
      onLeave: (id) => {
        this.removeRemote(id);
        this.netStatus.textContent = "waiting…";
      },
      onState: (m) => this.ensureRemote(m.id).applyState(m),
      onHit: (m) => {
        if (m.target === this.net?.selfId) {
          this.player.receiveHit({
            damage: m.damage,
            knockback: m.knockback,
            fromDir: new THREE.Vector3(m.dx, 0, m.dz),
          });
        }
      },
      onProjectile: (m) => this.spawnGhostProjectile(m),
      onStatus: (s) => {
        if (s !== "open") {
          this.netStatus.textContent = s === "full" ? "room full (1v1)" : s;
        }
      },
    });
    this.net.connect(NET.serverUrl, room);
    this.netBtn.textContent = "Leave";
    this.rebuildCombatants();
  }

  private leaveOnline(): void {
    this.net?.disconnect();
    this.net = undefined;
    this.online = false;
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    for (const d of this.dummies) d.object.visible = true;
    this.netBtn.textContent = "Play Online";
    this.netStatus.textContent = "";
    this.rebuildCombatants();
  }

  private ensureRemote(id: string): RemotePlayer {
    let r = this.remotes.get(id);
    if (r) return r;
    r = new RemotePlayer(id, (info) =>
      this.net?.sendHit(id, info.damage, info.knockback, info.fromDir.x, info.fromDir.z),
    );
    r.char.setSortMode(this.customMapActive);
    r.position.set(0, 0, -7);
    this.remotes.set(id, r);
    this.scene.add(r.object);
    this.rebuildCombatants();
    return r;
  }

  private removeRemote(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.object);
    this.remotes.delete(id);
    this.rebuildCombatants();
  }

  private rebuildCombatants(): void {
    this.combatants = this.online
      ? [this.player, ...this.remotes.values()]
      : [this.player, ...this.dummies];
  }

  private spawnGhostProjectile(m: ProjectileMsg): void {
    const owner = this.remotes.get(m.id);
    this.projectiles.spawn({
      source: owner ?? this.player,
      type: m.ptype,
      origin: new THREE.Vector3(m.x, m.y, m.z),
      dir: new THREE.Vector3(m.dx, 0, m.dz),
      speed: m.speed,
      damage: m.damage,
      knockback: m.knockback,
      radius: m.radius,
      lifetime: m.lifetime,
      ghost: true,
    });
  }

  private buildSkillBar(): void {
    for (let i = 0; i < 4; i++) {
      const el = document.createElement("div");
      el.className = "skill-slot";
      const cd = document.createElement("div");
      cd.className = "skill-cd";
      const key = document.createElement("div");
      key.className = "skill-key";
      const name = document.createElement("div");
      name.className = "skill-name";
      const cdText = document.createElement("div");
      cdText.className = "skill-cd-text";
      el.append(cd, key, name, cdText);
      this.skillBarEl.appendChild(el);
      this.skillSlots.push({ el, key, name, cd, cdText });
    }
  }

  private updateSkillBar(): void {
    if (this.mapEditor.active) {
      this.skillBarEl.style.display = "none";
      return;
    }
    this.skillBarEl.style.display = "flex";
    const bar = this.player.skillBar;
    for (let i = 0; i < this.skillSlots.length; i++) {
      const s = bar[i];
      const slot = this.skillSlots[i];
      slot.key.textContent = s.key;
      slot.name.textContent = s.name;
      slot.el.style.borderColor = s.color;
      const frac = s.cdMax > 0 ? s.cd / s.cdMax : 0;
      slot.cd.style.height = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      slot.cdText.textContent = s.cd > 0 ? String(Math.ceil(s.cd)) : "";
      slot.el.style.opacity = s.cd > 0 ? "0.65" : "1";
    }
  }

  async start(): Promise<void> {
    const projTypes = [
      ...ROSTER.map((c) => c.projectile).filter((p): p is ProjectileType => !!p),
      ...SKILL_PROJECTILES,
    ];
    await Promise.all([
      this.player.load(),
      ...this.dummies.map((d) => d.load()),
      preloadProjectiles(projTypes),
    ]);
    this.player.spawn(new THREE.Vector3(0, 0, 7));

    // Snap camera onto the player before the first frame.
    this.camTarget.copy(this.player.object.position);
    this.updateCameraPosition();
    this.clock.start();
    this.renderer.setAnimationLoop(this.frame);
  }

  private frame = () => {
    const dt = Math.min(this.clock.getDelta(), 1 / 20); // clamp big hitches

    this.input.beginFrame();
    this.updateSkillBar();

    // If editor is active, suspend game physics and handle camera panning
    if (this.mapEditor.active) {
      const panSpeed = 15 * dt;
      const panMove = new THREE.Vector3();
      if (this.input.isDown("KeyW") || this.input.isDown("ArrowUp")) panMove.z -= 1;
      if (this.input.isDown("KeyS") || this.input.isDown("ArrowDown")) panMove.z += 1;
      if (this.input.isDown("KeyA") || this.input.isDown("ArrowLeft")) panMove.x -= 1;
      if (this.input.isDown("KeyD") || this.input.isDown("ArrowRight")) panMove.x += 1;
      
      if (panMove.lengthSq() > 1e-4) {
        panMove.normalize().multiplyScalar(panSpeed);
        const fwd = new THREE.Vector3(-1, 0, -1).normalize();
        const right = new THREE.Vector3(-1, 0, 1).normalize();
        this.camTarget.addScaledVector(fwd, -panMove.z);
        this.camTarget.addScaledVector(right, panMove.x);
        this.updateCameraPosition();
      }

      this.input.endFrame();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Game-level hotkeys.
    if (this.input.wasPressed("KeyG")) this.arena.toggleGrid();
    if (this.input.wasPressed("BracketLeft")) DIR_ROW_OFFSET.value--;
    if (this.input.wasPressed("BracketRight")) DIR_ROW_OFFSET.value++;
    // Number keys swap the player's character (1-9).
    for (let i = 0; i < ROSTER.length; i++) {
      if (this.input.wasPressed(`Digit${i + 1}`)) {
        void this.player.setCharacter(ROSTER[i].id);
      }
    }
    // Tune projectile aim correction (in case art points the other way).
    if (this.input.wasPressed("Comma")) PROJECTILE_ANGLE_OFFSET.value -= Math.PI / 8;
    if (this.input.wasPressed("Period")) PROJECTILE_ANGLE_OFFSET.value += Math.PI / 8;

    this.player.update(dt, this.camera, this.input);
    if (this.online) {
      for (const r of this.remotes.values()) r.update(dt, this.camera);
    } else {
      for (const d of this.dummies) d.update(dt, this.player, this.camera);
    }

    // Custom map interactions (V to interact — E is the Dash skill)
    if (this.customMapActive && this.input.wasPressed("KeyV")) {
      this.tileWorld.interactNear(this.player.position);
    }

    // Resolve wall/object collisions on the custom map
    if (this.customMapActive) {
      this.tileWorld.resolveCollisions(this.player);
      for (const d of this.dummies) {
        this.tileWorld.resolveCollisions(d);
      }
    }

    this.input.endFrame();

    // Resolve every posted swing against all other combatants.
    for (const c of this.combatants) {
      const q = c.consumeMeleeQuery();
      if (q) resolveMelee(q, this.combatants);
      const s = c.consumeProjectile();
      if (s) {
        this.projectiles.spawn(s);
        if (this.online && c === this.player) {
          this.net?.sendProjectile({
            ptype: s.type,
            x: s.origin.x, y: s.origin.y, z: s.origin.z,
            dx: s.dir.x, dz: s.dir.z,
            speed: s.speed, damage: s.damage, knockback: s.knockback,
            radius: s.radius, lifetime: s.lifetime,
          });
        }
      }
    }

    // Broadcast our own state at a fixed tick rate.
    if (this.online && this.net?.connected) {
      this.stateAccum += dt;
      if (this.stateAccum >= 1 / NET.tickHz) {
        this.stateAccum = 0;
        this.net.sendState(this.player.netState());
      }
    }

    // Smooth follow.
    this.camTarget.lerp(this.player.object.position, 1 - Math.pow(0.001, dt));
    this.updateCameraPosition();

    this.projectiles.update(dt, this.camera, this.combatants, WORLD.arenaSize / 2);

    // Unified 2.5D painter's sort: tiles + actors + projectiles share one
    // depth order keyed on each ground anchor (health bars stay on top).
    if (this.customMapActive) {
      this.tileWorld.applyDepthSort(this.camera);
      for (const c of this.combatants) {
        c.char.setRenderOrder(sortOrder(c.position, this.camera, SORT_LAYER.mid));
      }
      this.projectiles.applyDepthSort(this.camera);
    }

    for (const c of this.combatants) c.refreshHealthBar(this.camera);

    this.renderer.render(this.scene, this.camera);
    this.updateHud(dt);
  };

  /** Switch all fighters between z-buffer (arena) and painter's sort (tiles). */
  private setWorldSortMode(unified: boolean): void {
    this.player.char.setSortMode(unified);
    for (const d of this.dummies) d.char.setSortMode(unified);
  }

  private updateCameraPosition(): void {
    const o = CAMERA.offset;
    this.camera.position.set(
      this.camTarget.x + o.x,
      this.camTarget.y + o.y,
      this.camTarget.z + o.z,
    );
    this.camera.lookAt(this.camTarget);
  }

  private applyCameraFrustum(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const h = CAMERA.viewHeight;
    const w = h * aspect;
    const c = this.camera;
    c.left = -w / 2;
    c.right = w / 2;
    c.top = h / 2;
    c.bottom = -h / 2;
    c.near = CAMERA.near;
    c.far = CAMERA.far;
    c.updateProjectionMatrix();
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.applyCameraFrustum();
  };

  private updateHud(dt: number): void {
    const fps = dt > 0 ? 1 / dt : 60;
    this.fpsSmoothed += (fps - this.fpsSmoothed) * 0.1;
    const p = this.player;
    const aliveDummies = this.dummies.filter((d) => d.alive).length;
    const charName = ROSTER.find((c) => c.id === p.characterId)?.name ?? "?";
    this.hud.textContent =
      `fps   ${this.fpsSmoothed.toFixed(0)}\n` +
      `char  ${charName}  [1-9]\n` +
      `hp    ${Math.ceil(p.health)}/${p.maxHealth}\n` +
      `state ${p.debugState}\n` +
      `anim  ${p.char.currentAnim}\n` +
      `enemies ${aliveDummies}/${this.dummies.length}\n` +
      `shots ${this.projectiles.count}\n` +
      `dirΔ ${DIR_ROW_OFFSET.value}  projΔ ${PROJECTILE_ANGLE_OFFSET.value.toFixed(2)}`;
  }
}
