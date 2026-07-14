// Offscreen cache for the slow/static scene layers. The water column, seabed,
// light shafts, deep drift, formations (rock / coral / kelp / speckle / contact
// shadow), the water surface AND the near-foreground silhouettes only change
// when the CAMERA moves or the palette / viewport / formation set changes —
// never per animation frame. Baking them once into an offscreen buffer (sized
// to the viewport plus a pan margin) and blitting that buffer each frame turns
// "redraw the whole reef every frame" into one opaque drawImage that also
// serves as the frame's base (no separate clear or water fill). Fish, pellets
// and the near motes stay dynamic on top.
//
// INVALIDATION RULE (the buffer is re-baked only when):
//   - no bake yet, OR
//   - zoom changed (baked pixels are scale-specific), OR
//   - viewport css size or dpr changed (buffer is viewport-sized), OR
//   - palette changed (new pigments), OR
//   - the formation set changed (new snapshot identity), OR
//   - reduced-motion toggled (frozen vs live ambient clock), OR
//   - the camera has PANNED beyond the margin: |(cam − camRef)·zoom| > margin
//     on either axis, i.e. the viewport would slide off the baked region.
// Within the margin the buffer is blitted at the camera delta; the ambient
// sway baked into it (shafts, kelp, surface, drift) is frozen until the next
// re-bake, which the camera-workout perf sweep triggers constantly anyway.

import type { Camera, RigFormation, ScenePalette, Viewport } from '../contracts';

/** pan slack (css px) baked around the viewport before a re-bake is forced */
export const CACHE_MARGIN = 320;

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
  const created: StaticLayerCache = { buffer, bctx, key: null };
  caches.set(main, created);
  return created;
}

/** Pure invalidation decision (see the INVALIDATION RULE above). */
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
  if (key.zoom !== camera.zoom) return true;
  if (key.cssWidth !== viewport.cssWidth || key.cssHeight !== viewport.cssHeight) return true;
  if (key.dpr !== viewport.dpr) return true;
  if (key.palette !== palette) return true;
  if (key.formations !== formations) return true;
  if (key.reducedMotion !== reducedMotion) return true;
  const panX = (camera.x - key.camX) * camera.zoom;
  const panY = (camera.y - key.camY) * camera.zoom;
  return Math.abs(panX) > margin || Math.abs(panY) > margin;
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

/** Blit the baked static buffer under the current camera. Screen-space
 * transform must be installed. The baked layers include the opaque water
 * column, so the blit doubles as the frame's base — no separate clear or water
 * fill. The buffer content baked at camRef appears at screen + (margin, margin);
 * the current camera shifts it by −(cam−camRef)·zoom (actors-layer delta), so
 * the draw offset is that delta minus the margin. */
export function blitStatic(
  ctx: CanvasRenderingContext2D,
  cache: StaticLayerCache,
  camera: Camera,
  viewport: Viewport,
  margin: number,
): void {
  const key = cache.key;
  if (key === null) return;
  const panX = (camera.x - key.camX) * camera.zoom;
  const panY = (camera.y - key.camY) * camera.zoom;
  ctx.drawImage(
    cache.buffer,
    -panX - margin,
    -panY - margin,
    viewport.cssWidth + 2 * margin,
    viewport.cssHeight + 2 * margin,
  );
}
