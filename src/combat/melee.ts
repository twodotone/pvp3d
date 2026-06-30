import * as THREE from "three";
import { Combatant, type MeleeQuery, type HitResult } from "./Combatant.ts";
import { dirFromAngle } from "../core/mathx.ts";

/**
 * Tests one swing against every other combatant: a hit lands if the target is
 * within `range` (+ its radius) and inside the frontal arc. Each surviving
 * target gets `receiveHit`, which handles blocking/i-frames internally.
 */
export function resolveMelee(
  q: MeleeQuery,
  targets: readonly Combatant[],
): HitResult[] {
  const results: HitResult[] = [];
  const fwd = dirFromAngle(q.facing, _fwd);

  for (const t of targets) {
    if (t === q.source || !t.alive) continue;

    const to = _to.copy(t.position).sub(q.origin);
    to.y = 0;
    const dist = to.length();
    if (dist < 1e-4 || dist > q.range + t.radius) continue;

    to.multiplyScalar(1 / dist);
    if (fwd.dot(to) < q.arcCos) continue;

    results.push(
      t.receiveHit({
        damage: q.damage,
        knockback: q.knockback,
        fromDir: to.clone(),
      }),
    );
  }
  return results;
}

const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();
