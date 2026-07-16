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
  buildPolyps,
  buildSpeckle,
  buildSpurs,
  blobRing,
  traceSmoothRing,
} from './formationShapes';
import type { Pt } from './mathUtil';
import type { CoralAccents } from './coralColor';
import { coralAccentsForSeed } from './coralColor';
import type { FormationDepth } from './depth';
import { formationDepth } from './depth';
import { mulberry32 } from './hash';
import type { LayerTransform, ViewRect } from './layers';
import { applyLayer } from './layers';
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
  /** outer branch tips — anemone-like colored accents bloom here */
  coralTips: readonly Pt[];
  /** scattered polyps on the front lobes — reef-color dabs across the mass */
  coralPolyps: readonly Pt[];
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
  const branches = buildBranches(formation, rnd);
  for (const seg of branches.segs) {
    coralPath.moveTo(seg.x1, seg.y1);
    coralPath.lineTo(seg.x2, seg.y2);
  }
  return {
    tonePaths,
    edgePath,
    coralPath,
    coralTips: branches.tips,
    coralPolyps: buildPolyps(lobes, rnd),
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
    speckleLight: withAlpha(adjustL(palette.formation, 13), 0.5),
    speckleDark: withAlpha(adjustL(palette.formationEdge, -6), 0.42),
  };
  colorCache.set(palette, built);
  return built;
}

/** Renders the visible formations back-to-front by depth: far reefs draw
 * SMALLER, hazier, and lifted up the seabed (receding background reef), near
 * reefs at full pigment and size — so the reef reads as a volume, not one flat
 * row. Depth is a deterministic hash of each reef's seed (depth.ts), stable
 * per rig and independent of any positional change the sim makes. Rendered
 * ONCE into the static offscreen cache, so the per-formation transforms and
 * state changes here never touch the per-frame hot path. Pass the installed
 * mid-layer transform; each reef composes its own depth transform onto it. */
export function paintFormations(
  ctx: CanvasRenderingContext2D,
  formations: readonly RigFormation[],
  palette: ScenePalette,
  mid: LayerTransform,
  view: ViewRect,
  clockMs: number,
): void {
  const base = formationColors(palette);
  const visible = formations.filter((f) => f.key !== CITY_KEY && withinView(f, view));
  if (visible.length === 0) {
    applyLayer(ctx, mid);
    return;
  }
  visible.sort((a, b) => formationDepth(a.seed).z - formationDepth(b.seed).z);
  for (const f of visible) {
    const depth = formationDepth(f.seed);
    const t = depthTransform(mid, f, depth);
    applyLayer(ctx, t);
    const colors = hazedForSeed(palette, base, f.seed, depth.haze);
    const accents = coralAccentsForSeed(palette, f.seed, depth.haze);
    paintOneFormation(ctx, f, colors, accents, t.scale, palette, depth.haze, clockMs);
  }
  applyLayer(ctx, mid);
}

// hazed colors are seed-deterministic; cache them so repeated re-bakes (the
// camera workout triggers many) never re-run the mixOklch parse/format.
const hazedCache = new WeakMap<ScenePalette, Map<number, FormationColors>>();

function hazedForSeed(
  palette: ScenePalette,
  base: FormationColors,
  seed: number,
  haze: number,
): FormationColors {
  let bySeed = hazedCache.get(palette);
  if (bySeed === undefined) {
    bySeed = new Map();
    hazedCache.set(palette, bySeed);
  }
  const hit = bySeed.get(seed);
  if (hit !== undefined) return hit;
  const built = hazeFormationColors(base, palette.hazeFar, haze);
  bySeed.set(seed, built);
  return built;
}

function withinView(f: RigFormation, view: ViewRect): boolean {
  const g = formationGeometry(f);
  return g.cullRight >= view.left && g.cullLeft <= view.right;
}

/** mid layer composed with scale-about-anchor + upward lift for this reef's
 * depth: screen = (mid.scale·s)·P + (anchor·(1−s) − lift)·mid.scale + mid.t */
function depthTransform(
  mid: LayerTransform,
  f: RigFormation,
  depth: FormationDepth,
): LayerTransform {
  const s = depth.scale;
  return {
    scale: mid.scale * s,
    tx: f.anchorX * (1 - s) * mid.scale + mid.tx,
    ty: (f.anchorY * (1 - s) - depth.lift) * mid.scale + mid.ty,
    dpr: mid.dpr,
  };
}

/** Atmospheric perspective: blend a reef's pigments toward the far water so a
 * background reef desaturates into the haze instead of reading as full-pigment
 * rock shrunk in place. The contact shadow is left alone (it is a darkening,
 * not a pigment). */
function hazeFormationColors(
  base: FormationColors,
  hazeFar: string,
  haze: number,
): FormationColors {
  if (haze <= 0) return base;
  const mix = (c: string): string => mixOklch(c, hazeFar, haze);
  return {
    tones: [mix(at(base.tones, 0)), mix(at(base.tones, 1)), mix(at(base.tones, 2))],
    edge: mix(base.edge),
    contact: base.contact,
    speckleLight: mix(base.speckleLight),
    speckleDark: mix(base.speckleDark),
  };
}

/** One reef under its own depth transform: contact shadow, tone fills,
 * speckle, edge, coral, kelp. `effScale` is the reef's effective screen scale
 * (mid.scale·depthScale) so css-px line/speckle sizes stay constant. */
function paintOneFormation(
  ctx: CanvasRenderingContext2D,
  f: RigFormation,
  colors: FormationColors,
  accents: CoralAccents,
  effScale: number,
  palette: ScenePalette,
  haze: number,
  clockMs: number,
): void {
  const g = formationGeometry(f);
  paintContactShadow(ctx, g, colors.contact);
  for (let tone = 0; tone < TONE_COUNT; tone += 1) {
    ctx.fillStyle = at(colors.tones, tone);
    ctx.fill(at(g.tonePaths, tone));
  }
  paintSpeckleOne(ctx, g, colors, effScale);
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 1.25 / effScale;
  ctx.lineJoin = 'round';
  ctx.stroke(g.edgePath);
  ctx.strokeStyle = accents.branch;
  ctx.lineWidth = Math.max(3.5, 0.06 * f.radius);
  ctx.lineCap = 'round';
  ctx.stroke(g.coralPath);
  ctx.lineCap = 'butt';
  paintCoralAccentsOne(ctx, g, accents, f.radius);
  paintKelpOne(ctx, g, palette, haze, effScale, clockMs);
}

/** Two-tone reef-color dots at the coral tips + polyps: an outer accent ring
 * with a small brighter core, dabbed in the formation's seed-varied hue so the
 * reef carries pink/orange/violet accent color across the mass. Baked. Tips
 * bloom larger (anemone heads); polyps are small studs on the rock crown. */
function paintCoralAccentsOne(
  ctx: CanvasRenderingContext2D,
  g: FormationGeometry,
  accents: CoralAccents,
  radius: number,
): void {
  const tipR = Math.max(4, 0.05 * radius);
  const polypR = Math.max(2.6, 0.028 * radius);
  const dab = (pts: readonly Pt[], r: number): void => {
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fill();
  };
  ctx.fillStyle = accents.polyp;
  dab(g.coralTips, tipR);
  dab(g.coralPolyps, polypR);
  ctx.fillStyle = accents.polypCore;
  dab(g.coralTips, tipR * 0.42);
  dab(g.coralPolyps, polypR * 0.42);
}

const CONTACT_RINGS: ReadonlyArray<{ scale: number; alpha: number }> = [
  { scale: 1.15, alpha: 0.1 },
  { scale: 0.8, alpha: 0.16 },
  { scale: 0.5, alpha: 0.22 },
];

/** soft ambient-occlusion darkening at the rock/seabed contact: nested flat
 * ellipses (darkest tight, faint wide) — no gradient, cheap, deterministic */
function paintContactShadow(
  ctx: CanvasRenderingContext2D,
  g: FormationGeometry,
  contact: string,
): void {
  const c = g.contact;
  for (const ring of CONTACT_RINGS) {
    ctx.fillStyle = withAlpha(contact, ring.alpha);
    const rx = c.halfWidth * ring.scale;
    const ry = Math.max(10, c.halfWidth * 0.14) * ring.scale;
    ctx.beginPath();
    ctx.moveTo(c.cx + rx, c.cy);
    ctx.ellipse(c.cx, c.cy, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
}

/** Two grain passes (light + dark mineral ticks) so rock reads as textured
 * stone without introducing unlabelled pellet-shaped dots. */
function paintSpeckleOne(
  ctx: CanvasRenderingContext2D,
  g: FormationGeometry,
  colors: FormationColors,
  effScale: number,
): void {
  const half = Math.max(1.8, 3 / effScale);
  const passes: ReadonlyArray<[string, readonly Pt[]]> = [
    [colors.speckleDark, g.speckle.dark],
    [colors.speckleLight, g.speckle.light],
  ];
  for (const [color, pts] of passes) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 1.2 / effScale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const p of pts) {
      const lean = Math.sin(p.x * 0.013 + p.y * 0.019) * half * 0.7;
      ctx.moveTo(p.x - half, p.y - lean);
      ctx.lineTo(p.x + half, p.y + lean);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function paintKelpOne(
  ctx: CanvasRenderingContext2D,
  g: FormationGeometry,
  palette: ScenePalette,
  haze: number,
  effScale: number,
  clockMs: number,
): void {
  ctx.strokeStyle = haze > 0 ? mixOklch(palette.kelp, palette.hazeFar, haze) : palette.kelp;
  ctx.lineWidth = Math.max(4.5, 1.5 / effScale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const t = clockMs / 1000;
  for (const frond of g.fronds) {
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
  ctx.stroke();
  ctx.lineCap = 'butt';
}
