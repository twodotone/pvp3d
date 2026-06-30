import * as THREE from "three";

/**
 * Loads and caches spritesheet textures. Each base texture is fetched once;
 * characters get an independent `.clone()` so they can scrub their own frame
 * (offset/repeat) without stepping on each other — the clone shares the
 * underlying image, so it's cheap.
 */
const cache = new Map<string, Promise<THREE.Texture>>();
const loader = new THREE.TextureLoader();

function configure(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  // Sub-rect (per-frame) sampling + mipmaps causes neighbour-frame bleeding.
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function loadTexture(file: string): Promise<THREE.Texture> {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(file).then(configure);
    cache.set(file, p);
  }
  return p;
}

export function preload(files: string[]): Promise<THREE.Texture[]> {
  return Promise.all(files.map(loadTexture));
}

/** A per-character copy that can scrub frames independently. */
export async function cloneFor(file: string): Promise<THREE.Texture> {
  const base = await loadTexture(file);
  const c = base.clone();
  c.needsUpdate = true;
  return configure(c);
}
