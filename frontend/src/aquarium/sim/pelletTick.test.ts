import { describe, expect, it } from 'vitest';
import { WORLD } from '../contracts';
import { PELLET_DROP_START_Y } from './constants';
import { tickPellet, type PelletTickInputs, MOUTH_OFFSET_WU } from './pelletTick';

const ANCHOR = { x: 2000, y: WORLD.seabedY, radius: 200 };
const CREST = ANCHOR.y - ANCHOR.radius;

function baseInputs(overrides: Partial<PelletTickInputs>): PelletTickInputs {
  return {
    beadId: 'gc-1',
    state: 'drifting',
    formationAnchor: ANCHOR,
    holderKin: undefined,
    prevKin: undefined,
    gulpMsLeft: undefined,
    ageFraction: 0,
    arriving: false,
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

  it('damps toward the mouth instead of snapping when the holder jitters (anti-jitter)', () => {
    const holderKin = { x: 100, y: 200, heading: 0, speed: 70, phase: 0 };
    const target = 100 + MOUTH_OFFSET_WU;
    // Pellet was lagging behind at x=0; one tick moves it PART of the way, not
    // all the way, to the mouth — that partial follow is what kills the twitch.
    const prevKin = { x: 0, y: 200, phase: 0 };
    const kin = tickPellet(baseInputs({ state: 'held', holderKin, prevKin }));
    expect(kin.x).toBeGreaterThan(prevKin.x);
    expect(kin.x).toBeLessThan(target);
  });

  it('converges to the mouth over many ticks (smoothing is stable, not lossy)', () => {
    const holderKin = { x: 100, y: 200, heading: 0, speed: 70, phase: 0 };
    const target = 100 + MOUTH_OFFSET_WU;
    let kin = { x: 0, y: 200, phase: 0 };
    for (let i = 0; i < 120; i += 1) {
      kin = tickPellet(baseInputs({ state: 'held', holderKin, prevKin: kin }));
    }
    expect(kin.x).toBeCloseTo(target, 2);
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

describe('tickPellet — orphaned', () => {
  it('settles in-progress work with no observed owner on the seabed', () => {
    const kin = tickPellet(baseInputs({ state: 'orphaned', holderKin: undefined }));
    expect(kin.y).toBeGreaterThanOrEqual(ANCHOR.y - 1);
  });
});

describe('tickPellet — drifting', () => {
  it('drifts over the formation width, above the crest (open food, not on the seabed)', () => {
    const kin = tickPellet(baseInputs({ state: 'drifting' }));
    expect(kin.y).toBeLessThan(CREST);
    expect(Math.abs(kin.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius);
  });

  it('encodes age as height: a fresh bead floats high, a stale one sinks lower', () => {
    const fresh = tickPellet(baseInputs({ state: 'drifting', ageFraction: 0 }));
    const stale = tickPellet(baseInputs({ state: 'drifting', ageFraction: 1 }));
    // y grows downward, so the stale bead sits lower in the column
    expect(stale.y).toBeGreaterThan(fresh.y);
    // but both stay above the crest — never mistaken for blocked-on-floor beads
    expect(fresh.y).toBeLessThan(CREST);
    expect(stale.y).toBeLessThan(CREST);
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

  it('a newly-arrived bead drops in from the surface, then falls to its age height', () => {
    // first frame spawns at the waterline (food dropped in)
    const first = tickPellet(baseInputs({ state: 'drifting', arriving: true }));
    expect(first.y).toBeCloseTo(PELLET_DROP_START_Y, 6);
    // subsequent frames ease it downward into the food column
    let kin = first;
    for (let i = 0; i < 240; i += 1) {
      kin = tickPellet(
        baseInputs({ state: 'drifting', arriving: true, prevKin: kin, clockMs: i * 16 }),
      );
    }
    expect(kin.y).toBeGreaterThan(first.y);
    expect(kin.y).toBeLessThan(CREST);
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
