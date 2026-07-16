import { describe, expect, it } from 'vitest';
import type { FishEntity, FishKinematics, SimState } from '../contracts';
import { buildShoalGrid, createShoalAccum, gatherShoal, shoalComparisonCount } from './grid';

function workingFish(id: string): FishEntity {
  return {
    id,
    name: id,
    species: 'role',
    isMayor: false,
    pose: 'working',
    poseWord: 'working',
    bellyPct: undefined,
    homeKey: 'rig',
    linkTo: `/agents/${id}`,
    tombstoned: false,
  };
}

function prevFrom(
  entries: ReadonlyArray<[string, Partial<FishKinematics> & { x: number; y: number }]>,
): SimState {
  const fish: Record<string, FishKinematics> = {};
  for (const [id, k] of entries) {
    fish[id] = { heading: 0, speed: 70, phase: 0, ...k };
  }
  return { fish, pellets: {}, clockMs: 0 };
}

describe('spatial grid — neighbourhood correctness', () => {
  it('gathers only points within the neighbour radius and never one outside the 3x3 block', () => {
    // self at (2000, 1000). near = 100 wu (counted). edge = 400 wu, still an
    // adjacent cell so it IS examined, but beyond the 360 radius (not counted).
    // far = 1600 wu, outside the 3x3 block entirely (never even examined).
    const fish = ['near', 'edge', 'far', 'self'].map(workingFish);
    const prev = prevFrom([
      ['near', { x: 2100, y: 1000 }],
      ['edge', { x: 2400, y: 1000 }],
      ['far', { x: 3600, y: 1000 }],
      ['self', { x: 2000, y: 1000 }],
    ]);
    buildShoalGrid(fish, prev);
    const acc = createShoalAccum();
    gatherShoal(2000, 1000, 'self', acc);

    expect(acc.cohCount).toBe(1); // only `near` is within radius
    expect(acc.cohX).toBeCloseTo(2100, 5);
    expect(acc.cohY).toBeCloseTo(1000, 5);
  });

  it('skips the querying fish itself', () => {
    const fish = [workingFish('a'), workingFish('b')].map((f) => f);
    const prev = prevFrom([
      ['a', { x: 2000, y: 1000 }],
      ['b', { x: 2050, y: 1000 }],
    ]);
    buildShoalGrid(fish, prev);
    const acc = createShoalAccum();
    gatherShoal(2000, 1000, 'a', acc);
    // Only `b` is a neighbour of `a`; `a` never flocks with itself.
    expect(acc.cohCount).toBe(1);
    expect(acc.cohX).toBeCloseTo(2050, 5);
  });

  it('accumulates an away-push for a too-close neighbour (separation)', () => {
    const fish = [workingFish('self'), workingFish('close')];
    const prev = prevFrom([
      ['self', { x: 2000, y: 1000 }],
      ['close', { x: 2030, y: 1000 }], // 30 wu < separation radius
    ]);
    buildShoalGrid(fish, prev);
    const acc = createShoalAccum();
    gatherShoal(2000, 1000, 'self', acc);
    // neighbour is to the RIGHT, so the push is to the LEFT (negative x).
    expect(acc.sepX).toBeLessThan(0);
    expect(acc.sepY).toBeCloseTo(0, 6);
  });

  it('excludes members that are tombstoned, non-working, or missing a previous position', () => {
    const alive = workingFish('alive');
    const dead = { ...workingFish('dead'), tombstoned: true };
    const idle: FishEntity = { ...workingFish('idle'), pose: 'idle' };
    const noprev = workingFish('noprev');
    const prev = prevFrom([
      ['alive', { x: 2100, y: 1000 }],
      ['dead', { x: 2100, y: 1000 }],
      ['idle', { x: 2100, y: 1000 }],
      // 'noprev' deliberately absent from prev
    ]);
    buildShoalGrid([alive, dead, idle, noprev], prev);
    const acc = createShoalAccum();
    gatherShoal(2000, 1000, 'self-not-a-member', acc);
    expect(acc.cohCount).toBe(1); // only the live, working, previously-placed fish
  });
});

describe('spatial grid — determinism', () => {
  it('two identical builds+gathers produce identical accumulators', () => {
    const fish = ['a', 'b', 'c'].map(workingFish);
    const prev = prevFrom([
      ['a', { x: 2000, y: 1000, heading: 0.3 }],
      ['b', { x: 2100, y: 1010, heading: 1.1 }],
      ['c', { x: 1950, y: 990, heading: -0.7 }],
    ]);
    function run() {
      buildShoalGrid(fish, prev);
      const acc = createShoalAccum();
      gatherShoal(2000, 1000, 'a', acc);
      return acc;
    }
    expect(run()).toEqual(run());
  });
});

describe('spatial grid — sub-quadratic (grid, not O(n^2))', () => {
  // Fish on a one-per-cell lattice: local density is constant regardless of n,
  // so the 3x3 query cost per fish is bounded and total comparisons scale
  // ~linearly — doubling n roughly doubles the work, nowhere near quadrupling.
  function latticeTick(n: number): number {
    const CELL = 360;
    const cols = 11; // floor(4000 / 360)
    const fish: FishEntity[] = [];
    const entries: Array<[string, { x: number; y: number }]> = [];
    for (let i = 0; i < n; i += 1) {
      const id = `f${i}`;
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      fish.push(workingFish(id));
      entries.push([id, { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 }]);
    }
    const prev = prevFrom(entries);
    buildShoalGrid(fish, prev);
    const acc = createShoalAccum();
    for (const f of fish) {
      const k = prev.fish[f.id]!;
      gatherShoal(k.x, k.y, f.id, acc);
    }
    return shoalComparisonCount();
  }

  it('doubling the population grows comparisons ~linearly, far below the all-pairs baseline', () => {
    const c30 = latticeTick(30);
    const c60 = latticeTick(60);
    expect(c30).toBeGreaterThan(0);
    // Linear would ~double (2x); quadratic would ~quadruple (4x). Assert well
    // under 3x — provably NOT quadratic.
    expect(c60).toBeLessThan(c30 * 3);
    // And a hard ceiling: the all-pairs scan for 60 fish is 60*59 = 3540.
    expect(c60).toBeLessThan(60 * 59 * 0.5);
  });
});
