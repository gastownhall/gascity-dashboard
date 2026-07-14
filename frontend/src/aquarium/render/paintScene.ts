// One full frame, back to front: clear + water column, far haze and light
// shafts (parallax 0.85), formations + kelp (0.95), waterline + pellets +
// fish (1.0), particulate (1.06), depth vignette, then all text layers in
// screen space. Everything culls against its own layer's view rect (with
// margin) before any geometry work. reduced-motion freezes the ambient
// clock; poses and positions stay truthful facts.

import type { PaintScene } from '../contracts';
import { paintFarHaze, paintFormations } from './formations';
import { paintFishLayer } from './fishPainter';
import { PARALLAX, applyLayer, applyScreenSpace, layerTransform, visibleWorldRect } from './layers';
import { paintPellets } from './pellets';
import { paintTextLayers } from './text';
import {
  paintDepthVignette,
  paintLightShafts,
  paintParticulate,
  paintWaterColumn,
  paintWaterline,
} from './water';

/** world-unit cull padding: covers a grouper (160) plus caudal fan + labels */
const CULL_MARGIN = 250;

export const paintScene: PaintScene = (
  ctx,
  snapshot,
  sim,
  camera,
  viewport,
  palette,
  opts,
) => {
  const clockMs = opts.reducedMotion ? 0 : sim.clockMs;
  const far = layerTransform(camera, viewport, PARALLAX.far);
  const mid = layerTransform(camera, viewport, PARALLAX.mid);
  const actors = layerTransform(camera, viewport, PARALLAX.actors);
  const near = layerTransform(camera, viewport, PARALLAX.near);
  const farView = visibleWorldRect(far, viewport, CULL_MARGIN);
  const midView = visibleWorldRect(mid, viewport, CULL_MARGIN);
  const actorView = visibleWorldRect(actors, viewport, CULL_MARGIN);
  const nearView = visibleWorldRect(near, viewport, CULL_MARGIN);

  applyScreenSpace(ctx, viewport);
  ctx.clearRect(0, 0, viewport.cssWidth, viewport.cssHeight);
  paintWaterColumn(ctx, palette, far, viewport);

  applyLayer(ctx, far);
  paintFarHaze(ctx, palette, farView);
  paintLightShafts(ctx, palette, farView, clockMs);

  applyLayer(ctx, mid);
  paintFormations(ctx, snapshot.formations, palette, midView, camera.zoom, clockMs);

  applyLayer(ctx, actors);
  paintWaterline(ctx, palette, actorView, camera.zoom);
  paintPellets(ctx, snapshot.pellets, sim, palette, actorView);
  paintFishLayer(ctx, snapshot.fish, sim, palette, actors, actorView, clockMs);

  applyLayer(ctx, near);
  paintParticulate(ctx, palette, nearView, clockMs);

  paintDepthVignette(ctx, palette, far, viewport);
  paintTextLayers(ctx, snapshot, sim, palette, camera, viewport);
  applyScreenSpace(ctx, viewport);
};
