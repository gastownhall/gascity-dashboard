import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts';
import { WORLD } from '../contracts';
import { buildScenePalette } from './palette';
import { foregroundSilhouettes, paintForeground } from './foreground';
import type { ViewRect } from './layers';

// jsdom has no canvas, so Path2D is undefined. The foreground geometry is pure
// (path methods are called but nothing rasterizes here), and `foreground.ts`
// only touches `new Path2D()` lazily inside foregroundSilhouettes() — which the
// tests call — so this module-eval stub is installed in time. The harness
// exercises the real Path2D.
if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
  class StubPath2D {
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

/** counts fill(path) calls; every other 2D op is a no-op */
function fillCountingCtx(): { ctx: CanvasRenderingContext2D; fills: () => number } {
  let fills = 0;
  const stub = {
    save(): void {},
    restore(): void {},
    translate(): void {},
    scale(): void {},
    fill(): void {
      fills += 1;
    },
    beginPath(): void {},
    moveTo(): void {},
    lineTo(): void {},
    quadraticCurveTo(): void {},
    closePath(): void {},
    fillStyle: '',
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, fills: () => fills };
}

const ALL: ViewRect = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };

describe('foreground silhouettes (near-glass depth cue)', () => {
  it('builds several large silhouettes, each a Path2D rooted at the tank floor', () => {
    const s = foregroundSilhouettes();
    expect(s.length).toBeGreaterThanOrEqual(3);
    for (const sil of s) {
      expect(sil.path).toBeInstanceOf(Path2D);
      expect(sil.cullRight).toBeGreaterThan(sil.cullLeft);
      // rooted at the world floor so they sit at the frame's bottom edge
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

  it('paints every visible silhouette as a multi-pass soft feather', () => {
    const { ctx, fills } = fillCountingCtx();
    paintForeground(ctx, PALETTE, ALL);
    // ≥ 2 feather passes per silhouette (halo + core), all visible
    expect(fills()).toBeGreaterThanOrEqual(foregroundSilhouettes().length * 2);
  });

  it('culls silhouettes entirely outside the view (no draw work off-screen)', () => {
    const { ctx, fills } = fillCountingCtx();
    const offToTheRight: ViewRect = { left: 9e5, top: -1e6, right: 1e6, bottom: 1e6 };
    paintForeground(ctx, PALETTE, offToTheRight);
    expect(fills()).toBe(0);
  });
});
