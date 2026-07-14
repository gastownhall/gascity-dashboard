import { describe, expect, it } from 'vitest';
import { WORLD } from '../contracts';
import { restPosition, type HomeAnchor } from './restPositions';

const ANCHOR: HomeAnchor = { x: 2000, y: WORLD.seabedY, radius: 200 };

describe('restPosition', () => {
  it('is deterministic for the same pose/anchor/seed', () => {
    expect(restPosition('asleep', ANCHOR, 123)).toEqual(restPosition('asleep', ANCHOR, 123));
  });

  it('varies by seed so fish at the same formation do not stack exactly', () => {
    const a = restPosition('asleep', ANCHOR, 1);
    const b = restPosition('asleep', ANCHOR, 2);
    expect(a).not.toEqual(b);
  });

  it('asleep settles near the seabed, within the formation footprint', () => {
    const p = restPosition('asleep', ANCHOR, 7);
    expect(p.y).toBeGreaterThanOrEqual(WORLD.seabedY);
    expect(Math.abs(p.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius);
  });

  it('awaiting-input rises to the waterline band near the home x', () => {
    const p = restPosition('awaiting-input', ANCHOR, 3);
    expect(p.y).toBeGreaterThan(WORLD.waterlineY);
    expect(p.y).toBeLessThan(WORLD.waterlineY + 150);
    expect(Math.abs(p.x - ANCHOR.x)).toBeLessThan(100);
  });

  it('errored rises to the waterline band, distinct from awaiting-input', () => {
    const errored = restPosition('errored', ANCHOR, 3);
    const awaiting = restPosition('awaiting-input', ANCHOR, 3);
    expect(errored.y).toBeGreaterThan(WORLD.waterlineY);
    expect(errored.y).not.toBeCloseTo(awaiting.y, 0);
  });

  it('rate-limited tucks near the formation, above the bare seabed line', () => {
    const p = restPosition('rate-limited', ANCHOR, 5);
    expect(p.y).toBeLessThan(ANCHOR.y);
    expect(Math.abs(p.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius);
  });

  it('stalled has a defined spawn point near the anchor (used only for a brand-new fish)', () => {
    const p = restPosition('stalled', ANCHOR, 9);
    expect(Math.abs(p.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius);
  });

  it('working and idle also resolve to a plausible near-anchor spawn point', () => {
    for (const pose of ['working', 'idle'] as const) {
      const p = restPosition(pose, ANCHOR, 11);
      expect(Math.abs(p.x - ANCHOR.x)).toBeLessThanOrEqual(ANCHOR.radius * 1.5);
    }
  });
});
