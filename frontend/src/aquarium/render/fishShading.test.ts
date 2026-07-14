import { describe, expect, it } from 'vitest';
import type { ScenePalette, ThemeMood } from '../contracts';
import { buildScenePalette } from './palette';
import { countershadeBands, countershadeColors } from './fishShading';
import { DEPTH_BANDS } from './depth';
import { parseOklch } from './oklch';

const TOKENS: Record<string, string> = {
  surface: '96% 0.012 75',
  fg: '18% 0.012 75',
  'fg-muted': '42% 0.014 75',
  'fg-faint': '52% 0.014 75',
  rule: '80% 0.012 75',
  accent: '40% 0.13 25',
  ok: '50% 0.085 150',
  warn: '60% 0.14 60',
};
const FONT = '"Newsreader", Georgia, serif';

function palette(mood: ThemeMood): ScenePalette {
  return buildScenePalette(mood, TOKENS, FONT);
}

function L(color: string): number {
  return parseOklch(color).l;
}
function C(color: string): number {
  return parseOklch(color).c;
}
function H(color: string): number {
  return parseOklch(color).h;
}

describe('countershadeColors', () => {
  it('runs dark dorsal → light ventral in both moods (kills the flat clip-art read)', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = countershadeColors(palette(mood), 'normal');
      expect(L(c.dorsal), `${mood} dorsal<mid`).toBeLessThan(L(c.mid));
      expect(L(c.mid), `${mood} mid<ventral`).toBeLessThan(L(c.ventral));
      expect(L(c.ventral), `${mood} ventral≤belly`).toBeLessThanOrEqual(L(c.belly));
    }
  });

  it('the dorsal→ventral lightness delta is large enough to read strongly at ~150px', () => {
    // round-2 delta (~31 on navy) read flat; round-3 demands a much bigger gap
    for (const mood of ['light', 'dark'] as const) {
      const c = countershadeColors(palette(mood), 'normal');
      expect(L(c.ventral) - L(c.dorsal), mood).toBeGreaterThan(38);
    }
  });

  it('the lit belly is genuinely desaturated relative to the dark back (not just lighter navy)', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = countershadeColors(palette(mood), 'normal');
      expect(C(c.belly), `${mood} belly chroma`).toBeLessThan(C(c.dorsal));
      expect(C(c.ventral), `${mood} ventral chroma`).toBeLessThan(C(c.dorsal));
    }
  });

  it('the dimmed (asleep/tombstone) variant is muted: lower contrast AND lower chroma than normal', () => {
    for (const mood of ['light', 'dark'] as const) {
      const p = palette(mood);
      const normal = countershadeColors(p, 'normal');
      const dim = countershadeColors(p, 'dim');
      const normalDelta = L(normal.ventral) - L(normal.dorsal);
      const dimDelta = L(dim.ventral) - L(dim.dorsal);
      expect(dimDelta, mood).toBeLessThan(normalDelta);
      // asleep reads washed-out, never a vivid dark fish
      expect(C(dim.mid), `${mood} dim chroma`).toBeLessThan(C(normal.mid));
    }
  });

  it('the tense (rate-limited) variant is darker AND more saturated than normal — awake, held', () => {
    for (const mood of ['light', 'dark'] as const) {
      const p = palette(mood);
      const normal = countershadeColors(p, 'normal');
      const tense = countershadeColors(p, 'tense');
      expect(L(tense.mid), `${mood} tense darker`).toBeLessThan(L(normal.mid));
      expect(C(tense.dorsal), `${mood} tense saturated`).toBeGreaterThan(C(normal.dorsal));
    }
  });

  it('the pectoral light tone is brighter than the dark back (fin catches light)', () => {
    const c = countershadeColors(palette('light'), 'normal');
    expect(L(c.finLight)).toBeGreaterThan(L(c.finRoot));
  });
});

describe('countershadeColors (rig-hue identity)', () => {
  it('carries the rig hue on the flank while keeping the countershade form', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = countershadeColors(palette(mood), 'normal', 300);
      expect(H(c.mid), `${mood} flank hue = rig`).toBeCloseTo(300, 5);
      // form is unchanged: still dark back → lit belly, just in the rig's colour
      expect(L(c.dorsal), `${mood} dorsal<ventral`).toBeLessThan(L(c.ventral));
      expect(C(c.mid), `${mood} vivid flank`).toBeGreaterThan(C(palette(mood).fishBody));
    }
  });

  it('omitting rigHue (neutral: mayor city / unrigged) leaves the base pigment untouched', () => {
    const p = palette('light');
    const neutral = countershadeColors(p, 'normal');
    const explicitNull = countershadeColors(p, 'normal', null);
    expect(neutral.mid).toBe(explicitNull.mid);
    // neutral keeps the palette's own low-chroma body hue, not a rig hue
    expect(H(neutral.mid)).toBeCloseTo(H(p.fishBody), 5);
  });
});

describe('countershadeBands (per-depth atmospheric haze)', () => {
  it('preserves the rig hue as a fish recedes (no hue rotation through the water)', () => {
    // the wrap guard: a gold rig fish (hue 100) must not green toward the teal
    // haze as it hazes into the distance — only its value should recede.
    for (const mood of ['light', 'dark'] as const) {
      const bands = countershadeBands(palette(mood), 'normal', 100);
      const far = bands[0];
      const near = bands[DEPTH_BANDS - 1];
      if (far === undefined || near === undefined) throw new Error('bands missing');
      expect(H(near.mid), `${mood} near keeps rig hue`).toBeCloseTo(100, 5);
      expect(H(far.mid), `${mood} far keeps rig hue`).toBeCloseTo(100, 5);
    }
  });

  it('blends the FAR band strongly toward the water haze; the NEAR band is full pigment', () => {
    for (const mood of ['light', 'dark'] as const) {
      const p = palette(mood);
      const bands = countershadeBands(p, 'normal');
      const far = bands[0];
      const near = bands[DEPTH_BANDS - 1];
      if (far === undefined || near === undefined) throw new Error('bands missing');
      const hazeL = L(p.hazeFar);
      // the far band's flank sits far closer to the haze lightness than the near
      // band's — a far fish desaturates/lightens into the water, reading distant
      expect(Math.abs(L(far.mid) - hazeL), mood).toBeLessThan(Math.abs(L(near.mid) - hazeL));
      // the nearest band is unhazed: the crisp near fish keeps its full pigment
      expect(L(near.mid), mood).toBe(L(countershadeColors(p, 'normal').mid));
    }
  });
});
