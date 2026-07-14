// Procedural rig formations: layered rounded-blob rock/coral clusters in 2–3
// depth tones, kelp fronds with slow clock sway, and a sunken-pellet shelf.
// Silhouettes are seed-deterministic (same rig, same shape, every session)
// and cached as world-space Path2D per tone so a frame costs three fills.

import type { RigFormation, ScenePalette } from '../contracts';
import { CITY_KEY, WORLD } from '../contracts';
import { hash01, mulberry32 } from './hash';
import type { ViewRect } from './layers';
import { TAU, at, type Pt } from './mathUtil';
import { mixOklch, withAlpha } from './oklch';

const TONE_COUNT = 3;

interface Frond {
  baseX: number;
  baseY: number;
  height: number;
  lean: number;
  phase: number;
}

interface FormationGeometry {
  tonePaths: readonly Path2D[];
  edgePath: Path2D;
  shelf: { x: number; y: number; width: number; height: number };
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
  const r = formation.radius;
  const tonePaths = [new Path2D(), new Path2D(), new Path2D()];
  const edgePath = new Path2D();
  const counts = [2, 2 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2)];
  for (let tone = 0; tone < TONE_COUNT; tone += 1) {
    const path = at(tonePaths, tone);
    for (let b = 0; b < at(counts, tone); b += 1) {
      const spreadX = (rnd() * 1.6 - 0.8) * r;
      const rx = r * (0.34 + rnd() * 0.3) * (tone === 0 ? 1.25 : 1);
      const ry = rx * (0.62 + rnd() * 0.5) * (tone === 0 ? 1.2 : 1);
      const cx = formation.anchorX + spreadX;
      const cy = formation.anchorY - ry * (0.4 + rnd() * 0.25);
      const ring = blobRing(cx, cy, rx, ry, rnd);
      traceSmoothRing(path, ring);
      if (tone === TONE_COUNT - 1) traceSmoothRing(edgePath, ring);
    }
  }
  const shelfWidth = r * 1.9;
  return {
    tonePaths,
    edgePath,
    shelf: {
      x: formation.anchorX - shelfWidth / 2,
      y: formation.anchorY - 7,
      width: shelfWidth,
      height: 16,
    },
    fronds: buildFronds(formation, rnd),
    cullLeft: formation.anchorX - r * 1.6,
    cullRight: formation.anchorX + r * 1.6,
  };
}

function blobRing(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rnd: () => number,
): Pt[] {
  const points: Pt[] = [];
  const k = 9;
  for (let j = 0; j < k; j += 1) {
    const angle = (j / k) * TAU;
    const wobble = 0.82 + rnd() * 0.36;
    points.push({
      x: cx + Math.cos(angle) * rx * wobble,
      y: cy + Math.sin(angle) * ry * wobble,
    });
  }
  return points;
}

/** closed quadratic-through-midpoints ring (smooth, cheap) */
function traceSmoothRing(path: Path2D, ring: readonly Pt[]): void {
  const n = ring.length;
  const first = at(ring, 0);
  const second = at(ring, 1);
  path.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);
  for (let i = 1; i <= n; i += 1) {
    const p = at(ring, i % n);
    const next = at(ring, (i + 1) % n);
    path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  path.closePath();
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
  shelf: string;
  edge: string;
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
    shelf: mixOklch(palette.formationEdge, palette.formation, 0.35),
    edge: withAlpha(palette.formationEdge, 0.85),
  };
  colorCache.set(palette, built);
  return built;
}

/** Mid-layer transform must be installed. Batches all visible formations
 * into one fill per depth tone, one edge stroke, one kelp stroke. */
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
  for (let tone = 0; tone < TONE_COUNT; tone += 1) {
    ctx.fillStyle = at(colors.tones, tone);
    for (const f of visible) ctx.fill(at(formationGeometry(f).tonePaths, tone));
  }
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 1.25 / zoom;
  for (const f of visible) ctx.stroke(formationGeometry(f).edgePath);
  ctx.fillStyle = colors.shelf;
  ctx.beginPath();
  for (const f of visible) {
    const s = formationGeometry(f).shelf;
    ctx.rect(s.x, s.y, s.width, s.height);
  }
  ctx.fill();
  paintKelp(ctx, visible, palette, zoom, clockMs);
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
      // two short blades off the upper stem
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX + 16 + sway * 0.2, midY - 26);
      ctx.moveTo((frond.baseX + midX) / 2, (frond.baseY + midY) / 2);
      ctx.lineTo((frond.baseX + midX) / 2 - 15, (frond.baseY + midY) / 2 - 24);
    }
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

const FAR_MOUND_COUNT = 5;

/** Distant seabed dunes in pure haze tone (licensed ambience — nothing rig-,
 * fish-, or pellet-shaped). Far layer must be installed. */
export function paintFarHaze(
  ctx: CanvasRenderingContext2D,
  palette: ScenePalette,
  view: ViewRect,
): void {
  ctx.fillStyle = palette.hazeFar;
  ctx.beginPath();
  for (let i = 0; i < FAR_MOUND_COUNT; i += 1) {
    const cx = (0.06 + (i + hash01(i * 13 + 1) * 0.5) / FAR_MOUND_COUNT) * WORLD.width;
    const rx = 380 + hash01(i * 29 + 2) * 420;
    const ry = 130 + hash01(i * 31 + 4) * 150;
    const cy = WORLD.seabedY + 90;
    if (cx + rx < view.left || cx - rx > view.right) continue;
    ctx.moveTo(cx + rx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  }
  ctx.fill();
}
