import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts';
import { WORLD } from '../contracts';
import { buildScenePalette } from './palette';
import {
  FOREGROUND_MAX_ZOOM,
  foregroundFillsFor,
  foregroundSilhouettes,
  foregroundVisibleAtZoom,
  paintForeground,
} from './foreground';
import type { ViewRect } from './layers';
import { parseOklch } from './oklch';

// jsdom has no canvas, so Path2D is undefined. The foreground geometry is pure
// (path methods are called but nothing rasterizes here), and `foreground.ts`
// only touches `new Path2D()` lazily inside foregroundSilhouettes() / the paint
// combine step — which the tests call — so this module-eval stub is installed
// in time. The harness exercises the real Path2D.
if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
  class StubPath2D {
    addPath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    quadraticCurveTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
  }
  (globalThis as { Path2D: unknown }).Path2D = StubPath2D;
}

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
const PALETTE: ScenePalette = buildScenePalette('light', TOKENS, 'serif');

interface FillRecord {
  filter: string;
}

/** records the ctx.filter in effect at each fill(); every other 2D op no-ops */
function fillRecordingCtx(): {
  ctx: CanvasRenderingContext2D;
  fills: FillRecord[];
  filterNow: () => string;
} {
  const fills: FillRecord[] = [];
  const stub = {
    filter: 'none',
    fillStyle: '',
    save(): void {},
    restore(): void {},
    fill(): void {
      fills.push({ filter: (stub as { filter: string }).filter });
    },
  };
  return {
    ctx: stub as unknown as CanvasRenderingContext2D,
    fills,
    filterNow: () => (stub as { filter: string }).filter,
  };
}

const ALL: ViewRect = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
const MID = WORLD.width / 2;

function blurPx(filter: string): number {
  const m = /blur\(([\d.]+)px\)/.exec(filter);
  if (m === null || m[1] === undefined) throw new Error(`not a blur filter: ${filter}`);
  return Number(m[1]);
}

describe('foreground silhouettes (near-glass depth cue)', () => {
  it('builds several large silhouettes, each a Path2D rooted at the tank floor', () => {
    const s = foregroundSilhouettes();
    expect(s.length).toBeGreaterThanOrEqual(3);
    for (const sil of s) {
      expect(sil.path).toBeInstanceOf(Path2D);
      expect(sil.cullRight).toBeGreaterThan(sil.cullLeft);
      expect(sil.baseY).toBe(WORLD.height);
    }
  });

  it('is a cached, deterministic singleton (stable geometry across frames)', () => {
    expect(foregroundSilhouettes()).toBe(foregroundSilhouettes());
  });

  it('spans both side edges of the tank (silhouettes hug the frame edges)', () => {
    const s = foregroundSilhouettes();
    const minLeft = Math.min(...s.map((x) => x.cullLeft));
    const maxRight = Math.max(...s.map((x) => x.cullRight));
    expect(minLeft).toBeLessThan(WORLD.width * 0.15);
    expect(maxRight).toBeGreaterThan(WORLD.width * 0.85);
  });

  it('is composed ASYMMETRICALLY: left-half and right-half mass differ (not mirrored UI)', () => {
    const s = foregroundSilhouettes();
    const mass = (side: (center: number) => boolean): number =>
      s
        .filter((x) => side((x.cullLeft + x.cullRight) / 2))
        .reduce((sum, x) => sum + (x.cullRight - x.cullLeft), 0);
    const leftMass = mass((c) => c < MID);
    const rightMass = mass((c) => c >= MID);
    expect(leftMass).toBeGreaterThan(0);
    expect(rightMass).toBeGreaterThan(0);
    // clearly different silhouette mass per side → reads organic, not mirror-symmetric
    expect(Math.abs(leftMass - rightMass) / Math.max(leftMass, rightMass)).toBeGreaterThan(0.15);
  });

  it('keeps the near-plane mass away from the tank center (centered crops stay clear)', () => {
    const s = foregroundSilhouettes();
    const centerBand = WORLD.width * 0.12;
    for (const sil of s) {
      const intrudes = sil.cullLeft < MID + centerBand && sil.cullRight > MID - centerBand;
      expect(intrudes, 'a foreground silhouette crosses the tank center').toBe(false);
    }
  });
});

describe('paintForeground (real out-of-focus blur, baked)', () => {
  it('fills kelp + rock as separate blurred masses (each under an active blur)', () => {
    const { ctx, fills } = fillRecordingCtx();
    paintForeground(ctx, PALETTE, ALL, 1);
    // two masses (kelp, rock), each drawn while the blur filter is active, so
    // each carries its own tint yet still reads as an out-of-focus near plane
    expect(fills.length).toBe(2);
    for (const f of fills) expect(blurPx(f.filter)).toBeGreaterThanOrEqual(6);
  });

  it('resets the filter to none after baking (no filter leaks to later layers)', () => {
    const { ctx, filterNow } = fillRecordingCtx();
    paintForeground(ctx, PALETTE, ALL, 1);
    expect(filterNow()).toBe('none');
  });

  it('scales the blur radius with dpr (stable on-screen css blur at any backing scale)', () => {
    const a = fillRecordingCtx();
    paintForeground(a.ctx, PALETTE, ALL, 1);
    const b = fillRecordingCtx();
    paintForeground(b.ctx, PALETTE, ALL, 2);
    expect(blurPx(b.fills[0]?.filter ?? 'none')).toBeCloseTo(
      2 * blurPx(a.fills[0]?.filter ?? 'none'),
    );
  });

  it('culls silhouettes entirely outside the view (no draw work off-screen)', () => {
    const { ctx, fills } = fillRecordingCtx();
    const offToTheRight: ViewRect = { left: 9e5, top: -1e6, right: 1e6, bottom: 1e6 };
    paintForeground(ctx, PALETTE, offToTheRight, 1);
    expect(fills.length).toBe(0);
  });
});

const DARK_PALETTE: ScenePalette = buildScenePalette('dark', TOKENS, 'serif');

function L(color: string): number {
  return parseOklch(color).l;
}
function C(color: string): number {
  return parseOklch(color).c;
}
function H(color: string): number {
  return parseOklch(color).h;
}

describe('foreground fill legibility (lifted off near-black, visible in both themes)', () => {
  it('is a DARK near plane against sunlit water (a silhouette, not a pale wash)', () => {
    const fills = foregroundFillsFor(PALETTE);
    const waterBottomL = L(PALETTE.waterBottom);
    // clearly darker than the water column behind it → reads as a near silhouette
    expect(waterBottomL - L(fills.rock)).toBeGreaterThan(20);
    expect(waterBottomL - L(fills.kelp)).toBeGreaterThan(15);
  });

  it('is a LIGHTER near plane against midnight water (never vanishes into the dark)', () => {
    const fills = foregroundFillsFor(DARK_PALETTE);
    const waterTopL = L(DARK_PALETTE.waterTop);
    // a near-black foreground on a near-black background gives no depth cue, so
    // in the deep tank the near plane must read LIGHTER than the water behind it
    expect(L(fills.rock)).toBeGreaterThan(waterTopL);
    expect(L(fills.kelp)).toBeGreaterThan(waterTopL);
  });

  it('is lifted off pure near-black in both moods (not a black vignette stain)', () => {
    for (const p of [PALETTE, DARK_PALETTE]) {
      const fills = foregroundFillsFor(p);
      expect(L(fills.rock)).toBeGreaterThan(18);
      expect(L(fills.kelp)).toBeGreaterThan(18);
    }
  });

  it('is tinted, and kelp reads distinct from rock (kelp green vs warm rock, not one smudge)', () => {
    for (const p of [PALETTE, DARK_PALETTE]) {
      const fills = foregroundFillsFor(p);
      expect(C(fills.kelp)).toBeGreaterThan(0);
      expect(C(fills.rock)).toBeGreaterThan(0);
      // the two masses carry different hues → they read as kelp vs rock
      expect(Math.abs(H(fills.kelp) - H(fills.rock))).toBeGreaterThan(10);
    }
  });
});

describe('foregroundVisibleAtZoom (legibility guard)', () => {
  it('shows the near plane only at overview / near-tank zooms', () => {
    expect(foregroundVisibleAtZoom(0.36)).toBe(true); // LOD0 fit
    expect(foregroundVisibleAtZoom(1.0)).toBe(true); // LOD1 shot
  });

  it('hides the near plane at the blind-crop and LOD2 close-up zooms', () => {
    expect(foregroundVisibleAtZoom(1.71)).toBe(false); // blind crop
    expect(foregroundVisibleAtZoom(2.4)).toBe(false); // LOD2 close-up
    expect(foregroundVisibleAtZoom(FOREGROUND_MAX_ZOOM)).toBe(false); // boundary excluded
  });
});
