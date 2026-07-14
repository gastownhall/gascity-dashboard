import { describe, expect, it } from 'vitest';
import type { Camera, RigFormation, ScenePalette, Viewport } from '../contracts';
import { buildScenePalette } from './palette';
import {
  type BakeKey,
  type StaticLayerCache,
  ZOOM_SCALE_CAP_LN,
  ZOOM_SETTLE_MS,
  blitStatic,
  needsRebake,
  shouldRebakeForZoom,
  trackZoom,
} from './sceneCache';

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
const VIEWPORT: Viewport = { cssWidth: 1440, cssHeight: 900, dpr: 1 };
const FORMATIONS: RigFormation[] = [
  { key: 'reef-a', anchorX: 1000, anchorY: 1850, radius: 200, seed: 3, openBeadTotal: 4 },
];
const MARGIN = 320;

function keyAt(camera: Camera): BakeKey {
  return {
    camX: camera.x,
    camY: camera.y,
    zoom: camera.zoom,
    cssWidth: VIEWPORT.cssWidth,
    cssHeight: VIEWPORT.cssHeight,
    dpr: VIEWPORT.dpr,
    palette: PALETTE,
    formations: FORMATIONS,
    reducedMotion: false,
  };
}

const CAM: Camera = { x: 1000, y: 1200, zoom: 1 };

describe('needsRebake (structural invalidation rule)', () => {
  it('always rebakes when there is no prior bake', () => {
    expect(needsRebake(null, CAM, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
  });

  it('does NOT rebake when nothing changed', () => {
    expect(needsRebake(keyAt(CAM), CAM, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(false);
  });

  it('does NOT structurally rebake on a pure zoom change (zoom is debounced)', () => {
    // Zoom is no longer a structural trigger — an active zoom scales the buffer
    // (see shouldRebakeForZoom) rather than re-baking every frame.
    const zoomed: Camera = { ...CAM, zoom: 1.05 };
    expect(needsRebake(keyAt(CAM), zoomed, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(
      false,
    );
  });

  it('does NOT rebake for a pan within the margin', () => {
    const within: Camera = { ...CAM, x: CAM.x + (MARGIN - 1) / CAM.zoom };
    expect(needsRebake(keyAt(CAM), within, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(
      false,
    );
  });

  it('rebakes once a pan exceeds the margin on either axis', () => {
    const farX: Camera = { ...CAM, x: CAM.x + (MARGIN + 1) / CAM.zoom };
    const farY: Camera = { ...CAM, y: CAM.y + (MARGIN + 1) / CAM.zoom };
    expect(needsRebake(keyAt(CAM), farX, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
    expect(needsRebake(keyAt(CAM), farY, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
  });

  it('scales the pan threshold with zoom (screen-space margin)', () => {
    const key = keyAt({ ...CAM, zoom: 2 });
    const within: Camera = { x: CAM.x + (MARGIN - 2) / 2, y: CAM.y, zoom: 2 };
    const beyond: Camera = { x: CAM.x + (MARGIN + 2) / 2, y: CAM.y, zoom: 2 };
    expect(needsRebake(key, within, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(false);
    expect(needsRebake(key, beyond, VIEWPORT, PALETTE, FORMATIONS, false, MARGIN)).toBe(true);
  });

  it('rebakes on viewport, dpr, palette or reduced-motion change', () => {
    const key = keyAt(CAM);
    expect(
      needsRebake(key, CAM, { ...VIEWPORT, cssWidth: 1441 }, PALETTE, FORMATIONS, false, MARGIN),
    ).toBe(true);
    expect(needsRebake(key, CAM, { ...VIEWPORT, dpr: 2 }, PALETTE, FORMATIONS, false, MARGIN)).toBe(
      true,
    );
    const otherPalette = buildScenePalette('dark', TOKENS, 'serif');
    expect(needsRebake(key, CAM, VIEWPORT, otherPalette, FORMATIONS, false, MARGIN)).toBe(true);
    expect(needsRebake(key, CAM, VIEWPORT, PALETTE, FORMATIONS, true, MARGIN)).toBe(true);
  });

  it('keys the formation re-bake on silhouette content, not array identity or bead count', () => {
    const key = keyAt(CAM);
    // a fresh array with identical silhouette content must NOT re-bake — the live
    // derive rebuilds formations every snapshot refresh, and reference-checking it
    // jittered the baked kelp/shafts on every SSE tick
    expect(needsRebake(key, CAM, VIEWPORT, PALETTE, [...FORMATIONS], false, MARGIN)).toBe(false);
    // a pure open-bead-count bump is a text label, never baked → no re-bake
    const beadBumped = [{ ...FORMATIONS[0]!, openBeadTotal: 999 }];
    expect(needsRebake(key, CAM, VIEWPORT, PALETTE, beadBumped, false, MARGIN)).toBe(false);
    // a real geography change DOES re-bake: a new rig...
    const grown = [
      ...FORMATIONS,
      { key: 'reef-b', anchorX: 2600, anchorY: 1850, radius: 150, seed: 9, openBeadTotal: 0 },
    ];
    expect(needsRebake(key, CAM, VIEWPORT, PALETTE, grown, false, MARGIN)).toBe(true);
    // ...or a crew-size radius shift
    const bigger = [{ ...FORMATIONS[0]!, radius: 300 }];
    expect(needsRebake(key, CAM, VIEWPORT, PALETTE, bigger, false, MARGIN)).toBe(true);
  });
});

function freshCache(): StaticLayerCache {
  // buffer/bctx are unused by trackZoom; a bare shell keeps the test canvas-free.
  return {
    buffer: {} as HTMLCanvasElement,
    bctx: {} as CanvasRenderingContext2D,
    key: null,
    lastSeenZoom: Number.NaN,
    lastZoomChangeMs: 0,
  };
}

describe('trackZoom (per-frame zoom tracker)', () => {
  it('registers the first observed zoom as a change and stamps the clock', () => {
    const cache = freshCache();
    expect(trackZoom(cache, 1, 500)).toBe(true);
    expect(cache.lastSeenZoom).toBe(1);
    expect(cache.lastZoomChangeMs).toBe(500);
  });

  it('reports no change and holds the timer while the zoom is steady', () => {
    const cache = freshCache();
    trackZoom(cache, 1, 500);
    expect(trackZoom(cache, 1, 560)).toBe(false);
    expect(trackZoom(cache, 1, 620)).toBe(false);
    expect(cache.lastZoomChangeMs).toBe(500); // steady frames never restart it
  });

  it('restarts the settle timer whenever the zoom changes', () => {
    const cache = freshCache();
    trackZoom(cache, 1, 500);
    expect(trackZoom(cache, 1.1, 700)).toBe(true);
    expect(cache.lastSeenZoom).toBe(1.1);
    expect(cache.lastZoomChangeMs).toBe(700);
  });
});

describe('shouldRebakeForZoom (zoom debounce / scaled-blit decision)', () => {
  const baked = 1;

  it('does NOT rebake when the camera is exactly at the baked zoom', () => {
    // steady + pan frames: plain blit, scale === 1
    expect(
      shouldRebakeForZoom(baked, baked, false, 1000, 0, false, ZOOM_SETTLE_MS, ZOOM_SCALE_CAP_LN),
    ).toBe(false);
  });

  it('scales (does NOT rebake) during an active zoom within the cap and settle window', () => {
    // one wheel step in: zoom changed THIS frame, ratio well under the cap,
    // timer just restarted → soft scaled blit, no re-bake.
    const zoom = baked * Math.exp(0.11); // ≈ 1.116, one perf-workout wheel step
    const changedThisFrame = true;
    const clockMs = 800;
    const lastChange = 800;
    expect(
      shouldRebakeForZoom(
        baked,
        zoom,
        false,
        clockMs,
        lastChange,
        changedThisFrame,
        ZOOM_SETTLE_MS,
        ZOOM_SCALE_CAP_LN,
      ),
    ).toBe(false);
  });

  it('does NOT rebake while a changed zoom is still inside the settle window', () => {
    const zoom = baked * Math.exp(0.11);
    const lastChange = 800;
    const clockMs = 800 + (ZOOM_SETTLE_MS - 1); // held, but not long enough
    expect(
      shouldRebakeForZoom(
        baked,
        zoom,
        false,
        clockMs,
        lastChange,
        false,
        ZOOM_SETTLE_MS,
        ZOOM_SCALE_CAP_LN,
      ),
    ).toBe(false);
  });

  it('rebakes once the zoom has SETTLED past the settle window', () => {
    const zoom = baked * Math.exp(0.11);
    const lastChange = 800;
    const clockMs = 800 + ZOOM_SETTLE_MS; // stable and held long enough
    expect(
      shouldRebakeForZoom(
        baked,
        zoom,
        false,
        clockMs,
        lastChange,
        false,
        ZOOM_SETTLE_MS,
        ZOOM_SCALE_CAP_LN,
      ),
    ).toBe(true);
  });

  it('rebakes mid-gesture when the scale ratio exceeds the cap (extreme zoom)', () => {
    // still actively zooming (changed this frame, timer just reset) but the
    // accumulated ratio vs the baked zoom is beyond the cap → force a re-bake.
    const zoom = baked * Math.exp(ZOOM_SCALE_CAP_LN + 0.05);
    expect(
      shouldRebakeForZoom(baked, zoom, false, 900, 900, true, ZOOM_SETTLE_MS, ZOOM_SCALE_CAP_LN),
    ).toBe(true);
    // symmetric for zoom-out
    const zoomOut = baked * Math.exp(-(ZOOM_SCALE_CAP_LN + 0.05));
    expect(
      shouldRebakeForZoom(baked, zoomOut, false, 900, 900, true, ZOOM_SETTLE_MS, ZOOM_SCALE_CAP_LN),
    ).toBe(true);
  });

  it('settles immediately under reduced motion (no autonomous loop to settle it)', () => {
    // clock is frozen under reduced motion; the discrete paint must still bake
    // at full quality on any zoom change.
    expect(
      shouldRebakeForZoom(baked, baked * 1.05, true, 0, 0, true, ZOOM_SETTLE_MS, ZOOM_SCALE_CAP_LN),
    ).toBe(true);
  });
});

interface DrawImageArgs {
  dx: number;
  dy: number;
  dWidth: number;
  dHeight: number;
}

function captureBlit(cache: StaticLayerCache, camera: Camera): DrawImageArgs {
  let captured: DrawImageArgs | null = null;
  const ctx = {
    drawImage: (
      _img: CanvasImageSource,
      dx: number,
      dy: number,
      dWidth: number,
      dHeight: number,
    ) => {
      captured = { dx, dy, dWidth, dHeight };
    },
  } as unknown as CanvasRenderingContext2D;
  blitStatic(ctx, cache, camera, VIEWPORT, MARGIN);
  if (captured === null) throw new Error('blitStatic did not draw');
  return captured;
}

function cacheWithKey(key: BakeKey): StaticLayerCache {
  return {
    buffer: {} as HTMLCanvasElement,
    bctx: {} as CanvasRenderingContext2D,
    key,
    lastSeenZoom: key.zoom,
    lastZoomChangeMs: 0,
  };
}

describe('blitStatic (pan + zoom-scaled placement)', () => {
  it('at the baked zoom reduces to the plain pan blit (scale 1)', () => {
    const cache = cacheWithKey(keyAt(CAM));
    const bufW = VIEWPORT.cssWidth + 2 * MARGIN;
    const bufH = VIEWPORT.cssHeight + 2 * MARGIN;

    // no pan → buffer drawn at (−margin, −margin), full buffer size
    const noPan = captureBlit(cache, CAM);
    expect(noPan).toEqual({ dx: -MARGIN, dy: -MARGIN, dWidth: bufW, dHeight: bufH });

    // pan → offset by −(cam − camRef)·zoom, same size
    const panned: Camera = { ...CAM, x: CAM.x + 100 };
    const withPan = captureBlit(cache, panned);
    expect(withPan.dWidth).toBe(bufW);
    expect(withPan.dHeight).toBe(bufH);
    expect(withPan.dx).toBeCloseTo(-MARGIN - 100 * CAM.zoom, 6);
    expect(withPan.dy).toBeCloseTo(-MARGIN, 6);
  });

  it('scales the buffer by zoom/bakedZoom about the viewport centre during a zoom', () => {
    const cache = cacheWithKey(keyAt(CAM)); // baked at zoom 1, cam centred
    const scale = 1.25;
    const zoomed: Camera = { ...CAM, zoom: scale };
    const bufW = VIEWPORT.cssWidth + 2 * MARGIN;
    const bufH = VIEWPORT.cssHeight + 2 * MARGIN;

    const out = captureBlit(cache, zoomed);
    expect(out.dWidth).toBeCloseTo(bufW * scale, 6);
    expect(out.dHeight).toBeCloseTo(bufH * scale, 6);
    // no pan (cam centre unchanged) → scaled about the viewport centre
    expect(out.dx).toBeCloseTo(VIEWPORT.cssWidth / 2 - (bufW * scale) / 2, 6);
    expect(out.dy).toBeCloseTo(VIEWPORT.cssHeight / 2 - (bufH * scale) / 2, 6);

    // the baked camera centre stays fixed on screen under the scale: buffer
    // centre pixel maps to (W/2, H/2) regardless of scale.
    const bufCentreScreenX = out.dx + (bufW * scale) / 2;
    expect(bufCentreScreenX).toBeCloseTo(VIEWPORT.cssWidth / 2, 6);
  });
});
