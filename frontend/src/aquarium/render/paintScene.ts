// One full frame. The SLOW layers — seabed, light shafts, deep drift,
// formations (rock / coral / kelp / speckle / contact shadow), the water surface
// AND the near-foreground silhouettes — are baked ONCE into an offscreen buffer
// (sceneCache.ts) and blitted each frame under the camera delta; they re-bake
// only when the camera pans past the margin or the zoom / viewport / palette /
// formation set changes. The water-column gradient is drawn fresh as the opaque
// base (cheap, and it keeps its true world-depth anchoring under a pan, and —
// being a per-frame 1440×900 fill rather than an in-bake 2080×1540 one — it
// keeps the re-bake, which dominates the p95 frames, as light as possible).
// Fish, pellets and the near motes are dynamic on top every frame. reduced-
// motion freezes the ambient clock; poses and positions stay truthful facts.

import type { Camera, PaintScene, ScenePalette, Viewport, WorldSnapshot } from '../contracts';
import { paintFormations } from './formations';
import { paintFishLayer } from './fishPainter';
import { foregroundVisibleAtZoom, paintForeground } from './foreground';
import { PARALLAX, applyLayer, applyScreenSpace, layerTransform, visibleWorldRect } from './layers';
import { paintPellets } from './pellets';
import {
  CACHE_MARGIN,
  blitStatic,
  bufferViewport,
  getStaticCache,
  needsRebake,
  sizeStaticBuffer,
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
/** the near-foreground silhouettes are large (tall kelp / wide rock) — a bigger
 * cull pad so a partially-onscreen silhouette is never dropped whole */
const FG_CULL_MARGIN = 700;

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
  if (
    needsRebake(
      cache.key,
      camera,
      viewport,
      palette,
      snapshot.formations,
      opts.reducedMotion,
      CACHE_MARGIN,
    )
  ) {
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
  const fg = layerTransform(camera, bufViewport, PARALLAX.foreground);
  const farView = visibleWorldRect(far, bufViewport, CULL_MARGIN);
  const midView = visibleWorldRect(mid, bufViewport, CULL_MARGIN);
  const actorView = visibleWorldRect(actors, bufViewport, CULL_MARGIN);
  const fgView = visibleWorldRect(fg, bufViewport, FG_CULL_MARGIN);

  applyLayer(bctx, far);
  paintSeabed(bctx, palette, farView);
  paintLightShafts(bctx, palette, farView, clockMs);
  paintDeepDrift(bctx, palette, farView, clockMs);

  applyLayer(bctx, mid);
  paintFormations(bctx, snapshot.formations, palette, mid, midView, clockMs);

  applyLayer(bctx, actors);
  paintWaterSurface(bctx, palette, actorView, clockMs);

  // Near-foreground silhouettes at the near parallax (they slide fast on a pan),
  // filled under a real out-of-focus blur. Baked in front of the reef so they
  // occlude the background; the dynamic fish then draw over them. Baked here →
  // the banned per-frame `ctx.filter` costs nothing per frame. Only at the
  // overview / near-tank zooms: it fades out well below the blind-crop (~1.71)
  // and LOD2 (2.4) zooms so it can never occlude a fish being judged close-up.
  if (foregroundVisibleAtZoom(camera.zoom)) {
    applyLayer(bctx, fg);
    paintForeground(bctx, palette, fgView, bufViewport.dpr);
  }

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
