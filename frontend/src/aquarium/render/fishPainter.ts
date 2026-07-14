// Paints one fish from its geometry + entity + kinematics: two-tone flat
// body (darker dorsal over lighter ventral, split along the spine), crisp
// zoom-stable outline, translucent fins, pose-carrying eye/gill/mouth.
// No save/restore per fish: placement is one setTransform, and the caller
// re-installs the actor layer once after the loop.

import type { FishEntity, FishKinematics, ScenePalette, SimState } from '../contracts';
import type { FishAttitude, FishHead, FishHull, FishSpine } from './fishGeometry';
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
import type { LayerTransform, ViewRect } from './layers';
import { applyLayer, rectContains } from './layers';
import { TAU, at, clamp, normalizeAngle, type Pt } from './mathUtil';
import { adjustL, withAlpha } from './oklch';

interface FishColors {
  dorsal: string;
  ventral: string;
  fin: string;
  outline: string;
  dimDorsal: string;
  dimVentral: string;
  dimFin: string;
  dimOutline: string;
}

const colorCache = new WeakMap<ScenePalette, FishColors>();

function fishColors(palette: ScenePalette): FishColors {
  const hit = colorCache.get(palette);
  if (hit !== undefined) return hit;
  const dorsal = adjustL(palette.fishBody, -7);
  const ventral = adjustL(palette.fishBody, 7);
  const dimDorsal = adjustL(palette.fishDim, -4);
  const dimVentral = adjustL(palette.fishDim, 4);
  const built: FishColors = {
    dorsal,
    ventral,
    fin: withAlpha(dorsal, 0.7),
    outline: palette.fishOutline,
    dimDorsal,
    dimVentral,
    dimFin: withAlpha(dimDorsal, 0.6),
    dimOutline: withAlpha(palette.fishOutline, 0.55),
  };
  colorCache.set(palette, built);
  return built;
}

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
  const colors = fishColors(palette);
  for (const fish of fishList) {
    const kin = sim.fish[fish.id];
    // sim can lag a fresh snapshot by one frame; a fish with no kinematics
    // yet is skipped rather than painted at an invented position
    if (kin === undefined) continue;
    if (!rectContains(view, kin.x, kin.y)) continue;
    paintFish(ctx, fish, kin, colors, layer, clockMs);
  }
  applyLayer(ctx, layer);
}

function paintFish(
  ctx: CanvasRenderingContext2D,
  fish: FishEntity,
  kin: FishKinematics,
  colors: FishColors,
  layer: LayerTransform,
  clockMs: number,
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
  const head = fishHead(spine, hull);
  placeFish(ctx, kin, attitude, layer, clockMs);
  const dim = attitude.dimmed || fish.tombstoned;
  const body = dim
    ? {
        dorsal: colors.dimDorsal,
        ventral: colors.dimVentral,
        fin: colors.dimFin,
        outline: colors.dimOutline,
      }
    : { dorsal: colors.dorsal, ventral: colors.ventral, fin: colors.fin, outline: colors.outline };
  const lineWidth = 1.25 / layer.scale;
  if (fish.tombstoned) ctx.globalAlpha = 0.4;
  ctx.fillStyle = body.fin;
  traceThrough(ctx, fins.dorsal);
  ctx.fill();
  traceThrough(ctx, fins.pelvic);
  ctx.fill();
  traceThrough(ctx, fins.caudal);
  ctx.fill();
  paintBody(ctx, spine, hull, body.dorsal, body.ventral);
  ctx.fillStyle = body.fin;
  traceThrough(ctx, fins.pectoral);
  ctx.fill();
  traceHull(ctx, hull);
  ctx.strokeStyle = body.outline;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
  paintFace(ctx, head, attitude, spine, body.outline, lineWidth);
  if (fish.tombstoned) ctx.globalAlpha = 1;
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
  const sway = attitude.swayAmp * Math.sin((clockMs / 1000) * 0.35 * TAU + kin.phase);
  const rot = clamp(base, -attitude.maxHeadingTilt, attitude.maxHeadingTilt) + sway;
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

/** two-tone fill: whole hull in ventral, then the dorsal half re-filled
 * darker, split along a smoothed spine curve */
function paintBody(
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

function paintFace(
  ctx: CanvasRenderingContext2D,
  head: FishHead,
  attitude: FishAttitude,
  spine: FishSpine,
  outline: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = outline;
  ctx.fillStyle = outline;
  ctx.lineWidth = lineWidth;
  paintEye(ctx, head, attitude);
  // gill crease, bowed back toward the tail
  const bow = 1.6 * head.eyeRadius;
  ctx.beginPath();
  ctx.moveTo(head.gillA.x, head.gillA.y);
  ctx.quadraticCurveTo(
    (head.gillA.x + head.gillB.x) / 2 - head.mouthDir.x * bow,
    (head.gillA.y + head.gillB.y) / 2 - head.mouthDir.y * bow,
    head.gillB.x,
    head.gillB.y,
  );
  ctx.stroke();
  if (attitude.mouthOpen) {
    // open gape: dark wedge notched into the nose
    const len = head.eyeRadius * 2.4;
    const px = -head.mouthDir.y;
    const py = head.mouthDir.x;
    ctx.beginPath();
    ctx.moveTo(
      head.mouth.x + head.mouthDir.x * len * 0.35,
      head.mouth.y + head.mouthDir.y * len * 0.35,
    );
    ctx.lineTo(
      head.mouth.x - head.mouthDir.x * len + px * len * 0.45,
      head.mouth.y - head.mouthDir.y * len + py * len * 0.45,
    );
    ctx.lineTo(
      head.mouth.x - head.mouthDir.x * len - px * len * 0.45,
      head.mouth.y - head.mouthDir.y * len - py * len * 0.45,
    );
    ctx.closePath();
    ctx.fill();
  } else if (SPECIES[spine.species].noseBlunt > 0.6) {
    // heavy grouper lips: a short thick bar across the nose front
    const px = -head.mouthDir.y;
    const py = head.mouthDir.x;
    const r = head.eyeRadius;
    ctx.lineWidth = lineWidth * 2.4;
    ctx.beginPath();
    ctx.moveTo(head.mouth.x + px * r * 0.6, head.mouth.y + py * r * 0.6);
    ctx.lineTo(head.mouth.x - px * r * 1.1, head.mouth.y - py * r * 1.1);
    ctx.stroke();
    ctx.lineWidth = lineWidth;
  }
}

function paintEye(ctx: CanvasRenderingContext2D, head: FishHead, attitude: FishAttitude): void {
  const { eye, eyeRadius: r } = head;
  ctx.beginPath();
  switch (attitude.eye) {
    case 'open':
      ctx.arc(eye.x, eye.y, r, 0, TAU);
      ctx.fill();
      return;
    case 'hollow':
      ctx.arc(eye.x, eye.y, r * 0.9, 0, TAU);
      ctx.stroke();
      return;
    case 'closed':
      // restful downward arc
      ctx.arc(eye.x, eye.y - r * 0.3, r, TAU * 0.08, TAU * 0.42);
      ctx.stroke();
      return;
    case 'cross':
      ctx.moveTo(eye.x - r * 0.8, eye.y - r * 0.8);
      ctx.lineTo(eye.x + r * 0.8, eye.y + r * 0.8);
      ctx.moveTo(eye.x + r * 0.8, eye.y - r * 0.8);
      ctx.lineTo(eye.x - r * 0.8, eye.y + r * 0.8);
      ctx.stroke();
      return;
  }
}
