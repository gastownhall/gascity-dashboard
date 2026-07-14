// Bead pellets: small rounded morsels batched by style (one fillStyle, many
// arcs). Tone variation is a deterministic 3-bucket hash of the bead id;
// sunken pellets settle darker and squashed; eaten pellets shrink+fade over
// the gulp window. Positions (drift bob, mouth-hold) are sim facts.

import type { PelletEntity, ScenePalette, SimState } from '../contracts';
import { hashString } from './hash';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { TAU, at, clamp01 } from './mathUtil';
import { adjustL, withAlpha } from './oklch';

const PELLET_RADIUS = 5; // world units
/** render-side normalization of gulpMsLeft into a shrink/fade ramp */
const GULP_WINDOW_MS = 600;

interface PelletColors {
  tones: readonly [string, string, string];
  /** two settled-morsel tones for blocked/sunken beads */
  sunken: readonly [string, string];
  /** soft contact shadow under a settled morsel */
  sunkenShadow: string;
}

const colorCache = new WeakMap<ScenePalette, PelletColors>();

function pelletColors(palette: ScenePalette): PelletColors {
  const hit = colorCache.get(palette);
  if (hit !== undefined) return hit;
  const built: PelletColors = {
    tones: [palette.pellet, adjustL(palette.pellet, 6), adjustL(palette.pellet, -6)],
    sunken: [palette.pelletSunken, adjustL(palette.pelletSunken, -7)],
    sunkenShadow: withAlpha(adjustL(palette.pelletSunken, -20), 0.34),
  };
  colorCache.set(palette, built);
  return built;
}

interface Dot {
  x: number;
  y: number;
}

/** a settled morsel carries its own hashed size/shape so the seabed reads as
 * scattered organic food, not a row of identical UI diamonds */
interface Morsel {
  x: number;
  y: number;
  /** 0.78..1.28 of the base radius */
  scale: number;
  /** 0.72..0.94 vertical squash (resting, slightly flattened by gravity) */
  squash: number;
  tone: 0 | 1;
}

/** Actor layer must be installed. */
export function paintPellets(
  ctx: CanvasRenderingContext2D,
  pellets: readonly PelletEntity[],
  sim: SimState,
  palette: ScenePalette,
  view: ViewRect,
): void {
  const colors = pelletColors(palette);
  const buckets: [Dot[], Dot[], Dot[]] = [[], [], []];
  const sunken: Morsel[] = [];
  const eaten: Array<Dot & { t: number }> = [];
  for (const pellet of pellets) {
    const kin = sim.pellets[pellet.beadId];
    // sim can lag a fresh snapshot by one frame; skip rather than invent
    if (kin === undefined) continue;
    if (!rectContains(view, kin.x, kin.y)) continue;
    if (pellet.state === 'sunken') {
      const h = hashString(pellet.beadId);
      sunken.push({
        x: kin.x,
        y: kin.y,
        scale: 0.78 + ((h >>> 4) % 100) * 0.005,
        squash: 0.72 + ((h >>> 11) % 100) * 0.0022,
        tone: (h & 1) as 0 | 1,
      });
    } else if (pellet.state === 'eaten') {
      eaten.push({ x: kin.x, y: kin.y, t: clamp01((pellet.gulpMsLeft ?? 0) / GULP_WINDOW_MS) });
    } else {
      at(buckets, hashString(pellet.beadId) % 3).push({ x: kin.x, y: kin.y });
    }
  }
  for (let tone = 0; tone < buckets.length; tone += 1) {
    fillDots(ctx, at(buckets, tone), at(colors.tones, tone), PELLET_RADIUS, 0.82);
  }
  paintSunken(ctx, sunken, colors);
  for (const dot of eaten) {
    ctx.globalAlpha = dot.t;
    fillDots(ctx, [dot], at(colors.tones, 0), PELLET_RADIUS * (0.25 + 0.75 * dot.t), 0.82);
  }
  if (eaten.length > 0) ctx.globalAlpha = 1;
}

/** settled morsels: a soft contact shadow pass, then two tone passes of
 * rounded pebbles with hashed size/squash — reads as food on the sand */
function paintSunken(
  ctx: CanvasRenderingContext2D,
  sunken: readonly Morsel[],
  colors: PelletColors,
): void {
  if (sunken.length === 0) return;
  ctx.fillStyle = colors.sunkenShadow;
  ctx.beginPath();
  for (const m of sunken) {
    const rx = PELLET_RADIUS * m.scale * 1.25;
    ctx.moveTo(m.x + rx, m.y + PELLET_RADIUS * 0.5);
    ctx.ellipse(m.x, m.y + PELLET_RADIUS * 0.5, rx, PELLET_RADIUS * 0.4, 0, 0, TAU);
  }
  ctx.fill();
  for (let tone = 0; tone < colors.sunken.length; tone += 1) {
    ctx.fillStyle = at(colors.sunken, tone);
    ctx.beginPath();
    for (const m of sunken) {
      if (m.tone !== tone) continue;
      const rx = PELLET_RADIUS * m.scale;
      ctx.moveTo(m.x + rx, m.y);
      ctx.ellipse(m.x, m.y, rx, rx * m.squash, 0, 0, TAU);
    }
    ctx.fill();
  }
}

function fillDots(
  ctx: CanvasRenderingContext2D,
  dots: readonly Dot[],
  color: string,
  rx: number,
  squash: number,
): void {
  if (dots.length === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const dot of dots) {
    ctx.moveTo(dot.x + rx, dot.y);
    ctx.ellipse(dot.x, dot.y, rx, rx * squash, 0, 0, TAU);
  }
  ctx.fill();
}
