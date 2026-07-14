import { describe, expect, it } from 'vitest';
import {
  DEPTH_BANDS,
  bandHaze,
  depthAlpha,
  depthBand,
  depthScale,
  fishDepthZ,
  formationDepth,
  formationDepthZ,
} from './depth';

describe('fish depth (front/back volume)', () => {
  it('fishDepthZ is deterministic and lands in [0, 1)', () => {
    for (const id of ['alpha', 'reef-a/agent-3', 'city/mayor', '', 'x']) {
      const z = fishDepthZ(id);
      expect(z).toBe(fishDepthZ(id));
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThan(1);
    }
  });

  it('spreads ids across the depth range (not all in one plane)', () => {
    const zs = Array.from({ length: 200 }, (_u, i) => fishDepthZ(`agent-${i}`));
    expect(Math.min(...zs)).toBeLessThan(0.2);
    expect(Math.max(...zs)).toBeGreaterThan(0.8);
  });

  it('depthScale is strictly monotonic in z (near larger than far)', () => {
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    for (let i = 1; i < samples.length; i += 1) {
      const lo = samples[i - 1] ?? 0;
      const hi = samples[i] ?? 0;
      expect(depthScale(hi)).toBeGreaterThan(depthScale(lo));
    }
    // far fish are visibly smaller than near fish
    expect(depthScale(0)).toBeLessThan(depthScale(1) * 0.75);
  });

  it('depthAlpha is monotonic and full-opaque only at the front', () => {
    expect(depthAlpha(1)).toBe(1);
    expect(depthAlpha(0)).toBeLessThan(1);
    expect(depthAlpha(0.9)).toBeGreaterThan(depthAlpha(0.1));
  });

  it('depthBand covers 0..DEPTH_BANDS-1 without spilling over', () => {
    expect(depthBand(0)).toBe(0);
    expect(depthBand(0.999999)).toBe(DEPTH_BANDS - 1);
    expect(depthBand(1)).toBe(DEPTH_BANDS - 1);
    for (let i = 0; i <= 20; i += 1) {
      const b = depthBand(i / 20);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(DEPTH_BANDS - 1);
    }
  });

  it('bandHaze fades to zero at the nearest band and is heaviest at the far band', () => {
    expect(bandHaze(DEPTH_BANDS - 1)).toBe(0);
    expect(bandHaze(0)).toBeGreaterThan(0);
    for (let b = 1; b < DEPTH_BANDS; b += 1) {
      expect(bandHaze(b)).toBeLessThan(bandHaze(b - 1));
    }
  });
});

describe('formation depth (background reef)', () => {
  it('formationDepthZ is deterministic and bounded', () => {
    for (const seed of [1, 7, 42, 9999]) {
      const z = formationDepthZ(seed);
      expect(z).toBe(formationDepthZ(seed));
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThan(1);
    }
  });

  it('far reefs (low z) render smaller, hazier and lifted; near reefs full', () => {
    // synthesize the extremes by scanning seeds for a low-z and a high-z reef
    let low = formationDepth(0);
    let high = formationDepth(0);
    for (let seed = 0; seed < 400; seed += 1) {
      const d = formationDepth(seed);
      if (d.z < low.z) low = d;
      if (d.z > high.z) high = d;
    }
    expect(low.scale).toBeLessThan(high.scale); // far smaller
    expect(low.haze).toBeGreaterThan(high.haze); // far hazier
    expect(low.lift).toBeGreaterThan(high.lift); // far pushed up/back
    expect(high.haze).toBeLessThan(0.05); // the nearest reef is near-full pigment
  });
});
