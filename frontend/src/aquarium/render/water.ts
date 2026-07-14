// Water atmosphere: the one licensed vertical water-column gradient, a warm
// sand (light) / muted deep (dark) seabed with a dune ridge + speckle grain +
// contact darkening, soft volumetric light shafts (irregular spacing/width/
// angle) that feather with depth, multi-depth drifting particulate, a depth
// vignette, and a soft rippled water surface with faint caustic shimmer (no
// hard dashed rule). All variation is deterministic (hash + clockMs);
// Math.random never appears here. reduced-motion arrives as a frozen clock.

import type { ScenePalette, Viewport } from '../contracts';
import { WORLD } from '../contracts';
import { hash01 } from './hash';
import type { LayerTransform, ViewRect } from './layers';
import { applyScreenSpace } from './layers';
import { TAU, clamp } from './mathUtil';
import { adjustL, mixOklch, parseOklch, withAlpha } from './oklch';

interface WaterDerived {
  mote: string;
  deepDrift: string;
  vignette: string;
  /** opaque bright surface hue; alpha applied per gradient/shimmer stop */
  surfaceHue: string;
}

const derivedCache = new WeakMap<ScenePalette, WaterDerived>();

function derived(palette: ScenePalette): WaterDerived {
  const hit = derivedCache.get(palette);
  if (hit !== undefined) return hit;
  const built: WaterDerived = {
    mote: withAlpha(adjustL(palette.hazeFar, 10), 0.4),
    deepDrift: withAlpha(adjustL(palette.hazeFar, 6), 0.22),
    vignette: withAlpha(adjustL(palette.waterBottom, -10), 0.32),
    surfaceHue: adjustL(palette.waterTop, 12),
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

// ---------------------------------------------------------------------------
// Seabed

interface SeabedColors {
  sand: string;
  ridge: string;
  trough: string;
  grainLight: string;
  grainDark: string;
  backDune: string;
}

const seabedCache = new WeakMap<ScenePalette, SeabedColors>();

function seabedColors(palette: ScenePalette): SeabedColors {
  const hit = seabedCache.get(palette);
  if (hit !== undefined) return hit;
  // warm sand in light (formation warm brown pulled toward the gold pellet),
  // muted deep in dark — theme-keyed off existing pigment, never pale blue
  const sand = mixOklch(palette.formation, palette.pellet, 0.28);
  const built: SeabedColors = {
    sand,
    ridge: adjustL(sand, 7),
    trough: withAlpha(adjustL(sand, -12), 0.55),
    grainLight: adjustL(sand, 6),
    grainDark: adjustL(sand, -6),
    backDune: mixOklch(sand, palette.hazeFar, 0.5),
  };
  seabedCache.set(palette, built);
  return built;
}

/** Undulating seabed top at world x (deterministic dune line). */
function ridgeY(x: number, base: number): number {
  return base + 34 * Math.sin(x * 0.0016 + 1.3) + 17 * Math.sin(x * 0.0041 + 4.1);
}

/** Warm seabed band with a back dune, dune-crest highlight, contact-shadow
 * trough, and speckle grain. Far layer must be installed (world space). */
export function paintSeabed(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
): void {
  if (WORLD.height < view.top) return;
  const c = seabedColors(palette);
  const left = Math.max(view.left, 0);
  const right = Math.min(view.right, WORLD.width);
  if (right <= left) return;
  fillBand(ctx, left, right, (x) => ridgeY(x, WORLD.seabedY - 70) - 24, c.backDune);
  fillBand(ctx, left, right, (x) => ridgeY(x, WORLD.seabedY), c.sand);
  strokeRidge(ctx, left, right, (x) => ridgeY(x, WORLD.seabedY), c.ridge, c.trough);
  paintGrain(ctx, left, right, c);
}

function fillBand(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  topAt: (x: number) => number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left, WORLD.height);
  ctx.lineTo(left, topAt(left));
  for (let x = left; x <= right; x += 42) ctx.lineTo(x, topAt(x));
  ctx.lineTo(right, topAt(right));
  ctx.lineTo(right, WORLD.height);
  ctx.closePath();
  ctx.fill();
}

function strokeRidge(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  topAt: (x: number) => number,
  ridge: string,
  trough: string,
): void {
  const trace = (offset: number): void => {
    ctx.beginPath();
    ctx.moveTo(left, topAt(left) + offset);
    for (let x = left; x <= right; x += 42) ctx.lineTo(x, topAt(x) + offset);
    ctx.stroke();
  };
  ctx.lineWidth = 3;
  ctx.strokeStyle = trough; // self-shadow just under the crest (ground contact)
  trace(9);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ridge; // sunlit crest highlight
  trace(0);
}

const GRAIN_COUNT = 220;

function paintGrain(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  c: SeabedColors,
): void {
  for (let pass = 0; pass < 2; pass += 1) {
    ctx.fillStyle = pass === 0 ? c.grainLight : c.grainDark;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = pass; i < GRAIN_COUNT; i += 2) {
      const x = hash01(i * 2 + 1) * WORLD.width;
      if (x < left || x > right) continue;
      const depth = hash01(i * 3 + 7);
      const y = WORLD.seabedY + 30 + depth * (WORLD.height - WORLD.seabedY - 30);
      const r = 2 + hash01(i * 5 + 3) * 3;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Light shafts

const SHAFT_COUNT = 6;

/** Soft volumetric light shafts from the waterline: a vertical gradient fades
 * each beam into depth (no hard triangle edge), and a wide faint halo + narrow
 * bright core feather the sides. Spacing, width, and angle are irregular per
 * shaft (stratified slice + hashed jitter) so the beams never read as a
 * mechanical evenly-spaced comb. Far layer must be installed. */
export function paintLightShafts(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
  clockMs: number,
): void {
  const baseA = parseOklch(palette.lightShaft).alpha;
  const topY = WORLD.waterlineY;
  for (let i = 0; i < SHAFT_COUNT; i += 1) {
    // irregular gaps: each shaft owns a slice but jitters hard within it
    const anchorX = ((i + 0.1 + hash01(i * 31 + 5) * 0.85) / SHAFT_COUNT) * WORLD.width;
    const topWidth = 80 + hash01(i * 17 + 5) * 260;
    const sway = Math.sin((clockMs / 1000) * 0.03 * TAU + i * 2.1) * 90;
    // angle spans near-vertical to steeply raked (some negative-leaning)
    const slant = (hash01(i * 23 + 7) - 0.32) * 640 + sway;
    const depth = WORLD.height * (0.5 + hash01(i * 19 + 2) * 0.36);
    if (anchorX + topWidth * 2 + Math.abs(slant) < view.left) continue;
    if (anchorX - topWidth - Math.abs(slant) > view.right) continue;
    // wide faint halo, then a narrow bright core — soft feathered sides
    shaftQuad(
      ctx,
      palette.lightShaft,
      baseA * 0.5,
      anchorX,
      topWidth * 1.7,
      slant * 1.25,
      topY,
      depth,
    );
    shaftQuad(ctx, palette.lightShaft, baseA, anchorX, topWidth, slant, topY, depth);
  }
}

function shaftQuad(
  ctx: CanvasRenderingContext2D,
  shaft: string,
  topAlpha: number,
  anchorX: number,
  width: number,
  slant: number,
  topY: number,
  depth: number,
): void {
  const grad = ctx.createLinearGradient(0, topY, 0, topY + depth);
  grad.addColorStop(0, withAlpha(shaft, clamp(topAlpha, 0, 1)));
  grad.addColorStop(0.5, withAlpha(shaft, clamp(topAlpha * 0.5, 0, 1)));
  grad.addColorStop(1, withAlpha(shaft, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(anchorX, topY);
  ctx.lineTo(anchorX + width, topY);
  ctx.lineTo(anchorX + width * 1.6 + slant, topY + depth);
  ctx.lineTo(anchorX + slant, topY + depth);
  ctx.closePath();
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
    const x = hash01(i * 2 + 1) * WORLD.width + Math.sin(t * 0.2 + i * 1.7) * 9;
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

const SURFACE_BAND_DEPTH = 220; // world units the brighter surface fades over
const SURFACE_RIPPLE_AMP = 10;

/** rippled surface height at world x (two harmonics + slow clock drift) */
function surfaceRippleY(x: number, t: number): number {
  return (
    WORLD.waterlineY -
    SURFACE_RIPPLE_AMP * Math.sin(x * 0.0052 + t * 0.5) -
    0.4 * SURFACE_RIPPLE_AMP * Math.sin(x * 0.017 + t * 0.9)
  );
}

/** Soft rendered water surface: a brighter band under a gentle sine ripple with
 * faint caustic shimmer, fading into depth — NOT a hard full-width dashed rule
 * (which read as a chart gridline). Actors layer must be installed. */
export function paintWaterSurface(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
  clockMs: number,
): void {
  const top = WORLD.waterlineY - SURFACE_RIPPLE_AMP * 1.5;
  const bottom = WORLD.waterlineY + SURFACE_BAND_DEPTH;
  if (bottom < view.top || top > view.bottom) return;
  const left = Math.max(view.left, 0);
  const right = Math.min(view.right, WORLD.width);
  if (right <= left) return;
  const hue = derived(palette).surfaceHue;
  const t = clockMs / 1000;
  const step = Math.max(22, (right - left) / 90);

  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, withAlpha(hue, 0.5));
  grad.addColorStop(0.4, withAlpha(hue, 0.14));
  grad.addColorStop(1, withAlpha(hue, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, surfaceRippleY(left, t));
  for (let x = left; x <= right; x += step) ctx.lineTo(x, surfaceRippleY(x, t));
  ctx.lineTo(right, surfaceRippleY(right, t));
  ctx.lineTo(right, bottom);
  ctx.closePath();
  ctx.fill();
  paintCaustics(ctx, hue, left, right, step, t);
}

/** faint wavy bright lines drifting just under the surface — light dappling */
function paintCaustics(
  ctx: CanvasRenderingContext2D,
  hue: string,
  left: number,
  right: number,
  step: number,
  t: number,
): void {
  ctx.strokeStyle = withAlpha(hue, 0.16);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let band = 0; band < 3; band += 1) {
    const baseY = WORLD.waterlineY + 26 + band * 34;
    const drift = t * (0.6 + band * 0.2) + band * 2.1;
    ctx.beginPath();
    ctx.moveTo(left, baseY);
    for (let x = left; x <= right; x += step) {
      ctx.lineTo(x, baseY + 7 * Math.sin(x * 0.006 + drift) + 3 * Math.sin(x * 0.02 - drift));
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Far-layer suspended plankton/marine-snow: large, faint, slow motes that fill
 * the upper water column with depth-life (no fish-shaped decoys — the
 * truthfulness rule forbids anything mistakable for a session). Far layer must
 * be installed. Deterministic per mote index. */
export function paintDeepDrift(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
  clockMs: number,
): void {
  ctx.fillStyle = derived(palette).deepDrift;
  ctx.beginPath();
  const t = clockMs / 1000;
  for (let i = 0; i < DEEP_DRIFT_COUNT; i += 1) {
    const drift = 3 + hash01(i * 13 + 4) * 5;
    const x = hash01(i * 2 + 9) * WORLD.width + Math.sin(t * 0.12 + i * 0.9) * 22;
    const y = (hash01(i * 3 + 5) * WORLD.height + t * drift) % WORLD.height;
    if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
    const r = 2.5 + hash01(i * 5 + 2) * 4.5;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();
}

const DEEP_DRIFT_COUNT = 140;
