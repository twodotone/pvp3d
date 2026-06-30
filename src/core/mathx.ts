import * as THREE from "three";

/** Ground-plane direction vector for a facing angle (atan2(x, z) convention). */
export function dirFromAngle(a: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(a), 0, Math.cos(a));
}

/** Facing angle from a ground-plane direction (matches dirFromAngle). */
export function angleFromDir(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** cos of the half-angle of an arc given its full width in degrees. */
export function arcCos(fullDeg: number): number {
  return Math.cos(THREE.MathUtils.degToRad(fullDeg / 2));
}

/** Shortest-arc interpolation between two angles (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, Math.max(0, t));
}
