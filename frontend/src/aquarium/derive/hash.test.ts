import { describe, expect, it } from 'vitest';
import { hashString, hashUnit, hashRange } from './hash';

describe('hashString (FNV-1a 32-bit)', () => {
  it('is deterministic for the same input', () => {
    expect(hashString('gc-rig-alpha')).toBe(hashString('gc-rig-alpha'));
  });

  it('differs for different inputs (no trivial collisions on close strings)', () => {
    expect(hashString('gc-rig-alpha')).not.toBe(hashString('gc-rig-beta'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('is always a non-negative 32-bit unsigned integer', () => {
    for (const s of ['', 'x', 'mayor', 'unrigged', 'a-very-long-rig-name-indeed']) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('matches the known FNV-1a 32-bit vector for the empty string', () => {
    // Canonical FNV-1a 32-bit offset basis; hashing "" performs zero mix
    // rounds so the result is exactly the offset basis.
    expect(hashString('')).toBe(0x811c9dc5);
  });
});

describe('hashUnit', () => {
  it('is deterministic and always in [0, 1)', () => {
    for (const n of [0, 1, 2, 12345, 0xffffffff]) {
      const u = hashUnit(n);
      expect(hashUnit(n)).toBe(u);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('spreads distinct integers to distinct units (no collapse to a constant)', () => {
    const values = new Set([0, 1, 2, 3, 4, 5].map(hashUnit));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe('hashRange', () => {
  it('maps into [min, max) deterministically', () => {
    for (let i = 0; i < 20; i += 1) {
      const v = hashRange(hashString(`id-${i}`), 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('is stable for the same seed', () => {
    const seed = hashString('stable-seed');
    expect(hashRange(seed, -5, 5)).toBe(hashRange(seed, -5, 5));
  });
});
