import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts';
import { adjustL, mixOklch, parseOklch, withAlpha } from './oklch';
import { buildScenePalette } from './palette';

// mirrors frontend/src/styles/index.css :root — bare triplets, no oklch() wrapper
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

function colorFields(palette: ScenePalette): Array<[string, string]> {
  return Object.entries(palette).filter(([key]) => key !== 'fontFamily');
}

describe('buildScenePalette', () => {
  it('wraps every color field in oklch() canonical form', () => {
    for (const mood of ['light', 'dark'] as const) {
      const palette = buildScenePalette(mood, TOKENS, FONT);
      for (const [key, value] of colorFields(palette)) {
        expect(value.startsWith('oklch('), `${mood}.${key} = ${value}`).toBe(true);
        // parseable by the render color math (canonical form, throws otherwise)
        expect(() => parseOklch(value), `${mood}.${key} = ${value}`).not.toThrow();
      }
    }
  });

  it('derives text colors from the fg tokens', () => {
    const palette = buildScenePalette('light', TOKENS, FONT);
    expect(palette.text).toBe('oklch(18% 0.012 75)');
    expect(palette.textMuted).toBe('oklch(42% 0.014 75)');
    expect(palette.waterline).toBe('oklch(42% 0.014 75 / 0.55)');
    expect(palette.ok).toBe('oklch(50% 0.085 150)');
    expect(palette.warn).toBe('oklch(60% 0.14 60)');
  });

  it('never lets the accent (maroon) token into any palette field', () => {
    for (const mood of ['light', 'dark'] as const) {
      const palette = buildScenePalette(mood, TOKENS, FONT);
      for (const [key, value] of Object.entries(palette)) {
        expect(value.includes(TOKENS['accent'] as string), `${mood}.${key}`).toBe(false);
      }
    }
  });

  it('keys distinct water moods to the theme', () => {
    const light = buildScenePalette('light', TOKENS, FONT);
    const dark = buildScenePalette('dark', TOKENS, FONT);
    const aquaticKeys = [
      'waterTop',
      'waterBottom',
      'hazeFar',
      'lightShaft',
      'formation',
      'formationEdge',
      'kelp',
      'fishBody',
      'fishOutline',
      'fishDim',
      'pellet',
    ] as const;
    for (const key of aquaticKeys) {
      expect(light[key], key).not.toBe(dark[key]);
    }
    // sunlit shallows sit high; midnight deep sits low
    expect(parseOklch(light.waterTop).l).toBeGreaterThan(parseOklch(dark.waterTop).l);
    expect(parseOklch(light.waterBottom).l).toBeGreaterThan(parseOklch(dark.waterBottom).l);
  });

  it('passes the font family through untouched', () => {
    expect(buildScenePalette('dark', TOKENS, FONT).fontFamily).toBe(FONT);
  });

  it('throws with the missing token name when a required token is absent', () => {
    expect(() => buildScenePalette('light', { fg: '18% 0.012 75' }, FONT)).toThrow(/fg-muted/);
    expect(() => buildScenePalette('light', {}, FONT)).toThrow(/"fg"/);
  });
});

describe('oklch color math', () => {
  it('parses and round-trips canonical strings', () => {
    expect(parseOklch('oklch(50% 0.085 150)')).toEqual({ l: 50, c: 0.085, h: 150, alpha: 1 });
    expect(parseOklch('oklch(97% 0.03 110 / 0.28)').alpha).toBeCloseTo(0.28, 9);
  });

  it('throws on non-canonical color strings', () => {
    expect(() => parseOklch('#fff')).toThrow(/oklch/);
    expect(() => parseOklch('oklch(0.5 0.085 150)')).toThrow(/oklch/);
  });

  it('adjusts lightness with clamping', () => {
    expect(adjustL('oklch(50% 0.1 200)', 10)).toBe('oklch(60% 0.1 200)');
    expect(parseOklch(adjustL('oklch(95% 0.1 200)', 20)).l).toBe(100);
  });

  it('replaces alpha and mixes componentwise', () => {
    expect(withAlpha('oklch(50% 0.1 200)', 0.5)).toBe('oklch(50% 0.1 200 / 0.5)');
    expect(mixOklch('oklch(20% 0 100)', 'oklch(40% 0.2 200)', 0.5)).toBe('oklch(30% 0.1 150)');
  });
});
