import type { Action, Archetype } from "./characters.ts";
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
  | { kind: "dash"; speed: number; duration: number; iframes: number };

export interface SkillDef {
  id: string;
  name: string;
  action: Action; // animation to play
  cooldown: number; // seconds
  color: string; // skill-bar accent
  effect: SkillEffect;
}

export const SKILLS = {
  whirlwind: {
    id: "whirlwind", name: "Whirlwind", action: "spin", cooldown: 5, color: "#ff8a3d",
    effect: { kind: "melee", activeFrame: 6, damage: 18, range: 2.9, arcDeg: 360, knockback: 9 },
  },
  powershot: {
    id: "powershot", name: "Power Shot", action: "quickShot", cooldown: 4, color: "#a06bff",
    effect: { kind: "projectile", activeFrame: 6, damage: 28, speed: 26, knockback: 10, radius: 0.4, lifetime: 1.6 },
  },
  dash: {
    id: "dash", name: "Dash", action: "frontFlip", cooldown: 3, color: "#4cd9ff",
    effect: { kind: "dash", speed: 17, duration: 0.4, iframes: 0.35 },
  },
  kick: {
    id: "kick", name: "Kick", action: "kick", cooldown: 4, color: "#ffd34c",
    effect: { kind: "melee", activeFrame: 6, damage: 8, range: 2.3, arcDeg: 90, knockback: 17 },
  },
  cast: {
    id: "cast", name: "Firebolt", action: "cast", cooldown: 5, color: "#ff5e5e",
    effect: { kind: "projectile", activeFrame: 8, projectile: "FireSpell", damage: 22, speed: 16, knockback: 6, radius: 0.4, lifetime: 2 },
  },
} satisfies Record<string, SkillDef>;

export type SkillId = keyof typeof SKILLS;

/** Default equipped loadout per archetype (slots map to SKILL_KEYS). */
export const LOADOUTS: Record<Archetype, SkillId[]> = {
  melee: ["whirlwind", "dash", "kick", "cast"],
  ranged: ["powershot", "dash", "kick", "cast"],
};

export const SKILL_KEYS = ["KeyQ", "KeyE", "KeyR", "KeyF"];
export const SKILL_KEY_LABELS = ["Q", "E", "R", "F"];

/** Projectile types explicitly referenced by skills (for preloading). */
export const SKILL_PROJECTILES: ProjectileType[] = Object.values(SKILLS).flatMap(
  (s) => {
    const e = s.effect;
    return e.kind === "projectile" && "projectile" in e && e.projectile
      ? [e.projectile]
      : [];
  },
);
