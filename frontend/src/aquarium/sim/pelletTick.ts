// Per-pellet, per-frame kinematics update. Position is purely a function of
// pellet state + its formation/holder — deterministic, id-hash seeded.

import type { FishKinematics, PelletKinematics, PelletState } from '../contracts';
import { hashRange } from '../derive/hash';
import {
  MOUTH_OFFSET_WU,
  PELLET_AGE_Y_JITTER_WU,
  PELLET_DROP_FOLLOW_TC_S,
  PELLET_DROP_START_Y,
  PELLET_FRESH_Y,
  PELLET_STALE_Y,
} from './constants';

export { MOUTH_OFFSET_WU };

const TAU = Math.PI * 2;
const DRIFT_BOB_AMPLITUDE_WU = 10;
const DRIFT_BOB_PERIOD_MS = 3400;
// A held pellet tracks its holder's mouth, but the holder is a working fish
// doing boids — its heading + position twitch every frame, and snapping the
// pellet exactly onto the mouth each tick makes the bead jitter. Damp toward
// the mouth with a short time constant instead (frame-rate independent), so
// the pellet follows smoothly and filters the high-frequency shoal jitter.
const HELD_FOLLOW_TIME_CONSTANT_S = 0.11;
/** Fallback gulp duration for a defensively-malformed 'eaten' pellet with no
 * gulpMsLeft (never emitted this way by derive/eating.ts, but sim must not
 * divide-by/compare against undefined). */
const DEFAULT_GULP_MS = 1200;

export interface FormationAnchor {
  x: number;
  y: number;
  radius: number;
}

export interface PelletTickInputs {
  beadId: string;
  state: PelletState;
  formationAnchor: FormationAnchor;
  /** resolved holder's kinematics (held/eaten), previous tick — undefined
   * when the pellet has no resolved holder. */
  holderKin: FishKinematics | undefined;
  prevKin: PelletKinematics | undefined;
  /** entity.gulpMsLeft, eaten only. */
  gulpMsLeft: number | undefined;
  /** bead age 0..1 — drives a drifting bead's height (fresh high, stale low). */
  ageFraction: number;
  /** newly-arrived open bead: falls in from the surface, then eases to height. */
  arriving: boolean;
  seed: number;
  clockMs: number;
  dtS: number;
}

export function tickPellet(inputs: PelletTickInputs): PelletKinematics {
  switch (inputs.state) {
    case 'held':
      return atMouth(inputs, mouthPhase(inputs.seed));
    case 'orphaned':
      return sunkenPosition(inputs);
    case 'sunken':
      return sunkenPosition(inputs);
    case 'drifting':
      return driftingPosition(inputs);
    case 'eaten':
      return eatenPosition(inputs);
  }
}

function mouthPhase(seed: number): number {
  return hashRange(seed, 0, TAU);
}

/** Forward of the holder's mouth along its heading; falls back to a
 * formation-crest point when the holder is unresolved (a stale assignee
 * with no matching live session — pellets.ts already leaves fishId
 * undefined for that case, this is its rendering-side counterpart). */
function atMouth(inputs: PelletTickInputs, phase: number): PelletKinematics {
  if (inputs.holderKin === undefined) return crestPoint(inputs.formationAnchor, inputs.seed, phase);
  const h = inputs.holderKin;
  const targetX = h.x + Math.cos(h.heading) * MOUTH_OFFSET_WU;
  const targetY = h.y + Math.sin(h.heading) * MOUTH_OFFSET_WU;
  // First frame (no prev) snaps to the mouth; afterward, exponentially damp
  // toward it so the bead does not twitch with the holder's shoal jitter.
  if (inputs.prevKin === undefined) return { x: targetX, y: targetY, phase };
  const alpha = 1 - Math.exp(-inputs.dtS / HELD_FOLLOW_TIME_CONSTANT_S);
  return {
    x: inputs.prevKin.x + (targetX - inputs.prevKin.x) * alpha,
    y: inputs.prevKin.y + (targetY - inputs.prevKin.y) * alpha,
    phase,
  };
}

function crestPoint(anchor: FormationAnchor, seed: number, phase: number): PelletKinematics {
  return {
    x: anchor.x + hashRange(seed, -anchor.radius, anchor.radius) * 0.5,
    y: anchor.y - anchor.radius * hashRange(seed + 1, 0.4, 0.8),
    phase,
  };
}

/** Fixed, hash-derived point on the seabed under the formation — a function
 * of (seed, anchor) only, so it is identical every tick with no need to
 * carry state through prevKin. */
function sunkenPosition(inputs: PelletTickInputs): PelletKinematics {
  const anchor = inputs.formationAnchor;
  return {
    x: anchor.x + hashRange(inputs.seed, -anchor.radius * 0.8, anchor.radius * 0.8),
    y: anchor.y,
    phase: mouthPhase(inputs.seed),
  };
}

/** Open food drifts in the mid-water column, spread across the formation width,
 * its HEIGHT carrying bead age: fresh floats high, stale sinks toward (but stays
 * above) the seabed. A newly-created bead falls in from the surface and eases
 * down to its age height (feeding drop-in). Well above the formation crest for
 * every rig, so open food never blurs with the blocked beads settled ON it. */
function driftingPosition(inputs: PelletTickInputs): PelletKinematics {
  const anchor = inputs.formationAnchor;
  const phase = mouthPhase(inputs.seed);
  const baseX = anchor.x + hashRange(inputs.seed + 2, -anchor.radius, anchor.radius) * 0.9;
  const ageY =
    PELLET_FRESH_Y +
    (PELLET_STALE_Y - PELLET_FRESH_Y) * inputs.ageFraction +
    hashRange(inputs.seed + 3, -PELLET_AGE_Y_JITTER_WU, PELLET_AGE_Y_JITTER_WU);
  const bob =
    Math.sin((inputs.clockMs / DRIFT_BOB_PERIOD_MS) * TAU + phase) * DRIFT_BOB_AMPLITUDE_WU;
  const settledY = ageY + bob;
  if (inputs.arriving) {
    // spawn at the surface, then exponentially fall toward the age height.
    if (inputs.prevKin === undefined) return { x: baseX, y: PELLET_DROP_START_Y, phase };
    const alpha = 1 - Math.exp(-inputs.dtS / PELLET_DROP_FOLLOW_TC_S);
    return { x: baseX, y: inputs.prevKin.y + (settledY - inputs.prevKin.y) * alpha, phase };
  }
  return { x: baseX, y: settledY, phase };
}

/** At the holder's mouth (or its last-known position, if the holder is
 * unresolved) while the gulp plays. `phase` accumulates elapsed ms since
 * first observed as eaten (see module doc below), capped at gulpMsLeft —
 * the render layer computes gulp progress as phase / entity.gulpMsLeft. */
function eatenPosition(inputs: PelletTickInputs): PelletKinematics {
  const gulpMs = inputs.gulpMsLeft ?? DEFAULT_GULP_MS;
  const elapsedMs = Math.min((inputs.prevKin?.phase ?? 0) + inputs.dtS * 1000, gulpMs);
  if (inputs.holderKin !== undefined) {
    const h = inputs.holderKin;
    return {
      x: h.x + Math.cos(h.heading) * MOUTH_OFFSET_WU,
      y: h.y + Math.sin(h.heading) * MOUTH_OFFSET_WU,
      phase: elapsedMs,
    };
  }
  const frozen = inputs.prevKin ?? crestPoint(inputs.formationAnchor, inputs.seed, 0);
  return { x: frozen.x, y: frozen.y, phase: elapsedMs };
}
