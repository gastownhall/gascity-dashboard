// Per-fish, per-frame kinematics update. One pure function per pose family;
// `tickFish` dispatches. Every autonomous number (speed jitter, wander
// phase, bob) is seeded from the fish's own id-hash or the injected
// clockMs — never Math.random, never Date.now.

import { WORLD, type AquariumPose, type FishKinematics } from '../contracts';
import { hashRange } from '../derive/hash';
import { type ShoalAccum } from './grid';
import { restPosition, type HomeAnchor } from './restPositions';
import { clampPoint, headingTo, limitTurn, seekTarget, type Pt } from './steer';
import {
  AWAITING_INPUT_RISE_SPEED,
  BAND_IDLE_Y,
  BAND_WORKING_Y,
  BOB_AMPLITUDE_WU,
  BOB_PERIOD_MS,
  CRUISE_SPEED_MAX,
  CRUISE_SPEED_MIN,
  ERRORED_RISE_SPEED,
  IDLE_SPEED_MAX,
  IDLE_SPEED_MIN,
  MAX_TURN_RATE_RAD_PER_S,
  MAYOR_SPEED,
  SHOAL_ALIGN_LOOKAHEAD_WU,
  SHOAL_MIN_HALF_SPREAD_WU,
  SHOAL_SEPARATION_SCALE,
  SHOAL_SPREAD_RADIUS_FACTOR,
  WALL_MARGIN_WU,
} from './constants';

const TAU = Math.PI * 2;
/** Calm transition speed used to swim TO a hold pose's rest point (the hold
 * itself then reports speed 0 once arrived). */
const APPROACH_SPEED = 30;
/** Within this distance of a hold target, a fish is considered "arrived".
 * Must be >= BOB_AMPLITUDE_WU: once arrived, the settled point is snapped to
 * target + bob, so next tick's distance-to-target is exactly the bob
 * offset (<= BOB_AMPLITUDE_WU) and arrival stays latched. */
const ARRIVAL_EPSILON_WU = 10;

export interface FishTickInputs {
  seed: number;
  pose: AquariumPose;
  isMayor: boolean;
  tombstoned: boolean;
  prevKin: FishKinematics | undefined;
  homeAnchor: HomeAnchor;
  /** own task-bead pellet's last-known position, working pose only. */
  taskTarget: Pt | undefined;
  /** pre-reduced boids pull from the spatial grid (working pose only); zeroed
   * accumulator when the fish has no shoalmates or is not working. */
  shoal: ShoalAccum;
  clockMs: number;
  dtS: number;
}

export function tickFish(inputs: FishTickInputs): FishKinematics {
  const phase = hashRange(inputs.seed, 0, TAU);
  if (inputs.tombstoned) return frozenTombstone(inputs, phase);

  // restPosition(pose, ...) IS each hold pose's own target — reused below as
  // both the spawn fallback and (for hold poses) the seek target itself, so
  // it's computed once per tick instead of once per branch.
  const spawn = restPosition(inputs.pose, inputs.homeAnchor, inputs.seed);
  const prevPos: Pt = inputs.prevKin ?? spawn;
  const prevHeading = inputs.prevKin?.heading ?? 0;

  if (inputs.isMayor && (inputs.pose === 'working' || inputs.pose === 'idle')) {
    return tickMayorPatrol(inputs, prevPos, prevHeading, phase);
  }
  switch (inputs.pose) {
    case 'working':
      return tickWorking(inputs, prevPos, prevHeading, phase);
    case 'idle':
      return tickIdle(inputs, prevPos, prevHeading, phase);
    case 'asleep':
      return tickHold(inputs, prevPos, prevHeading, phase, spawn, 0);
    case 'awaiting-input':
      return tickHold(
        inputs,
        prevPos,
        prevHeading,
        phase,
        spawn,
        BOB_AMPLITUDE_WU,
        AWAITING_INPUT_RISE_SPEED,
      );
    case 'errored':
      return tickHold(
        inputs,
        prevPos,
        prevHeading,
        phase,
        spawn,
        BOB_AMPLITUDE_WU * 0.4,
        ERRORED_RISE_SPEED,
      );
    case 'rate-limited':
      return tickHold(inputs, prevPos, prevHeading, phase, spawn, 0);
    case 'stalled':
      return tickHold(inputs, prevPos, prevHeading, phase, spawn, BOB_AMPLITUDE_WU * 0.6);
  }
}

/** Frozen verbatim (including its own recorded phase) — a tombstone must
 * never resume motion or resnap to a freshly-computed phase/position. */
function frozenTombstone(inputs: FishTickInputs, phase: number): FishKinematics {
  if (inputs.prevKin !== undefined) return { ...inputs.prevKin, speed: 0 };
  const spawn = restPosition(inputs.pose, inputs.homeAnchor, inputs.seed);
  return { ...spawn, heading: 0, speed: 0, phase };
}

function clampToWorld(p: Pt): Pt {
  return clampPoint(
    p,
    WALL_MARGIN_WU,
    WORLD.width - WALL_MARGIN_WU,
    WORLD.waterlineY,
    WORLD.height - 20,
  );
}

/** Seek toward `target` at `approachSpeed`; once arrived, report speed 0 and
 * snap directly to `target` (+ a bob oscillation), rather than continuing to
 * seek from the bob-displaced position — feeding the bob back into next
 * tick's seek would perpetually re-trigger "not arrived" as it swings past
 * the arrival radius, so the settled point is computed straight off the
 * fixed target every tick once reached. */
function tickHold(
  inputs: FishTickInputs,
  prevPos: Pt,
  prevHeading: number,
  phase: number,
  target: Pt,
  bobAmplitude: number,
  approachSpeed: number = APPROACH_SPEED,
): FishKinematics {
  const arrived = Math.hypot(target.x - prevPos.x, target.y - prevPos.y) <= ARRIVAL_EPSILON_WU;
  if (arrived) {
    const settled: Pt =
      bobAmplitude > 0
        ? {
            x: target.x,
            y: target.y + Math.sin((inputs.clockMs / BOB_PERIOD_MS) * TAU + phase) * bobAmplitude,
          }
        : target;
    const heading = limitTurn(
      prevHeading,
      headingTo(prevPos, target),
      MAX_TURN_RATE_RAD_PER_S * inputs.dtS,
    );
    const clamped = clampToWorld(settled);
    return { x: clamped.x, y: clamped.y, heading, speed: 0, phase };
  }
  const { pos, heading } = seekTarget(
    prevPos,
    prevHeading,
    target,
    approachSpeed,
    inputs.dtS,
    MAX_TURN_RATE_RAD_PER_S,
  );
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed: approachSpeed, phase };
}

/** Lazy solo wander in the idle band — a gentle ellipse around the home x, no
 * boids, lower and looser than the working shoal. */
function tickIdle(
  inputs: FishTickInputs,
  prevPos: Pt,
  prevHeading: number,
  phase: number,
): FishKinematics {
  const speed = hashRange(inputs.seed + 3, IDLE_SPEED_MIN, IDLE_SPEED_MAX);
  const angle = inputs.clockMs / 6000 + phase;
  const ySwing = Math.min(inputs.homeAnchor.radius * 0.3, 90);
  const target: Pt = {
    x: inputs.homeAnchor.x + Math.cos(angle) * inputs.homeAnchor.radius * 0.6,
    y: BAND_IDLE_Y + Math.sin(angle) * ySwing,
  };
  const { pos, heading } = seekTarget(
    prevPos,
    prevHeading,
    target,
    speed,
    inputs.dtS,
    MAX_TURN_RATE_RAD_PER_S,
  );
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed, phase };
}

// Boids blend weights (unchanged from round 2). Kept as named constants so
// the balance between "hold station over my rig" and "flock with whoever is
// near" is legible and tunable in one place.
const W_WANDER = 0.12;
const W_COHESION = 0.22;
const W_SEPARATION = 0.34;
const W_HOME = 0.2;
const W_ALIGN = 0.18;
const W_TASK = 0.35;

/** The wandering shoal centre for a working fish. Round-3 FIX 2: the home
 * spread is wide (>= SHOAL_MIN_HALF_SPREAD_WU, and scaling up with formation
 * size) so a rig's school fans across neighbouring formations and the open
 * mid-water instead of stacking in a tight vertical column over its own
 * labelled mound. The y-tether to BAND_WORKING_Y still keeps it off the
 * seabed; the x still centres on the fish's own rig (truthful membership). */
function shoalHomeX(inputs: FishTickInputs): number {
  const spread = Math.max(
    inputs.homeAnchor.radius * SHOAL_SPREAD_RADIUS_FACTOR,
    SHOAL_MIN_HALF_SPREAD_WU,
  );
  return inputs.homeAnchor.x + hashRange(inputs.seed + 11, -spread, spread);
}

/** A working fish cruises the mid-water pellet band as part of a loose shoal.
 * Cohesion/separation/alignment come pre-reduced from the spatial grid (see
 * sim/grid.ts) — one allocation-free scalar blend here instead of the old
 * per-neighbour array/centroid churn. The wide `home` term keeps a lone fish
 * loosely over its own reef; a task pellet pulls hardest. */
function tickWorking(
  inputs: FishTickInputs,
  prevPos: Pt,
  prevHeading: number,
  phase: number,
): FishKinematics {
  const speed = hashRange(inputs.seed + 7, CRUISE_SPEED_MIN, CRUISE_SPEED_MAX);
  const target = blendWorkingTarget(inputs, prevPos, phase);
  const { pos, heading } = seekTarget(
    prevPos,
    prevHeading,
    target,
    speed,
    inputs.dtS,
    MAX_TURN_RATE_RAD_PER_S,
  );
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed, phase };
}

/** Weighted blend of the boids pulls into one steering target, in scalars —
 * no intermediate Pt/array allocation per pull. */
function blendWorkingTarget(inputs: FishTickInputs, prevPos: Pt, phase: number): Pt {
  const homeX = shoalHomeX(inputs);
  const sh = inputs.shoal;
  // No shoalmates in range => cohesion is neutral (hold the current band spot),
  // NOT a yank back to the wide random home. The lone `home` term (below) still
  // tethers a solo fish loosely to its rig; letting cohesion fall back to the
  // wide home instead would overpower a fish's own task-pellet pull.
  const cohX = sh.cohCount > 0 ? sh.cohX / sh.cohCount : prevPos.x;
  const cohY = sh.cohCount > 0 ? sh.cohY / sh.cohCount : BAND_WORKING_Y;
  const wanderAngle = inputs.clockMs / 4000 + phase;

  let tx = (prevPos.x + Math.cos(wanderAngle) * 40) * W_WANDER;
  let ty = (prevPos.y + Math.sin(wanderAngle) * 40) * W_WANDER;
  tx +=
    cohX * W_COHESION +
    (prevPos.x + sh.sepX * SHOAL_SEPARATION_SCALE) * W_SEPARATION +
    homeX * W_HOME;
  ty +=
    cohY * W_COHESION +
    (prevPos.y + sh.sepY * SHOAL_SEPARATION_SCALE) * W_SEPARATION +
    BAND_WORKING_Y * W_HOME;
  let tw = W_WANDER + W_COHESION + W_SEPARATION + W_HOME;

  if (sh.alignCount > 0 && (sh.alignCos !== 0 || sh.alignSin !== 0)) {
    const meanHeading = Math.atan2(sh.alignSin, sh.alignCos);
    tx += (prevPos.x + Math.cos(meanHeading) * SHOAL_ALIGN_LOOKAHEAD_WU) * W_ALIGN;
    ty += (prevPos.y + Math.sin(meanHeading) * SHOAL_ALIGN_LOOKAHEAD_WU) * W_ALIGN;
    tw += W_ALIGN;
  }
  if (inputs.taskTarget !== undefined) {
    tx += inputs.taskTarget.x * W_TASK;
    ty += inputs.taskTarget.y * W_TASK;
    tw += W_TASK;
  }
  return { x: tx / tw, y: ty / tw };
}

function mayorPatrolPoint(clockMs: number, phase: number): Pt {
  const t = clockMs / 1000;
  const cx = WORLD.width / 2;
  const cy = (WORLD.waterlineY + WORLD.seabedY) / 2;
  const ax = WORLD.width * 0.35;
  const ay = (WORLD.seabedY - WORLD.waterlineY) * 0.3;
  return {
    x: cx + Math.sin(t * 0.05 + phase) * ax,
    y: cy + Math.sin(t * 0.033 + phase * 1.3) * ay,
  };
}

function tickMayorPatrol(
  inputs: FishTickInputs,
  prevPos: Pt,
  prevHeading: number,
  phase: number,
): FishKinematics {
  const target = mayorPatrolPoint(inputs.clockMs, phase);
  const { pos, heading } = seekTarget(
    prevPos,
    prevHeading,
    target,
    MAYOR_SPEED,
    inputs.dtS,
    MAX_TURN_RATE_RAD_PER_S,
  );
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed: MAYOR_SPEED, phase };
}
