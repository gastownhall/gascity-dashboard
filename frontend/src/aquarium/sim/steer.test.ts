import { describe, expect, it } from 'vitest';
import { clampPoint, headingTo, limitTurn, moveToward, seekTarget } from './steer';

describe('limitTurn', () => {
  it('turns fully toward the desired heading when within the max delta', () => {
    expect(limitTurn(0, 0.1, 1)).toBeCloseTo(0.1, 9);
  });

  it('caps the turn at maxDeltaRad when the desired heading is far away', () => {
    expect(limitTurn(0, Math.PI, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('turns the short way around the +-PI wrap boundary', () => {
    // 3.1 -> -3.1 is a ~0.083 rad short hop across the +-PI seam, not the
    // ~6.2 rad long way through 0 — reachable within maxDelta=1.
    expect(limitTurn(3.1, -3.1, 1)).toBeCloseTo(-3.1, 6);
  });

  it('caps a wrap-boundary turn to a partial step in the short direction', () => {
    // Capped before reaching the target: still moves forward (increasing),
    // landing just past the +PI seam rather than short-circuiting backward.
    expect(limitTurn(3.1, -3.1, 0.05)).toBeCloseTo(-3.1331853, 6);
  });

  it('never overshoots past the desired heading', () => {
    const result = limitTurn(0, 0.05, 1);
    expect(result).toBeCloseTo(0.05, 9);
  });
});

describe('headingTo', () => {
  it('points along +x for a target directly to the right', () => {
    expect(headingTo({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 9);
  });

  it('points along +y (down, since y grows downward) for a target directly below', () => {
    expect(headingTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('moveToward', () => {
  it('steps by speed*dt toward the target without overshooting', () => {
    const p = moveToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 1);
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('stops exactly at the target rather than overshooting past it', () => {
    const p = moveToward({ x: 0, y: 0 }, { x: 5, y: 0 }, 100, 1);
    expect(p.x).toBeCloseTo(5, 9);
  });

  it('is a no-op when already at the target', () => {
    const p = moveToward({ x: 3, y: 4 }, { x: 3, y: 4 }, 50, 1);
    expect(p).toEqual({ x: 3, y: 4 });
  });
});

describe('seekTarget', () => {
  it('moves position along the (capped) heading, not straight at the target, when mid-turn', () => {
    // Facing straight down (+y); target is far to the +x side. A tight turn
    // cap means this tick's motion should still be mostly downward, not
    // sideways toward the target.
    const { pos, heading } = seekTarget(
      { x: 0, y: 0 },
      Math.PI / 2,
      { x: 1000, y: 0 },
      100,
      1,
      0.01,
    );
    expect(heading).toBeCloseTo(Math.PI / 2 - 0.01, 6);
    expect(pos.y).toBeGreaterThan(0);
    expect(Math.abs(pos.x)).toBeLessThan(5);
  });

  it('does not overshoot a nearby target even when facing it directly', () => {
    const { pos } = seekTarget({ x: 0, y: 0 }, 0, { x: 5, y: 0 }, 100, 1, 10);
    expect(pos.x).toBeCloseTo(5, 6);
    expect(pos.y).toBeCloseTo(0, 6);
  });

  it('is deterministic', () => {
    const a = seekTarget({ x: 1, y: 2 }, 0.3, { x: 50, y: 60 }, 70, 0.016, 4);
    const b = seekTarget({ x: 1, y: 2 }, 0.3, { x: 50, y: 60 }, 70, 0.016, 4);
    expect(a).toEqual(b);
  });
});

describe('clampPoint', () => {
  it('leaves an in-bounds point untouched', () => {
    expect(clampPoint({ x: 100, y: 100 }, 10, 900, 0, 200)).toEqual({ x: 100, y: 100 });
  });

  it('clamps x and y independently to the given bounds', () => {
    expect(clampPoint({ x: -50, y: 5000 }, 10, 900, 0, 200)).toEqual({ x: 10, y: 200 });
  });
});
