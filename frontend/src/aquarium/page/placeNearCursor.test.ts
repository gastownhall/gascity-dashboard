import { describe, expect, it } from 'vitest';
import { placeNearCursor } from './placeNearCursor';

const VIEWPORT = { cssWidth: 1000, cssHeight: 800 };
const OFFSET = 12;

describe('placeNearCursor', () => {
  it('sits down-and-right of the cursor when there is room', () => {
    const { left, top } = placeNearCursor(100, 100, 200, 80, VIEWPORT, OFFSET);
    expect(left).toBe(100 + OFFSET);
    expect(top).toBe(100 + OFFSET);
  });

  it('flips to the left of the cursor when the right edge would overflow', () => {
    // 950 + 12 + 200 = 1162 > 1000 → flip left of the cursor
    const { left } = placeNearCursor(950, 100, 200, 80, VIEWPORT, OFFSET);
    expect(left).toBe(950 - OFFSET - 200);
  });

  it('flips above the cursor when the bottom edge would overflow', () => {
    // 770 + 12 + 80 = 862 > 800 → flip above the cursor
    const { top } = placeNearCursor(100, 770, 200, 80, VIEWPORT, OFFSET);
    expect(top).toBe(770 - OFFSET - 80);
  });

  it('flips both axes at the bottom-right corner (fish-name clip case)', () => {
    const { left, top } = placeNearCursor(990, 790, 200, 80, VIEWPORT, OFFSET);
    expect(left).toBe(990 - OFFSET - 200);
    expect(top).toBe(790 - OFFSET - 80);
  });

  it('clamps to the top-left when a flipped box would still run off the near edge', () => {
    // anchor near the right edge but box wider than the cursor's left gap →
    // left would be negative; pin to 0 rather than push it off-screen.
    const { left, top } = placeNearCursor(
      30,
      20,
      200,
      80,
      { cssWidth: 220, cssHeight: 90 },
      OFFSET,
    );
    expect(left).toBe(0);
    expect(top).toBe(0);
  });

  it('keeps the default side when the box exactly meets the edge (no false flip)', () => {
    // 788 + 12 + 200 = 1000, not > 1000 → no flip
    const { left } = placeNearCursor(788, 100, 200, 80, VIEWPORT, OFFSET);
    expect(left).toBe(788 + OFFSET);
  });

  it('treats a zero-size box (not yet measured) as the default lower-right offset', () => {
    const { left, top } = placeNearCursor(500, 400, 0, 0, VIEWPORT, OFFSET);
    expect(left).toBe(500 + OFFSET);
    expect(top).toBe(400 + OFFSET);
  });
});
