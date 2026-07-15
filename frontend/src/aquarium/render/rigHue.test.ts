import { describe, expect, it } from 'vitest';
import { CITY_KEY, UNRIGGED_KEY } from '../contracts';
import { MAROON_HUE, RIG_HUES, rigHue } from './rigHue';

/** shortest angular distance between two hue degrees (0..180) */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

describe('rigHue', () => {
  it('is deterministic in the key (a rig keeps its colour across calls/sessions)', () => {
    expect(rigHue('reef-alpha')).toBe(rigHue('reef-alpha'));
    expect(rigHue('some-long-rig-name')).toBe(rigHue('some-long-rig-name'));
  });

  it('does not depend on which other rigs exist (pure in the key)', () => {
    const first = rigHue('reef-gamma');
    rigHue('unrelated-a');
    rigHue('unrelated-b');
    expect(rigHue('reef-gamma')).toBe(first);
  });

  it('returns a hue from the curated palette for a real rig', () => {
    for (const key of ['reef-alpha', 'reef-beta', 'reef-gamma', 'harbor', 'x']) {
      expect(RIG_HUES).toContain(rigHue(key));
    }
  });

  it('reads neutral (null) for the mayor city and unrigged strata', () => {
    expect(rigHue(CITY_KEY)).toBeNull();
    expect(rigHue(UNRIGGED_KEY)).toBeNull();
    expect(rigHue('')).toBeNull();
  });

  it('every curated hue clears the maroon ledger band (One Mark stays maroon-only)', () => {
    for (const hue of RIG_HUES) {
      expect(hueDistance(hue, MAROON_HUE), `hue ${hue}`).toBeGreaterThanOrEqual(40);
    }
  });

  it('offers a wide palette of mutually distinct hues (fewer rig collisions)', () => {
    // enough hues that a ~20-rig city rarely doubles up, and no two are so close
    // they read as the same colour.
    expect(RIG_HUES.length).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < RIG_HUES.length; i += 1) {
      for (let j = i + 1; j < RIG_HUES.length; j += 1) {
        const a = RIG_HUES[i]!;
        const b = RIG_HUES[j]!;
        expect(hueDistance(a, b), `hues ${a} vs ${b}`).toBeGreaterThanOrEqual(18);
      }
    }
  });

  it('keeps adjacent array indices far apart in hue (hash neighbours read distinct)', () => {
    for (let i = 1; i < RIG_HUES.length; i += 1) {
      expect(hueDistance(RIG_HUES[i]!, RIG_HUES[i - 1]!)).toBeGreaterThanOrEqual(60);
    }
  });

  it('distinguishes at least several rigs (colour actually separates projects)', () => {
    const keys = ['reef-alpha', 'reef-beta', 'reef-gamma', 'harbor', 'delta', 'mesa'];
    const distinct = new Set(keys.map((k) => rigHue(k)));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });
});
