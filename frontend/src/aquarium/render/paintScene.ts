// One full frame. The SLOW layers — seabed, light shafts, deep drift,
// formations (rock / coral / kelp / speckle / contact shadow) and the water
// surface — are baked ONCE into an offscreen buffer (sceneCache.ts) and blitted
// each frame under the camera delta; they re-bake only when the camera pans past
// the margin or the viewport / palette / formation set changes, or when a zoom
// SETTLES. During an active zoom the bake is not repeated (redrawing every
// static layer costs far more than a blit) — the buffer is blitted scaled by
// zoom/bakedZoom instead, so a zoom frame stays a cheap drawImage. The
// water-column gradient is drawn fresh as the opaque base (cheap, and it keeps
// its true world-depth anchoring under a pan, and — being a per-frame 1440×900
// fill rather than an in-bake 2080×1540 one — it keeps the re-bake as light as
// possible). Fish, pellets and the near motes are dynamic on top every frame.
// reduced-motion freezes the ambient clock; poses and positions stay truthful
// facts.

import type { Camera, PaintScene, ScenePalette, Viewport, WorldSnapshot } from '../contracts';
import { paintFormations } from './formations';
import { paintFishLayer } from './fishPainter';
import { PARALLAX, applyLayer, applyScreenSpace, layerTransform, visibleWorldRect } from './layers';
import { paintPellets } from './pellets';
import {
  CACHE_MARGIN,
  ZOOM_SCALE_CAP_LN,
  ZOOM_SETTLE_MS,
  blitStatic,
  bufferViewport,
  getStaticCache,
  needsRebake,
  shouldRebakeForZoom,
  sizeStaticBuffer,
  trackZoom,
  type StaticLayerCache,
} from './sceneCache';
import { paintTextLayers } from './text';
import {
  paintDeepDrift,
  paintDepthVignette,
  paintLightShafts,
  paintParticulate,
  paintSeabed,
  paintWaterColumn,
  paintWaterSurface,
} from './water';

/** world-unit cull padding: covers a grouper (160) plus caudal fan + labels */
const CULL_MARGIN = 250;

export const paintScene: PaintScene = (ctx, snapshot, sim, camera, viewport, palette, opts) => {
  const clockMs = opts.reducedMotion ? 0 : sim.clockMs;
  const far = layerTransform(camera, viewport, PARALLAX.far);
  const actors = layerTransform(camera, viewport, PARALLAX.actors);
  const near = layerTransform(camera, viewport, PARALLAX.near);
  const actorView = visibleWorldRect(actors, viewport, CULL_MARGIN);
  const nearView = visibleWorldRect(near, viewport, CULL_MARGIN);

  applyScreenSpace(ctx, viewport);
  paintWaterColumn(ctx, palette, far, viewport);

  const cache = getStaticCache(ctx.canvas);
  // The bake redraws every static layer, so a re-bake runs only on a structural
  // change or a SETTLED zoom (raw sim.clockMs, not the zeroed ambient clock,
  // times the debounce); an active zoom scales the existing bake instead.
  if (resolveRebake(cache, snapshot, camera, viewport, palette, opts.reducedMotion, sim.clockMs)) {
    bakeStaticLayers(cache, snapshot, palette, camera, viewport, opts.reducedMotion, clockMs);
  }
  applyScreenSpace(ctx, viewport);
  blitStatic(ctx, cache, camera, viewport, CACHE_MARGIN);

  applyLayer(ctx, actors);
  paintPellets(ctx, snapshot.pellets, sim, palette, actorView, actors.scale);
  paintFishLayer(ctx, snapshot.fish, sim, palette, actors, actorView, clockMs);

  applyLayer(ctx, near);
  paintParticulate(ctx, palette, nearView, clockMs);

  paintDepthVignette(ctx, palette, far, viewport);
  paintTextLayers(ctx, snapshot, sim, palette, camera, viewport);
  applyScreenSpace(ctx, viewport);
};

/** Compose this frame's re-bake decision and advance the zoom tracker. Returns
 * true for a structural change (see needsRebake) or a settled / extreme-scale
 * zoom (see shouldRebakeForZoom); false during an active zoom, where the caller
 * blits the existing bake scaled by zoom/bakedZoom instead. `timingMs` is the
 * monotonic sim clock (never the reduced-motion-zeroed ambient clock). */
function resolveRebake(
  cache: StaticLayerCache,
  snapshot: WorldSnapshot,
  camera: Camera,
  viewport: Viewport,
  palette: ScenePalette,
  reducedMotion: boolean,
  timingMs: number,
): boolean {
  const zoomChanged = trackZoom(cache, camera.zoom, timingMs);
  if (
    needsRebake(
      cache.key,
      camera,
      viewport,
      palette,
      snapshot.formations,
      reducedMotion,
      CACHE_MARGIN,
    )
  ) {
    return true;
  }
  return shouldRebakeForZoom(
    cache.key?.zoom ?? camera.zoom,
    camera.zoom,
    reducedMotion,
    timingMs,
    cache.lastZoomChangeMs,
    zoomChanged,
    ZOOM_SETTLE_MS,
    ZOOM_SCALE_CAP_LN,
  );
}

/** Render the static layers into the offscreen buffer at the current camera as
 * the new bake reference, then record the bake key. Uses an expanded viewport
 * so buffer pixel (margin+sx, margin+sy) maps to real screen pixel (sx, sy). The
 * buffer is transparent above the seabed (the per-frame water column shows
 * through), so it is cleared explicitly before baking. */
function bakeStaticLayers(
  cache: StaticLayerCache,
  snapshot: WorldSnapshot,
  palette: ScenePalette,
  camera: Camera,
  viewport: Viewport,
  reducedMotion: boolean,
  clockMs: number,
): void {
  const { bufCssWidth, bufCssHeight } = sizeStaticBuffer(cache, viewport, CACHE_MARGIN);
  const bctx = cache.bctx;
  const bufViewport = bufferViewport(viewport, CACHE_MARGIN);
  bctx.setTransform(bufViewport.dpr, 0, 0, bufViewport.dpr, 0, 0);
  bctx.clearRect(0, 0, bufCssWidth, bufCssHeight);

  const far = layerTransform(camera, bufViewport, PARALLAX.far);
  const mid = layerTransform(camera, bufViewport, PARALLAX.mid);
  const actors = layerTransform(camera, bufViewport, PARALLAX.actors);
  const farView = visibleWorldRect(far, bufViewport, CULL_MARGIN);
  const midView = visibleWorldRect(mid, bufViewport, CULL_MARGIN);
  const actorView = visibleWorldRect(actors, bufViewport, CULL_MARGIN);

  applyLayer(bctx, far);
  paintSeabed(bctx, palette, farView);
  paintLightShafts(bctx, palette, farView, clockMs);
  paintDeepDrift(bctx, palette, farView, clockMs);

  applyLayer(bctx, mid);
  paintFormations(bctx, snapshot.formations, palette, mid, midView, clockMs);

  applyLayer(bctx, actors);
  paintWaterSurface(bctx, palette, actorView, clockMs);

  cache.key = {
    camX: camera.x,
    camY: camera.y,
    zoom: camera.zoom,
    cssWidth: viewport.cssWidth,
    cssHeight: viewport.cssHeight,
    dpr: viewport.dpr,
    palette,
    formations: snapshot.formations,
    reducedMotion,
  };
}
