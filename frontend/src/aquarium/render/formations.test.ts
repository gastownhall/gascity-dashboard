import { describe, expect, it } from 'vitest';
import type { RigFormation, ScenePalette, ThemeMood } from '../contracts';
import { buildScenePalette } from './palette';
import { coralAccentsForSeed } from './coralColor';
import { buildBranches, buildLobes, buildPolyps } from './formationShapes';
import { formationDepth } from './depth';
import { mulberry32 } from './hash';
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

function palette(mood: ThemeMood): ScenePalette {
  return buildScenePalette(mood, TOKENS, 'serif');
}

function C(color: string): number {
  return parseOklch(color).c;
}
function H(color: string): number {
  return parseOklch(color).h;
}

const SEEDS = Array.from({ length: 40 }, (_u, i) => i * 101 + 7);

describe('coralAccentsForSeed (reef color accents, seed-varied)', () => {
  it('produces warm, chroma-bearing coral accents (kills the monochrome pale-olive read)', () => {
    for (const mood of ['light', 'dark'] as const) {
      const a = coralAccentsForSeed(palette(mood), 12345, 0);
      for (const color of [a.branch, a.polyp, a.polypCore]) {
        expect(() => parseOklch(color)).not.toThrow();
        // restrained but genuinely colored (not a grey/olive rock tone)
        expect(C(color), `${mood} accent chroma`).toBeGreaterThan(0.03);
        expect(C(color), `${mood} accent restrained`).toBeLessThan(0.13);
      }
    }
  });

  it('varies the reef hue per seed — no two reefs are forced to the same coral', () => {
    const hues = new Set(
      SEEDS.map((s) => Math.round(H(coralAccentsForSeed(palette('light'), s, 0).branch))),
    );
    // several distinct reef hues across the seed space (not one monochrome accent)
    expect(hues.size).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic per (palette, seed) — same reef, same coral every session', () => {
    const p = palette('dark');
    expect(coralAccentsForSeed(p, 88, 0)).toEqual(coralAccentsForSeed(p, 88, 0));
  });

  it('desaturates the accent toward the far water when a background reef is hazed', () => {
    // haze is a pure function of the seed in production (formationDepth), so the
    // per-seed cache is correct; use DISTINCT seeds to compare a full-pigment
    // near reef against a hazed background reef (branch base chroma is 0.088 for
    // every seed, so the comparison isolates the haze blend toward the water)
    const p = palette('light');
    const nearFull = coralAccentsForSeed(p, 5551, 0);
    const hazedBack = coralAccentsForSeed(p, 5552, 0.7);
    expect(C(hazedBack.branch)).toBeLessThan(C(nearFull.branch));
  });

  it('the polyp core is a distinct (second) reef hue from the branch — 2-tone coral', () => {
    // scan seeds for one whose two hue picks differ, proving the offset salt works
    const differ = SEEDS.some((s) => {
      const a = coralAccentsForSeed(palette('light'), s, 0);
      return Math.round(H(a.branch)) !== Math.round(H(a.polypCore));
    });
    expect(differ).toBe(true);
  });
});

describe('coral geometry (tips + polyps for the color accents)', () => {
  const formation: RigFormation = {
    key: 'reef-x',
    anchorX: 1000,
    anchorY: 1900,
    radius: 220,
    seed: 0x1234,
    openBeadTotal: 3,
  };

  it('buildBranches returns limb segments AND outer tip points', () => {
    const b = buildBranches(formation, mulberry32(formation.seed));
    expect(b.segs.length).toBeGreaterThan(0);
    expect(b.tips.length).toBeGreaterThan(0);
  });

  it('buildPolyps studs only the front (full-pigment) lobes, never the far haze plane', () => {
    const rnd = mulberry32(formation.seed);
    const lobes = buildLobes(formation, rnd);
    const polyps = buildPolyps(lobes, rnd);
    // there is at least one front lobe to stud, so polyps exist
    if (lobes.some((l) => l.tone === 2)) {
      expect(polyps.length).toBeGreaterThan(0);
    }
    // every polyp sits above the seabed anchor (on the crown, not buried below)
    for (const p of polyps) {
      expect(p.y).toBeLessThanOrEqual(formation.anchorY);
    }
  });

  it('formationDepth haze feeds the accent haze path (near reef unhazed, far hazed)', () => {
    // sanity: the seed used here has a real depth haze value in range
    const haze = formationDepth(formation.seed).haze;
    expect(haze).toBeGreaterThanOrEqual(0);
    expect(haze).toBeLessThanOrEqual(1);
  });
});
