import { describe, expect, it } from 'vitest';
import { WORLD } from '../contracts';
import { BAND_WORKING_Y } from './constants';
import { createShoalAccum } from './grid';
import type { HomeAnchor } from './restPositions';
import { tickFish, type FishTickInputs } from './fishTick';

const ANCHOR: HomeAnchor = { x: 2000, y: WORLD.seabedY, radius: 200 };

function baseInputs(overrides: Partial<FishTickInputs>): FishTickInputs {
  return {
    seed: 42,
    pose: 'idle',
    isMayor: false,
    tombstoned: false,
    prevKin: undefined,
    homeAnchor: ANCHOR,
    taskTarget: undefined,
    shoal: createShoalAccum(),
    clockMs: 0,
    dtS: 1 / 60,
    ...overrides,
  };
}

describe('tickFish — general', () => {
  it('is deterministic for identical inputs', () => {
    const inputs = baseInputs({
      pose: 'working',
      prevKin: { x: 10, y: 20, heading: 0.2, speed: 70, phase: 1 },
    });
    expect(tickFish(inputs)).toEqual(tickFish(inputs));
  });

  it('spawns a brand-new working fish in its mid-water band near its home x, never at the origin', () => {
    const kin = tickFish(baseInputs({ pose: 'working' }));
    expect(kin.x === 0 && kin.y === 0).toBe(false);
    expect(Math.abs(kin.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius * 1.5);
    expect(Math.abs(kin.y - BAND_WORKING_Y)).toBeLessThanOrEqual(80);
  });

  it('a tombstoned fish freezes exactly at its previous kinematics with zero speed', () => {
    const prevKin = { x: 111, y: 222, heading: 1.1, speed: 55, phase: 0.4 };
    const kin = tickFish(baseInputs({ pose: 'errored', tombstoned: true, prevKin }));
    expect(kin).toEqual({ ...prevKin, speed: 0 });
  });

  it('never produces NaN/Infinity across every pose', () => {
    for (const pose of [
      'working',
      'idle',
      'asleep',
      'awaiting-input',
      'stalled',
      'rate-limited',
      'errored',
    ] as const) {
      const kin = tickFish(baseInputs({ pose }));
      expect(Number.isFinite(kin.x)).toBe(true);
      expect(Number.isFinite(kin.y)).toBe(true);
      expect(Number.isFinite(kin.heading)).toBe(true);
      expect(Number.isFinite(kin.speed)).toBe(true);
    }
  });
});

describe('tickFish — working', () => {
  it('cruises with positive speed', () => {
    const kin = tickFish(
      baseInputs({
        pose: 'working',
        prevKin: { x: 2000, y: 1900, heading: 0, speed: 70, phase: 0 },
      }),
    );
    expect(kin.speed).toBeGreaterThan(0);
  });

  it('is pulled toward its task pellet target over several ticks', () => {
    const target = { x: 2400, y: BAND_WORKING_Y };
    let kin = { x: 2000, y: BAND_WORKING_Y, heading: 0, speed: 70, phase: 0 };
    for (let i = 0; i < 240; i += 1) {
      kin = tickFish(
        baseInputs({ pose: 'working', prevKin: kin, taskTarget: target, clockMs: i * 16 }),
      );
    }
    expect(Math.hypot(kin.x - target.x, kin.y - target.y)).toBeLessThan(
      Math.hypot(2000 - target.x, BAND_WORKING_Y - target.y),
    );
  });

  it('rises from the seabed into the mid-water pellet band and holds it, never sinking back', () => {
    // Start at the formation base; the band-home tether must lift it above the
    // crest into the working band rather than let it linger on the seabed.
    let kin = { x: ANCHOR.x, y: ANCHOR.y, heading: 0, speed: 70, phase: 0 };
    for (let i = 0; i < 1500; i += 1) {
      kin = tickFish(baseInputs({ pose: 'working', prevKin: kin, clockMs: i * 16 }));
    }
    expect(kin.y).toBeLessThan(ANCHOR.y - ANCHOR.radius);
    expect(Math.abs(kin.y - BAND_WORKING_Y)).toBeLessThan(180);
  });
});

describe('tickFish — hold poses', () => {
  it('asleep speed trends to zero once it reaches its rest point', () => {
    // FIX 3 pushed the asleep rest point OUT onto the open sand (clear of the
    // rock), so a fish transitioning from the formation base has farther to
    // swim before it settles — give it the ticks to arrive.
    let kin = { x: ANCHOR.x, y: ANCHOR.y, heading: 0, speed: 0, phase: 0 };
    for (let i = 0; i < 900; i += 1) {
      kin = tickFish(baseInputs({ pose: 'asleep', prevKin: kin, clockMs: i * 16 }));
    }
    expect(kin.speed).toBeCloseTo(0, 1);
  });

  it('awaiting-input rises steadily toward the waterline band from the seabed', () => {
    let kin = { x: ANCHOR.x, y: ANCHOR.y, heading: 0, speed: 0, phase: 0 };
    for (let i = 0; i < 300; i += 1) {
      kin = tickFish(baseInputs({ pose: 'awaiting-input', prevKin: kin, clockMs: i * 16 }));
    }
    expect(kin.y).toBeLessThan(ANCHOR.y);
  });

  it('awaiting-input reaches and holds the waterline band given enough time', () => {
    let kin = { x: ANCHOR.x, y: ANCHOR.y, heading: 0, speed: 0, phase: 0 };
    for (let i = 0; i < 3000; i += 1) {
      kin = tickFish(baseInputs({ pose: 'awaiting-input', prevKin: kin, clockMs: i * 16 }));
    }
    expect(kin.y).toBeLessThan(WORLD.waterlineY + 150);
    expect(kin.speed).toBe(0);
  });

  it('errored rises toward the waterline band from the seabed', () => {
    let kin = { x: ANCHOR.x, y: ANCHOR.y, heading: 0, speed: 0, phase: 0 };
    for (let i = 0; i < 300; i += 1) {
      kin = tickFish(baseInputs({ pose: 'errored', prevKin: kin, clockMs: i * 16 }));
    }
    expect(kin.y).toBeLessThan(ANCHOR.y);
  });
});

describe('tickFish — world bounds', () => {
  it('never leaves the world bounds even from an out-of-bounds previous position', () => {
    const kin = tickFish(
      baseInputs({
        pose: 'working',
        prevKin: { x: -5000, y: -5000, heading: 0, speed: 70, phase: 0 },
      }),
    );
    expect(kin.x).toBeGreaterThanOrEqual(0);
    expect(kin.x).toBeLessThanOrEqual(WORLD.width);
    expect(kin.y).toBeGreaterThanOrEqual(0);
    expect(kin.y).toBeLessThanOrEqual(WORLD.height);
  });
});
