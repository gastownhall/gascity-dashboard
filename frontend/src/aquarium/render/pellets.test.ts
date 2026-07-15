import { describe, expect, it } from 'vitest';
import type { PelletEntity, ScenePalette, SimState, ThemeMood } from '../contracts';
import { LOD1_ZOOM, LOD2_ZOOM } from '../contracts';
import type { ViewRect } from './layers';
import { buildScenePalette } from './palette';
import {
  PELLET_RADIUS,
  driftKeepCount,
  paintPellets,
  pelletColors,
  pelletVisibleAtLod,
  priorityTone,
} from './pellets';
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

describe('pelletColors (rig-hue identity, priority luminance)', () => {
  it('tints every tier to the rig hue (a rig eats its own colour)', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = pelletColors(palette(mood), 300);
      for (const tier of [0, 1, 2] as const) {
        expect(H(c.tones[tier]), `${mood} tier ${tier} hue`).toBeCloseTo(300, 5);
      }
    }
  });

  it('carries priority (not status) in luminance: dim < base < bright', () => {
    for (const mood of ['light', 'dark'] as const) {
      const c = pelletColors(palette(mood), 300);
      expect(L(c.tones[0]), `${mood} dim<base`).toBeLessThan(L(c.tones[1]));
      expect(L(c.tones[1]), `${mood} base<bright`).toBeLessThan(L(c.tones[2]));
    }
  });

  it('leaves the unrigged / city pellet the neutral gold base (hue = null)', () => {
    const p = palette('light');
    const neutral = pelletColors(p, null);
    expect(neutral.tones[1]).toBe(p.pellet);
  });

  it('a P0 morsel blooms in its own rig hue, never a foreign white', () => {
    const c = pelletColors(palette('dark'), 300);
    expect(H(c.bloom), 'bloom hue matches rig').toBeCloseTo(300, 5);
  });

  it('two rigs get two distinct pellet hues', () => {
    const p = palette('dark');
    expect(H(pelletColors(p, 195).tones[1])).not.toBeCloseTo(H(pelletColors(p, 338).tones[1]), 0);
  });
});

describe('priorityTone (size is authoritative; luminance only reinforces)', () => {
  it('maps P0/P1 to bright, P2/unprioritised to base, explicit-low P3 to dim', () => {
    expect(priorityTone(1.8)).toBe(2); // P0
    expect(priorityTone(1.35)).toBe(2); // P1
    expect(priorityTone(1)).toBe(1); // P2 / unprioritised (null == 1.0)
    expect(priorityTone(0.78)).toBe(0); // P3
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
    linkTo: '',
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

describe('paintPellets P0 bloom (same-hue glow, replaces the white glint)', () => {
  it('blooms exactly one P0 morsel and not its non-P0 neighbour, in the rig hue not white', () => {
    const pellets = [
      glintPellet({ beadId: 'p0', isP0: true, radiusScale: 1.8 }),
      glintPellet({ beadId: 'plain' }),
    ];
    const { ctx, arcs } = glintRecordingCtx();
    paintPellets(ctx, pellets, simFor(['p0', 'plain']), palette('dark'), WIDE, 2.0);
    expect(arcs).toHaveLength(1);
    // a same-hue oklch glow, never a foreign white catchlight
    expect(arcs[0]!.fill).toContain('oklch');
    expect(arcs[0]!.fill).not.toContain('255');
    // centred on the P0 (100, 200) and larger than the morsel itself (a glow)
    expect(arcs[0]!.x).toBeCloseTo(100, 5);
    expect(arcs[0]!.y).toBeCloseTo(200, 5);
    expect(arcs[0]!.r).toBeGreaterThan(PELLET_RADIUS);
  });

  it('holds the bloom off below LOD1 (an unlabelled overview reads P0 by size alone)', () => {
    const pellets = [glintPellet({ beadId: 'p0', isP0: true, radiusScale: 1.8 })];
    const { ctx, arcs } = glintRecordingCtx();
    paintPellets(ctx, pellets, simFor(['p0']), palette('dark'), WIDE, LOD1_ZOOM * 0.9);
    expect(arcs).toHaveLength(0);
  });

  it('never blooms a closing (eaten) P0', () => {
    const pellets = [glintPellet({ beadId: 'p0', isP0: true, state: 'eaten', gulpMsLeft: 300 })];
    const { ctx, arcs } = glintRecordingCtx();
    paintPellets(ctx, pellets, simFor(['p0']), palette('dark'), WIDE, 2.0);
    expect(arcs).toHaveLength(0);
  });
});

describe('LOD-aware backlog thinning', () => {
  it('draws more of the backlog the closer you zoom (overview < LOD1 < LOD2)', () => {
    expect(driftKeepCount(0.5)).toBeLessThan(driftKeepCount(LOD1_ZOOM));
    expect(driftKeepCount(LOD1_ZOOM)).toBeLessThan(driftKeepCount(LOD2_ZOOM));
    expect(driftKeepCount(LOD2_ZOOM)).toBe(driftKeepCount(5)); // saturated at LOD2
  });

  it('always keeps held, blocked, eaten and P0 at any zoom', () => {
    for (const state of ['held', 'sunken', 'eaten'] as const) {
      expect(pelletVisibleAtLod(glintPellet({ beadId: `x-${state}`, state }), 0)).toBe(true);
    }
    const p0 = glintPellet({ beadId: 'p0', state: 'drifting', isP0: true });
    expect(pelletVisibleAtLod(p0, 0)).toBe(true);
  });

  it('thins ordinary drifting backlog at the overview, keeps all of it at LOD2, and only grows', () => {
    const ids = Array.from({ length: 60 }, (_, i) =>
      glintPellet({ beadId: `d-${i}`, state: 'drifting' }),
    );
    const overview = driftKeepCount(0.5);
    const lod2 = driftKeepCount(LOD2_ZOOM);
    const shownOverview = ids.filter((p) => pelletVisibleAtLod(p, overview)).length;
    expect(ids.filter((p) => pelletVisibleAtLod(p, lod2)).length).toBe(60); // all at LOD2
    expect(shownOverview).toBeLessThan(60); // thinned at the overview
    expect(shownOverview).toBeGreaterThan(0); // a representative slice, not empty
    // monotonic: anything shown at the overview is still shown zoomed in
    for (const p of ids) {
      if (pelletVisibleAtLod(p, overview)) expect(pelletVisibleAtLod(p, lod2)).toBe(true);
    }
  });
});
