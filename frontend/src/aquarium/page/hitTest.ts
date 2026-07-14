// Pure hit-testing over already-derived world coordinates. Deliberately
// independent of camera/ and sim/: the caller converts a screen click to
// world space via camera.worldFromScreen() first, then hands the world
// point plus the current snapshot + sim kinematics in here. Kept pure and
// side-effect-free so it is unit-testable without a canvas or a live
// camera module.

import type {
  FishEntity,
  FishKinematics,
  PelletEntity,
  PelletKinematics,
  FishSpecies,
} from '../contracts';

/**
 * Per-species hit radius, in world units. Generous on purpose — the operator
 * is clicking a small silhouette on a screen, not selecting a pixel-precise
 * hitbox. Scales with the species' drawn size: pool workers are the smallest
 * fish on screen, the mayor grouper the largest.
 */
const HIT_RADIUS_BY_SPECIES: Record<FishSpecies, number> = {
  pool: 70,
  role: 100,
  grouper: 150,
};

/** Pellets are small and numerous; a tight, uniform radius keeps a click from
 *  ambiguously hitting a neighbor in a dense drift. */
const PELLET_HIT_RADIUS = 40;

function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * The nearest fish within its species' hit radius of (worldX, worldY), or
 * null when nothing is close enough. Ties break toward the fish earliest in
 * `fish` (stable, deterministic — no reliance on floating-point equality).
 */
export function hitTestFish(
  worldX: number,
  worldY: number,
  fish: readonly FishEntity[],
  kinematics: Readonly<Record<string, FishKinematics>>,
): FishEntity | null {
  let best: FishEntity | null = null;
  let bestDistSq = Infinity;
  for (const f of fish) {
    const pos = kinematics[f.id];
    if (pos === undefined) continue;
    const radius = HIT_RADIUS_BY_SPECIES[f.species];
    const dSq = distanceSq(worldX, worldY, pos.x, pos.y);
    if (dSq > radius * radius) continue;
    if (dSq < bestDistSq) {
      best = f;
      bestDistSq = dSq;
    }
  }
  return best;
}

/** The nearest pellet within PELLET_HIT_RADIUS of (worldX, worldY), or null. */
export function hitTestPellet(
  worldX: number,
  worldY: number,
  pellets: readonly PelletEntity[],
  kinematics: Readonly<Record<string, PelletKinematics>>,
): PelletEntity | null {
  let best: PelletEntity | null = null;
  let bestDistSq = Infinity;
  for (const p of pellets) {
    const pos = kinematics[p.beadId];
    if (pos === undefined) continue;
    const dSq = distanceSq(worldX, worldY, pos.x, pos.y);
    if (dSq > PELLET_HIT_RADIUS * PELLET_HIT_RADIUS) continue;
    if (dSq < bestDistSq) {
      best = p;
      bestDistSq = dSq;
    }
  }
  return best;
}

export type HitResult =
  | { kind: 'fish'; entity: FishEntity }
  | { kind: 'pellet'; entity: PelletEntity }
  | null;

/**
 * Click resolution per specs/plans/reef-aquarium.md: fish win over pellets
 * (fish are the primary living subject); pellets are only reachable when no
 * fish is under the cursor. `pelletsEligible` gates pellet hit-testing on the
 * caller's LOD check (pellets are only individually clickable at LOD2 — the
 * spec's "nearest pellet at LOD2").
 */
export function hitTestScene(
  worldX: number,
  worldY: number,
  fish: readonly FishEntity[],
  fishKinematics: Readonly<Record<string, FishKinematics>>,
  pellets: readonly PelletEntity[],
  pelletKinematics: Readonly<Record<string, PelletKinematics>>,
  pelletsEligible: boolean,
): HitResult {
  const fishHit = hitTestFish(worldX, worldY, fish, fishKinematics);
  if (fishHit !== null) return { kind: 'fish', entity: fishHit };
  if (!pelletsEligible) return null;
  const pelletHit = hitTestPellet(worldX, worldY, pellets, pelletKinematics);
  if (pelletHit !== null) return { kind: 'pellet', entity: pelletHit };
  return null;
}
