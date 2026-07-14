// Water atmosphere: the one licensed vertical gradient, diagonal light
// shafts, drifting particulate, depth vignette, and the dashed waterline.
// All variation is deterministic (hash + clockMs); Math.random never appears
// in the render layer. reduced-motion arrives as a frozen clock upstream.

import type { ScenePalette, Viewport } from '../contracts';
import { WORLD } from '../contracts';
import { hash01 } from './hash';
import type { LayerTransform, ViewRect } from './layers';
import { applyScreenSpace } from './layers';
import { TAU } from './mathUtil';
import { adjustL, withAlpha } from './oklch';

interface WaterDerived {
  mote: string;
  vignette: string;
}

const derivedCache = new WeakMap<ScenePalette, WaterDerived>();

function derived(palette: ScenePalette): WaterDerived {
  const hit = derivedCache.get(palette);
  if (hit !== undefined) return hit;
  const built: WaterDerived = {
    mote: withAlpha(adjustL(palette.hazeFar, 10), 0.4),
    vignette: withAlpha(adjustL(palette.waterBottom, -10), 0.32),
  };
  derivedCache.set(palette, built);
  return built;
}

/** Full-viewport water column, anchored to world depth via the far layer so
 * zooming toward the seabed genuinely darkens. Doubles as the frame clear. */
export function paintWaterColumn(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  depthLayer: LayerTransform,
  viewport: Viewport,
): void {
  applyScreenSpace(ctx, viewport);
  const yTop = 0 * depthLayer.scale + depthLayer.ty;
  const yBottom = WORLD.height * depthLayer.scale + depthLayer.ty;
  const gradient = ctx.createLinearGradient(0, yTop, 0, yBottom);
  gradient.addColorStop(0, palette.waterTop);
  gradient.addColorStop(1, palette.waterBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight);
}

const SHAFT_COUNT = 3;

/** Diagonal translucent light shafts from the waterline. Far layer must be
 * installed. One fill for all shafts (single style). */
export function paintLightShafts(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
  clockMs: number,
): void {
  ctx.fillStyle = palette.lightShaft;
  ctx.beginPath();
  for (let i = 0; i < SHAFT_COUNT; i += 1) {
    const anchorX = (0.14 + 0.36 * i + hash01(i * 11 + 3) * 0.12) * WORLD.width;
    const topWidth = 180 + hash01(i * 17 + 5) * 140;
    const sway = Math.sin((clockMs / 1000) * 0.03 * TAU + i * 2.1) * 90;
    const slant = 300 + hash01(i * 23 + 7) * 220 + sway;
    const depth = WORLD.height * 0.72;
    if (anchorX + topWidth + Math.abs(slant) < view.left) continue;
    if (anchorX - topWidth - Math.abs(slant) > view.right) continue;
    const topY = WORLD.waterlineY;
    ctx.moveTo(anchorX, topY);
    ctx.lineTo(anchorX + topWidth, topY);
    ctx.lineTo(anchorX + topWidth * 1.8 + slant, topY + depth);
    ctx.lineTo(anchorX + slant, topY + depth);
    ctx.closePath();
  }
  ctx.fill();
}

const MOTE_COUNT = 160;

/** Sparse marine-snow particulate, drifting slowly down. Near layer must be
 * installed. Deterministic per mote from its index. */
export function paintParticulate(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
  clockMs: number,
): void {
  ctx.fillStyle = derived(palette).mote;
  ctx.beginPath();
  const t = clockMs / 1000;
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    const fallSpeed = 6 + hash01(i * 7 + 1) * 10;
    const x =
      hash01(i * 2 + 1) * WORLD.width + Math.sin(t * 0.2 + i * 1.7) * 9;
    const y = (hash01(i * 3 + 2) * WORLD.height + t * fallSpeed) % WORLD.height;
    if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
    const r = 1.2 + hash01(i * 5 + 3) * 1.6;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();
}

/** Subtle darkening toward the seabed, anchored to world depth. */
export function paintDepthVignette(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  depthLayer: LayerTransform,
  viewport: Viewport,
): void {
  applyScreenSpace(ctx, viewport);
  const yFrom = WORLD.height * 0.55 * depthLayer.scale + depthLayer.ty;
  const yTo = WORLD.height * 1.05 * depthLayer.scale + depthLayer.ty;
  if (yFrom > viewport.cssHeight) return;
  const color = derived(palette).vignette;
  const gradient = ctx.createLinearGradient(0, yFrom, 0, yTo);
  gradient.addColorStop(0, withAlpha(color, 0));
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  const top = Math.max(0, yFrom);
  ctx.fillRect(0, top, viewport.cssWidth, viewport.cssHeight - top);
}

/** Dashed waterline at WORLD.waterlineY. Actors layer must be installed;
 * dash rhythm and stroke stay ~constant in css px at any zoom. */
export function paintWaterline(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
  zoom: number,
): void {
  if (WORLD.waterlineY < view.top || WORLD.waterlineY > view.bottom) return;
  ctx.strokeStyle = palette.waterline;
  ctx.lineWidth = 1.25 / zoom;
  ctx.setLineDash([9 / zoom, 7 / zoom]);
  ctx.beginPath();
  ctx.moveTo(Math.max(view.left, 0), WORLD.waterlineY);
  ctx.lineTo(Math.min(view.right, WORLD.width), WORLD.waterlineY);
  ctx.stroke();
  ctx.setLineDash([]);
}
