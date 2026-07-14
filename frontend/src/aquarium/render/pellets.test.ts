import { describe, expect, it } from 'vitest';
import type { ScenePalette, ThemeMood } from '../contracts';
import { buildScenePalette } from './palette';
import { pelletColors } from './pellets';
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
const L = (c: string): number => parseOklch(c).l;
const H = (c: string): number => parseOklch(c).h;

describe('pelletColors (rig-hue identity)', () => {
  it('tints drift and settled pellets to the rig hue (a rig eats its own colour)', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = pelletColors(palette(mood), 300);
      expect(H(c.tones[0]), `${mood} open pellet hue`).toBeCloseTo(300, 5);
      expect(H(c.sunken[0]), `${mood} blocked pellet hue`).toBeCloseTo(300, 5);
    }
  });

  it('preserves status shade under the tint: open (drift) reads brighter than blocked (sunken)', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = pelletColors(palette(mood), 300);
      expect(L(c.tones[0]), `${mood} open>blocked`).toBeGreaterThan(L(c.sunken[0]));
    }
  });

  it('leaves the unrigged / city pellet the neutral gold (hue = null)', () => {
    const p = palette('light');
    const neutral = pelletColors(p, null);
    expect(neutral.tones[0]).toBe(p.pellet);
    expect(neutral.sunken[0]).toBe(p.pelletSunken);
  });

  it('two rigs get two distinct pellet hues', () => {
    const p = palette('dark');
    expect(H(pelletColors(p, 195).tones[0])).not.toBeCloseTo(H(pelletColors(p, 338).tones[0]), 0);
  });
});
