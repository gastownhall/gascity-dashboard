// Bead pellets: small rounded morsels batched by fill style (one fillStyle,
// many arcs). Tone variation is a deterministic 3-bucket hash of the bead id;
// sunken pellets settle darker and squashed; eaten pellets shrink+fade over
// the gulp window. Positions (drift bob, mouth-hold) are sim facts.
//
// Hot path (≤1000 pellets/frame): a single pass sorts pellets into reused
// module-level number arrays (batched by style), then each batch draws as one
// path. No per-pellet save/restore, no gradient, and — because the batch
// arrays are reused and only cleared (.length = 0) — no per-frame heap
// allocation.

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

// Reused batch arrays — a single synchronous caller per frame, no reentrancy.
const driftX: [number[], number[], number[]] = [[], [], []];
const driftY: [number[], number[], number[]] = [[], [], []];
const sunkX: number[] = [];
const sunkY: number[] = [];
const sunkScale: number[] = [];
const sunkSquash: number[] = [];
const sunkTone: number[] = [];
const eatenX: number[] = [];
const eatenY: number[] = [];
const eatenT: number[] = [];

function resetBatches(): void {
  for (let b = 0; b < 3; b += 1) {
    at(driftX, b).length = 0;
    at(driftY, b).length = 0;
  }
  sunkX.length = 0;
  sunkY.length = 0;
  sunkScale.length = 0;
  sunkSquash.length = 0;
  sunkTone.length = 0;
  eatenX.length = 0;
  eatenY.length = 0;
  eatenT.length = 0;
}

/** css px below which a pellet is drawn as the cheapest square mark instead of
 * an ellipse (its bezier-flattened arc). At the LOD0 overview 1000 pellets are
 * ~2 px each; a square path is meaningfully cheaper to build 1000× per frame and
 * indistinguishable at that size. Round morsels return at any real zoom. */
const CHEAP_MARK_PX = 2.2;

/** Actor layer must be installed. `layerScale` is the actor layer's css-px-per-
 * world-unit, used only to pick the cheap square mark at the tiny-pellet LOD0. */
export function paintPellets(
  ctx: CanvasRenderingContext2D,
  pellets: readonly PelletEntity[],
  sim: SimState,
  palette: ScenePalette,
  view: ViewRect,
  layerScale: number,
): void {
  const colors = pelletColors(palette);
  const square = PELLET_RADIUS * layerScale < CHEAP_MARK_PX;
  resetBatches();
  for (const pellet of pellets) {
    const kin = sim.pellets[pellet.beadId];
    // sim can lag a fresh snapshot by one frame; skip rather than invent
    if (kin === undefined) continue;
    if (!rectContains(view, kin.x, kin.y)) continue;
    if (pellet.state === 'sunken') {
      const h = hashString(pellet.beadId);
      sunkX.push(kin.x);
      sunkY.push(kin.y);
      sunkScale.push(0.78 + ((h >>> 4) % 100) * 0.005);
      sunkSquash.push(0.72 + ((h >>> 11) % 100) * 0.0022);
      sunkTone.push(h & 1);
    } else if (pellet.state === 'eaten') {
      eatenX.push(kin.x);
      eatenY.push(kin.y);
      eatenT.push(clamp01((pellet.gulpMsLeft ?? 0) / GULP_WINDOW_MS));
    } else {
      const b = hashString(pellet.beadId) % 3;
      at(driftX, b).push(kin.x);
      at(driftY, b).push(kin.y);
    }
  }
  for (let tone = 0; tone < 3; tone += 1) {
    fillDots(
      ctx,
      at(driftX, tone),
      at(driftY, tone),
      at(colors.tones, tone),
      PELLET_RADIUS,
      0.82,
      square,
    );
  }
  paintSunken(ctx, colors, square);
  paintEaten(ctx, colors);
}

/** settled morsels: a soft contact shadow pass, then two tone passes of
 * rounded pebbles with hashed size/squash — reads as food on the sand. When
 * `square` (tiny LOD0 marks) the invisible sub-pixel contact shadow is skipped
 * and pebbles draw as cheap squares. */
function paintSunken(ctx: CanvasRenderingContext2D, colors: PelletColors, square: boolean): void {
  const n = sunkX.length;
  if (n === 0) return;
  if (!square) {
    ctx.fillStyle = colors.sunkenShadow;
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const rx = PELLET_RADIUS * at(sunkScale, i) * 1.25;
      const y = at(sunkY, i) + PELLET_RADIUS * 0.5;
      ctx.moveTo(at(sunkX, i) + rx, y);
      ctx.ellipse(at(sunkX, i), y, rx, PELLET_RADIUS * 0.4, 0, 0, TAU);
    }
    ctx.fill();
  }
  for (let tone = 0; tone < colors.sunken.length; tone += 1) {
    ctx.fillStyle = at(colors.sunken, tone);
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      if (at(sunkTone, i) !== tone) continue;
      const rx = PELLET_RADIUS * at(sunkScale, i);
      const ry = rx * at(sunkSquash, i);
      if (square) {
        ctx.rect(at(sunkX, i) - rx, at(sunkY, i) - ry, rx * 2, ry * 2);
      } else {
        ctx.moveTo(at(sunkX, i) + rx, at(sunkY, i));
        ctx.ellipse(at(sunkX, i), at(sunkY, i), rx, ry, 0, 0, TAU);
      }
    }
    ctx.fill();
  }
}

/** gulp: each eaten morsel shrinks + fades on its own alpha (few per frame) */
function paintEaten(ctx: CanvasRenderingContext2D, colors: PelletColors): void {
  const n = eatenX.length;
  if (n === 0) return;
  const color = at(colors.tones, 0);
  for (let i = 0; i < n; i += 1) {
    const t = at(eatenT, i);
    ctx.globalAlpha = t;
    ctx.fillStyle = color;
    const rx = PELLET_RADIUS * (0.25 + 0.75 * t);
    ctx.beginPath();
    ctx.moveTo(at(eatenX, i) + rx, at(eatenY, i));
    ctx.ellipse(at(eatenX, i), at(eatenY, i), rx, rx * 0.82, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function fillDots(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
  color: string,
  rx: number,
  squash: number,
  square: boolean,
): void {
  const n = xs.length;
  if (n === 0) return;
  const ry = rx * squash;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (square) {
    // cheapest possible mark for the 1000-pellet LOD0 overview: a rect adds 4
    // straight edges vs the ellipse's four flattened beziers, and at ~2 css px
    // it is indistinguishable from a dot.
    for (let i = 0; i < n; i += 1) {
      ctx.rect(at(xs, i) - rx, at(ys, i) - ry, rx * 2, ry * 2);
    }
  } else {
    for (let i = 0; i < n; i += 1) {
      ctx.moveTo(at(xs, i) + rx, at(ys, i));
      ctx.ellipse(at(xs, i), at(ys, i), rx, ry, 0, 0, TAU);
    }
  }
  ctx.fill();
}
