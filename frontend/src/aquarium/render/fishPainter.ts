// Paints one fish from its geometry + entity + kinematics. Two draw paths:
// a rich path (per-fish countershading gradient, feathered fin membranes,
// eye/gill/mouth) for fish drawn large enough to read, and a cheap flat
// two-tone path for the 200-fish perf sweep where every fish is a few pixels.
// The rich path is gated on a fish-count budget (≤ RICH_FISH_BUDGET) AND a
// minimum drawn size, so gradients never fire on the perf fixture.
// No save/restore per fish: placement is one setTransform.

import type { FishEntity, FishKinematics, ScenePalette, SimState } from '../contracts';
import type { FishAttitude, FishHull, FishSpine } from './fishGeometry';
import {
  SPECIES,
  attitudeForPose,
  bellyFactorFromPct,
  fishFins,
  fishHead,
  fishHull,
  fishSpine,
  speedFactorFor,
  swimPhaseFor,
} from './fishGeometry';
import type { FishFins } from './fishFins';
import { paintFace } from './fishFace';
import type { CountershadeColors } from './fishShading';
import { bodyGradient, countershadeColors, finGradient, midpoint } from './fishShading';
import type { LayerTransform, ViewRect } from './layers';
import { applyLayer, rectContains } from './layers';
import { TAU, at, clamp, normalizeAngle, type Pt } from './mathUtil';
import { withAlpha } from './oklch';

/** above this many visible fish, everyone takes the cheap flat path */
const RICH_FISH_BUDGET = 48;
/** min drawn body length (css px) for the gradient path */
const RICH_MIN_PX = 16;
/** min drawn body length (css px) for eye/gill/mouth */
const FACE_MIN_PX = 46;

/** Cull + paint every fish. Leaves the actor layer transform installed. */
export function paintFishLayer(
  ctx: CanvasRenderingContext2D,
  fishList: readonly FishEntity[],
  sim: SimState,
  palette: ScenePalette,
  layer: LayerTransform,
  view: ViewRect,
  clockMs: number,
): void {
  const normal = countershadeColors(palette, false);
  const dim = countershadeColors(palette, true);
  const drawnPx = 85 * layer.scale;
  const richBudget = fishList.length <= RICH_FISH_BUDGET && drawnPx >= RICH_MIN_PX;
  for (const fish of fishList) {
    const kin = sim.fish[fish.id];
    // sim can lag a fresh snapshot by one frame; a fish with no kinematics
    // yet is skipped rather than painted at an invented position
    if (kin === undefined) continue;
    if (!rectContains(view, kin.x, kin.y)) continue;
    const dimmed = attitudeForPose(fish.pose).dimmed || fish.tombstoned;
    paintFish(ctx, fish, kin, dimmed ? dim : normal, layer, clockMs, richBudget);
  }
  applyLayer(ctx, layer);
}

function paintFish(
  ctx: CanvasRenderingContext2D,
  fish: FishEntity,
  kin: FishKinematics,
  colors: CountershadeColors,
  layer: LayerTransform,
  clockMs: number,
  richBudget: boolean,
): void {
  const attitude = attitudeForPose(fish.pose);
  const swimPhase = swimPhaseFor(fish.species, kin.phase, clockMs);
  const spine = fishSpine(
    fish.species,
    attitude,
    swimPhase,
    speedFactorFor(fish.species, kin.speed),
  );
  const hull = fishHull(spine, fish.species, bellyFactorFromPct(fish.bellyPct));
  const fins = fishFins(spine, hull, swimPhase);
  placeFish(ctx, kin, attitude, layer, clockMs);
  const lineWidth = 1.25 / layer.scale;
  const drawnPx = SPECIES[fish.species].length * layer.scale;
  if (fish.tombstoned) ctx.globalAlpha = 0.4;
  if (richBudget && drawnPx >= RICH_MIN_PX) {
    paintRich(ctx, fish, spine, hull, fins, colors, lineWidth, drawnPx >= FACE_MIN_PX);
  } else {
    paintFlat(ctx, spine, hull, fins, colors, lineWidth);
  }
  if (fish.tombstoned) ctx.globalAlpha = 1;
}

/** rich path: membranes behind the body, gradient body, near pectoral, face */
function paintRich(
  ctx: CanvasRenderingContext2D,
  fish: FishEntity,
  spine: FishSpine,
  hull: FishHull,
  fins: FishFins,
  colors: CountershadeColors,
  lineWidth: number,
  withFace: boolean,
): void {
  membrane(
    ctx,
    fins.caudal,
    midpoint(at(fins.caudal, 0), at(fins.caudal, 4)),
    at(fins.caudal, 2),
    colors.finRoot,
    0.92,
  );
  membrane(
    ctx,
    fins.dorsal,
    midpoint(at(fins.dorsal, 0), at(fins.dorsal, 3)),
    midpoint(at(fins.dorsal, 1), at(fins.dorsal, 2)),
    colors.finRoot,
    0.82,
  );
  membrane(ctx, fins.pelvic, at(fins.pelvic, 0), at(fins.pelvic, 1), colors.finRoot, 0.78);
  traceHull(ctx, hull);
  ctx.fillStyle = bodyGradient(ctx, hull, colors);
  ctx.fill();
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
  membrane(ctx, fins.pectoral, at(fins.pectoral, 0), at(fins.pectoral, 1), colors.finLight, 0.6);
  if (withFace) {
    paintFace(
      ctx,
      fishHead(spine, hull),
      spine.attitude,
      SPECIES[fish.species].noseBlunt,
      colors,
      lineWidth,
    );
  }
}

/** cheap path: flat two-tone body + flat translucent fins, one stroke */
function paintFlat(
  ctx: CanvasRenderingContext2D,
  spine: FishSpine,
  hull: FishHull,
  fins: FishFins,
  colors: CountershadeColors,
  lineWidth: number,
): void {
  ctx.fillStyle = withAlpha(colors.finRoot, 0.6);
  traceThrough(ctx, fins.caudal);
  ctx.fill();
  traceThrough(ctx, fins.dorsal);
  ctx.fill();
  traceThrough(ctx, fins.pelvic);
  ctx.fill();
  paintBodyFlat(ctx, spine, hull, colors.dorsal, colors.ventral);
  ctx.fillStyle = withAlpha(colors.finLight, 0.5);
  traceThrough(ctx, fins.pectoral);
  ctx.fill();
  traceHull(ctx, hull);
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function membrane(
  ctx: CanvasRenderingContext2D,
  pts: readonly Pt[],
  root: Pt,
  tip: Pt,
  color: string,
  rootAlpha: number,
): void {
  ctx.fillStyle = finGradient(ctx, root, tip, color, rootAlpha);
  traceThrough(ctx, pts);
  ctx.fill();
}

/** heading → mirrored, tilt-clamped placement in one setTransform */
function placeFish(
  ctx: CanvasRenderingContext2D,
  kin: FishKinematics,
  attitude: FishAttitude,
  layer: LayerTransform,
  clockMs: number,
): void {
  const facingLeft = Math.cos(kin.heading) < 0;
  const base = normalizeAngle(facingLeft ? kin.heading - Math.PI : kin.heading);
  const t = clockMs / 1000;
  const sway = attitude.swayAmp * Math.sin(t * 0.35 * TAU + kin.phase);
  const quiver = attitude.quiver * Math.sin(t * 6 * TAU + kin.phase);
  const rot = clamp(base, -attitude.maxHeadingTilt, attitude.maxHeadingTilt) + sway + quiver;
  const m = facingLeft ? -1 : 1;
  const k = layer.dpr * layer.scale;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  ctx.setTransform(
    k * cos * m,
    k * sin * m,
    -k * sin,
    k * cos,
    k * kin.x + layer.dpr * layer.tx,
    k * kin.y + layer.dpr * layer.ty,
  );
}

function traceHull(ctx: CanvasRenderingContext2D, hull: FishHull): void {
  const segs = hull.segments;
  const start = at(segs, 0).from;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (const s of segs) ctx.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
  ctx.closePath();
}

/** two-tone fill: whole hull in ventral, then the dorsal half re-filled darker,
 * split along a smoothed spine curve (cheap countershading for tiny fish) */
function paintBodyFlat(
  ctx: CanvasRenderingContext2D,
  spine: FishSpine,
  hull: FishHull,
  dorsal: string,
  ventral: string,
): void {
  ctx.fillStyle = ventral;
  traceHull(ctx, hull);
  ctx.fill();
  ctx.fillStyle = dorsal;
  const segs = hull.segments;
  const n = spine.points.length;
  const start = at(segs, 0).from;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  // ring is [nose, dorsal…, tail, ventral…]: segments 0..n run nose→tail
  for (let i = 0; i <= n; i += 1) {
    const s = at(segs, i);
    ctx.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.to.x, s.to.y);
  }
  for (let i = n - 2; i >= 1; i -= 1) {
    const p = at(spine.points, i);
    const next = at(spine.points, i - 1);
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  const head = at(spine.points, 0);
  ctx.quadraticCurveTo(head.x, head.y, start.x, start.y);
  ctx.closePath();
  ctx.fill();
}

/** open Catmull-Rom through every point (tips stay sharp), closed at the end */
function traceThrough(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  const n = pts.length;
  const first = at(pts, 0);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = at(pts, Math.max(0, i - 1));
    const p1 = at(pts, i);
    const p2 = at(pts, i + 1);
    const p3 = at(pts, Math.min(n - 1, i + 2));
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  ctx.closePath();
}
