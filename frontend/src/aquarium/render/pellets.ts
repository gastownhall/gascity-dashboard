// Bead pellets: small rounded morsels batched by fill style (one fillStyle,
// many arcs). Colour is PURE rig identity (hue), never status: status is read
// from position/behaviour — open drifts in the water column, in-progress (held)
// sits at a fish's mouth, blocked (sunken) settles squashed on the seabed with a
// contact shadow, eaten shrinks+fades over the gulp window. Those positions are
// sim facts. The three tone tiers carry PRIORITY (dim P3 / base P2 / bright
// P0-P1) as luminance within the rig hue — size stays the authoritative priority
// channel and luminance only reinforces it. A P0 additionally blooms in its own
// rig hue (replacing the old foreign white specular glint).
//
// Hot path (≤1000 pellets/frame): a single pass sorts pellets into reused
// module-level number arrays (batched by style), then each batch draws as one
// path. No per-pellet save/restore, no gradient, and — because the batch
// arrays are reused and only cleared (.length = 0) — no per-frame heap
// allocation.

import type { PelletEntity, ScenePalette, SimState } from '../contracts';
import { LOD1_ZOOM, LOD2_ZOOM } from '../contracts';
import { hashString } from './hash';
import type { ViewRect } from './layers';
import { rectContains } from './layers';
import { TAU, at, clamp01 } from './mathUtil';
import { adjustL, withAlpha, withHueChroma } from './oklch';
import { rigHue } from './rigHue';

export const PELLET_RADIUS = 5; // world units
/** render-side normalization of gulpMsLeft into a shrink/fade ramp */
const GULP_WINDOW_MS = 600;

export interface PelletColors {
  /** priority-luminance tiers of the rig hue: index 0 = dim (explicit-low P3),
   *  1 = base (P2 / unprioritised), 2 = bright (P0/P1). Status is NOT carried
   *  by colour — drift, held and sunken morsels all read from these same tiers;
   *  their state is read from position (drift height / held at a mouth / settled
   *  on the seabed), never a shade. Selected per pellet by {@link priorityTone}. */
  tones: readonly [string, string, string];
  /** soft contact shadow under a settled morsel — a physical cue of resting on
   *  the sand, not a status colour. */
  sunkenShadow: string;
  /** soft same-hue bloom for a P0 morsel: replaces the old white specular glint
   *  so the highest-priority beads glow in their own rig colour rather than
   *  carrying a foreign white catchlight. */
  bloom: string;
}

/** rig-tinted pellet chroma; matches a fish's rig hue so a school and its food
 * read as one project. A touch below the fish flank so 1000 tiny morsels don't
 * scream. */
const PELLET_RIG_CHROMA = 0.12;
/** priority-luminance spread (oklch L%) of the bright/dim tiers around the base
 * tone. Deliberately modest: size is the authoritative priority channel and a
 * distant pellet is dimmed by depth haze, so luminance only reinforces size. */
const PRIORITY_L_STEP = 8;
/** neutral (no-rig) cache key; real rig hues are their degree value */
const NEUTRAL_HUE_KEY = -1;

/** Retint a base pellet pigment to a rig's identity hue, or leave it the neutral
 * gold for the unrigged / city strata. */
function tintPellet(base: string, hue: number | null, chroma: number): string {
  return hue === null ? base : withHueChroma(base, hue, chroma);
}

// Cached per palette, then per rig hue: one base pigment per rig, spread into
// three priority-luminance tiers. Hue is the only project signal; lightness is
// priority, not status.
const colorCache = new WeakMap<ScenePalette, Map<number, PelletColors>>();

export function pelletColors(palette: ScenePalette, hue: number | null): PelletColors {
  let byHue = colorCache.get(palette);
  if (byHue === undefined) {
    byHue = new Map();
    colorCache.set(palette, byHue);
  }
  const k = hue ?? NEUTRAL_HUE_KEY;
  const hit = byHue.get(k);
  if (hit !== undefined) return hit;
  const base = tintPellet(palette.pellet, hue, PELLET_RIG_CHROMA);
  const built: PelletColors = {
    tones: [adjustL(base, -PRIORITY_L_STEP), base, adjustL(base, PRIORITY_L_STEP)],
    sunkenShadow: withAlpha(adjustL(base, -26), 0.34),
    bloom: withAlpha(adjustL(base, 16), 0.5),
  };
  byHue.set(k, built);
  return built;
}

/** Priority-luminance tier index for a pellet from its size multiplier (the same
 * `radiusScale` that already carries priority): P0/P1 (>= 1.35) read bright, an
 * explicit-low P3 (< 0.9) dim, and P2 / unprioritised (== 1.0) sit at the base
 * tier. Size stays the authoritative priority channel — this only picks the
 * reinforcing luminance, so a haze-dimmed distant pellet is never mis-ranked. */
export function priorityTone(radiusScale: number): 0 | 1 | 2 {
  if (radiusScale >= 1.35) return 2;
  if (radiusScale < 0.9) return 0;
  return 1;
}

// rigKey → hue cache key, memoised so the hot path never re-hashes a rig name.
const hueKeyByRig = new Map<string, number>();
function pelletHueKey(rigKey: string): number {
  const cached = hueKeyByRig.get(rigKey);
  if (cached !== undefined) return cached;
  const key = rigHue(rigKey) ?? NEUTRAL_HUE_KEY;
  hueKeyByRig.set(rigKey, key);
  return key;
}

// Reused batch arrays — a single synchronous caller per frame, no reentrancy.
const driftX: [number[], number[], number[]] = [[], [], []];
const driftY: [number[], number[], number[]] = [[], [], []];
const driftScale: [number[], number[], number[]] = [[], [], []];
const heldX: [number[], number[], number[]] = [[], [], []];
const heldY: [number[], number[], number[]] = [[], [], []];
const heldScale: [number[], number[], number[]] = [[], [], []];
const sunkX: number[] = [];
const sunkY: number[] = [];
const sunkScale: number[] = [];
const sunkSquash: number[] = [];
const sunkTone: number[] = [];
const eatenX: number[] = [];
const eatenY: number[] = [];
const eatenT: number[] = [];
// P0 blooms — collected per hue pass (the glow is tinted to the rig hue) and
// painted after that hue's fills.
const bloomX: number[] = [];
const bloomY: number[] = [];
const bloomScale: number[] = [];

function resetBatches(): void {
  for (let b = 0; b < 3; b += 1) {
    at(driftX, b).length = 0;
    at(driftY, b).length = 0;
    at(driftScale, b).length = 0;
    at(heldX, b).length = 0;
    at(heldY, b).length = 0;
    at(heldScale, b).length = 0;
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

/** A P0 pellet blooms from LOD1 up (layerScale === camera zoom for the actor
 * layer). Below LOD1 the whole reef is an unlabelled overview where a P0 reads
 * by its size alone; the same-hue glow is true detail that arrives with
 * proximity (honest zoom), so it stays off there. */
const BLOOM_MIN_SCALE = LOD1_ZOOM;
/** bloom disc radius as a fraction of the pellet radius — larger than the morsel
 * so the glow reads as a soft halo around it, centred (no offset). */
const BLOOM_RADIUS_FRACTION = 1.7;

/** LOD-aware backlog thinning: at the whole-tank overview ~1000 near-identical
 * open pellets swamp the ~50 sparse fish (the fleet reads as "coloured dust").
 * Held (in-progress), blocked, eaten and every P0 always draw; the ordinary
 * drifting backlog is sampled by a stable id hash so the overview shows a
 * REPRESENTATIVE slice of each rig's food and zooming in only ever ADDS pellets
 * (honest zoom). The exact per-rig totals stay in the formation label + legend,
 * so a thinned pellet is never a lost bead — the same truthful contract the
 * per-rig render cap already relies on. */
const DRIFT_SAMPLE_DENOM = 6;

/** How many of the DRIFT_SAMPLE_DENOM hash buckets of ordinary drifting backlog
 * to draw at a given zoom: ~1/6 at the overview, half at LOD1, all at LOD2. */
export function driftKeepCount(layerScale: number): number {
  if (layerScale >= LOD2_ZOOM) return DRIFT_SAMPLE_DENOM;
  if (layerScale >= LOD1_ZOOM) return DRIFT_SAMPLE_DENOM / 2;
  return 1;
}

/** Whether a pellet draws at the current LOD. Everything but ordinary drifting
 * backlog always draws; drifting non-P0 beads pass only if their stable hash
 * bucket is within the keep count, so the sample grows monotonically with zoom. */
export function pelletVisibleAtLod(pellet: PelletEntity, keep: number): boolean {
  if (pellet.state !== 'drifting' || pellet.isP0 === true) return true;
  return hashString(pellet.beadId) % DRIFT_SAMPLE_DENOM < keep;
}

/** distinct rig-hue keys present this frame (few; reused, so no per-frame alloc) */
const presentHues: number[] = [];

/** Actor layer must be installed. `layerScale` is the actor layer's css-px-per-
 * world-unit, used only to pick the cheap square mark at the tiny-pellet LOD0.
 * Pellets are drawn one tinted pass per rig hue so a rig's food shares its
 * school's colour; the batch arrays are reset and reused across passes. */
export function paintPellets(
  ctx: CanvasRenderingContext2D,
  pellets: readonly PelletEntity[],
  sim: SimState,
  palette: ScenePalette,
  view: ViewRect,
  layerScale: number,
): void {
  const square = PELLET_RADIUS * layerScale < CHEAP_MARK_PX;
  const bloomOn = layerScale >= BLOOM_MIN_SCALE;
  const keep = driftKeepCount(layerScale);
  presentHues.length = 0;
  for (const pellet of pellets) {
    const kin = sim.pellets[pellet.beadId];
    // sim can lag a fresh snapshot by one frame; skip rather than invent
    if (kin === undefined || !rectContains(view, kin.x, kin.y)) continue;
    if (!pelletVisibleAtLod(pellet, keep)) continue;
    const key = pelletHueKey(pellet.rigKey);
    if (!presentHues.includes(key)) presentHues.push(key);
  }
  for (let hi = 0; hi < presentHues.length; hi += 1) {
    const key = at(presentHues, hi);
    const colors = pelletColors(palette, key === NEUTRAL_HUE_KEY ? null : key);
    resetBatches();
    bloomX.length = 0;
    bloomY.length = 0;
    bloomScale.length = 0;
    for (const pellet of pellets) {
      const kin = sim.pellets[pellet.beadId];
      if (kin === undefined || !rectContains(view, kin.x, kin.y)) continue;
      // hue check first (a cached lookup) so the thinning hash only runs for
      // the current hue's pellets, not all of them once per present hue.
      if (pelletHueKey(pellet.rigKey) !== key) continue;
      if (!pelletVisibleAtLod(pellet, keep)) continue;
      // tone tier is priority (dim/base/bright), shared by every state — colour
      // never carries status, only rig hue and priority luminance.
      const tier = priorityTone(pellet.radiusScale);
      // a P0 morsel blooms in its own hue (redundant priority emphasis) once it
      // is a real morsel; the closing gulp (eaten) is not re-marked as it leaves.
      if (bloomOn && pellet.isP0 === true && pellet.state !== 'eaten') {
        bloomX.push(kin.x);
        bloomY.push(kin.y);
        bloomScale.push(pellet.radiusScale);
      }
      if (pellet.state === 'sunken') {
        const h = hashString(pellet.beadId);
        sunkX.push(kin.x);
        sunkY.push(kin.y);
        sunkScale.push((0.78 + ((h >>> 4) % 100) * 0.005) * pellet.radiusScale);
        sunkSquash.push(0.72 + ((h >>> 11) % 100) * 0.0022);
        sunkTone.push(tier);
      } else if (pellet.state === 'eaten') {
        eatenX.push(kin.x);
        eatenY.push(kin.y);
        eatenT.push(clamp01((pellet.gulpMsLeft ?? 0) / GULP_WINDOW_MS));
      } else if (pellet.state === 'held') {
        at(heldX, tier).push(kin.x);
        at(heldY, tier).push(kin.y);
        at(heldScale, tier).push(pellet.radiusScale);
      } else {
        at(driftX, tier).push(kin.x);
        at(driftY, tier).push(kin.y);
        at(driftScale, tier).push(pellet.radiusScale);
      }
    }
    // drift (open) and held (in-progress) share the same rig-hue priority tiers;
    // their state is the position (mid-water vs a fish's mouth), not the colour.
    for (let tone = 0; tone < 3; tone += 1) {
      fillDots(
        ctx,
        at(driftX, tone),
        at(driftY, tone),
        at(colors.tones, tone),
        PELLET_RADIUS,
        0.82,
        square,
        at(driftScale, tone),
      );
      fillDots(
        ctx,
        at(heldX, tone),
        at(heldY, tone),
        at(colors.tones, tone),
        PELLET_RADIUS,
        0.82,
        square,
        at(heldScale, tone),
      );
    }
    paintSunken(ctx, colors, square);
    paintEaten(ctx, colors);
    // one same-hue glow pass over this hue's visible P0 morsels, on top of fills
    paintBloom(ctx, colors.bloom);
  }
}

/** A soft same-hue glow centred on each collected P0 morsel — one fillStyle, one
 * path, no per-frame allocation. Reserved strictly for P0, so the bloom reads as
 * "a choicer morsel" rather than decoration, and in the rig's own colour so it
 * never introduces a foreign white pixel. */
function paintBloom(ctx: CanvasRenderingContext2D, color: string): void {
  const n = bloomX.length;
  if (n === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const r = PELLET_RADIUS * at(bloomScale, i) * BLOOM_RADIUS_FRACTION;
    ctx.moveTo(at(bloomX, i) + r, at(bloomY, i));
    ctx.arc(at(bloomX, i), at(bloomY, i), r, 0, TAU);
  }
  ctx.fill();
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
  for (let tone = 0; tone < colors.tones.length; tone += 1) {
    ctx.fillStyle = at(colors.tones, tone);
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
  const color = at(colors.tones, 1);
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

/** `scales[i]` is a per-pellet size multiplier (bead priority); the base rx and
 * squash are shared, so the batch stays one fillStyle + one fill. */
function fillDots(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
  color: string,
  rx: number,
  squash: number,
  square: boolean,
  scales: readonly number[],
): void {
  const n = xs.length;
  if (n === 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (square) {
    // cheapest possible mark for the 1000-pellet LOD0 overview: a rect adds 4
    // straight edges vs the ellipse's four flattened beziers, and at ~2 css px
    // it is indistinguishable from a dot.
    for (let i = 0; i < n; i += 1) {
      const srx = rx * at(scales, i);
      const sry = srx * squash;
      ctx.rect(at(xs, i) - srx, at(ys, i) - sry, srx * 2, sry * 2);
    }
  } else {
    for (let i = 0; i < n; i += 1) {
      const srx = rx * at(scales, i);
      ctx.moveTo(at(xs, i) + srx, at(ys, i));
      ctx.ellipse(at(xs, i), at(ys, i), srx, srx * squash, 0, 0, TAU);
    }
  }
  ctx.fill();
}
