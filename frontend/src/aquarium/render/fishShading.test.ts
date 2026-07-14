import { describe, expect, it } from 'vitest';
import type { ScenePalette, ThemeMood } from '../contracts';
import { buildScenePalette } from './palette';
import { countershadeColors } from './fishShading';
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

describe('countershadeColors', () => {
  it('runs dark dorsal → light ventral in both moods (kills the flat clip-art read)', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = countershadeColors(palette(mood), false);
      expect(L(c.dorsal), `${mood} dorsal<mid`).toBeLessThan(L(c.mid));
      expect(L(c.mid), `${mood} mid<ventral`).toBeLessThan(L(c.ventral));
      expect(L(c.ventral), `${mood} ventral≤belly`).toBeLessThanOrEqual(L(c.belly));
    }
  });

  it('the dorsal→ventral lightness delta is large enough to read at ~150px', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = countershadeColors(palette(mood), false);
      expect(L(c.ventral) - L(c.dorsal), mood).toBeGreaterThan(20);
    }
  });

  it('the dimmed (asleep/tombstone) variant is muted: lower contrast than normal', () => {
    for (const mood of ['light', 'dark'] as const) {
      const p = palette(mood);
      const normal = countershadeColors(p, false);
      const dim = countershadeColors(p, true);
      const normalDelta = L(normal.ventral) - L(normal.dorsal);
      const dimDelta = L(dim.ventral) - L(dim.dorsal);
      expect(dimDelta, mood).toBeLessThan(normalDelta);
    }
  });

  it('the pectoral light tone is brighter than the dark back (fin catches light)', () => {
    const c = countershadeColors(palette('light'), false);
    expect(L(c.finLight)).toBeGreaterThan(L(c.finRoot));
  });
});
