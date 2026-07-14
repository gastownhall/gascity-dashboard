import { describe, expect, it } from 'vitest';
import { WORLD, type AquariumPose } from '../contracts';
import {
  BAND_AWAITING_Y,
  BAND_ERRORED_Y,
  BAND_IDLE_Y,
  BAND_STALLED_Y,
  BAND_WORKING_Y,
  IDLE_BAND_HALF_HEIGHT_WU,
  WORKING_BAND_GUARD_WU,
  WORKING_BAND_HALF_HEIGHT_WU,
} from './constants';
import { restPosition, type HomeAnchor } from './restPositions';

const ANCHOR: HomeAnchor = { x: 2000, y: WORLD.seabedY, radius: 200 };
/** Top of the formation silhouette (base center minus footprint radius). */
const CREST = ANCHOR.y - ANCHOR.radius;

describe('restPosition — determinism', () => {
  it('is deterministic for the same pose/anchor/seed', () => {
    expect(restPosition('asleep', ANCHOR, 123)).toEqual(restPosition('asleep', ANCHOR, 123));
  });

  it('varies by seed so fish at the same formation do not stack exactly', () => {
    expect(restPosition('working', ANCHOR, 1)).not.toEqual(restPosition('working', ANCHOR, 2));
  });
});

describe('restPosition — vertical bands (the shared pose table)', () => {
  it('gives every pose a distinct water-column band, ordered surface → seabed', () => {
    for (const seed of [1, 42, 99, 12345, 777]) {
      const y = (pose: AquariumPose) => restPosition(pose, ANCHOR, seed).y;
      // awaiting-input / errored (surface) < stalled (upper-mid) < working
      // (mid) < idle (mid-low) < rate-limited < asleep (seabed).
      expect(y('awaiting-input')).toBeLessThan(y('errored'));
      expect(y('errored')).toBeLessThan(y('stalled'));
      expect(y('stalled')).toBeLessThan(y('working'));
      expect(y('working')).toBeLessThan(y('idle'));
      expect(y('idle')).toBeLessThan(y('rate-limited'));
      expect(y('rate-limited')).toBeLessThan(y('asleep'));
    }
  });

  it('working shoals in the mid-water pellet band: above the crest, below the waterline', () => {
    const p = restPosition('working', ANCHOR, 7);
    expect(Math.abs(p.y - BAND_WORKING_Y)).toBeLessThanOrEqual(WORKING_BAND_HALF_HEIGHT_WU);
    expect(p.y).toBeGreaterThan(WORLD.waterlineY);
    expect(p.y).toBeLessThan(CREST);
    expect(Math.abs(p.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius);
  });

  it('idle sits below the working shoal but well off the seabed', () => {
    const idle = restPosition('idle', ANCHOR, 7);
    const working = restPosition('working', ANCHOR, 7);
    expect(Math.abs(idle.y - BAND_IDLE_Y)).toBeLessThanOrEqual(90);
    expect(idle.y).toBeGreaterThan(working.y);
    expect(idle.y).toBeLessThan(ANCHOR.y - 100);
  });

  it('stalled treads upper-mid, strictly between the surface band and the working shoal', () => {
    const stalled = restPosition('stalled', ANCHOR, 7);
    expect(Math.abs(stalled.y - BAND_STALLED_Y)).toBeLessThanOrEqual(55);
    expect(stalled.y).toBeGreaterThan(BAND_ERRORED_Y + 100);
    expect(stalled.y).toBeLessThan(BAND_WORKING_Y - 100);
  });

  it('asleep settles OUT on the open sand, clear of the formation footprint', () => {
    const p = restPosition('asleep', ANCHOR, 7);
    expect(p.y).toBeGreaterThanOrEqual(ANCHOR.y);
    // FIX 3: asleep is offset beyond the silhouette radius — "sleeping in the
    // open", never touching the rock.
    expect(Math.abs(p.x - ANCHOR.x)).toBeGreaterThan(ANCHOR.radius);
  });

  it('awaiting-input rises to touch the waterline band near the home x', () => {
    const p = restPosition('awaiting-input', ANCHOR, 3);
    expect(Math.abs(p.y - BAND_AWAITING_Y)).toBeLessThanOrEqual(15);
    expect(p.y).toBeGreaterThan(WORLD.waterlineY);
    expect(Math.abs(p.x - ANCHOR.x)).toBeLessThan(100);
  });

  it('errored holds the surface band just below awaiting-input', () => {
    const errored = restPosition('errored', ANCHOR, 3);
    const awaiting = restPosition('awaiting-input', ANCHOR, 3);
    expect(Math.abs(errored.y - BAND_ERRORED_Y)).toBeLessThanOrEqual(15);
    expect(errored.y).toBeGreaterThan(awaiting.y);
  });

  it('rate-limited tucks against the formation near the seabed, offset above asleep', () => {
    const rl = restPosition('rate-limited', ANCHOR, 5);
    const asleep = restPosition('asleep', ANCHOR, 5);
    expect(rl.y).toBeLessThan(ANCHOR.y);
    expect(rl.y).toBeGreaterThan(BAND_IDLE_Y);
    expect(rl.y).toBeLessThan(asleep.y);
    // FIX 3: jammed deep inside the footprint (in the rock's shadow).
    expect(Math.abs(rl.x - ANCHOR.x)).toBeLessThan(ANCHOR.radius * 0.4);
  });
});

describe('restPosition — FIX 3 legibility separation', () => {
  const SEEDS = [1, 42, 99, 12345, 777];

  it('asleep sits on the open sand, rate-limited jams under the rock — max horizontal separation', () => {
    for (const seed of SEEDS) {
      const asleep = restPosition('asleep', ANCHOR, seed);
      const rl = restPosition('rate-limited', ANCHOR, seed);
      const asleepOffset = Math.abs(asleep.x - ANCHOR.x);
      const rlOffset = Math.abs(rl.x - ANCHOR.x);
      // asleep clear of the silhouette, rate-limited deep in the footprint,
      // and asleep is unambiguously the farther of the two from the rock core.
      expect(asleepOffset).toBeGreaterThan(ANCHOR.radius);
      expect(rlOffset).toBeLessThanOrEqual(ANCHOR.radius * 0.4);
      expect(asleepOffset).toBeGreaterThan(rlOffset);
    }
  });

  it('rate-limited rides up under the overhang; asleep rests on the floor below the base', () => {
    for (const seed of SEEDS) {
      const asleep = restPosition('asleep', ANCHOR, seed);
      const rl = restPosition('rate-limited', ANCHOR, seed);
      expect(rl.y).toBeLessThan(ANCHOR.y);
      expect(asleep.y).toBeGreaterThanOrEqual(ANCHOR.y);
    }
  });

  it('awaiting-input touches the waterline; stalled treads far below (height alone separates them)', () => {
    for (const seed of SEEDS) {
      const awaiting = restPosition('awaiting-input', ANCHOR, seed);
      const stalled = restPosition('stalled', ANCHOR, seed);
      expect(awaiting.y).toBeLessThan(WORLD.waterlineY + 60);
      expect(stalled.y - awaiting.y).toBeGreaterThan(300);
    }
  });
});

describe('restPosition — FIX 1 working band is a guarded mid-water VOLUME', () => {
  // The working band (y only) is anchor-independent, but sample varied anchors
  // and many seeds so the disjointness holds for the whole fleet, not one fish.
  const ANCHORS: HomeAnchor[] = [
    { x: 2000, y: WORLD.seabedY, radius: 200 },
    { x: 800, y: WORLD.seabedY + 150, radius: 340 },
    { x: 3500, y: WORLD.seabedY + 60, radius: 140 },
  ];

  function bandYs(pose: AquariumPose): number[] {
    const ys: number[] = [];
    for (const anchor of ANCHORS) {
      for (let seed = 0; seed < 200; seed += 1) ys.push(restPosition(pose, anchor, seed).y);
    }
    return ys;
  }

  it('the derived guard margin is comfortably positive (protects the 7/7 pose separation)', () => {
    expect(WORKING_BAND_GUARD_WU).toBeGreaterThanOrEqual(100);
  });

  it('working fish fill a thick vertical band, not a thin mid-water line', () => {
    const workY = bandYs('working');
    const thickness = Math.max(...workY) - Math.min(...workY);
    // Occupies most of its full ±half extent — a volume, well past a flat line.
    expect(thickness).toBeGreaterThan(2 * WORKING_BAND_HALF_HEIGHT_WU - 40);
  });

  it('the working band stays DISJOINT from stalled above and idle below with the guard margin', () => {
    const minWork = Math.min(...bandYs('working'));
    const maxWork = Math.max(...bandYs('working'));
    const maxStall = Math.max(...bandYs('stalled'));
    const minIdle = Math.min(...bandYs('idle'));
    // No working fish reaches up into the stalled stratum...
    expect(minWork - maxStall).toBeGreaterThanOrEqual(WORKING_BAND_GUARD_WU);
    // ...nor down into the idle stratum; both gaps clear the guard margin.
    expect(minIdle - maxWork).toBeGreaterThanOrEqual(WORKING_BAND_GUARD_WU);
  });

  it('idle fish also get vertical variation but stay clear of working and asleep', () => {
    const idleY = bandYs('idle');
    const idleRange = Math.max(...idleY) - Math.min(...idleY);
    expect(idleRange).toBeGreaterThan(2 * IDLE_BAND_HALF_HEIGHT_WU - 40);
    // Below every working fish, and never down onto the seabed rest poses.
    expect(Math.min(...idleY)).toBeGreaterThan(Math.max(...bandYs('working')));
    expect(Math.max(...idleY)).toBeLessThan(Math.min(...bandYs('rate-limited')));
  });
});
