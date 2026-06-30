import * as THREE from "three";
import {
  projectileFrameUrls,
  type ProjectileType,
} from "../game/projectiles.ts";

/**
 * Loads and caches the per-frame textures for projectile types. Projectiles
 * spawn mid-frame, so frames must be ready synchronously — call `preload()` at
 * startup, then `frames()` to get them without awaiting.
 */
const cache = new Map<ProjectileType, THREE.Texture[]>();
const loader = new THREE.TextureLoader();

function configure(t: THREE.Texture): THREE.Texture {
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export async function preloadProjectiles(types: ProjectileType[]): Promise<void> {
  await Promise.all(
    [...new Set(types)].map(async (type) => {
      if (cache.has(type)) return;
      const texes = await Promise.all(
        projectileFrameUrls(type).map((url) =>
          loader.loadAsync(url).then(configure),
        ),
      );
      cache.set(type, texes);
    }),
  );
}

/** Preloaded frame textures for a type (throws if not preloaded). */
export function frames(type: ProjectileType): THREE.Texture[] {
  const f = cache.get(type);
  if (!f) throw new Error(`Projectile "${type}" not preloaded`);
  return f;
}
