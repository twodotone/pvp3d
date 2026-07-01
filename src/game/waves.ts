import type { EnemyProfile } from "../entities/Enemy.ts";

/**
 * Wave content for the PvE survival run. Pure data: the WaveDirector reads this
 * to spawn enemies from the ENEMY_ROSTER (public/enemies pack), escalating each
 * wave via a per-wave stat `profile`. The final wave is the boss (`2DeathLord`)
 * plus a large swarm of mixed minions.
 */
export interface WaveEntry {
  charId: string;
  count: number;
}

export interface WaveDef {
  entries: WaveEntry[];
  /** Stat scaling applied to every minion in this wave. */
  profile: EnemyProfile;
  /** Final wave: also spawns the boss alongside the listed swarm. */
  boss?: boolean;
}

/** Run-wide constants (lives, pacing, healing). */
export const RUN = {
  lives: 3,
  respawnDelay: 2.2, // seconds down before you respawn (when lives remain)
  introSeconds: 2.4, // banner beat before the first wave spawns
  intermissionSeconds: 4, // breather between waves
  healPerWave: 0.4, // fraction of max HP restored when a wave is cleared
  spawnStagger: 0.35, // seconds between individual spawns within a wave
} as const;

/** The boss (spawned when a wave sets `boss: true`). */
export const BOSS_ID = "2DeathLord";
export const BOSS_PROFILE: EnemyProfile = {
  healthMul: 10,
  damageMul: 1.6,
  speedMul: 0.85,
  cooldownMul: 0.9,
  scale: 1.9,
};

export const WAVES: WaveDef[] = [
  // 1 — a light melee warm-up.
  {
    entries: [
      { charId: "1Brute", count: 2 },
      { charId: "6Warrior", count: 2 },
    ],
    profile: { healthMul: 0.8, damageMul: 0.8 },
  },
  // 2 — add a shooter to the mix.
  {
    entries: [
      { charId: "6Warrior", count: 3 },
      { charId: "5Archer", count: 2 },
    ],
    profile: { healthMul: 0.9, damageMul: 0.9 },
  },
  // 3 — faster attackers + a fire archer.
  {
    entries: [
      { charId: "4Berserker", count: 3 },
      { charId: "7DarkArcher", count: 2 },
      { charId: "3DarkKnight", count: 1 },
    ],
    profile: { healthMul: 1.0, damageMul: 1.0 },
  },
  // 4 — casters join the fray.
  {
    entries: [
      { charId: "3DarkKnight", count: 2 },
      { charId: "9Wizard", count: 2 },
      { charId: "8Necromancer", count: 2 },
      { charId: "4Berserker", count: 2 },
    ],
    profile: { healthMul: 1.1, damageMul: 1.1, speedMul: 1.05 },
  },
  // 5 — a big mixed swarm before the boss.
  {
    entries: [
      { charId: "1Brute", count: 3 },
      { charId: "4Berserker", count: 3 },
      { charId: "5Archer", count: 2 },
      { charId: "8Necromancer", count: 2 },
    ],
    profile: { healthMul: 1.2, damageMul: 1.15, speedMul: 1.05 },
  },
  // 6 — BOSS: the Death Lord, surrounded by a large group of mixed minions.
  {
    boss: true,
    entries: [
      { charId: "3DarkKnight", count: 2 },
      { charId: "4Berserker", count: 3 },
      { charId: "8Necromancer", count: 2 },
    ],
    profile: { healthMul: 1.15, damageMul: 1.1, speedMul: 1.0 },
  },
];
