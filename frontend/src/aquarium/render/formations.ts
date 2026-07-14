// Procedural rig formations: layered rounded-rock clusters in 3 depth tones
// with per-seed-unique silhouettes and dramatic height/width variance
// (formationShapes.ts), light/dark texture speckle, thin crown spurs, forking
// coral branches, a soft contact shadow where the rock meets the seabed, and
// kelp fronds with a slow clock sway. Silhouettes are seed-deterministic (same
// rig, same shape, every session) and cached as world-space Path2D per tone so
// a frame costs a handful of fills/strokes. There is deliberately NO flat
// shelf/plank bar — that read as a diagram baseline; fish perch on rock.

import type { RigFormation, ScenePalette } from '../contracts';
import { CITY_KEY } from '../contracts';
import {
  buildBranches,
  buildLobes,
  buildSpeckle,
  buildSpurs,
  blobRing,
  traceSmoothRing,
} from './formationShapes';
import type { Pt } from './mathUtil';
import { mulberry32 } from './hash';
import type { ViewRect } from './layers';
import { TAU, at } from './mathUtil';
import { adjustL, mixOklch, withAlpha } from './oklch';

const TONE_COUNT = 3;

interface Frond {
  baseX: number;
  baseY: number;
  height: number;
  lean: number;
  phase: number;
}

interface Contact {
  cx: number;
  cy: number;
  halfWidth: number;
}

interface FormationGeometry {
  tonePaths: readonly Path2D[];
  edgePath: Path2D;
  /** forking coral limbs, stroked as one batched path */
  coralPath: Path2D;
  speckle: { light: readonly Pt[]; dark: readonly Pt[] };
  contact: Contact;
  fronds: readonly Frond[];
  cullLeft: number;
  cullRight: number;
}

const geometryCache = new Map<string, FormationGeometry>();

function formationGeometry(formation: RigFormation): FormationGeometry {
  const key = `${formation.key}|${formation.seed}|${Math.round(formation.radius)}|${Math.round(formation.anchorX)},${Math.round(formation.anchorY)}`;
  const hit = geometryCache.get(key);
  if (hit !== undefined) return hit;
  if (geometryCache.size > 128) geometryCache.clear();
  const built = buildGeometry(formation);
  geometryCache.set(key, built);
  return built;
}

function buildGeometry(formation: RigFormation): FormationGeometry {
  const rnd = mulberry32(formation.seed);
  const tonePaths = [new Path2D(), new Path2D(), new Path2D()];
  const edgePath = new Path2D();
  const lobes = buildLobes(formation, rnd);
  let minX = formation.anchorX;
  let maxX = formation.anchorX;
  for (const lobe of lobes) {
    const ring = blobRing(lobe.cx, lobe.cy, lobe.rx, lobe.ry, rnd);
    traceSmoothRing(at(tonePaths, lobe.tone), ring);
    if (lobe.tone === TONE_COUNT - 1) traceSmoothRing(edgePath, ring);
    minX = Math.min(minX, lobe.cx - lobe.rx);
    maxX = Math.max(maxX, lobe.cx + lobe.rx);
  }
  const front = at(tonePaths, TONE_COUNT - 1);
  for (const spur of buildSpurs(formation, rnd)) {
    const px = -(spur.tipY - spur.baseY);
    const py = spur.tipX - spur.baseX;
    const len = Math.hypot(px, py) || 1;
    const nx = (px / len) * spur.width;
    const ny = (py / len) * spur.width;
    front.moveTo(spur.baseX + nx, spur.baseY + ny);
    front.lineTo(spur.tipX, spur.tipY);
    front.lineTo(spur.baseX - nx, spur.baseY - ny);
    front.closePath();
  }
  const coralPath = new Path2D();
  for (const seg of buildBranches(formation, rnd)) {
    coralPath.moveTo(seg.x1, seg.y1);
    coralPath.lineTo(seg.x2, seg.y2);
  }
  return {
    tonePaths,
    edgePath,
    coralPath,
    speckle: buildSpeckle(lobes, rnd),
    contact: { cx: (minX + maxX) / 2, cy: formation.anchorY + 6, halfWidth: (maxX - minX) / 2 },
    fronds: buildFronds(formation, rnd),
    cullLeft: minX - formation.radius * 0.3,
    cullRight: maxX + formation.radius * 0.3,
  };
}

function buildFronds(formation: RigFormation, rnd: () => number): Frond[] {
  const fronds: Frond[] = [];
  const count = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i += 1) {
    const side = rnd() < 0.5 ? -1 : 1;
    fronds.push({
      baseX: formation.anchorX + side * formation.radius * (0.55 + rnd() * 0.55),
      baseY: formation.anchorY + 4,
      height: 170 + rnd() * 210,
      lean: (rnd() - 0.5) * 60,
      phase: rnd() * TAU,
    });
  }
  return fronds;
}

interface FormationColors {
  tones: readonly string[];
  edge: string;
  contact: string;
  coral: string;
  speckleLight: string;
  speckleDark: string;
}

const colorCache = new WeakMap<ScenePalette, FormationColors>();

function formationColors(palette: ScenePalette): FormationColors {
  const hit = colorCache.get(palette);
  if (hit !== undefined) return hit;
  const built: FormationColors = {
    // back tones fog-blend toward the far haze; the front tone is full pigment
    tones: [
      mixOklch(palette.formation, palette.hazeFar, 0.55),
      mixOklch(palette.formation, palette.hazeFar, 0.28),
      palette.formation,
    ],
    edge: withAlpha(palette.formationEdge, 0.85),
    contact: withAlpha(adjustL(palette.formationEdge, -10), 1),
    // a warmer, brighter accent than the rock — reads as living coral
    coral: adjustL(mixOklch(palette.formation, palette.pellet, 0.42), 6),
    speckleLight: withAlpha(adjustL(palette.formation, 13), 0.5),
    speckleDark: withAlpha(adjustL(palette.formationEdge, -6), 0.42),
  };
  colorCache.set(palette, built);
  return built;
}

/** Mid-layer transform must be installed. Batches all visible formations into
 * one fill per depth tone, a contact shadow pass, one edge stroke, one kelp
 * stroke. */
export function paintFormations(
  ctx: CanvasRenderingContext2D,
  formations: readonly RigFormation[],
  palette: ScenePalette,
  view: ViewRect,
  zoom: number,
  clockMs: number,
): void {
  const colors = formationColors(palette);
  const visible = formations.filter((f) => {
    if (f.key === CITY_KEY) return false; // city agents swim open water
    const g = formationGeometry(f);
    return g.cullRight >= view.left && g.cullLeft <= view.right;
  });
  if (visible.length === 0) return;
  paintContactShadows(ctx, visible, colors.contact);
  for (let tone = 0; tone < TONE_COUNT; tone += 1) {
    ctx.fillStyle = at(colors.tones, tone);
    for (const f of visible) ctx.fill(at(formationGeometry(f).tonePaths, tone));
  }
  paintSpeckle(ctx, visible, colors, zoom);
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 1.25 / zoom;
  ctx.lineJoin = 'round';
  for (const f of visible) ctx.stroke(formationGeometry(f).edgePath);
  paintCoral(ctx, visible, colors);
  paintKelp(ctx, visible, palette, zoom, clockMs);
}

/** Forking coral limbs over the crown, one batched stroke, round-capped.
 * Width is world-unit (scales with the reef), so it needs no zoom. */
function paintCoral(
  ctx: CanvasRenderingContext2D,
  visible: readonly RigFormation[],
  colors: FormationColors,
): void {
  ctx.strokeStyle = colors.coral;
  ctx.lineWidth = Math.max(3.5, 0.06 * averageRadius(visible));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const f of visible) ctx.stroke(formationGeometry(f).coralPath);
  ctx.lineCap = 'butt';
}

function averageRadius(visible: readonly RigFormation[]): number {
  let sum = 0;
  for (const f of visible) sum += f.radius;
  return visible.length === 0 ? 0 : sum / visible.length;
}

/** Two batched grain passes (light + dark speckle dots) so rock reads as
 * textured stone, not a flat blob. Dot radius stays ~constant in css px. */
function paintSpeckle(
  ctx: CanvasRenderingContext2D,
  visible: readonly RigFormation[],
  colors: FormationColors,
  zoom: number,
): void {
  const r = Math.max(1.4, 2.4 / zoom);
  const passes: Array<[string, (g: FormationGeometry) => readonly { x: number; y: number }[]]> = [
    [colors.speckleDark, (g) => g.speckle.dark],
    [colors.speckleLight, (g) => g.speckle.light],
  ];
  for (const [color, pick] of passes) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const f of visible) {
      for (const p of pick(formationGeometry(f))) {
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, TAU);
      }
    }
    ctx.fill();
  }
}

/** soft ambient-occlusion darkening at the rock/seabed contact: nested flat
 * ellipses (darkest tight, faint wide) — no gradient, cheap, deterministic */
function paintContactShadows(
  ctx: CanvasRenderingContext2D,
  visible: readonly RigFormation[],
  contact: string,
): void {
  const rings: Array<{ scale: number; alpha: number }> = [
    { scale: 1.15, alpha: 0.1 },
    { scale: 0.8, alpha: 0.16 },
    { scale: 0.5, alpha: 0.22 },
  ];
  for (const ring of rings) {
    ctx.fillStyle = withAlpha(contact, ring.alpha);
    ctx.beginPath();
    for (const f of visible) {
      const c = formationGeometry(f).contact;
      const rx = c.halfWidth * ring.scale;
      const ry = Math.max(10, c.halfWidth * 0.14) * ring.scale;
      ctx.moveTo(c.cx + rx, c.cy);
      ctx.ellipse(c.cx, c.cy, rx, ry, 0, 0, TAU);
    }
    ctx.fill();
  }
}

function paintKelp(
  ctx: CanvasRenderingContext2D,
  visible: readonly RigFormation[],
  palette: ScenePalette,
  zoom: number,
  clockMs: number,
): void {
  ctx.strokeStyle = palette.kelp;
  ctx.lineWidth = Math.max(4.5, 1.5 / zoom);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const t = clockMs / 1000;
  for (const f of visible) {
    for (const frond of formationGeometry(f).fronds) {
      const sway = Math.sin(t * 0.12 * TAU + frond.phase) * (12 + frond.height * 0.07);
      const tipX = frond.baseX + frond.lean + sway;
      const tipY = frond.baseY - frond.height;
      const midX = frond.baseX + frond.lean * 0.4 + sway * 0.35;
      const midY = frond.baseY - frond.height * 0.55;
      ctx.moveTo(frond.baseX, frond.baseY);
      ctx.bezierCurveTo(frond.baseX, frond.baseY - frond.height * 0.3, midX, midY, tipX, tipY);
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX + 16 + sway * 0.2, midY - 26);
      ctx.moveTo((frond.baseX + midX) / 2, (frond.baseY + midY) / 2);
      ctx.lineTo((frond.baseX + midX) / 2 - 15, (frond.baseY + midY) / 2 - 24);
    }
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}
