import {
  TILES,
  TILE_CATEGORIES,
  type TileDef,
  type Rot,
} from "./tileManifest.generated.ts";

export { TILES, TILE_CATEGORIES };
export type { TileDef, Rot };

export const ROTATIONS: Rot[] = ["N", "E", "S", "W"];

export function tileDef(id: string): TileDef | undefined {
  return TILES[id];
}

/** Served URL for a tile at a rotation, falling back to any available rotation. */
export function tileFile(id: string, rot: Rot): string | undefined {
  const t = TILES[id];
  if (!t) return undefined;
  const rel = t.rotations[rot] ?? Object.values(t.rotations)[0];
  return rel ? `/tiles/${rel}` : undefined;
}

/** Rotations a tile actually has art for (for the editor's rotate control). */
export function tileRotations(id: string): Rot[] {
  const t = TILES[id];
  return t ? ROTATIONS.filter((r) => t.rotations[r]) : [];
}
