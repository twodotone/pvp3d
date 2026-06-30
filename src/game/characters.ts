import { SHEET_MANIFEST } from "./sheetManifest.generated.ts";
import type { ProjectileType } from "./projectiles.ts";

/**
 * The engine speaks in *logical actions*; each character maps those to its own
 * spritesheet files. That decouples combat/movement code from art filenames and
 * tames the melee-vs-ranged moveset split: both archetypes provide attack1/2/3
 * and block, just backed by different sheets, so gameplay code never branches
 * on character type.
 */
export type Action =
  // shared by all characters
  | "idle" | "idle2" | "walk" | "run" | "runBack" | "strafeL" | "strafeR"
  | "roll" | "slideStart" | "slide" | "slideEnd" | "crouchIdle" | "crouchRun"
  | "frontFlip" | "turn180" | "kick" | "cast" | "special1" | "special2"
  | "hurt" | "die"
  // attack/block (different sheets per archetype, same logical names)
  | "attack1" | "attack2" | "attack3" | "attackRun" | "blockStart" | "blockMid"
  // archetype-specific extras
  | "spin" | "unsheath" | "quickShot" | "sit";

export type Archetype = "melee" | "ranged";

interface ActionDef {
  sheet: string;
  fps: number;
  loop: boolean;
}

/** Animations every character shares (identical sheet names across the pack). */
const COMMON: Partial<Record<Action, ActionDef>> = {
  idle: { sheet: "Idle", fps: 12, loop: true },
  idle2: { sheet: "Idle2", fps: 12, loop: true },
  walk: { sheet: "Walk", fps: 14, loop: true },
  run: { sheet: "Run", fps: 18, loop: true },
  runBack: { sheet: "RunBackwards", fps: 18, loop: true },
  strafeL: { sheet: "StrafeLeft", fps: 16, loop: true },
  strafeR: { sheet: "StrafeRight", fps: 16, loop: true },
  roll: { sheet: "Rolling", fps: 28, loop: false },
  slideStart: { sheet: "SlideStart", fps: 24, loop: false },
  slide: { sheet: "Slide", fps: 18, loop: true },
  slideEnd: { sheet: "SlideEnd", fps: 24, loop: false },
  crouchIdle: { sheet: "CrouchIdle", fps: 10, loop: true },
  crouchRun: { sheet: "CrouchRun", fps: 16, loop: true },
  frontFlip: { sheet: "FrontFlip", fps: 24, loop: false },
  turn180: { sheet: "180Turn", fps: 20, loop: false },
  kick: { sheet: "Kick", fps: 20, loop: false },
  cast: { sheet: "CastSpell", fps: 18, loop: false },
  special1: { sheet: "Special1", fps: 18, loop: false },
  special2: { sheet: "Special2", fps: 18, loop: false },
  hurt: { sheet: "TakeDamage", fps: 18, loop: false },
  die: { sheet: "Die", fps: 16, loop: false },
};

const MELEE: Partial<Record<Action, ActionDef>> = {
  attack1: { sheet: "Melee", fps: 22, loop: false },
  attack2: { sheet: "Melee2", fps: 22, loop: false },
  attack3: { sheet: "Pummel", fps: 22, loop: false },
  attackRun: { sheet: "MeleeRun", fps: 20, loop: false },
  spin: { sheet: "MeleeSpin", fps: 22, loop: false },
  blockStart: { sheet: "ShieldBlockStart", fps: 40, loop: false }, // snappy raise
  blockMid: { sheet: "ShieldBlockMid", fps: 10, loop: true },
  unsheath: { sheet: "UnSheathSword", fps: 18, loop: false },
};

const RANGED: Partial<Record<Action, ActionDef>> = {
  attack1: { sheet: "Attack1", fps: 20, loop: false },
  attack2: { sheet: "Attack2", fps: 20, loop: false },
  attack3: { sheet: "Attack3", fps: 20, loop: false },
  attackRun: { sheet: "AttackRun", fps: 18, loop: false },
  quickShot: { sheet: "QuickShot", fps: 24, loop: false },
  blockStart: { sheet: "BlockStart", fps: 40, loop: false }, // snappy raise
  blockMid: { sheet: "BlockMid", fps: 10, loop: true },
  unsheath: { sheet: "UnSheath", fps: 18, loop: false },
  sit: { sheet: "SittingChair", fps: 8, loop: true },
};

export interface CharacterDef {
  id: string;
  name: string;
  archetype: Archetype;
  /** Which projectile a ranged character fires. */
  projectile?: ProjectileType;
}

/** The playable / spawnable roster (folder id -> display name + archetype). */
export const ROSTER: CharacterDef[] = [
  { id: "1Knight", name: "Knight", archetype: "melee" },
  { id: "2Archer", name: "Archer", archetype: "ranged", projectile: "Arrow" },
  { id: "3Wizard", name: "Wizard", archetype: "ranged", projectile: "IceSpell" },
  { id: "4Paladin", name: "Paladin", archetype: "melee" },
  { id: "5CamoArcher", name: "Camo Archer", archetype: "ranged", projectile: "FireArrow" },
  { id: "6Mage", name: "Mage", archetype: "ranged", projectile: "FireSpell" },
  { id: "7DeathKnight", name: "Death Knight", archetype: "melee" },
  { id: "8DarkLord", name: "Dark Lord", archetype: "ranged", projectile: "DeathSpell" },
  { id: "9Longbow", name: "Longbow", archetype: "ranged", projectile: "Arrow" },
];

export interface ResolvedAnim {
  url: string;
  fps: number;
  loop: boolean;
  frames: number;
}

export interface ResolvedCharacter {
  id: string;
  name: string;
  archetype: Archetype;
  projectile?: ProjectileType;
  /** Ground anchor: cell fraction (0..1) where the feet/shadow bottom sits. */
  anchor: number;
  anims: Partial<Record<Action, ResolvedAnim>>;
}

/**
 * Merge the common + archetype action tables with the generated manifest
 * (frame counts) into a ready-to-load animation set for one character.
 */
export function resolveCharacter(id: string): ResolvedCharacter {
  const def = ROSTER.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown character: ${id}`);
  const meta = SHEET_MANIFEST[id];
  if (!meta) {
    throw new Error(`No manifest for ${id} — run "npm run sheets".`);
  }

  const table = { ...COMMON, ...(def.archetype === "melee" ? MELEE : RANGED) };
  const anims: Partial<Record<Action, ResolvedAnim>> = {};

  for (const [action, d] of Object.entries(table) as [Action, ActionDef][]) {
    const sheet = meta.sheets[d.sheet];
    if (!sheet) continue; // tolerate a character missing a sheet
    anims[action] = {
      url: `/characters/${id}/${d.sheet}.webp`,
      fps: d.fps,
      loop: d.loop,
      frames: sheet.frames,
    };
  }

  return {
    id,
    name: def.name,
    archetype: def.archetype,
    projectile: def.projectile,
    anchor: meta.anchor,
    anims,
  };
}
