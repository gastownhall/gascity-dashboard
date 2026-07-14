// Fin and head anchors, built from the spine + hull so appendages stay
// attached under bellyFactor swell, pitch, flip, and x-compression. Pure
// geometry: each fin is an ordered point list the painter smooths into a
// translucent membrane. Re-exported through fishGeometry.ts.

import type { Pt } from './mathUtil';
import { at } from './mathUtil';
import type { FishHull, FishSpine, SpeciesProfile } from './fishGeometry';
import { SPECIES, outlineAt, sampleSpine } from './fishGeometry';

export interface FishFins {
  /** base-fore, front peak, back peak, base-aft (along the anatomical back) */
  dorsal: readonly Pt[];
  /** root, tip, trailing root — sweeps back-down from ~30% length */
  pectoral: readonly Pt[];
  /** small ventral fin near mid-body */
  pelvic: readonly Pt[];
  /** peduncle-top, upper tip, mid (notch or bulge), lower tip, peduncle-bottom */
  caudal: readonly Pt[];
}

const DEG = Math.PI / 180;

export function fishFins(spine: FishSpine, hull: FishHull, swimPhase: number): FishFins {
  const p = SPECIES[spine.species];
  const fold = spine.attitude.finsFolded ? 0.3 : 1;
  return {
    dorsal: buildDorsal(spine, hull, p, fold, swimPhase),
    pectoral: buildVentralFin(spine, hull, p, 0.3, p.pectoralLength, fold, swimPhase),
    pelvic: buildVentralFin(spine, hull, p, 0.52, p.pelvicLength, fold, swimPhase + 1.7),
    caudal: buildCaudal(spine, hull, p, fold, swimPhase),
  };
}

function buildDorsal(
  spine: FishSpine,
  hull: FishHull,
  p: SpeciesProfile,
  fold: number,
  swimPhase: number,
): Pt[] {
  const baseFore = outlineAt(hull.dorsal, spine.stations, p.dorsalStart);
  const baseAft = outlineAt(hull.dorsal, spine.stations, p.dorsalEnd);
  const mid = sampleSpine(spine, (p.dorsalStart + p.dorsalEnd) / 2);
  const h = p.dorsalHeight * p.length * fold * (1 + 0.06 * Math.sin(swimPhase * 2));
  const ux = mid.up.x * spine.dorsalSign;
  const uy = mid.up.y * spine.dorsalSign;
  const peakAt = (t: number, k: number): Pt => ({
    x: baseFore.x + (baseAft.x - baseFore.x) * t + ux * h * k,
    y: baseFore.y + (baseAft.y - baseFore.y) * t + uy * h * k,
  });
  return [baseFore, peakAt(0.3, 1), peakAt(0.72, 0.68), baseAft];
}

function buildVentralFin(
  spine: FishSpine,
  hull: FishHull,
  p: SpeciesProfile,
  s: number,
  lengthFrac: number,
  fold: number,
  swimPhase: number,
): Pt[] {
  const sample = sampleSpine(spine, s);
  const edge = outlineAt(hull.ventral, spine.stations, s);
  // root tucked just inside the hull edge so the membrane visibly attaches
  const root = {
    x: sample.p.x + (edge.x - sample.p.x) * 0.8,
    y: sample.p.y + (edge.y - sample.p.y) * 0.8,
  };
  const down = { x: -sample.up.x * spine.dorsalSign, y: -sample.up.y * spine.dorsalSign };
  const flutter = 14 * DEG * spine.attitude.tailBeat * fold * Math.sin(swimPhase);
  const angle = Math.atan2(
    sample.toTail.y * 0.85 + down.y,
    sample.toTail.x * 0.85 + down.x,
  ) + flutter;
  const len = lengthFrac * p.length * fold;
  const tip = { x: root.x + Math.cos(angle) * len, y: root.y + Math.sin(angle) * len };
  const trail = {
    x: root.x + sample.toTail.x * len * 0.5,
    y: root.y + sample.toTail.y * len * 0.5,
  };
  return [root, tip, trail];
}

function buildCaudal(
  spine: FishSpine,
  hull: FishHull,
  p: SpeciesProfile,
  fold: number,
  swimPhase: number,
): Pt[] {
  const n = spine.points.length;
  const last = at(spine.points, n - 1);
  const prev = at(spine.points, n - 2);
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const dl = Math.hypot(dx, dy) || 1;
  const td = { x: dx / dl, y: dy / dl };
  const spread =
    p.caudalSpreadDeg * DEG * (1 + 0.25 * Math.sin(swimPhase * 2)) * (0.45 + 0.55 * fold);
  const len = p.caudalLength * p.length * (0.85 + 0.15 * fold);
  const tipAt = (a: number, k: number): Pt => ({
    x: last.x + (td.x * Math.cos(a) - td.y * Math.sin(a)) * len * k,
    y: last.y + (td.x * Math.sin(a) + td.y * Math.cos(a)) * len * k,
  });
  const midLen = p.caudal === 'forked' ? 0.45 : p.caudal === 'rounded' ? 1.12 : 1.0;
  return [
    at(hull.dorsal, n - 1),
    tipAt(-spread, 1),
    tipAt(0, midLen),
    tipAt(spread, 1),
    at(hull.ventral, n - 1),
  ];
}

// ---------------------------------------------------------------------------
// Head anchors (eye, gill line, mouth)

export interface FishHead {
  eye: Pt;
  eyeRadius: number;
  /** gill crease endpoints, dorsal-ish → ventral-ish behind the head */
  gillA: Pt;
  gillB: Pt;
  /** mouth anchor at the nose tip and its outward direction */
  mouth: Pt;
  mouthDir: Pt;
}

export function fishHead(spine: FishSpine, hull: FishHull): FishHead {
  const p = SPECIES[spine.species];
  const eyeSample = sampleSpine(spine, 0.1);
  const eyeEdge = outlineAt(hull.dorsal, spine.stations, 0.1);
  const gillTop = outlineAt(hull.dorsal, spine.stations, 0.2);
  const gillBottom = outlineAt(hull.ventral, spine.stations, 0.24);
  const gillMidTop = sampleSpine(spine, 0.2).p;
  const gillMidBottom = sampleSpine(spine, 0.24).p;
  const first = at(spine.points, 0);
  const mdx = hull.nose.x - first.x;
  const mdy = hull.nose.y - first.y;
  const ml = Math.hypot(mdx, mdy) || 1;
  return {
    eye: {
      x: eyeSample.p.x + (eyeEdge.x - eyeSample.p.x) * 0.45,
      y: eyeSample.p.y + (eyeEdge.y - eyeSample.p.y) * 0.45,
    },
    eyeRadius: p.eyeRadius * p.length,
    gillA: {
      x: gillMidTop.x + (gillTop.x - gillMidTop.x) * 0.6,
      y: gillMidTop.y + (gillTop.y - gillMidTop.y) * 0.6,
    },
    gillB: {
      x: gillMidBottom.x + (gillBottom.x - gillMidBottom.x) * 0.65,
      y: gillMidBottom.y + (gillBottom.y - gillMidBottom.y) * 0.65,
    },
    mouth: hull.nose,
    mouthDir: { x: mdx / ml, y: mdy / ml },
  };
}
