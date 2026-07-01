import * as THREE from "three";
import { WORLD } from "../config.ts";
import { Enemy, type EnemyProfile } from "../entities/Enemy.ts";
import { Boss } from "../entities/Boss.ts";
import { Player } from "../entities/Player.ts";
import { feedback } from "../render/Feedback.ts";
import { WAVES, RUN, BOSS_ID, BOSS_PROFILE } from "./waves.ts";

export type RunStatus = "idle" | "starting" | "active" | "victory" | "defeat";

/** Read-only snapshot the HUD renders each frame. */
export interface RunView {
  status: RunStatus;
  wave: number; // 1-based
  totalWaves: number;
  enemiesLeft: number;
  lives: number;
  bossHpFrac: number | null; // null when no boss is on the field
}

interface SpawnReq {
  charId: string;
  profile: EnemyProfile;
  boss: boolean;
}

const PLAYER_SPAWN = new THREE.Vector3(0, 0, 8);

/**
 * Runs the PvE survival encounter: spawns each wave from `waves.ts` at the arena
 * edges, escalates difficulty, handles the between-wave breather + partial heal,
 * the lives/respawn economy, and the boss → Victory / out-of-lives → Defeat
 * ends. It owns the enemy list; the Game updates each enemy's AI and resolves
 * their attacks through the shared combat loop.
 */
export class WaveDirector {
  readonly enemies: Enemy[] = [];

  private status: RunStatus = "idle"; // waits for the player to press Start
  private waveIndex = 0;
  private timer = 0;
  private lives = RUN.lives;

  private spawnQueue: SpawnReq[] = [];
  private spawnTimer = 0;

  private playerDown = false;
  private playerDownTimer = 0;

  private boss: Enemy | null = null;
  private bossDefeated = false;

  constructor(
    private scene: THREE.Scene,
    private player: Player,
    /** Notify the Game to rebuild its combatants list when the roster changes. */
    private onRoster: () => void,
  ) {}

  /** Begin (or restart) a run from wave 1. */
  start(): void {
    this.clearEnemies();
    this.spawnQueue.length = 0;
    this.waveIndex = 0;
    this.lives = RUN.lives;
    this.playerDown = false;
    this.boss = null;
    this.bossDefeated = false;
    this.player.autoRespawn = false;
    this.player.respawn(PLAYER_SPAWN.clone()); // heal + place at the start
    this.status = "starting";
    this.timer = RUN.introSeconds;
    feedback.banner("Wave 1");
    this.onRoster();
  }

  /** Hand control back to free-play (e.g. switching to PvP). */
  stop(): void {
    this.clearEnemies();
    this.spawnQueue.length = 0;
    this.player.autoRespawn = true;
  }

  get view(): RunView {
    return {
      status: this.status,
      wave: this.waveIndex + 1,
      totalWaves: WAVES.length,
      enemiesLeft: this.aliveCount() + this.spawnQueue.length,
      lives: this.lives,
      bossHpFrac: this.boss && this.boss.alive ? this.boss.health / this.boss.maxHealth : null,
    };
  }

  update(dt: number): void {
    if (this.status === "idle") return; // not started yet
    if (this.boss && !this.boss.alive) this.bossDefeated = true;
    this.cull();
    this.drainSpawnQueue(dt);
    this.updateLives(dt);

    if (this.status === "victory" || this.status === "defeat") return;

    if (this.bossDefeated) {
      this.status = "victory";
      feedback.banner("Victory!");
      return;
    }

    if (this.status === "starting") {
      this.timer -= dt;
      if (this.timer <= 0) this.beginWave();
    } else if (this.status === "active") {
      if (this.spawnQueue.length === 0 && this.aliveCount() === 0) {
        this.onWaveCleared();
      }
    }
  }

  // --- Wave flow --------------------------------------------------------

  private beginWave(): void {
    const def = WAVES[this.waveIndex];
    for (const entry of def.entries) {
      for (let i = 0; i < entry.count; i++) {
        this.spawnQueue.push({ charId: entry.charId, profile: def.profile, boss: false });
      }
    }
    if (def.boss) {
      this.spawnQueue.unshift({ charId: BOSS_ID, profile: BOSS_PROFILE, boss: true });
    }
    this.spawnTimer = 0;
    this.status = "active";
  }

  private onWaveCleared(): void {
    if (this.waveIndex >= WAVES.length - 1) {
      this.status = "victory";
      feedback.banner("Victory!");
      return;
    }
    const heal = this.player.maxHealth * RUN.healPerWave;
    this.player.health = Math.min(this.player.maxHealth, this.player.health + heal);
    this.waveIndex++;
    this.status = "starting";
    this.timer = RUN.intermissionSeconds;
    const next = WAVES[this.waveIndex];
    feedback.banner(next.boss ? "The Death Lord approaches" : `Wave ${this.waveIndex + 1}`);
  }

  // --- Spawning + culling ----------------------------------------------

  private drainSpawnQueue(dt: number): void {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnEnemy(this.spawnQueue.shift()!);
    this.spawnTimer = RUN.spawnStagger;
  }

  private spawnEnemy(req: SpawnReq): void {
    const e = req.boss
      ? new Boss(this.spawnPoint(), req.charId, req.profile)
      : new Enemy(this.spawnPoint(), req.charId, req.profile);
    this.scene.add(e.object);
    this.enemies.push(e);
    void e.load();
    if (req.boss) this.boss = e;
    this.onRoster();
  }

  private cull(): void {
    let changed = false;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.readyToCull) {
        this.scene.remove(e.object);
        this.enemies.splice(i, 1);
        if (e === this.boss) this.boss = null;
        changed = true;
      }
    }
    if (changed) this.onRoster();
  }

  private clearEnemies(): void {
    for (const e of this.enemies) this.scene.remove(e.object);
    this.enemies.length = 0;
  }

  // --- Lives ------------------------------------------------------------

  private updateLives(dt: number): void {
    if (this.status === "victory" || this.status === "defeat") return;

    if (!this.player.alive && !this.playerDown) {
      this.playerDown = true;
      this.playerDownTimer = RUN.respawnDelay;
      this.lives -= 1;
      if (this.lives <= 0) {
        this.status = "defeat";
        feedback.banner("Defeat");
        return;
      }
    }
    if (this.playerDown) {
      this.playerDownTimer -= dt;
      if (this.playerDownTimer <= 0) {
        this.player.respawn(PLAYER_SPAWN.clone());
        this.playerDown = false;
      }
    }
  }

  // --- Helpers ----------------------------------------------------------

  private aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /** A point on the arena-edge ring, kept a little away from the player. */
  private spawnPoint(): THREE.Vector3 {
    const b = WORLD.playBound - 1;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * b;
      const z = Math.sin(a) * b;
      const dx = x - this.player.position.x;
      const dz = z - this.player.position.z;
      if (dx * dx + dz * dz > 49) return new THREE.Vector3(x, 0, z); // >= 7 units away
    }
    return new THREE.Vector3(0, 0, -(WORLD.playBound - 1));
  }
}
