// Rig formations: deterministic hash-placed reef geography. Same rig set,
// same anchors, every derive call — the operator's spatial memory of "where
// the rig lives" must never drift while the fleet composition is unchanged.

import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { CITY_KEY, UNRIGGED_KEY, WORLD, type RigFormation } from '../contracts';
import { hashString } from './hash';

export interface FormationInputs {
  /** key = canonical rig name (or UNRIGGED_KEY); items/total per rig's open queue. */
  beadsByRig: Readonly<Record<string, { items: readonly Bead[]; total: number }>>;
  /** homeKey of every fish (CITY_KEY and UNRIGGED_KEY included verbatim). */
  fishHomeKeys: readonly string[];
}

const MIN_RADIUS = 140;
const MAX_RADIUS = 420;
const RADIUS_PER_CREW = 26;
/** Minimum world-unit gap enforced between adjacent formation silhouettes,
 * on top of their two radii, so shoals never visually merge two reefs. */
const MIN_GAP_WU = 24;
const SEABED_MARGIN_X = 200;

export function buildFormations(inputs: FormationInputs): RigFormation[] {
  const crewCountByKey = countBy(inputs.fishHomeKeys);
  const keys = formationKeys(inputs.beadsByRig, crewCountByKey);
  if (keys.length === 0) return [];

  // Hash-order assignment: the i-th smallest key hash gets the i-th slot,
  // left to right — the same rig set always resolves to the same order.
  const sorted = [...keys].sort(byHashThenKey);
  const radii = sorted.map((key) => radiusForCrew(crewCountByKey.get(key) ?? 0));
  const anchorXs = placeAlongSeabed(sorted.length, radii);

  return sorted.map((key, i) => ({
    key,
    anchorX: anchorXs[i]!,
    anchorY: WORLD.seabedY,
    radius: radii[i]!,
    seed: hashString(key),
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

/**
 * Evenly-spaced base slots across the seabed band, then a left-to-right
 * sweep that pushes any formation right until it clears the minimum gap from
 * its left neighbor. Guarantees no overlap for any radius set; large radius
 * counts may run past the nominal right margin rather than overlap.
 */
function placeAlongSeabed(count: number, radii: readonly number[]): number[] {
  const usableWidth = WORLD.width - 2 * SEABED_MARGIN_X;
  const xs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = SEABED_MARGIN_X + (usableWidth * (i + 0.5)) / count;
    const prevX = xs[i - 1];
    const prevRadius = radii[i - 1];
    if (prevX === undefined || prevRadius === undefined) {
      xs.push(base);
      continue;
    }
    const minX = prevX + prevRadius + radii[i]! + MIN_GAP_WU;
    xs.push(Math.max(base, minX));
  }
  return xs;
}
