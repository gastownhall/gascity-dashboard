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
import { driftKeepCount, pelletVisibleAtLod } from '../render/pellets';

/**
 * Per-species hit radius in CSS pixels. Keeping this in screen space prevents
 * the same silhouette from becoming impossible to target at the overview and
 * enormous to target when zoomed in.
 */
const HIT_RADIUS_PX_BY_SPECIES: Record<FishSpecies, number> = {
  pool: 24,
  role: 34,
  grouper: 52,
};

/** Pellets are small and numerous, but remain practical targets at every zoom
 * where their rendered mark is visible. */
const PELLET_HIT_RADIUS_PX = 14;

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
  cssPixelsPerWorldUnit: number,
): FishEntity | null {
  let best: FishEntity | null = null;
  let bestDistSq = Infinity;
  for (const f of fish) {
    const pos = kinematics[f.id];
    if (pos === undefined) continue;
    const radius = HIT_RADIUS_PX_BY_SPECIES[f.species] / cssPixelsPerWorldUnit;
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
  cssPixelsPerWorldUnit: number,
  visibleDriftKeepCount: number,
): PelletEntity | null {
  let best: PelletEntity | null = null;
  let bestDistSq = Infinity;
  for (const p of pellets) {
    if (!pelletVisibleAtLod(p, visibleDriftKeepCount)) continue;
    const pos = kinematics[p.beadId];
    if (pos === undefined) continue;
    const radius = PELLET_HIT_RADIUS_PX / cssPixelsPerWorldUnit;
    const dSq = distanceSq(worldX, worldY, pos.x, pos.y);
    if (dSq > radius * radius) continue;
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
 * fish is under the cursor. Pellet candidates use the renderer's exact LOD
 * visibility contract, so thinned backlog is never an invisible hit target.
 */
export function hitTestScene(
  worldX: number,
  worldY: number,
  fish: readonly FishEntity[],
  fishKinematics: Readonly<Record<string, FishKinematics>>,
  pellets: readonly PelletEntity[],
  pelletKinematics: Readonly<Record<string, PelletKinematics>>,
  cssPixelsPerWorldUnit: number,
): HitResult {
  const fishHit = hitTestFish(worldX, worldY, fish, fishKinematics, cssPixelsPerWorldUnit);
  if (fishHit !== null) return { kind: 'fish', entity: fishHit };
  const pelletHit = hitTestPellet(
    worldX,
    worldY,
    pellets,
    pelletKinematics,
    cssPixelsPerWorldUnit,
    driftKeepCount(cssPixelsPerWorldUnit),
  );
  if (pelletHit !== null) return { kind: 'pellet', entity: pelletHit };
  return null;
}
