// Rig formations: deterministic hash-placed reef geography. Same rig set,
// same anchors, every derive call — the operator's spatial memory of "where
// the rig lives" must never drift while the fleet composition is unchanged.
//
// Placement is deliberately IRREGULAR (round-2 fix, sharpened round-3, depth-
// deepened round-4): even spacing + one flat baseline read as a bar chart, not
// a reef. Each formation gets a deterministic per-formation SLOT WEIGHT (so gaps
// vary a lot — some rigs near, some far), a horizontal jitter, a WIDE seabed-
// depth offset (distinct depth planes the render layer scales/hazes fore-to-
// background), and a gentle size-variety multiplier (equal-crew rigs still
// differ in footprint, so silhouettes never read as one repeated icon).
// Adjacency is gated on non-overlapping CORES (not full silhouettes), so
// neighbours may gently overlap and cluster while every rig still keeps a
// distinct, findable home. The per-adjacent-pair CORE-gap floor is a hard
// invariant the blind fixture's single-crop camera math depends on — keep it.

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
/** Absolute horizontal jitter (world units) on each weighted slot centre —
 * an extra break on top of the varied slot widths. */
const JITTER_MAX_WU = 150;
/** Seabed-depth spread: a formation's base sits this many world units below the
 * nominal seabed line at most. Widened (round 4) so formations occupy clearly
 * DIFFERENT depth planes — the render layer scales/hazes higher (further) bases
 * into the background and lower (nearer) bases into the foreground, so the reef
 * reads with fore/mid/background depth rather than one flat row. Stays under
 * WORLD.height so a base never sinks off-tank. */
const DEPTH_BAND_WU = 320;
/** Per-formation slot WEIGHT range: adjacent formations draw widely different
 * spacing (some near, some far), so the row never reads as evenly-spaced bars.
 * Weights are normalised across the reef, so the total span is unchanged. */
const SLOT_WEIGHT_MIN = 0.5;
const SLOT_WEIGHT_MAX = 1.75;
/** Per-formation size-variety multiplier (round 4): even equal-crew rigs get
 * gently different footprints, so silhouettes don't read as one repeated icon.
 * Bounded and applied before the [MIN_RADIUS, MAX_RADIUS] clamp, so the crew
 * signal still dominates and the footprint stays within the same envelope. */
const SIZE_JITTER_MIN = 0.85;
const SIZE_JITTER_MAX = 1.2;

const JITTER_SALT = 0x2545f491;
const DEPTH_SALT = 0x9e3779b1;
const WEIGHT_SALT = 0x27d4eb2f;
const SIZE_SALT = 0x5bd1e995;

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
  const radii = sorted.map((key, i) => radiusForCrew(crewCountByKey.get(key) ?? 0, seeds[i]!));
  const { xs: anchorXs, scale } = placeAlongSeabed(radii, seeds);

  return sorted.map((key, i) => ({
    key,
    anchorX: anchorXs[i]!,
    anchorY: WORLD.seabedY + depthOffset(seeds[i]!),
    // radii shrink by the same factor the positions were compressed, so an
    // overflowing fleet keeps its CORE-gap floor (cores never interpenetrate) —
    // it just becomes a reef of smaller, tighter mounds. A fitting fleet's
    // scale is 1, so its radii are untouched.
    radius: radii[i]! * scale,
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

function radiusForCrew(crewCount: number, seed: number): number {
  const raw = (MIN_RADIUS + RADIUS_PER_CREW * crewCount) * sizeJitter(seed);
  return Math.min(Math.max(raw, MIN_RADIUS), MAX_RADIUS);
}

/** Deterministic per-formation size-variety multiplier in
 * [SIZE_JITTER_MIN, SIZE_JITTER_MAX). */
function sizeJitter(seed: number): number {
  return hashRange(seed ^ SIZE_SALT, SIZE_JITTER_MIN, SIZE_JITTER_MAX);
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
 * gets a deterministic slot WEIGHT, so the reef is carved into wide and narrow
 * slots (varied spacing) rather than equal columns; its centre lands at the
 * weighted cumulative position plus a jitter. A left-to-right sweep then
 * pushes any formation right only far enough to clear the minimum CORE gap
 * from its left neighbour — so silhouettes may gently overlap and cluster, but
 * cores never do, the spacing stays uneven, and adjacent anchors keep the
 * hard per-pair gap floor the blind fixture relies on.
 */
function placeAlongSeabed(
  radii: readonly number[],
  seeds: readonly number[],
): { xs: number[]; scale: number } {
  const usableWidth = WORLD.width - 2 * SEABED_MARGIN_X;
  const weights = seeds.map((s) => hashRange(s ^ WEIGHT_SALT, SLOT_WEIGHT_MIN, SLOT_WEIGHT_MAX));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const xs: number[] = [];
  let cumBefore = 0;
  for (let i = 0; i < radii.length; i += 1) {
    const w = weights[i]!;
    const centreFrac = (cumBefore + w / 2) / totalWeight;
    cumBefore += w;
    const slotCenter = SEABED_MARGIN_X + centreFrac * usableWidth;
    const jitter = hashRange(seeds[i]! ^ JITTER_SALT, -JITTER_MAX_WU, JITTER_MAX_WU);
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
  return fitChainToBand(xs, usableWidth);
}

/** The left-to-right min-CORE-gap ratchet above can accumulate a chain far wider
 * than the tank — 22 large rigs need ~7600 wu of cores+gaps in a 3600-wu band —
 * which shoves the rightmost formations past the wall, where the fish clamp
 * (sim/fishTick clampToWorld) piles their schools on one line (the "stacked pile
 * on the right"). A chain that already fits is returned untouched with scale 1
 * (small cities and the blind fixture stay byte-identical). A chain that overran
 * is compressed to the usable band and centred, and the returned `scale` is
 * applied to the radii too (see buildFormations), so the compressed reef keeps
 * its CORE-gap floor — every adjacent pair's gap and both cores shrink by the
 * same factor, so cores never interpenetrate. Deterministic: a pure function of
 * the same chain. */
function fitChainToBand(
  xs: readonly number[],
  usableWidth: number,
): { xs: number[]; scale: number } {
  if (xs.length === 0) return { xs: [], scale: 1 };
  let min = xs[0]!;
  let max = xs[0]!;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const span = max - min;
  if (span <= usableWidth) return { xs: [...xs], scale: 1 };
  const scale = usableWidth / span;
  const left = SEABED_MARGIN_X + (usableWidth - span * scale) / 2;
  return { xs: xs.map((x) => left + (x - min) * scale), scale };
}
