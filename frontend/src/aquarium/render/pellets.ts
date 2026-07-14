// Bead pellets: small rounded morsels batched by style (one fillStyle, many
// arcs). Tone variation is a deterministic 3-bucket hash of the bead id;
// sunken pellets settle darker and squashed; eaten pellets shrink+fade over
// the gulp window. Positions (drift bob, mouth-hold) are sim facts.

import type { PelletEntity, ScenePalette, SimState } from '../contracts';
import { hashString } from './hash';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { TAU, at, clamp01 } from './mathUtil';
import { adjustL } from './oklch';

const PELLET_RADIUS = 5; // world units
/** render-side normalization of gulpMsLeft into a shrink/fade ramp */
const GULP_WINDOW_MS = 600;

interface PelletColors {
  tones: readonly [string, string, string];
  sunken: string;
}

const colorCache = new WeakMap<ScenePalette, PelletColors>();

function pelletColors(palette: ScenePalette): PelletColors {
  const hit = colorCache.get(palette);
  if (hit !== undefined) return hit;
  const built: PelletColors = {
    tones: [palette.pellet, adjustL(palette.pellet, 6), adjustL(palette.pellet, -6)],
    sunken: palette.pelletSunken,
  };
  colorCache.set(palette, built);
  return built;
}

interface Dot {
  x: number;
  y: number;
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
  const sunken: Dot[] = [];
  const eaten: Array<Dot & { t: number }> = [];
  for (const pellet of pellets) {
    const kin = sim.pellets[pellet.beadId];
    // sim can lag a fresh snapshot by one frame; skip rather than invent
    if (kin === undefined) continue;
    if (!rectContains(view, kin.x, kin.y)) continue;
    if (pellet.state === 'sunken') {
      sunken.push({ x: kin.x, y: kin.y });
    } else if (pellet.state === 'eaten') {
      eaten.push({ x: kin.x, y: kin.y, t: clamp01((pellet.gulpMsLeft ?? 0) / GULP_WINDOW_MS) });
    } else {
      at(buckets, hashString(pellet.beadId) % 3).push({ x: kin.x, y: kin.y });
    }
  }
  for (let tone = 0; tone < buckets.length; tone += 1) {
    fillDots(ctx, at(buckets, tone), at(colors.tones, tone), PELLET_RADIUS, 0.82);
  }
  fillDots(ctx, sunken, colors.sunken, PELLET_RADIUS, 0.6);
  for (const dot of eaten) {
    ctx.globalAlpha = dot.t;
    fillDots(ctx, [dot], at(colors.tones, 0), PELLET_RADIUS * (0.25 + 0.75 * dot.t), 0.82);
  }
  if (eaten.length > 0) ctx.globalAlpha = 1;
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
