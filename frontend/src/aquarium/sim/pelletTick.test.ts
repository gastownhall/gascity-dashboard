import { describe, expect, it } from 'vitest';
import { WORLD } from '../contracts';
import { BAND_WORKING_Y } from './constants';
import { tickPellet, type PelletTickInputs, MOUTH_OFFSET_WU } from './pelletTick';

const ANCHOR = { x: 2000, y: WORLD.seabedY, radius: 200 };

function baseInputs(overrides: Partial<PelletTickInputs>): PelletTickInputs {
  return {
    beadId: 'gc-1',
    state: 'drifting',
    formationAnchor: ANCHOR,
    holderKin: undefined,
    prevKin: undefined,
    gulpMsLeft: undefined,
    seed: 99,
    clockMs: 0,
    dtS: 1 / 60,
    ...overrides,
  };
}

describe('tickPellet — held', () => {
  it('sits exactly MOUTH_OFFSET_WU forward of the holder along its heading', () => {
    const holderKin = { x: 100, y: 200, heading: 0, speed: 70, phase: 0 };
    const kin = tickPellet(baseInputs({ state: 'held', holderKin }));
    expect(kin.x).toBeCloseTo(100 + MOUTH_OFFSET_WU, 6);
    expect(kin.y).toBeCloseTo(200, 6);
  });

  it('rotates the mouth offset with the holder heading', () => {
    const holderKin = { x: 0, y: 0, heading: Math.PI / 2, speed: 70, phase: 0 };
    const kin = tickPellet(baseInputs({ state: 'held', holderKin }));
    expect(kin.x).toBeCloseTo(0, 5);
    expect(kin.y).toBeCloseTo(MOUTH_OFFSET_WU, 5);
  });

  it('falls back near the formation when the holder is unresolved (stale assignee)', () => {
    const kin = tickPellet(baseInputs({ state: 'held', holderKin: undefined }));
    expect(Number.isFinite(kin.x)).toBe(true);
    expect(Math.hypot(kin.x - ANCHOR.x, kin.y - ANCHOR.y)).toBeLessThan(ANCHOR.radius * 2);
  });
});

describe('tickPellet — sunken', () => {
  it('is static: identical position across ticks with no prevKin dependency', () => {
    const a = tickPellet(baseInputs({ state: 'sunken', clockMs: 0 }));
    const b = tickPellet(baseInputs({ state: 'sunken', clockMs: 5000, prevKin: a }));
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('sits at or below the formation anchor (on the seabed)', () => {
    const kin = tickPellet(baseInputs({ state: 'sunken' }));
    expect(kin.y).toBeGreaterThanOrEqual(ANCHOR.y - 1);
  });
});

describe('tickPellet — drifting', () => {
  it('drifts in the mid-water pellet band, above the crest, over the formation width', () => {
    const kin = tickPellet(baseInputs({ state: 'drifting' }));
    expect(kin.y).toBeLessThan(ANCHOR.y - ANCHOR.radius);
    expect(Math.abs(kin.y - BAND_WORKING_Y)).toBeLessThanOrEqual(160);
    expect(Math.abs(kin.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius);
  });

  it('bobs over time (position changes tick to tick even with a fixed seed)', () => {
    const a = tickPellet(baseInputs({ state: 'drifting', clockMs: 0 }));
    const b = tickPellet(baseInputs({ state: 'drifting', clockMs: 1000, prevKin: a }));
    expect(b.y).not.toBeCloseTo(a.y, 3);
  });

  it('is deterministic for identical inputs', () => {
    const inputs = baseInputs({ state: 'drifting', clockMs: 4000 });
    expect(tickPellet(inputs)).toEqual(tickPellet(inputs));
  });
});

describe('tickPellet — eaten', () => {
  it('sits at the holder mouth while the gulp plays', () => {
    const holderKin = { x: 500, y: 600, heading: 0, speed: 0, phase: 0 };
    const kin = tickPellet(baseInputs({ state: 'eaten', holderKin, gulpMsLeft: 1200 }));
    expect(kin.x).toBeCloseTo(500 + MOUTH_OFFSET_WU, 6);
  });

  it('accumulates elapsed time in phase across ticks, capped at gulpMsLeft', () => {
    const holderKin = { x: 0, y: 0, heading: 0, speed: 0, phase: 0 };
    let kin = tickPellet(
      baseInputs({ state: 'eaten', holderKin, gulpMsLeft: 1200, dtS: 0.5, clockMs: 500 }),
    );
    expect(kin.phase).toBeCloseTo(500, 6);
    kin = tickPellet(
      baseInputs({
        state: 'eaten',
        holderKin,
        gulpMsLeft: 1200,
        prevKin: kin,
        dtS: 0.5,
        clockMs: 1000,
      }),
    );
    expect(kin.phase).toBeCloseTo(1000, 6);
    kin = tickPellet(
      baseInputs({
        state: 'eaten',
        holderKin,
        gulpMsLeft: 1200,
        prevKin: kin,
        dtS: 0.5,
        clockMs: 1500,
      }),
    );
    expect(kin.phase).toBeLessThanOrEqual(1200);
  });

  it('holds the last-known position when there is no resolved holder', () => {
    const kin = tickPellet(baseInputs({ state: 'eaten', holderKin: undefined, gulpMsLeft: 1200 }));
    expect(Number.isFinite(kin.x)).toBe(true);
    expect(Number.isFinite(kin.y)).toBe(true);
  });
});
