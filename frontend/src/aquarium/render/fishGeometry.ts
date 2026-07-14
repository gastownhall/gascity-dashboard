// Pure spine-based fish construction. No canvas here: everything returns
// geometry in fish-local coordinates (origin at body center, nose toward +x,
// canvas convention y-down, dorsal at −y for an upright fish). The painter
// owns placement (heading/mirror) and pixels.
//
// Construction: a 5–6 point spine nose→tail carries a traveling swim-cycle
// wave whose amplitude grows toward the tail; at cruising tail-beat the wave
// bows the whole body into a readable S even in a single still frame (head
// leading, tail trailing in phase). The hull is a closed Catmull-Rom bezier
// ring built from per-station dorsal/ventral half-widths (nose taper, deep
// mid-body, narrow caudal peduncle) so the caudal fin roots on a real
// peduncle. Attitude (pose) is baked into the geometry: pitch, belly-up flip,
// x-compression, fin fold.

import type { FishSpecies } from '../contracts';
import type { FishAttitude } from './fishAttitude';
import { TAU, at, clamp, clamp01, type Pt } from './mathUtil';

export type CaudalKind = 'forked' | 'rounded' | 'broad';

export interface SpeciesProfile {
  /** body length, world units */
  length: number;
  /** spine stations s ∈ [0,1], nose→tail; one per spine point */
  stations: readonly number[];
  /** dorsal half-width at each station, fraction of length */
  dorsalWidths: readonly number[];
  /** ventral half-width at each station, fraction of length */
  ventralWidths: readonly number[];
  tailFrequencyHz: number;
  /** lateral wave amplitude at the tail, fraction of length */
  tailAmplitude: number;
  /** world units/second that reads as speedFactor 1 */
  cruiseSpeed: number;
  caudal: CaudalKind;
  /** caudal fin length beyond the peduncle, fraction of length */
  caudalLength: number;
  /** caudal fan half-spread, degrees */
  caudalSpreadDeg: number;
  dorsalStart: number;
  dorsalEnd: number;
  /** dorsal fin height, fraction of length */
  dorsalHeight: number;
  pectoralLength: number;
  pelvicLength: number;
  /** eye radius, fraction of length */
  eyeRadius: number;
  /** 0 = pointed snout … 1 = blunt heavy head (grouper lips) */
  noseBlunt: number;
}

export const SPECIES: Record<FishSpecies, SpeciesProfile> = {
  pool: {
    length: 55,
    stations: [0, 0.25, 0.5, 0.75, 1],
    dorsalWidths: [0.03, 0.088, 0.1, 0.055, 0.016],
    ventralWidths: [0.03, 0.1, 0.118, 0.06, 0.016],
    tailFrequencyHz: 2.3,
    tailAmplitude: 0.14,
    cruiseSpeed: 90,
    caudal: 'forked',
    caudalLength: 0.26,
    caudalSpreadDeg: 28,
    dorsalStart: 0.3,
    dorsalEnd: 0.56,
    dorsalHeight: 0.085,
    pectoralLength: 0.15,
    pelvicLength: 0.08,
    eyeRadius: 0.04,
    noseBlunt: 0.15,
  },
  role: {
    length: 85,
    stations: [0, 0.25, 0.5, 0.75, 1],
    dorsalWidths: [0.04, 0.125, 0.15, 0.076, 0.022],
    ventralWidths: [0.04, 0.14, 0.175, 0.084, 0.022],
    tailFrequencyHz: 1.5,
    tailAmplitude: 0.12,
    cruiseSpeed: 65,
    caudal: 'rounded',
    caudalLength: 0.21,
    caudalSpreadDeg: 18,
    dorsalStart: 0.26,
    dorsalEnd: 0.62,
    dorsalHeight: 0.11,
    pectoralLength: 0.17,
    pelvicLength: 0.09,
    eyeRadius: 0.037,
    noseBlunt: 0.35,
  },
  grouper: {
    length: 160,
    stations: [0, 0.2, 0.4, 0.6, 0.8, 1],
    dorsalWidths: [0.07, 0.15, 0.178, 0.152, 0.075, 0.026],
    ventralWidths: [0.07, 0.165, 0.2, 0.172, 0.082, 0.026],
    tailFrequencyHz: 0.85,
    tailAmplitude: 0.09,
    cruiseSpeed: 40,
    caudal: 'broad',
    caudalLength: 0.2,
    caudalSpreadDeg: 24,
    dorsalStart: 0.28,
    dorsalEnd: 0.76,
    dorsalHeight: 0.1,
    pectoralLength: 0.21,
    pelvicLength: 0.1,
    eyeRadius: 0.03,
    noseBlunt: 0.8,
  },
};

// ---------------------------------------------------------------------------
// Spine

export interface FishSpine {
  species: FishSpecies;
  /** nose→tail, attitude-transformed, fish-local coordinates */
  points: readonly Pt[];
  stations: readonly number[];
  /** −1 when belly-up: anatomical dorsal offsets point geometrically down */
  dorsalSign: 1 | -1;
  attitude: FishAttitude;
}

/** phase lag from nose to tail (radians) — just over a half wave, so a still
 * frame lands on an S (front and back bow opposite ways), not a bland C */
const BODY_WAVE_RAD = 3.2;

/** tailPhase = phase + clockMs·frequency (the swim-cycle clock for one fish) */
export function swimPhaseFor(species: FishSpecies, phase: number, clockMs: number): number {
  return phase + (clockMs / 1000) * SPECIES[species].tailFrequencyHz * TAU;
}

/** normalize kinematic speed against species cruise speed, clamped 0..2 */
export function speedFactorFor(species: FishSpecies, speed: number): number {
  return clamp(speed / SPECIES[species].cruiseSpeed, 0, 2);
}

export function fishSpine(
  species: FishSpecies,
  attitude: FishAttitude,
  swimPhase: number,
  speedFactor: number,
): FishSpine {
  const p = SPECIES[species];
  const beat = clamp(speedFactor, 0, 2);
  const amp = p.tailAmplitude * p.length * attitude.tailBeat * (0.5 + 0.6 * Math.min(beat, 1.5));
  const rot = -attitude.pitch;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const flip = attitude.flipVertical ? -1 : 1;
  const points = p.stations.map((s) => {
    const x = (0.5 - s) * p.length * attitude.xScale;
    const envelope = 0.12 + 0.88 * s * s;
    const y = amp * envelope * Math.sin(swimPhase - s * BODY_WAVE_RAD);
    return { x: x * cos - y * sin, y: flip * (x * sin + y * cos) };
  });
  return {
    species,
    points,
    stations: p.stations,
    dorsalSign: attitude.flipVertical ? -1 : 1,
    attitude,
  };
}

// ---------------------------------------------------------------------------
// Hull

export interface BezierSeg {
  from: Pt;
  cp1: Pt;
  cp2: Pt;
  to: Pt;
}

export interface FishHull {
  /** closed smooth outline: segments[i].to === segments[i+1].from, ring closed */
  segments: readonly BezierSeg[];
  /** ring vertices the segments interpolate (nose, dorsal…, tail, ventral…) */
  ring: readonly Pt[];
  /** per-station outline points, nose→tail */
  dorsal: readonly Pt[];
  ventral: readonly Pt[];
  /** nose tip, slightly ahead of the first spine point */
  nose: Pt;
  /** caudal peduncle center (last spine point) */
  tail: Pt;
}

/** context_pct → mid-body swell: 1 + 0.5·pct/100; indeterminate stays slim. */
export function bellyFactorFromPct(pct: number | undefined): number {
  return pct === undefined ? 1 : 1 + (0.5 * clamp(pct, 0, 100)) / 100;
}

/** smooth mid-body bump, 0 at nose/tail, 1 near s≈0.5 */
function bellyBulge(s: number): number {
  const t = clamp01((s - 0.12) / 0.76);
  const w = Math.sin(Math.PI * t);
  return w * w;
}

/** unit normals pointing to the geometric −y (up) side of the spine */
function upNormals(points: readonly Pt[]): Pt[] {
  return points.map((_, i) => {
    const a = at(points, Math.max(0, i - 1));
    const b = at(points, Math.min(points.length - 1, i + 1));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  });
}

export function fishHull(spine: FishSpine, species: FishSpecies, bellyFactor: number): FishHull {
  const p = SPECIES[species];
  const L = p.length;
  const ns = upNormals(spine.points);
  const sign = spine.dorsalSign;
  const dorsal: Pt[] = [];
  const ventral: Pt[] = [];
  for (let i = 0; i < spine.points.length; i += 1) {
    const pt = at(spine.points, i);
    const n = at(ns, i);
    const bulge = bellyBulge(at(spine.stations, i)) * (bellyFactor - 1);
    const dw = L * at(p.dorsalWidths, i) * (1 + 0.35 * bulge);
    const vw = L * at(p.ventralWidths, i) * (1 + bulge);
    dorsal.push({ x: pt.x + n.x * dw * sign, y: pt.y + n.y * dw * sign });
    ventral.push({ x: pt.x - n.x * vw * sign, y: pt.y - n.y * vw * sign });
  }
  const nose = noseTip(spine, p);
  const tail = at(spine.points, spine.points.length - 1);
  const ring = [nose, ...dorsal, tail, ...[...ventral].reverse()];
  return { segments: closedBezierRing(ring), ring, dorsal, ventral, nose, tail };
}

function noseTip(spine: FishSpine, p: SpeciesProfile): Pt {
  const first = at(spine.points, 0);
  const second = at(spine.points, 1);
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const len = Math.hypot(dx, dy) || 1;
  // blunter species extend less beyond the (already wide) head stations
  const noseLen = p.length * (0.05 - 0.032 * p.noseBlunt);
  return { x: first.x + (dx / len) * noseLen, y: first.y + (dy / len) * noseLen };
}

/** closed Catmull-Rom → cubic bezier ring through the given vertices */
export function closedBezierRing(ring: readonly Pt[]): BezierSeg[] {
  const n = ring.length;
  const segs: BezierSeg[] = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = at(ring, (i - 1 + n) % n);
    const p1 = at(ring, i);
    const p2 = at(ring, (i + 1) % n);
    const p3 = at(ring, (i + 2) % n);
    segs.push({
      from: p1,
      cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: p2,
    });
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Sampling helpers (fins/head attach at arbitrary stations)

export interface SpineSample {
  p: Pt;
  /** unit normal toward geometric −y side (multiply by dorsalSign for anatomy) */
  up: Pt;
  /** unit tangent pointing toward the tail */
  toTail: Pt;
}

export function sampleSpine(spine: FishSpine, s: number): SpineSample {
  const { i, t } = bracket(spine.stations, s);
  const a = at(spine.points, i);
  const b = at(spine.points, i + 1);
  const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    p,
    up: { x: -dy / len, y: dx / len },
    toTail: { x: dx / len, y: dy / len },
  };
}

/** piecewise-linear outline point at station s (dorsal or ventral side) */
export function outlineAt(points: readonly Pt[], stations: readonly number[], s: number): Pt {
  const { i, t } = bracket(stations, s);
  const a = at(points, i);
  const b = at(points, i + 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bracket(stations: readonly number[], s: number): { i: number; t: number } {
  const sc = clamp01(s);
  for (let i = 0; i < stations.length - 2; i += 1) {
    if (sc <= at(stations, i + 1)) {
      const s0 = at(stations, i);
      const s1 = at(stations, i + 1);
      return { i, t: (sc - s0) / (s1 - s0) };
    }
  }
  const i = stations.length - 2;
  const s0 = at(stations, i);
  const s1 = at(stations, i + 1);
  return { i, t: (sc - s0) / (s1 - s0) };
}

export { attitudeForPose } from './fishAttitude';
export type { FishAttitude, EyeStyle } from './fishAttitude';
export { fishFins, fishHead } from './fishFins';
export type { FishFins, FishHead } from './fishFins';
