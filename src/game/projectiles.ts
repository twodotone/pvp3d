import {
  PROJECTILE_MANIFEST,
  type ProjectileType,
} from "./projectileManifest.generated.ts";

export type { ProjectileType };

export interface ProjectileVisual {
  fps: number;
  /** World size along the art's long (travel) axis. */
  length: number;
  /** Extra rotation (radians) if the art doesn't already point +X (East). */
  baseAngle: number;
  loop: boolean;
}

/**
 * Per-type render tuning. The art points roughly along +X with a motion trail;
 * `baseAngle` corrects it if a given sprite points the other way (tunable in
 * play with the , and . keys).
 */
export const PROJECTILE_VISUALS: Record<ProjectileType, ProjectileVisual> = {
  Arrow: { fps: 24, length: 1.8, baseAngle: 0, loop: true },
  FireArrow: { fps: 24, length: 1.8, baseAngle: 0, loop: true },
  ArcSpell: { fps: 20, length: 1.1, baseAngle: 0, loop: true },
  DeathSpell: { fps: 22, length: 1.6, baseAngle: 0, loop: true },
  FireSpell: { fps: 22, length: 1.4, baseAngle: 0, loop: true },
  IceSpell: { fps: 22, length: 1.6, baseAngle: 0, loop: true },
  // AoE ground effects — not used as travelling shots yet, sized for later.
  FireAoE: { fps: 24, length: 3, baseAngle: 0, loop: false },
  IceAoE: { fps: 24, length: 3, baseAngle: 0, loop: false },
  DeathAoE: { fps: 24, length: 3, baseAngle: 0, loop: false },
  SwordAoE: { fps: 24, length: 2.5, baseAngle: 0, loop: false },
};

/** Public URLs for every frame texture of a projectile, in order. */
export function projectileFrameUrls(type: ProjectileType): string[] {
  return PROJECTILE_MANIFEST[type].frames.map(
    (n) => `/projectiles/${type}/${String(n).padStart(4, "0")}.webp`,
  );
}

/** height / width of a frame (for preserving aspect when scaling). */
export function projectileAspect(type: ProjectileType): number {
  const m = PROJECTILE_MANIFEST[type];
  return m.h / m.w;
}

/** First non-empty frame index (skips the launch/charge-up intro). */
export function projectileStart(type: ProjectileType): number {
  return PROJECTILE_MANIFEST[type].start;
}

/** Live-tunable correction added to every projectile's aim (the , and . keys). */
export const PROJECTILE_ANGLE_OFFSET = { value: 0 };
