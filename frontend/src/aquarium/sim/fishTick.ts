// Per-fish, per-frame kinematics update. One pure function per pose family;
// `tickFish` dispatches. Every autonomous number (speed jitter, wander
// phase, bob) is seeded from the fish's own id-hash or the injected
// clockMs — never Math.random, never Date.now.

import { WORLD, type AquariumPose, type FishKinematics } from '../contracts';
import { hashRange } from '../derive/hash';
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

/** A boids neighbor: another working fish's last-tick position AND heading.
 * Heading feeds alignment (the shoal swims a shared direction); position
 * feeds cohesion + separation. FishKinematics is structurally assignable. */
export interface Neighbor {
  x: number;
  y: number;
  heading: number;
}

export interface FishTickInputs {
  seed: number;
  pose: AquariumPose;
  isMayor: boolean;
  tombstoned: boolean;
  prevKin: FishKinematics | undefined;
  homeAnchor: HomeAnchor;
  /** own task-bead pellet's last-known position, working pose only. */
  taskTarget: Pt | undefined;
  /** other working-pose fish sharing this fish's home formation (prev tick). */
  neighbors: readonly Neighbor[];
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

/** Neighbourhood radii: the wide one gathers the shoal (cohesion +
 * alignment); the tight one is personal space (separation). */
const NEIGHBOR_RADIUS_WU = 360;
const SEPARATION_RADIUS_WU = 64;
const SEPARATION_SCALE = 5200;
/** How far ahead the alignment steer projects along the shoal's mean heading. */
const ALIGN_LOOKAHEAD_WU = 130;

/** A working fish cruises the mid-water pellet band as part of a loose shoal:
 * cohesion toward nearby shoalmates (falling back to the band home so the
 * school stays above its own reef), separation for personal space, alignment
 * to the shoal's mean heading, a per-fish wander for heading variance, and a
 * pull toward its own task pellet. Never sinks to the seabed — the band home
 * tethers it to BAND_WORKING_Y. */
function tickWorking(
  inputs: FishTickInputs,
  prevPos: Pt,
  prevHeading: number,
  phase: number,
): FishKinematics {
  const speed = hashRange(inputs.seed + 7, CRUISE_SPEED_MIN, CRUISE_SPEED_MAX);
  // Per-fish home column: a strong y-tether to the band, a loose x-slot spread
  // across the reef so the shoal fills the water above its formation rather
  // than collapsing into one clump over the centre.
  const homeSpread = inputs.homeAnchor.radius * 0.7;
  const shoalHome: Pt = {
    x: inputs.homeAnchor.x + hashRange(inputs.seed + 11, -homeSpread, homeSpread),
    y: BAND_WORKING_Y,
  };
  const nearby = neighborsWithin(prevPos, inputs.neighbors, NEIGHBOR_RADIUS_WU);

  const wanderAngle = inputs.clockMs / 4000 + phase;
  const wander: Pt = {
    x: prevPos.x + Math.cos(wanderAngle) * 40,
    y: prevPos.y + Math.sin(wanderAngle) * 40,
  };
  const cohesion = neighborCentroid(nearby) ?? shoalHome;
  const separation = separationPush(prevPos, inputs.neighbors);
  const alignment = alignmentTarget(prevPos, nearby);

  const target = weightedBlend([
    [wander, 0.12],
    [cohesion, 0.22],
    [separation, 0.34],
    [shoalHome, 0.2],
    ...(alignment !== undefined ? ([[alignment, 0.18]] as const) : []),
    ...(inputs.taskTarget !== undefined ? ([[inputs.taskTarget, 0.35]] as const) : []),
  ]);

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

/** Neighbors within `radius` of `pos` — the boids neighbourhood filter. */
function neighborsWithin(pos: Pt, neighbors: readonly Neighbor[], radius: number): Neighbor[] {
  const r2 = radius * radius;
  return neighbors.filter((n) => {
    const dx = n.x - pos.x;
    const dy = n.y - pos.y;
    return dx * dx + dy * dy <= r2;
  });
}

function neighborCentroid(neighbors: readonly Neighbor[]): Pt | undefined {
  if (neighbors.length === 0) return undefined;
  const sum = neighbors.reduce((acc, n) => ({ x: acc.x + n.x, y: acc.y + n.y }), { x: 0, y: 0 });
  return { x: sum.x / neighbors.length, y: sum.y / neighbors.length };
}

/** A point a fixed distance ahead along the shoal's mean heading (circular
 * mean of the neighbours' headings) — steers the fish to swim WITH the
 * school instead of merely toward its centre, so the shoal reads as a moving
 * body, not a clump orbiting a point. */
function alignmentTarget(pos: Pt, neighbors: readonly Neighbor[]): Pt | undefined {
  if (neighbors.length === 0) return undefined;
  let cx = 0;
  let cy = 0;
  for (const n of neighbors) {
    cx += Math.cos(n.heading);
    cy += Math.sin(n.heading);
  }
  if (cx === 0 && cy === 0) return undefined;
  const meanHeading = Math.atan2(cy, cx);
  return {
    x: pos.x + Math.cos(meanHeading) * ALIGN_LOOKAHEAD_WU,
    y: pos.y + Math.sin(meanHeading) * ALIGN_LOOKAHEAD_WU,
  };
}

/** A point pushed away from any neighbor closer than SEPARATION_RADIUS_WU —
 * loose organic shoals instead of fish stacking on one point. */
function separationPush(pos: Pt, neighbors: readonly Neighbor[]): Pt {
  let sx = 0;
  let sy = 0;
  for (const n of neighbors) {
    const dx = pos.x - n.x;
    const dy = pos.y - n.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > 0 && distSq < SEPARATION_RADIUS_WU * SEPARATION_RADIUS_WU) {
      sx += dx / distSq;
      sy += dy / distSq;
    }
  }
  return { x: pos.x + sx * SEPARATION_SCALE, y: pos.y + sy * SEPARATION_SCALE };
}

function weightedBlend(pairs: ReadonlyArray<readonly [Pt, number]>): Pt {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const [p, w] of pairs) {
    sx += p.x * w;
    sy += p.y * w;
    sw += w;
  }
  return sw === 0 ? { x: 0, y: 0 } : { x: sx / sw, y: sy / sw };
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
