import * as THREE from "three";

/**
 * A soft radial "blob" shadow texture, generated once and shared. Used under
 * characters when the sprites are shadowless so they read as grounded.
 */
let cached: THREE.Texture | null = null;

export function blobShadowTexture(): THREE.Texture {
  if (cached) return cached;
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(0,0,0,0.6)");
  g.addColorStop(0.55, "rgba(0,0,0,0.3)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  cached = new THREE.CanvasTexture(c);
  cached.colorSpace = THREE.SRGBColorSpace;
  return cached;
}
