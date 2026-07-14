import { describe, expect, it } from 'vitest';
import {
  CITY_KEY,
  UNRIGGED_KEY,
  WORLD,
  type FishEntity,
  type FishKinematics,
  type PelletEntity,
  type RigFormation,
  type SimState,
  type WorldSnapshot,
} from '../contracts';
import { BAND_WORKING_Y } from './constants';
import { shoalComparisonCount } from './grid';
import { advanceSim } from './advanceSim';

function fish(overrides: Partial<FishEntity> & { id: string }): FishEntity {
  return {
    name: overrides.id,
    species: 'role',
    isMayor: false,
    pose: 'idle',
    poseWord: 'idle',
    bellyPct: undefined,
    homeKey: 'alpha',
    linkTo: `/agents/${overrides.id}`,
    tombstoned: false,
    ...overrides,
  };
}

function formation(overrides: Partial<RigFormation> & { key: string }): RigFormation {
  return {
    anchorX: 2000,
    anchorY: WORLD.seabedY,
    radius: 200,
    seed: 1,
    openBeadTotal: 0,
    ...overrides,
  };
}

function pellet(
  overrides: Partial<PelletEntity> & { beadId: string; rigKey: string },
): PelletEntity {
  return { label: overrides.beadId, state: 'drifting', ...overrides };
}

function snapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    formations: [],
    fish: [],
    pellets: [],
    needsAttention: 0,
    pelletOverflow: {},
    ...overrides,
  };
}

const EMPTY_STATE: SimState = { fish: {}, pellets: {}, clockMs: 0 };

describe('advanceSim — determinism', () => {
  it('produces byte-identical output for identical inputs', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha' })],
      fish: [fish({ id: 'f1', pose: 'working' }), fish({ id: 'f2', pose: 'asleep' })],
      pellets: [pellet({ beadId: 'b1', rigKey: 'alpha', state: 'held', fishId: 'f1' })],
    });
    const a = advanceSim(world, EMPTY_STATE, 16, false);
    const b = advanceSim(world, EMPTY_STATE, 16, false);
    expect(b).toEqual(a);
  });

  it('is deterministic across a multi-tick chain (same tick sequence -> same final state)', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha' })],
      fish: [fish({ id: 'f1', pose: 'working' })],
    });
    function run(): SimState {
      let s = EMPTY_STATE;
      for (let i = 0; i < 50; i += 1) s = advanceSim(world, s, 16, false);
      return s;
    }
    expect(run()).toEqual(run());
  });

  it('clamps an oversized dt so a single tick cannot teleport a fish', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha' })],
      fish: [fish({ id: 'f1', pose: 'working' })],
    });
    const withHugeDt = advanceSim(world, EMPTY_STATE, 5000, false);
    const withClampedDt = advanceSim(world, EMPTY_STATE, 50, false);
    expect(withHugeDt.fish.f1).toEqual(withClampedDt.fish.f1);
  });
});

describe('advanceSim — reduced motion', () => {
  it('every fish reports zero speed', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha' })],
      fish: [
        fish({ id: 'f1', pose: 'working' }),
        fish({ id: 'f2', pose: 'idle' }),
        fish({ id: 'f3', pose: 'asleep' }),
        fish({ id: 'f4', pose: 'awaiting-input' }),
        fish({ id: 'f5', pose: 'stalled' }),
        fish({ id: 'f6', pose: 'rate-limited' }),
        fish({ id: 'f7', pose: 'errored' }),
        fish({ id: 'f8', pose: 'working', isMayor: true, homeKey: CITY_KEY }),
      ],
    });
    const result = advanceSim(world, EMPTY_STATE, 16, true);
    for (const id of Object.keys(result.fish)) {
      expect(result.fish[id]?.speed).toBe(0);
    }
  });

  it('keeps every fish within world bounds', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha', anchorX: 100, radius: 200 })],
      fish: [fish({ id: 'f1', pose: 'awaiting-input' }), fish({ id: 'f2', pose: 'errored' })],
    });
    const result = advanceSim(world, EMPTY_STATE, 16, true);
    for (const kin of Object.values(result.fish)) {
      expect(kin.x).toBeGreaterThanOrEqual(0);
      expect(kin.x).toBeLessThanOrEqual(WORLD.width);
      expect(kin.y).toBeGreaterThanOrEqual(0);
      expect(kin.y).toBeLessThanOrEqual(WORLD.height);
    }
  });

  it('honors distress positions: awaiting-input/errored surface near the waterline, asleep stays near the seabed', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha' })],
      fish: [
        fish({ id: 'surfaced', pose: 'awaiting-input' }),
        fish({ id: 'bellyup', pose: 'errored' }),
        fish({ id: 'sleeper', pose: 'asleep' }),
      ],
    });
    const result = advanceSim(world, EMPTY_STATE, 16, true);
    expect(result.fish.surfaced!.y).toBeLessThan(WORLD.waterlineY + 200);
    expect(result.fish.bellyup!.y).toBeLessThan(WORLD.waterlineY + 200);
    expect(result.fish.sleeper!.y).toBeGreaterThan(WORLD.seabedY - 50);
  });

  it('is a pure single-call settle: identical result with a fresh empty prev state', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha' })],
      fish: [fish({ id: 'f1', pose: 'working' })],
    });
    const fromEmpty = advanceSim(world, EMPTY_STATE, 16, true);
    const fromPopulated = advanceSim(
      world,
      {
        fish: { f1: { x: 999, y: 999, heading: 3, speed: 80, phase: 2 } },
        pellets: {},
        clockMs: 5000,
      },
      16,
      true,
    );
    expect(fromPopulated.fish.f1).toEqual(fromEmpty.fish.f1);
  });
});

describe('advanceSim — schooling', () => {
  const IDS = ['s0', 's1', 's2', 's3', 's4', 's5'];

  function pairwise(state: SimState): { min: number; max: number } {
    const pts = IDS.map((id) => state.fish[id]!);
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y);
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
    }
    return { min, max };
  }

  it('working fish converge into a loose shoal without collapsing to a point', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha', anchorX: 2000, radius: 200 })],
      fish: IDS.map((id) => fish({ id, pose: 'working', homeKey: 'alpha' })),
    });
    // Seed the shoal spread wide across the mid-water column, same band y.
    const startXs = [400, 900, 1400, 2600, 3100, 3600];
    const seededFish: Record<string, FishKinematics> = Object.fromEntries(
      IDS.map((id, i) => [
        id,
        { x: startXs[i]!, y: BAND_WORKING_Y, heading: 0, speed: 70, phase: 0 },
      ]),
    );
    let state: SimState = { fish: seededFish, pellets: {}, clockMs: 0 };
    const before = pairwise(state);
    for (let i = 0; i < 1200; i += 1) state = advanceSim(world, state, 16, false);
    const after = pairwise(state);

    // Cohesion: the shoal draws together (spread more than halves).
    expect(after.max).toBeLessThan(before.max * 0.5);
    // Separation: it never collapses onto one point.
    expect(after.min).toBeGreaterThan(25);
  });
});

describe('advanceSim — perf hot path (200 working fish)', () => {
  const RIGS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];

  function bigWorld(): WorldSnapshot {
    const formations = RIGS.map((key, i) =>
      formation({ key, anchorX: 400 + i * 600, radius: 260 }),
    );
    const fishList = Array.from({ length: 200 }, (_, i) =>
      fish({ id: `w${i}`, pose: 'working', homeKey: RIGS[i % RIGS.length]! }),
    );
    return snapshot({ formations, fish: fishList });
  }

  function runChain(ticks: number): SimState {
    const world = bigWorld();
    let s = EMPTY_STATE;
    for (let i = 0; i < ticks; i += 1) s = advanceSim(world, s, 16, false);
    return s;
  }

  it('is deterministic across a 10-tick chain at 200 fish', () => {
    expect(runChain(10)).toEqual(runChain(10));
  });

  it('neighbour queries go through the spatial grid, not an all-pairs O(n^2) scan', () => {
    const world = bigWorld();
    const tick1 = advanceSim(world, EMPTY_STATE, 16, false); // no prev positions yet
    advanceSim(world, tick1, 16, false); // tick 2: grid now populated from tick 1
    const comparisons = shoalComparisonCount();
    expect(comparisons).toBeGreaterThan(0); // the grid is actually exercised
    // An all-pairs scan would be 200*199 = 39800 comparisons per tick; the
    // 3x3 grid neighbourhood keeps it well under half of that.
    expect(comparisons).toBeLessThan(200 * 199 * 0.5);
  });
});

describe('advanceSim — entity set fidelity', () => {
  it('produces exactly one kinematics entry per fish and per pellet in the snapshot', () => {
    const world = snapshot({
      formations: [formation({ key: 'alpha' })],
      fish: [fish({ id: 'f1' }), fish({ id: 'f2' })],
      pellets: [
        pellet({ beadId: 'b1', rigKey: 'alpha' }),
        pellet({ beadId: 'b2', rigKey: 'alpha' }),
      ],
    });
    const result = advanceSim(world, EMPTY_STATE, 16, false);
    expect(Object.keys(result.fish).sort()).toEqual(['f1', 'f2']);
    expect(Object.keys(result.pellets).sort()).toEqual(['b1', 'b2']);
  });

  it('drops kinematics for ids no longer present in the snapshot', () => {
    const world = snapshot({ formations: [], fish: [], pellets: [] });
    const prev: SimState = {
      fish: { gone: { x: 1, y: 1, heading: 0, speed: 0, phase: 0 } },
      pellets: { gone: { x: 1, y: 1, phase: 0 } },
      clockMs: 0,
    };
    const result = advanceSim(world, prev, 16, false);
    expect(result.fish).toEqual({});
    expect(result.pellets).toEqual({});
  });

  it('a fish homed at UNRIGGED_KEY with no matching formation still resolves to an in-bounds position', () => {
    const world = snapshot({ fish: [fish({ id: 'f1', homeKey: UNRIGGED_KEY, pose: 'idle' })] });
    const result = advanceSim(world, EMPTY_STATE, 16, false);
    const kin = result.fish.f1!;
    expect(kin.x).toBeGreaterThanOrEqual(0);
    expect(kin.x).toBeLessThanOrEqual(WORLD.width);
  });

  it('advances the clock by the clamped dt in normal motion, holds it in reduced motion', () => {
    const world = snapshot();
    const normal = advanceSim(world, EMPTY_STATE, 20, false);
    expect(normal.clockMs).toBe(20);
    const reduced = advanceSim(world, { ...EMPTY_STATE, clockMs: 500 }, 20, true);
    expect(reduced.clockMs).toBe(500);
  });
});
