import { describe, expect, it } from 'vitest';
import type { PelletEntity, ScenePalette, SimState, ThemeMood } from '../contracts';
import { LOD1_ZOOM } from '../contracts';
import type { ViewRect } from './layers';
import { buildScenePalette } from './palette';
import { paintPellets, pelletColors } from './pellets';
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

  it('gives in-progress (held) its own brighter shade so status reads by shade: blocked < open < held', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = pelletColors(palette(mood), 300);
      expect(L(c.sunken[0]), `${mood} blocked<open`).toBeLessThan(L(c.tones[0]));
      expect(L(c.tones[0]), `${mood} open<held`).toBeLessThan(L(c.held[0]));
      expect(H(c.held[0]), `${mood} held hue`).toBeCloseTo(300, 5);
    }
  });

  it('leaves the unrigged / city pellet the neutral gold (hue = null)', () => {
    const p = palette('light');
    const neutral = pelletColors(p, null);
    expect(neutral.tones[0]).toBe(p.pellet);
    expect(neutral.held[0]).toBe(p.pelletHeld);
    expect(neutral.sunken[0]).toBe(p.pelletSunken);
  });

  it('two rigs get two distinct pellet hues', () => {
    const p = palette('dark');
    expect(H(pelletColors(p, 195).tones[0])).not.toBeCloseTo(H(pelletColors(p, 338).tones[0]), 0);
  });
});

// Glints are the only paintPellets primitive drawn with ctx.arc (fills use
// ellipse/rect), so recording arc calls isolates the P0 specular pass.
interface Arc {
  x: number;
  y: number;
  r: number;
  fill: string;
}
function glintRecordingCtx(): { ctx: CanvasRenderingContext2D; arcs: Arc[] } {
  const arcs: Arc[] = [];
  const stub = {
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    stroke(): void {},
    ellipse(): void {},
    rect(): void {},
    fill(): void {},
    arc(x: number, y: number, r: number): void {
      arcs.push({ x, y, r, fill: String(stub.fillStyle) });
    },
    fillStyle: '' as string,
    globalAlpha: 1,
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, arcs };
}

const WIDE: ViewRect = { left: -1e5, top: -1e5, right: 1e5, bottom: 1e5 };
function glintPellet(over: Partial<PelletEntity> & Pick<PelletEntity, 'beadId'>): PelletEntity {
  return {
    label: over.beadId,
    title: '',
    rigKey: 'alpha',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1,
    ...over,
  };
}
function simFor(ids: string[]): SimState {
  const pellets: SimState['pellets'] = {};
  ids.forEach((id, i) => (pellets[id] = { x: 100 + i * 50, y: 200, phase: 0 }));
  return { fish: {}, pellets, clockMs: 0 };
}

describe('paintPellets P0 glint', () => {
  it('draws exactly one specular disc for a P0 morsel and none for its non-P0 neighbour', () => {
    const pellets = [
      glintPellet({ beadId: 'p0', isP0: true, radiusScale: 1.8 }),
      glintPellet({ beadId: 'plain' }),
    ];
    const { ctx, arcs } = glintRecordingCtx();
    paintPellets(ctx, pellets, simFor(['p0', 'plain']), palette('dark'), WIDE, 2.0);
    expect(arcs).toHaveLength(1);
    // white catchlight, up-left of the P0 centre (100, 200)
    expect(arcs[0]!.fill).toContain('255');
    expect(arcs[0]!.x).toBeLessThan(100);
    expect(arcs[0]!.y).toBeLessThan(200);
  });

  it('holds the glint off below LOD1 (an unlabelled overview stays clean)', () => {
    const pellets = [glintPellet({ beadId: 'p0', isP0: true, radiusScale: 1.8 })];
    const { ctx, arcs } = glintRecordingCtx();
    paintPellets(ctx, pellets, simFor(['p0']), palette('dark'), WIDE, LOD1_ZOOM * 0.9);
    expect(arcs).toHaveLength(0);
  });

  it('never glints a closing (eaten) P0', () => {
    const pellets = [glintPellet({ beadId: 'p0', isP0: true, state: 'eaten', gulpMsLeft: 300 })];
    const { ctx, arcs } = glintRecordingCtx();
    paintPellets(ctx, pellets, simFor(['p0']), palette('dark'), WIDE, 2.0);
    expect(arcs).toHaveLength(0);
  });
});
