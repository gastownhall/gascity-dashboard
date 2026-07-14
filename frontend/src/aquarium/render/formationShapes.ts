// Per-rig silhouette geometry. Each rig picks one of four archetypes by seed
// (broad mound / tall spire / scattered cluster / asymmetric ridge) and then
// perturbs every lobe, so no two formations read as the same stamp. Spurs are
// thin rock/coral spikes rising off the crown. Pure data: formations.ts traces
// the returned lobes into cached Path2Ds. Deterministic (seeded PRNG only).

import type { RigFormation } from '../contracts';
import { TAU, type Pt } from './mathUtil';

export interface Lobe {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** 0 = farthest/faintest tone … 2 = nearest/full-pigment tone */
  tone: number;
}

export interface Spur {
  baseX: number;
  baseY: number;
  tipX: number;
  tipY: number;
  width: number;
}

type Rnd = () => number;

export function buildLobes(formation: RigFormation, rnd: Rnd): Lobe[] {
  const archetype = Math.floor(rnd() * 4);
  const r = formation.radius;
  const ax = formation.anchorX;
  const ay = formation.anchorY;
  if (archetype === 0) return mound(ax, ay, r, rnd);
  if (archetype === 1) return spire(ax, ay, r, rnd);
  if (archetype === 2) return cluster(ax, ay, r, rnd);
  return ridge(ax, ay, r, rnd);
}

/** broad, low, rounded — a reef shoulder */
function mound(ax: number, ay: number, r: number, rnd: Rnd): Lobe[] {
  const lobes: Lobe[] = [];
  const back = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < back; i += 1) {
    const rx = r * (0.5 + rnd() * 0.4);
    lobes.push({
      cx: ax + (rnd() * 1.7 - 0.85) * r,
      cy: ay - rx * (0.34 + rnd() * 0.2),
      rx,
      ry: rx * (0.55 + rnd() * 0.3),
      tone: rnd() < 0.5 ? 0 : 1,
    });
  }
  const front = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < front; i += 1) {
    const rx = r * (0.34 + rnd() * 0.3);
    lobes.push({
      cx: ax + (rnd() * 1.5 - 0.75) * r,
      cy: ay - rx * (0.4 + rnd() * 0.2),
      rx,
      ry: rx * (0.6 + rnd() * 0.3),
      tone: 2,
    });
  }
  return lobes;
}

/** tall narrow pinnacle — lobes stacked and shrinking as they rise */
function spire(ax: number, ay: number, r: number, rnd: Rnd): Lobe[] {
  const lobes: Lobe[] = [];
  const lean = (rnd() * 2 - 1) * r * 0.25;
  const steps = 3 + Math.floor(rnd() * 2);
  let rx = r * (0.62 + rnd() * 0.2);
  let cy = ay;
  for (let i = 0; i < steps; i += 1) {
    const t = i / steps;
    lobes.push({
      cx: ax + lean * t + (rnd() * 0.3 - 0.15) * r,
      cy: cy - rx * 0.35,
      rx,
      ry: rx * (0.85 + rnd() * 0.4),
      tone: i === 0 ? 0 : i === 1 ? 1 : 2,
    });
    cy -= rx * (0.9 + rnd() * 0.3);
    rx *= 0.72 + rnd() * 0.1;
  }
  return lobes;
}

/** scattered boulders with gaps a fish can swim through */
function cluster(ax: number, ay: number, r: number, rnd: Rnd): Lobe[] {
  const lobes: Lobe[] = [];
  const count = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < count; i += 1) {
    const spread = ((i + rnd() * 0.6) / count - 0.5) * 2.3 * r;
    const rx = r * (0.28 + rnd() * 0.32);
    lobes.push({
      cx: ax + spread,
      cy: ay - rx * (0.5 + rnd() * 0.5),
      rx,
      ry: rx * (0.7 + rnd() * 0.4),
      tone: i % 3,
    });
  }
  return lobes;
}

/** asymmetric outcrop: tall on one flank, sloping to a low shoulder */
function ridge(ax: number, ay: number, r: number, rnd: Rnd): Lobe[] {
  const lobes: Lobe[] = [];
  const dir = rnd() < 0.5 ? -1 : 1;
  const peaks = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < peaks; i += 1) {
    const t = i / (peaks - 1);
    const rx = r * (0.6 - 0.34 * t) * (0.85 + rnd() * 0.3);
    lobes.push({
      cx: ax + dir * (t - 0.35) * 1.9 * r,
      cy: ay - rx * (0.9 - 0.5 * t),
      rx,
      ry: rx * (0.75 + rnd() * 0.4),
      tone: i === 0 ? 2 : i < peaks - 1 ? 1 : 0,
    });
  }
  return lobes;
}

export function buildSpurs(formation: RigFormation, rnd: Rnd): Spur[] {
  const spurs: Spur[] = [];
  const count = Math.floor(rnd() * 4);
  const r = formation.radius;
  for (let i = 0; i < count; i += 1) {
    const baseX = formation.anchorX + (rnd() * 1.4 - 0.7) * r;
    const baseY = formation.anchorY - r * (0.2 + rnd() * 0.55);
    const h = r * (0.35 + rnd() * 0.55);
    const lean = (rnd() * 2 - 1) * h * 0.35;
    spurs.push({
      baseX,
      baseY,
      tipX: baseX + lean,
      tipY: baseY - h,
      width: r * (0.05 + rnd() * 0.06),
    });
  }
  return spurs;
}

export function blobRing(cx: number, cy: number, rx: number, ry: number, rnd: Rnd): Pt[] {
  const points: Pt[] = [];
  const k = 9;
  for (let j = 0; j < k; j += 1) {
    const angle = (j / k) * TAU;
    const wobble = 0.8 + rnd() * 0.4;
    points.push({ x: cx + Math.cos(angle) * rx * wobble, y: cy + Math.sin(angle) * ry * wobble });
  }
  return points;
}

/** closed quadratic-through-midpoints ring (smooth, cheap) */
export function traceSmoothRing(path: Path2D, ring: readonly Pt[]): void {
  const n = ring.length;
  const first = ring[0];
  const second = ring[1];
  if (first === undefined || second === undefined) return;
  path.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);
  for (let i = 1; i <= n; i += 1) {
    const p = ring[i % n];
    const next = ring[(i + 1) % n];
    if (p === undefined || next === undefined) continue;
    path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  path.closePath();
}
