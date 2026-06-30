import * as THREE from "three";

/**
 * Painter's-algorithm depth sorting for the unified 2.5D billboard layer.
 *
 * Every billboard (tiles, characters, projectiles) is drawn with depthTest off,
 * so draw order alone decides occlusion. We order by each object's GROUND
 * anchor depth along the camera's forward axis: things further from the camera
 * draw first (behind), nearer draw last (on top). A small per-layer band keeps
 * floors under walls/actors under roofs within the same cell.
 */
export const SORT_LAYER = {
  floor: 0,
  /** walls, objects, actors, projectiles — interleaved purely by depth. */
  mid: 1,
  roof: 2,
} as const;

const DEPTH_SCALE = 100; // one cell of depth >> the 0..2 layer band

/** renderOrder for a ground anchor: nearer the camera => larger => drawn later. */
export function sortOrder(
  anchor: THREE.Vector3,
  camera: THREE.Camera,
  layer: number,
): number {
  const e = camera.matrixWorld.elements;
  // Camera looks down its local -Z; world forward = -(3rd column).
  const fx = -e[8];
  const fy = -e[9];
  const fz = -e[10];
  const cp = camera.position;
  const depth =
    (anchor.x - cp.x) * fx + (anchor.y - cp.y) * fy + (anchor.z - cp.z) * fz;
  return -depth * DEPTH_SCALE + layer;
}

/** renderOrder that always wins (health bars, overlays). */
export const ALWAYS_ON_TOP = 1e6;
