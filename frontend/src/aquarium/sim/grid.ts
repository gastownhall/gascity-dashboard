// Uniform spatial hash grid for O(n) working-fish neighbour queries. Replaces
// the old per-rig O(k^2) neighbour scan (200 fish -> up to 40k distance checks
// a frame) that spiked the camera-sweep p95: fish are bucketed once per tick
// into fixed cells, and each fish gathers steering only from the 3x3 block of
// cells around its own — every point within one neighbour radius, never more.
//
// The grid is module-level scratch, fully rebuilt each buildShoalGrid() call
// and reused across ticks so the per-frame hot path allocates nothing. That
// internal mutation does NOT make advanceSim impure: its RETURN value is a
// pure function of (snapshot, prev, dt) because the grid is deterministically
// rebuilt from those inputs every call (bucket contents are in snapshot order;
// counting-sort scatter is stable), so two calls with equal inputs still
// produce byte-identical output.

import { WORLD, type FishEntity, type SimState } from '../contracts';
import { SHOAL_NEIGHBOR_RADIUS_WU, SHOAL_SEPARATION_RADIUS_WU } from './constants';

/** Cell edge = the neighbour radius, so the 3x3 block around a fish's own
 * cell contains every point within one neighbour radius (and no query ever
 * needs to look further than one ring of cells). */
export const GRID_CELL_WU = SHOAL_NEIGHBOR_RADIUS_WU;

const COLS = Math.max(1, Math.ceil(WORLD.width / GRID_CELL_WU) + 1);
const ROWS = Math.max(1, Math.ceil(WORLD.height / GRID_CELL_WU) + 1);
const CELL_COUNT = COLS * ROWS;

const NEIGHBOR_R2 = SHOAL_NEIGHBOR_RADIUS_WU * SHOAL_NEIGHBOR_RADIUS_WU;
const SEPARATION_R2 = SHOAL_SEPARATION_RADIUS_WU * SHOAL_SEPARATION_RADIUS_WU;

/** Pre-reduced steering pull for one fish, filled by gatherShoal in a single
 * allocation-free pass over the 3x3 neighbourhood. Scalar accumulators, not
 * arrays of neighbour objects — the old reduce-per-neighbour centroid was the
 * dominant GC churn. */
export interface ShoalAccum {
  /** sum of within-radius neighbour positions (cohesion) + their count. */
  cohX: number;
  cohY: number;
  cohCount: number;
  /** accumulated inverse-square push away from too-close neighbours. */
  sepX: number;
  sepY: number;
  /** sum of within-radius neighbour heading unit vectors (alignment). */
  alignCos: number;
  alignSin: number;
  alignCount: number;
}

export function createShoalAccum(): ShoalAccum {
  return {
    cohX: 0,
    cohY: 0,
    cohCount: 0,
    sepX: 0,
    sepY: 0,
    alignCos: 0,
    alignSin: 0,
    alignCount: 0,
  };
}

export function resetShoalAccum(a: ShoalAccum): void {
  a.cohX = 0;
  a.cohY = 0;
  a.cohCount = 0;
  a.sepX = 0;
  a.sepY = 0;
  a.alignCos = 0;
  a.alignSin = 0;
  a.alignCount = 0;
}

// Module-level scratch, reused across ticks. Cell arrays are fixed-size (the
// grid is bounded); member arrays grow (doubling) only when a frame carries
// more working fish than ever seen before, then are reused forever after.
const counts = new Int32Array(CELL_COUNT);
const cellStart = new Int32Array(CELL_COUNT + 1);
const cursor = new Int32Array(CELL_COUNT);

let capacity = 0;
let memberX = new Float64Array(0);
let memberY = new Float64Array(0);
let memberCos = new Float64Array(0);
let memberSin = new Float64Array(0);
let memberCell = new Int32Array(0);
let order = new Int32Array(0);
let memberCount = 0;
const slotById = new Map<string, number>();

/** Neighbour-candidate comparisons in the last-built tick — exposed only so a
 * perf test can prove the query stays sub-quadratic (grid, not O(n^2)). */
let comparisons = 0;
export function shoalComparisonCount(): number {
  return comparisons;
}

function ensureCapacity(n: number): void {
  if (n <= capacity) return;
  let cap = capacity === 0 ? 64 : capacity;
  while (cap < n) cap *= 2;
  memberX = new Float64Array(cap);
  memberY = new Float64Array(cap);
  memberCos = new Float64Array(cap);
  memberSin = new Float64Array(cap);
  memberCell = new Int32Array(cap);
  order = new Int32Array(cap);
  capacity = cap;
}

function clampCell(v: number, n: number): number {
  if (v < 0) return 0;
  if (v >= n) return n - 1;
  return v;
}

function cellIndex(x: number, y: number): number {
  const cx = clampCell(Math.floor(x / GRID_CELL_WU), COLS);
  const cy = clampCell(Math.floor(y / GRID_CELL_WU), ROWS);
  return cy * COLS + cx;
}

/**
 * Rebuild the grid over every working, live, previously-positioned fish (its
 * last-tick position feeds cohesion/alignment/separation, matching the old
 * "neighbours are prev-tick fish" semantics). Members are pushed in snapshot
 * order; a stable counting sort buckets them, so gather order — and therefore
 * the floating-point steering sums — is deterministic.
 */
export function buildShoalGrid(fish: readonly FishEntity[], prev: SimState): void {
  ensureCapacity(fish.length);
  memberCount = 0;
  slotById.clear();
  comparisons = 0;

  for (const f of fish) {
    if (f.pose !== 'working' || f.tombstoned) continue;
    const kin = prev.fish[f.id];
    if (kin === undefined) continue;
    const slot = memberCount;
    memberCount += 1;
    memberX[slot] = kin.x;
    memberY[slot] = kin.y;
    memberCos[slot] = Math.cos(kin.heading);
    memberSin[slot] = Math.sin(kin.heading);
    memberCell[slot] = cellIndex(kin.x, kin.y);
    slotById.set(f.id, slot);
  }

  counts.fill(0);
  for (let s = 0; s < memberCount; s += 1) {
    const cell = memberCell[s]!;
    counts[cell] = counts[cell]! + 1;
  }
  let acc = 0;
  for (let c = 0; c < CELL_COUNT; c += 1) {
    cellStart[c] = acc;
    cursor[c] = acc;
    acc += counts[c]!;
  }
  cellStart[CELL_COUNT] = acc;
  for (let s = 0; s < memberCount; s += 1) {
    const cell = memberCell[s]!;
    const at = cursor[cell]!;
    order[at] = s;
    cursor[cell] = at + 1;
  }
}

/**
 * Fill `out` with the pre-reduced boids pull for a fish at (x, y), gathered
 * from the 3x3 block of cells around its own. `selfId` (the querying fish, if
 * it is itself a grid member) is skipped so a fish never flocks with itself.
 * One pass, no per-neighbour allocation.
 */
export function gatherShoal(x: number, y: number, selfId: string, out: ShoalAccum): void {
  resetShoalAccum(out);
  const cx = clampCell(Math.floor(x / GRID_CELL_WU), COLS);
  const cy = clampCell(Math.floor(y / GRID_CELL_WU), ROWS);
  const selfSlot = slotById.get(selfId) ?? -1;

  for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
    if (gy < 0 || gy >= ROWS) continue;
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      if (gx < 0 || gx >= COLS) continue;
      const cell = gy * COLS + gx;
      const end = cellStart[cell + 1]!;
      for (let k = cellStart[cell]!; k < end; k += 1) {
        const s = order[k]!;
        if (s === selfSlot) continue;
        comparisons += 1;
        const dx = memberX[s]! - x;
        const dy = memberY[s]! - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= NEIGHBOR_R2) {
          out.cohX += memberX[s]!;
          out.cohY += memberY[s]!;
          out.cohCount += 1;
          out.alignCos += memberCos[s]!;
          out.alignSin += memberSin[s]!;
          out.alignCount += 1;
        }
        if (d2 > 0 && d2 < SEPARATION_R2) {
          // push AWAY from the neighbour: pos - neighbour = -(dx, dy).
          out.sepX += -dx / d2;
          out.sepY += -dy / d2;
        }
      }
    }
  }
}
