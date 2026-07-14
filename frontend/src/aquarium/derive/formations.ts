// Rig formations: deterministic hash-placed reef geography. Same rig set,
// same anchors, every derive call — the operator's spatial memory of "where
// the rig lives" must never drift while the fleet composition is unchanged.
//
// Placement is deliberately IRREGULAR (round-2 fix): even spacing + one flat
// baseline read as a bar chart, not a reef. Each formation gets a
// deterministic horizontal jitter and a seabed-depth offset, and adjacency is
// gated on non-overlapping CORES (not full silhouettes) so neighbours may
// gently overlap and cluster while every rig still keeps a distinct home.

import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { CITY_KEY, UNRIGGED_KEY, WORLD, type RigFormation } from '../contracts';
import { hashRange, hashString } from './hash';

export interface FormationInputs {
  /** key = canonical rig name (or UNRIGGED_KEY); items/total per rig's open queue. */
  beadsByRig: Readonly<Record<string, { items: readonly Bead[]; total: number }>>;
  /** homeKey of every fish (CITY_KEY and UNRIGGED_KEY included verbatim). */
  fishHomeKeys: readonly string[];
}

const MIN_RADIUS = 140;
const MAX_RADIUS = 420;
const RADIUS_PER_CREW = 26;
const SEABED_MARGIN_X = 200;

/** A formation's inner "core" — the mound its shoal homes on — is this
 * fraction of its silhouette radius. Adjacent cores never overlap (fish need
 * a findable home); the outer silhouettes (full radius) may gently overlap. */
export const CORE_RADIUS_FRACTION = 0.6;
/** Minimum world-unit gap enforced between adjacent formation CORES. */
const MIN_CORE_GAP_WU = 40;
/** Horizontal jitter, as a fraction of a nominal slot width, that breaks the
 * even left-to-right spacing so formations don't read as evenly-spaced bars. */
const JITTER_FRACTION = 0.32;
/** Seabed-depth spread: a formation's base sits this many world units below
 * the nominal seabed line at most, so bases aren't all on one baseline. */
const DEPTH_BAND_WU = 130;

const JITTER_SALT = 0x2545f491;
const DEPTH_SALT = 0x9e3779b1;

/** A formation's core radius (see CORE_RADIUS_FRACTION). */
export function formationCoreRadius(radius: number): number {
  return radius * CORE_RADIUS_FRACTION;
}

export function buildFormations(inputs: FormationInputs): RigFormation[] {
  const crewCountByKey = countBy(inputs.fishHomeKeys);
  const keys = formationKeys(inputs.beadsByRig, crewCountByKey);
  if (keys.length === 0) return [];

  // Hash-order assignment: the i-th smallest key hash gets the i-th slot,
  // left to right — the same rig set always resolves to the same order.
  const sorted = [...keys].sort(byHashThenKey);
  const seeds = sorted.map((key) => hashString(key));
  const radii = sorted.map((key) => radiusForCrew(crewCountByKey.get(key) ?? 0));
  const anchorXs = placeAlongSeabed(radii, seeds);

  return sorted.map((key, i) => ({
    key,
    anchorX: anchorXs[i]!,
    anchorY: WORLD.seabedY + depthOffset(seeds[i]!),
    radius: radii[i]!,
    seed: seeds[i]!,
    openBeadTotal: inputs.beadsByRig[key]?.total ?? 0,
  }));
}

function formationKeys(
  beadsByRig: FormationInputs['beadsByRig'],
  crewCountByKey: Map<string, number>,
): string[] {
  const keys = new Set<string>([...Object.keys(beadsByRig), ...crewCountByKey.keys()]);
  keys.delete(CITY_KEY);
  if (keys.has(UNRIGGED_KEY)) {
    const hasFish = (crewCountByKey.get(UNRIGGED_KEY) ?? 0) > 0;
    const hasPellets = (beadsByRig[UNRIGGED_KEY]?.items.length ?? 0) > 0;
    if (!hasFish && !hasPellets) keys.delete(UNRIGGED_KEY);
  }
  return [...keys];
}

function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function radiusForCrew(crewCount: number): number {
  const raw = MIN_RADIUS + RADIUS_PER_CREW * crewCount;
  return Math.min(Math.max(raw, MIN_RADIUS), MAX_RADIUS);
}

function byHashThenKey(a: string, b: string): number {
  const diff = hashString(a) - hashString(b);
  return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic seabed-depth offset for a formation base, in [0, DEPTH_BAND]. */
function depthOffset(seed: number): number {
  return Math.round(hashRange(seed ^ DEPTH_SALT, 0, DEPTH_BAND_WU));
}

/**
 * Irregular left-to-right placement across the seabed band. Each formation
 * starts at its nominal slot centre plus a deterministic jitter, then a
 * left-to-right sweep pushes any formation right only far enough to clear the
 * minimum CORE gap from its left neighbour — so silhouettes may gently
 * overlap and cluster, but cores never do, and the spacing stays uneven.
 */
function placeAlongSeabed(radii: readonly number[], seeds: readonly number[]): number[] {
  const count = radii.length;
  const usableWidth = WORLD.width - 2 * SEABED_MARGIN_X;
  const slot = usableWidth / count;
  const jitterMax = slot * JITTER_FRACTION;
  const xs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const slotCenter = SEABED_MARGIN_X + slot * (i + 0.5);
    const jitter = hashRange(seeds[i]! ^ JITTER_SALT, -jitterMax, jitterMax);
    const base = slotCenter + jitter;
    const prevX = xs[i - 1];
    const prevRadius = radii[i - 1];
    if (prevX === undefined || prevRadius === undefined) {
      xs.push(base);
      continue;
    }
    const minX =
      prevX + formationCoreRadius(prevRadius) + formationCoreRadius(radii[i]!) + MIN_CORE_GAP_WU;
    xs.push(Math.max(base, minX));
  }
  return xs;
}
