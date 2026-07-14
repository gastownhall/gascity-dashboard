import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts';
import { WORLD } from '../contracts';
import { buildScenePalette } from './palette';
import {
  FOREGROUND_MAX_ZOOM,
  foregroundSilhouettes,
  foregroundVisibleAtZoom,
  paintForeground,
} from './foreground';
import type { ViewRect } from './layers';

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
  it('fills the visible foreground as ONE mass under an active blur filter', () => {
    const { ctx, fills } = fillRecordingCtx();
    paintForeground(ctx, PALETTE, ALL, 1);
    // one combined fill, drawn while a blur filter is active
    expect(fills.length).toBe(1);
    expect(blurPx(fills[0]?.filter ?? 'none')).toBeGreaterThanOrEqual(6);
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
