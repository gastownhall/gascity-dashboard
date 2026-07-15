// Fin and head anchors, built from the spine + hull so appendages stay
// attached under bellyFactor swell, pitch, flip, and x-compression. Pure
// geometry: each fin is an ordered point list the painter smooths into a
// translucent membrane whose ROOT sits on the hull outline (never floating).
// The dorsal is one low rounded sail — deliberately not the twin-spike ridge
// that read as lightning bolts. Re-exported through fishGeometry.ts.

import type { Pt } from './mathUtil';
import { at } from './mathUtil';
import type { FishHull, FishSpine, SpeciesProfile } from './fishGeometry';
import { SPECIES, outlineAt, sampleSpine } from './fishGeometry';

export interface FishFins {
  /** base-fore, sail-fore, sail-aft, base-aft — a single rounded dorsal sail */
  dorsal: readonly Pt[];
  /** root(on hull), leading tip, trailing tip, trail root — near-side wing */
  pectoral: readonly Pt[];
  /** small ventral fin near mid-body */
  pelvic: readonly Pt[];
  /** peduncle-top, upper tip, mid (notch or bulge), lower tip, peduncle-bottom */
  caudal: readonly Pt[];
}

const DEG = Math.PI / 180;

/** Station the caudal fin roots on. Forward of the s=1 tail tip so the fin's
 *  base overlaps the body (which is painted over it), keeping the tail visually
 *  continuous with the flank instead of connecting at the near-zero peduncle. */
const CAUDAL_ROOT_S = 0.86;

export function fishFins(spine: FishSpine, hull: FishHull, swimPhase: number): FishFins {
  const p = SPECIES[spine.species];
  // finClamp is 1 for a spread fish and the pose's clamp fraction when folded;
  // rate-limited clamps hardest (fins pinned to the body), stalled less so
  const fold = spine.attitude.finClamp;
  return {
    dorsal: buildDorsal(spine, hull, p, fold, swimPhase),
    pectoral: buildPectoral(spine, hull, p, fold, swimPhase),
    pelvic: buildVentralFin(spine, hull, p, 0.52, p.pelvicLength, fold, swimPhase + 1.7),
    caudal: buildCaudal(spine, hull, p, fold, swimPhase),
  };
}

/** one low rounded sail: base chord on the dorsal hull line, a single broad
 * hump above it (two near-equal crest points, no valley → no spike read) */
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
  const h = p.dorsalHeight * p.length * fold * (1 + 0.05 * Math.sin(swimPhase * 2));
  const ux = mid.up.x * spine.dorsalSign;
  const uy = mid.up.y * spine.dorsalSign;
  const crest = (t: number, k: number): Pt => ({
    x: baseFore.x + (baseAft.x - baseFore.x) * t + ux * h * k,
    y: baseFore.y + (baseAft.y - baseFore.y) * t + uy * h * k,
  });
  return [baseFore, crest(0.35, 1), crest(0.62, 0.85), baseAft];
}

/** near-side pectoral wing rooted on the flank just behind the head; splays
 * out-and-down when swimming, sweeps back tight when folded */
function buildPectoral(
  spine: FishSpine,
  hull: FishHull,
  p: SpeciesProfile,
  fold: number,
  swimPhase: number,
): Pt[] {
  const s = 0.32;
  const sample = sampleSpine(spine, s);
  const edge = outlineAt(hull.ventral, spine.stations, s);
  const root = lerpPt(sample.p, edge, 0.72);
  const down = { x: -sample.up.x * spine.dorsalSign, y: -sample.up.y * spine.dorsalSign };
  const swept = spine.attitude.finsFolded ? 1.5 : 0.7;
  const flutter = 10 * DEG * spine.attitude.tailBeat * fold * Math.sin(swimPhase);
  const lead = fanTip(
    root,
    sample.toTail,
    down,
    swept,
    flutter,
    p.pectoralLength * p.length * fold,
  );
  const trailLen = p.pectoralLength * p.length * fold * 0.7;
  const back = fanTip(root, sample.toTail, down, swept + 0.9, flutter, trailLen);
  const trailRoot = {
    x: root.x + sample.toTail.x * trailLen * 0.4,
    y: root.y + sample.toTail.y * trailLen * 0.4,
  };
  return [root, lead, back, trailRoot];
}

function fanTip(
  root: Pt,
  toTail: Pt,
  down: Pt,
  tailWeight: number,
  flutter: number,
  len: number,
): Pt {
  const dx = toTail.x * tailWeight + down.x;
  const dy = toTail.y * tailWeight + down.y;
  const a = Math.atan2(dy, dx) + flutter;
  return { x: root.x + Math.cos(a) * len, y: root.y + Math.sin(a) * len };
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
  const root = lerpPt(sample.p, edge, 0.82);
  const down = { x: -sample.up.x * spine.dorsalSign, y: -sample.up.y * spine.dorsalSign };
  const swept = spine.attitude.finsFolded ? 1.4 : 0.85;
  const flutter = 12 * DEG * spine.attitude.tailBeat * fold * Math.sin(swimPhase);
  const len = lengthFrac * p.length * fold;
  const tip = fanTip(root, sample.toTail, down, swept, flutter, len);
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
    p.caudalSpreadDeg * DEG * (1 + 0.25 * Math.sin(swimPhase * 2)) * (0.5 + 0.5 * fold);
  const len = p.caudalLength * p.length * (0.88 + 0.12 * fold);
  const tipAt = (a: number, k: number): Pt => ({
    x: last.x + (td.x * Math.cos(a) - td.y * Math.sin(a)) * len * k,
    y: last.y + (td.x * Math.sin(a) + td.y * Math.cos(a)) * len * k,
  });
  const midLen = p.caudal === 'forked' ? 0.45 : p.caudal === 'rounded' ? 1.12 : 1.0;
  // Root the fin on a chord forward of the tail tip, not on the near-zero-width
  // s=1 peduncle: at s=1 the body has already tapered to a point, so a fin
  // rooted there connects by a pinpoint and reads as a detached shape. Sampling
  // the wider hull outline at CAUDAL_ROOT_S buries the fin's base under the body
  // (the caudal is painted before the body, so the overlap is covered) and the
  // tail emerges continuous with the flank.
  const rootTop = outlineAt(hull.dorsal, spine.stations, CAUDAL_ROOT_S);
  const rootBottom = outlineAt(hull.ventral, spine.stations, CAUDAL_ROOT_S);
  return [rootTop, tipAt(-spread, 1), tipAt(0, midLen), tipAt(spread, 1), rootBottom];
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
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
  /** closed-mouth crease endpoints across the snout front */
  mouthA: Pt;
  mouthB: Pt;
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
  const dir = { x: mdx / ml, y: mdy / ml };
  const px = -dir.y;
  const py = dir.x;
  const lip = p.eyeRadius * p.length * (0.9 + 1.2 * p.noseBlunt);
  const jaw = lerpPt(hull.nose, first, 0.28);
  return {
    eye: lerpPt(eyeSample.p, eyeEdge, 0.42),
    eyeRadius: p.eyeRadius * p.length,
    gillA: lerpPt(gillMidTop, gillTop, 0.6),
    gillB: lerpPt(gillMidBottom, gillBottom, 0.65),
    mouth: hull.nose,
    mouthDir: dir,
    mouthA: { x: jaw.x + px * lip * 0.15, y: jaw.y + py * lip * 0.15 },
    mouthB: { x: jaw.x - px * lip, y: jaw.y - py * lip },
  };
}
