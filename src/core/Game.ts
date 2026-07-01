import * as THREE from "three";
import { CAMERA, WORLD, NET, SPAWNS, SOFTLOCK } from "../config.ts";
import { Arena } from "../world/Arena.ts";
import { Player } from "../entities/Player.ts";
import { RemotePlayer } from "../entities/RemotePlayer.ts";
import { WaveDirector } from "../game/WaveDirector.ts";
import { Combatant } from "../combat/Combatant.ts";
import { NetClient } from "../net/NetClient.ts";
import type { ProjectileMsg } from "../net/protocol.ts";
import { resolveMelee } from "../combat/melee.ts";
import { ProjectileSystem } from "../combat/Projectile.ts";
import { ROSTER, ENEMY_ROSTER } from "../game/characters.ts";
import {
  PROJECTILE_ANGLE_OFFSET,
  type ProjectileType,
} from "../game/projectiles.ts";
import { SKILL_PROJECTILES } from "../game/skills.ts";
import { preloadProjectiles } from "../render/projectileTextures.ts";
import { feedback } from "../render/Feedback.ts";
import { sound } from "../audio/Sound.ts";
import { Input } from "./Input.ts";
import { TouchControls } from "./TouchControls.ts";
import { dirFromAngle } from "./mathx.ts";
import { DIR_ROW_OFFSET } from "../render/BillboardCharacter.ts";

/**
 * Owns the renderer, scene, isometric camera and the main loop. Wires the
 * greybox arena, the player, the PvE wave run (WaveDirector) and online PvP.
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private clock = new THREE.Clock();

  private arena: Arena;
  private player: Player;
  private director!: WaveDirector;
  private combatants: Combatant[] = [];
  private projectiles: ProjectileSystem;
  private input: Input;
  /** Cover line-of-sight predicate handed to enemy AI (bound once). */
  private blocked = (x: number, y: number, z: number) => this.arena.blocksProjectile(x, y, z);

  private camTarget = new THREE.Vector3();
  private hud = document.getElementById("hud")!;
  private resourceFill = document.getElementById("resource-fill")!;
  private vignette = document.getElementById("vignette")!;
  private bossBar = document.getElementById("bossbar")!;
  private bossFill = document.getElementById("boss-fill")!;
  private overlay = document.getElementById("run-overlay")!;
  private overlayTitle = document.getElementById("run-title")!;
  private overlaySub = document.getElementById("run-sub")!;
  private retryBtn = document.getElementById("run-retry") as HTMLButtonElement;
  private selectedCharId = ROSTER[0].id;
  private fpsSmoothed = 60;

  private reticle: THREE.Mesh;
  private aimPt = new THREE.Vector3();
  private viewHeight = window.matchMedia("(pointer: coarse)").matches
    ? CAMERA.viewHeightMobile
    : CAMERA.viewHeight;

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
  private muteBtn!: HTMLButtonElement;
  private touchControls!: TouchControls;

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

    this.combatants = [this.player];
    this.projectiles = new ProjectileSystem(this.scene);
    this.director = new WaveDirector(this.scene, this.player, () => this.rebuildCombatants());

    // Soft-lock target reticle (a ground ring under the locked enemy).
    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 28);
    ringGeo.rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff5a44,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.reticle.visible = false;
    this.reticle.renderOrder = 2;
    this.scene.add(this.reticle);

    this.input = new Input(this.renderer.domElement);

    this.buildSkillBar();
    this.buildNetBar();
    this.touchControls = new TouchControls(this.input, this.player);
    feedback.init(this.scene, this.player);
    sound.init(this.player);
    if (this.retryBtn) this.retryBtn.onclick = () => this.startRun();
    this.buildCharSelect();
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
    const fs = document.createElement("button");
    fs.textContent = "⛶";
    fs.title = "Fullscreen";
    fs.onclick = () => {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    const mute = document.createElement("button");
    mute.title = "Mute (M)";
    mute.onclick = () => this.setMuteLabel(sound.toggleMute());
    bar.append(input, btn, status, fs, mute);
    document.body.appendChild(bar);
    this.netBtn = btn;
    this.netStatus = status;
    this.muteBtn = mute;
    this.setMuteLabel(sound.isMuted);
  }

  private setMuteLabel(muted: boolean): void {
    this.muteBtn.textContent = muted ? "🔇" : "🔊";
  }

  private goOnline(room: string): void {
    this.online = true;
    history.replaceState(null, "", `?room=${encodeURIComponent(room)}`);
    this.director.stop(); // leave the PvE run; free-play PvP takes over
    this.netStatus.textContent = "connecting…";
    this.net = new NetClient({
      onAssign: (_self, slot, peers) => {
        // Spawn at our assigned slot so players don't pile up.
        const [sx, sz] = SPAWNS[slot % SPAWNS.length];
        this.player.spawn(new THREE.Vector3(sx, 0, sz));
        this.camTarget.copy(this.player.object.position);
        this.updateCameraPosition();
        peers.forEach((p) => this.ensureRemote(p));
        this.netStatus.textContent = peers.length ? "opponents here" : "waiting…";
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
          this.netStatus.textContent = s === "full" ? "room full" : s;
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
    this.director.start(); // back to the PvE wave run
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
      : [this.player, ...this.director.enemies];
  }

  /** Build the character-select grid inside the run overlay (hero portraits). */
  private buildCharSelect(): void {
    const host = document.getElementById("charselect");
    if (!host) return;
    const cards: HTMLElement[] = [];
    for (const c of ROSTER) {
      const card = document.createElement("button");
      card.className = "hero-card" + (c.id === this.selectedCharId ? " selected" : "");
      const portrait = document.createElement("div");
      portrait.className = "hero-portrait";
      portrait.style.backgroundImage = `url(/characters/${c.id}/Idle.webp)`;
      const name = document.createElement("div");
      name.className = "hero-name";
      name.textContent = c.name;
      card.append(portrait, name);
      card.onclick = () => {
        this.selectedCharId = c.id;
        for (const el of cards) el.classList.toggle("selected", el === card);
      };
      cards.push(card);
      host.appendChild(card);
    }
  }

  /** Start (or restart) the PvE run, loading the selected hero first. */
  private startRun(): void {
    if (this.online) return;
    void this.launchRun();
  }

  private async launchRun(): Promise<void> {
    this.retryBtn.disabled = true;
    if (this.selectedCharId !== this.player.characterId) {
      await this.player.setCharacter(this.selectedCharId);
    }
    this.retryBtn.disabled = false;
    this.director.start();
    this.overlay.style.display = "none";
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

  // --- Soft-lock aiming -------------------------------------------------

  /** Pick the best enemy in the aim cone and hand it to the player. */
  private updateSoftTarget(): void {
    const p = this.player;
    if (!p.alive) {
      p.softTarget = null;
      return;
    }
    // Aim direction. On touch it's the way you're facing (the left stick drives
    // facing) — an auto-lock "vision cone". On desktop it's the mouse.
    if (this.input.touch) {
      dirFromAngle(p.char.facing, this.aimPt);
    } else if (!this.input.getAimDir(this.camera, p.position, this.aimPt)) {
      const t = p.softTarget;
      if (t) {
        const dx = t.position.x - p.position.x;
        const dz = t.position.z - p.position.z;
        if (!t.alive || dx * dx + dz * dz > SOFTLOCK.range * SOFTLOCK.range) {
          p.softTarget = null;
        }
      }
      return;
    }
    const pp = p.position;
    let ax = this.aimPt.x;
    let az = this.aimPt.z;
    const al = Math.hypot(ax, az);
    if (al < 1e-4) return; // keep current target
    ax /= al;
    az /= al;

    const coneHalf = THREE.MathUtils.degToRad(SOFTLOCK.coneDeg / 2);
    let best: Combatant | null = null;
    let bestScore = Infinity;
    for (const c of this.combatants) {
      if (c === p || !c.alive || c.team === p.team) continue;
      const tx = c.position.x - pp.x;
      const tz = c.position.z - pp.z;
      const td = Math.hypot(tx, tz);
      if (td < 1e-4 || td > SOFTLOCK.range) continue;
      const ang = Math.acos(Math.min(1, Math.max(-1, (ax * tx + az * tz) / td)));
      if (ang > coneHalf) continue;
      let score = ang + td * SOFTLOCK.distWeight;
      if (c === p.softTarget) score -= SOFTLOCK.stickiness; // keep current
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    p.softTarget = best;
  }

  private updateReticle(): void {
    const t = this.player.softTarget;
    if (t && t.alive) {
      this.reticle.visible = true;
      this.reticle.position.set(t.position.x, 0.06, t.position.z);
      const s = 1 + 0.08 * Math.sin(performance.now() * 0.008);
      this.reticle.scale.set(s, s, s);
    } else {
      this.reticle.visible = false;
    }
  }

  // --- Skill bar --------------------------------------------------------

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

  // --- Loop -------------------------------------------------------------

  async start(): Promise<void> {
    const projTypes = [
      ...ROSTER.map((c) => c.projectile).filter((p): p is ProjectileType => !!p),
      ...ENEMY_ROSTER.map((c) => c.projectile).filter((p): p is ProjectileType => !!p),
      ...SKILL_PROJECTILES,
    ];
    await Promise.all([this.player.load(), preloadProjectiles(projTypes)]);
    this.player.spawn(new THREE.Vector3(0, 0, 8));
    // The run waits on the Start overlay; the director stays idle until then.

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
    this.touchControls.update();

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
    if (this.input.wasPressed("KeyM")) this.setMuteLabel(sound.toggleMute());
    // Enter starts/restarts the PvE run (from the Start/Victory/Defeat overlay).
    if (this.input.wasPressed("Enter") && !this.online) {
      const s = this.director.view.status;
      if (s === "idle" || s === "victory" || s === "defeat") this.startRun();
    }

    this.updateSoftTarget();
    this.player.update(dt, this.camera, this.input);
    if (this.online) {
      for (const r of this.remotes.values()) r.update(dt, this.camera);
    } else {
      this.director.update(dt);
      for (const e of this.director.enemies) {
        e.update(dt, this.combatants, this.camera, this.blocked);
      }
    }

    // Keep locally-controlled bodies out of the cover boxes (remotes are
    // collision-resolved on their own client).
    this.arena.resolveCollision(this.player);
    if (!this.online) {
      for (const e of this.director.enemies) this.arena.resolveCollision(e);
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
      // A multi-shot volley (boss fan) — spawn each; PvE-only, so no net mirror.
      for (const s2 of c.consumeProjectiles()) this.projectiles.spawn(s2);
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

    this.projectiles.update(
      dt,
      this.camera,
      this.combatants,
      WORLD.arenaSize / 2,
      (x, y, z) => this.arena.blocksProjectile(x, y, z),
    );

    for (const c of this.combatants) c.refreshHealthBar(this.camera);
    this.updateReticle();
    feedback.update(dt);

    this.renderer.render(this.scene, this.camera);
    this.updateHud(dt);
  };

  private updateCameraPosition(): void {
    const o = CAMERA.offset;
    this.camera.position.set(
      this.camTarget.x + o.x,
      this.camTarget.y + o.y,
      this.camTarget.z + o.z,
    );
    this.camera.lookAt(this.camTarget);
    feedback.cameraShake(this.camera);
  }

  private applyCameraFrustum(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const h = this.viewHeight;
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
    const charName = ROSTER.find((c) => c.id === p.characterId)?.name ?? "?";
    const r = p.resourceInfo;
    this.resourceFill.style.width = `${Math.max(0, Math.min(1, r.frac)) * 100}%`;
    this.resourceFill.style.background = r.color;
    const hpFrac = p.health / p.maxHealth;
    this.vignette.style.opacity =
      p.alive && hpFrac < 0.35 ? String((1 - hpFrac / 0.35) * 0.55) : "0";

    let statusLine: string;
    if (this.online) {
      statusLine = `online (${this.remotes.size + 1})`;
      this.bossBar.style.display = "none";
      this.overlay.style.display = "none";
    } else {
      statusLine = this.updateRunHud();
    }

    this.hud.textContent =
      `fps   ${this.fpsSmoothed.toFixed(0)}\n` +
      `char  ${charName}  [1-9]\n` +
      `hp    ${Math.ceil(p.health)}/${p.maxHealth}\n` +
      `${r.name}  ${Math.ceil(p.resource)}/${p.maxResource}\n` +
      `${statusLine}\n` +
      `shots ${this.projectiles.count}`;
  }

  /** Drive the wave HUD (boss bar + victory/defeat overlay); returns the status line. */
  private updateRunHud(): string {
    const v = this.director.view;

    if (v.bossHpFrac != null) {
      this.bossBar.style.display = "block";
      this.bossFill.style.width = `${Math.max(0, Math.min(1, v.bossHpFrac)) * 100}%`;
    } else {
      this.bossBar.style.display = "none";
    }

    if (v.status === "idle") {
      this.overlay.style.display = "flex";
      this.overlayTitle.textContent = "Wave Survival";
      this.overlayTitle.style.color = "#e7ebf3";
      this.overlaySub.textContent = "Choose your fighter — survive 5 waves, then the Death Lord.";
      this.retryBtn.textContent = "Start Run";
      return "press Start";
    }
    if (v.status === "victory" || v.status === "defeat") {
      const win = v.status === "victory";
      this.overlay.style.display = "flex";
      this.overlayTitle.textContent = win ? "Victory" : "Defeat";
      this.overlayTitle.style.color = win ? "#8fe388" : "#ff6b6b";
      this.overlaySub.textContent = win
        ? "The Death Lord has fallen."
        : `You reached wave ${v.wave} of ${v.totalWaves}.`;
      this.retryBtn.textContent = "Retry";
    } else {
      this.overlay.style.display = "none";
    }

    const hearts = "♥".repeat(Math.max(0, v.lives)) || "—";
    return `wave  ${v.wave}/${v.totalWaves}   foes ${v.enemiesLeft}   ${hearts}`;
  }
}
