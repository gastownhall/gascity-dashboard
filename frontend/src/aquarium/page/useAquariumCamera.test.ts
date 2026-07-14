import { describe, expect, it } from 'vitest';
import { wheelZoomFactor } from './useAquariumCamera';

// Wheel zoom must be PROPORTIONAL to the scroll delta (not a fixed step per
// event), so trackpads / momentum scroll stay controllable instead of
// compounding to an uncontrollable zoom.
describe('wheelZoomFactor', () => {
  const VH = 900;

  it('zooms in for scroll-up (deltaY < 0) and out for scroll-down', () => {
    expect(wheelZoomFactor(-100, 0, VH)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, VH)).toBeLessThan(1);
  });

  it('is proportional: a bigger delta zooms more than a small one', () => {
    const small = wheelZoomFactor(-20, 0, VH);
    const big = wheelZoomFactor(-120, 0, VH);
    expect(small).toBeGreaterThan(1);
    expect(big).toBeGreaterThan(small);
  });

  it('is gentle for a typical mouse notch (~100px) — well under the old fixed 1.4x', () => {
    expect(wheelZoomFactor(-100, 0, VH)).toBeLessThan(1.2);
  });

  it('clamps a single huge event so it cannot jump', () => {
    expect(wheelZoomFactor(-100000, 0, VH)).toBeLessThanOrEqual(2);
    expect(wheelZoomFactor(100000, 0, VH)).toBeGreaterThanOrEqual(0.5);
  });

  it('normalizes deltaMode: line (1) and page (2) scale up vs raw pixels', () => {
    // One line (deltaMode 1) is worth LINE_HEIGHT_PX pixels; one page is a
    // whole viewport — both should zoom more than a single raw-pixel unit.
    expect(wheelZoomFactor(-1, 1, VH)).toBeGreaterThan(wheelZoomFactor(-1, 0, VH));
    expect(wheelZoomFactor(-1, 2, VH)).toBeGreaterThan(wheelZoomFactor(-1, 1, VH));
  });
});
