import type { Action } from "./characters.ts";
import type { ProjectileType } from "./projectiles.ts";

/**
 * Equippable skills. Each skill plays an animation and, at its active frame,
 * applies ONE effect — which always reduces to something the combat layer
 * already does: a melee query (a 360° arc = AoE), a projectile spawn, or a
 * dash. So skills are a cooldown-gated, data-driven generalization of the basic
 * attack — no new combat systems required.
 */
export type SkillEffect =
  | {
      kind: "melee";
      activeFrame: number;
      damage: number;
      range: number;
      arcDeg: number; // 360 = AoE around the caster
      knockback: number;
    }
  | {
      kind: "projectile";
      activeFrame: number;
      /** Omit to fire the character's own projectile (e.g. the archer's arrow). */
      projectile?: ProjectileType;
      damage: number;
      speed: number;
      knockback: number;
      radius: number;
      lifetime: number;
    }
  | { kind: "dash"; speed: number; duration: number; iframes: number }
  | { kind: "heal"; activeFrame: number; amount: number };

export interface SkillDef {
  id: string;
  name: string;
  action: Action; // animation to play
  cooldown: number; // seconds
  cost: number; // stamina/mana spent
  color: string; // skill-bar accent
  effect: SkillEffect;
}

export const SKILLS = {
  whirlwind: {
    id: "whirlwind", name: "Whirlwind", action: "spin", cooldown: 5, cost: 30, color: "#ff8a3d",
    effect: { kind: "melee", activeFrame: 6, damage: 18, range: 2.9, arcDeg: 360, knockback: 9 },
  },
  powershot: {
    id: "powershot", name: "Power Shot", action: "quickShot", cooldown: 4, cost: 35, color: "#a06bff",
    effect: { kind: "projectile", activeFrame: 6, damage: 28, speed: 26, knockback: 10, radius: 0.4, lifetime: 1.6 },
  },
  dash: {
    id: "dash", name: "Dash", action: "frontFlip", cooldown: 3, cost: 18, color: "#4cd9ff",
    effect: { kind: "dash", speed: 17, duration: 0.4, iframes: 0.35 },
  },
  kick: {
    id: "kick", name: "Kick", action: "kick", cooldown: 4, cost: 16, color: "#ffd34c",
    effect: { kind: "melee", activeFrame: 6, damage: 8, range: 2.3, arcDeg: 90, knockback: 17 },
  },
  cast: {
    // Fires the caster's OWN element (undefined projectile -> character's).
    id: "cast", name: "Bolt", action: "cast", cooldown: 4, cost: 22, color: "#7bb8ff",
    effect: { kind: "projectile", activeFrame: 8, damage: 20, speed: 17, knockback: 6, radius: 0.4, lifetime: 2 },
  },
  slam: {
    id: "slam", name: "Slam", action: "special1", cooldown: 6, cost: 35, color: "#ff7043",
    effect: { kind: "melee", activeFrame: 8, damage: 22, range: 3.2, arcDeg: 360, knockback: 18 },
  },
  heal: {
    id: "heal", name: "Mend", action: "special2", cooldown: 12, cost: 45, color: "#7be07b",
    effect: { kind: "heal", activeFrame: 8, amount: 35 },
  },
  barrage: {
    id: "barrage", name: "Rapid Shot", action: "quickShot", cooldown: 2.5, cost: 14, color: "#9be1ff",
    effect: { kind: "projectile", activeFrame: 5, damage: 15, speed: 24, knockback: 3, radius: 0.35, lifetime: 1.6 },
  },
  bigShot: {
    id: "bigShot", name: "Charged Shot", action: "special1", cooldown: 7, cost: 40, color: "#c07bff",
    effect: { kind: "projectile", activeFrame: 8, damage: 40, speed: 15, knockback: 11, radius: 0.5, lifetime: 2 },
  },
} satisfies Record<string, SkillDef>;

export type SkillId = keyof typeof SKILLS;

/**
 * Per-character equipped loadout (4 skills → SKILL_KEYS). This is the main
 * differentiator: which kit a class brings. Skills that need an archetype's
 * animation (spin = melee; quickShot = ranged) are only slotted to that type.
 */
export const LOADOUTS: Record<string, SkillId[]> = {
  // Melee (stamina)
  "1Knight": ["whirlwind", "dash", "kick", "slam"], // balanced bruiser
  "4Paladin": ["whirlwind", "dash", "heal", "slam"], // sustain tank
  "7DeathKnight": ["slam", "whirlwind", "kick", "dash"], // heavy aggressor
  // Archers (mana, physical arrows)
  "2Archer": ["barrage", "dash", "kick", "bigShot"],
  "5CamoArcher": ["barrage", "dash", "kick", "bigShot"],
  "9Longbow": ["powershot", "dash", "kick", "bigShot"], // long-range poke
  // Casters (mana, elemental — "cast"/"bigShot" fire the class's own element)
  "3Wizard": ["cast", "dash", "kick", "bigShot"],
  "6Mage": ["cast", "dash", "bigShot", "kick"],
  "8DarkLord": ["cast", "dash", "heal", "bigShot"], // dark sustain caster
};

/** Fallback for any character not explicitly listed. */
export const DEFAULT_LOADOUT: SkillId[] = ["dash", "kick", "whirlwind", "cast"];

export const SKILL_KEYS = ["KeyQ", "KeyE", "KeyR", "KeyF"];
export const SKILL_KEY_LABELS = ["Q", "E", "R", "F"];

/** Projectile types explicitly referenced by skills (for preloading). */
export const SKILL_PROJECTILES: ProjectileType[] = Object.values(SKILLS).flatMap(
  (s) => {
    const e = s.effect as SkillEffect;
    return e.kind === "projectile" && e.projectile ? [e.projectile] : [];
  },
);
