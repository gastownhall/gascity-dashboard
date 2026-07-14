// Offscreen cache for the slow/static scene layers. The seabed, light shafts,
// deep drift, formations (rock / coral / kelp / speckle / contact shadow), the
// water surface AND the near-foreground silhouettes only change when the CAMERA
// moves or the palette / viewport / formation set changes — never per animation
// frame. Baking them once into an offscreen buffer (sized to the viewport plus a
// pan margin) and blitting that buffer each frame turns "redraw the whole reef
// every frame" into one drawImage over the per-frame water-column base. The
// buffer is transparent above the seabed so the water column shows through.
// Fish, pellets and the near motes stay dynamic on top.
//
// A bake is EXPENSIVE (it includes a real gaussian `ctx.filter` blur on the
// near-foreground), so it must not run on every frame of a continuous zoom.
//
// INVALIDATION RULE — the buffer is re-baked only when one of:
//   STRUCTURAL (needsRebake): no bake yet, viewport css size / dpr changed,
//   palette changed, formation set changed, reduced-motion toggled, OR the
//   camera PANNED beyond the margin (|(cam − camRef)·zoom| > margin on either
//   axis, i.e. the viewport would slide off the baked region).
//   ZOOM (shouldRebakeForZoom): the zoom differs from the baked zoom AND either
//   the gesture SETTLED (held for `ZOOM_SETTLE_MS`), or the scaled blit would
//   exceed the scale cap (|ln(zoom/bakedZoom)| > `ZOOM_SCALE_CAP_LN`), or
//   reduced motion is active (no autonomous loop → settle the discrete paint
//   now). While a zoom is ACTIVE the buffer is instead blitted SCALED by
//   zoom/bakedZoom about the baked camera centre — momentarily soft, but a
//   cheap drawImage instead of a ~55ms re-bake.
// Within the pan margin the buffer is blitted at the camera delta; the ambient
// sway baked into it (shafts, kelp, surface, drift) is frozen until the next
// re-bake.

import type { Camera, RigFormation, ScenePalette, Viewport } from '../contracts';

/** pan slack (css px) baked around the viewport before a re-bake is forced */
export const CACHE_MARGIN = 320;

/** ms of sim clock a zoom must hold steady before the soft scaled buffer is
 * re-baked at full quality. Kept above the perf workout's ~100ms inter-wheel
 * gap so a continuous zoom scales rather than re-bakes every step. */
export const ZOOM_SETTLE_MS = 120;

/** max |ln(zoom / bakedZoom)| tolerated on the scaled blit before a re-bake is
 * forced — beyond this the up/down-scale of the blurred buffer reads as mush.
 * ~0.35 ≈ a 1.42×/0.70× scale window. */
export const ZOOM_SCALE_CAP_LN = 0.35;

export interface BakeKey {
  camX: number;
  camY: number;
  zoom: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  palette: ScenePalette;
  formations: readonly RigFormation[];
  reducedMotion: boolean;
}

export interface StaticLayerCache {
  buffer: HTMLCanvasElement;
  bctx: CanvasRenderingContext2D;
  key: BakeKey | null;
  /** live zoom observed on the previous frame; NaN until the first frame so the
   * first observation always registers a change (the first frame bakes anyway). */
  lastSeenZoom: number;
  /** sim-clock ms at which the live zoom last changed frame-to-frame; the zoom
   * settle timer measures from here. */
  lastZoomChangeMs: number;
}

const caches = new WeakMap<HTMLCanvasElement, StaticLayerCache>();

/** Per-main-canvas cache, created lazily and held across frames via a WeakMap
 * (GC'd when the canvas is gone). Keyed by the main canvas so a remount gets a
 * fresh buffer. */
export function getStaticCache(main: HTMLCanvasElement): StaticLayerCache {
  const hit = caches.get(main);
  if (hit !== undefined) return hit;
  const buffer = document.createElement('canvas');
  const bctx = buffer.getContext('2d');
  if (bctx === null) {
    throw new Error('sceneCache: 2D context unavailable for the offscreen buffer');
  }
  const created: StaticLayerCache = {
    buffer,
    bctx,
    key: null,
    lastSeenZoom: Number.NaN,
    lastZoomChangeMs: 0,
  };
  caches.set(main, created);
  return created;
}

/** Structural invalidation decision (see the INVALIDATION RULE above). Zoom is
 * handled separately by shouldRebakeForZoom so a continuous zoom can scale the
 * existing bake instead of re-baking every frame. */
export function needsRebake(
  key: BakeKey | null,
  camera: Camera,
  viewport: Viewport,
  palette: ScenePalette,
  formations: readonly RigFormation[],
  reducedMotion: boolean,
  margin: number,
): boolean {
  if (key === null) return true;
  if (key.cssWidth !== viewport.cssWidth || key.cssHeight !== viewport.cssHeight) return true;
  if (key.dpr !== viewport.dpr) return true;
  if (key.palette !== palette) return true;
  if (key.formations !== formations) return true;
  if (key.reducedMotion !== reducedMotion) return true;
  const panX = (camera.x - key.camX) * camera.zoom;
  const panY = (camera.y - key.camY) * camera.zoom;
  return Math.abs(panX) > margin || Math.abs(panY) > margin;
}

/** Advance the per-canvas zoom tracker and report whether the live zoom changed
 * frame-to-frame (which restarts the settle timer). Mutates two scalar fields;
 * no allocation. Call once per frame before shouldRebakeForZoom. */
export function trackZoom(cache: StaticLayerCache, zoom: number, clockMs: number): boolean {
  if (cache.lastSeenZoom === zoom) return false;
  cache.lastSeenZoom = zoom;
  cache.lastZoomChangeMs = clockMs;
  return true;
}

/** Zoom-debounce decision: the buffer was baked at `bakedZoom`; the camera is
 * now at `zoom`. Re-bake at full quality only when the zoom differs AND one of:
 * reduced motion (no loop → settle the discrete paint now), the scaled blit
 * exceeds the scale cap, or the zoom has SETTLED (unchanged this frame and held
 * for `settleMs`). Otherwise the frame is a cheap zoom-scaled blit. */
export function shouldRebakeForZoom(
  bakedZoom: number,
  zoom: number,
  reducedMotion: boolean,
  clockMs: number,
  lastZoomChangeMs: number,
  zoomChangedThisFrame: boolean,
  settleMs: number,
  scaleCapLn: number,
): boolean {
  if (zoom === bakedZoom) return false;
  if (reducedMotion) return true;
  if (Math.abs(Math.log(zoom / bakedZoom)) > scaleCapLn) return true;
  return !zoomChangedThisFrame && clockMs - lastZoomChangeMs >= settleMs;
}

/** Resize the buffer to (viewport + 2·margin)·dpr, only when the size actually
 * changed (setting canvas.width reallocates + clears, so we must not do it on
 * every pan re-bake). Returns the buffer's css dimensions. */
export function sizeStaticBuffer(
  cache: StaticLayerCache,
  viewport: Viewport,
  margin: number,
): { bufCssWidth: number; bufCssHeight: number } {
  const bufCssWidth = viewport.cssWidth + 2 * margin;
  const bufCssHeight = viewport.cssHeight + 2 * margin;
  const devW = Math.round(bufCssWidth * viewport.dpr);
  const devH = Math.round(bufCssHeight * viewport.dpr);
  if (cache.buffer.width !== devW || cache.buffer.height !== devH) {
    cache.buffer.width = devW;
    cache.buffer.height = devH;
  }
  return { bufCssWidth, bufCssHeight };
}

/** Expanded viewport used to bake: it is the real viewport grown by `margin`
 * on every side, so `layerTransform` centres the camera at the buffer centre
 * and buffer pixel (margin+sx, margin+sy) == real screen pixel (sx, sy). */
export function bufferViewport(viewport: Viewport, margin: number): Viewport {
  return {
    cssWidth: viewport.cssWidth + 2 * margin,
    cssHeight: viewport.cssHeight + 2 * margin,
    dpr: viewport.dpr,
  };
}

/** Blit the baked static buffer over the per-frame water column, under the
 * current camera. Screen-space transform must be installed. The buffer content
 * baked at (camRef, bakedZoom) appears at screen + (margin, margin); the current
 * camera shifts it by −(cam−camRef)·zoom (actors-layer delta) and, when the
 * camera has zoomed off the baked zoom, scales it by zoom/bakedZoom about the
 * baked camera centre. At the baked zoom the scale is exactly 1 and this reduces
 * to the plain pan blit. No allocation. */
export function blitStatic(
  ctx: CanvasRenderingContext2D,
  cache: StaticLayerCache,
  camera: Camera,
  viewport: Viewport,
  margin: number,
): void {
  const key = cache.key;
  if (key === null) return;
  const scale = camera.zoom / key.zoom;
  const drawW = (viewport.cssWidth + 2 * margin) * scale;
  const drawH = (viewport.cssHeight + 2 * margin) * scale;
  const panX = (camera.x - key.camX) * camera.zoom;
  const panY = (camera.y - key.camY) * camera.zoom;
  const dx = viewport.cssWidth / 2 - drawW / 2 - panX;
  const dy = viewport.cssHeight / 2 - drawH / 2 - panY;
  ctx.drawImage(cache.buffer, dx, dy, drawW, drawH);
}
