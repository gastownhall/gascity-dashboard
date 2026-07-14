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
  neighbors: readonly Pt[];
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
      return tickHold(inputs, prevPos, prevHeading, phase, spawn, BOB_AMPLITUDE_WU, AWAITING_INPUT_RISE_SPEED);
    case 'errored':
      return tickHold(inputs, prevPos, prevHeading, phase, spawn, BOB_AMPLITUDE_WU * 0.4, ERRORED_RISE_SPEED);
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
  return clampPoint(p, WALL_MARGIN_WU, WORLD.width - WALL_MARGIN_WU, WORLD.waterlineY, WORLD.height - 20);
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
        ? { x: target.x, y: target.y + Math.sin((inputs.clockMs / BOB_PERIOD_MS) * TAU + phase) * bobAmplitude }
        : target;
    const heading = limitTurn(prevHeading, headingTo(prevPos, target), MAX_TURN_RATE_RAD_PER_S * inputs.dtS);
    const clamped = clampToWorld(settled);
    return { x: clamped.x, y: clamped.y, heading, speed: 0, phase };
  }
  const { pos, heading } = seekTarget(prevPos, prevHeading, target, approachSpeed, inputs.dtS, MAX_TURN_RATE_RAD_PER_S);
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed: approachSpeed, phase };
}

function tickIdle(inputs: FishTickInputs, prevPos: Pt, prevHeading: number, phase: number): FishKinematics {
  const speed = hashRange(inputs.seed + 3, IDLE_SPEED_MIN, IDLE_SPEED_MAX);
  const angle = inputs.clockMs / 6000 + phase;
  const target: Pt = {
    x: inputs.homeAnchor.x + Math.cos(angle) * inputs.homeAnchor.radius * 0.6,
    y: inputs.homeAnchor.y - Math.abs(Math.sin(angle)) * inputs.homeAnchor.radius * 0.3,
  };
  const { pos, heading } = seekTarget(prevPos, prevHeading, target, speed, inputs.dtS, MAX_TURN_RATE_RAD_PER_S);
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed, phase };
}

const SEPARATION_RADIUS_WU = 50;
const SEPARATION_SCALE = 4000;

function tickWorking(inputs: FishTickInputs, prevPos: Pt, prevHeading: number, phase: number): FishKinematics {
  const speed = hashRange(inputs.seed + 7, CRUISE_SPEED_MIN, CRUISE_SPEED_MAX);
  const wanderAngle = inputs.clockMs / 4000 + phase;
  const wander: Pt = { x: prevPos.x + Math.cos(wanderAngle) * 40, y: prevPos.y + Math.sin(wanderAngle) * 40 };
  const cohesion = neighborCentroid(inputs.neighbors) ?? inputs.homeAnchor;
  const separation = separationPush(prevPos, inputs.neighbors);

  const target = weightedBlend([
    [wander, 0.25],
    [cohesion, 0.25],
    [separation, 0.3],
    ...(inputs.taskTarget !== undefined ? ([[inputs.taskTarget, 0.4]] as const) : []),
  ]);

  const { pos, heading } = seekTarget(prevPos, prevHeading, target, speed, inputs.dtS, MAX_TURN_RATE_RAD_PER_S);
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed, phase };
}

function neighborCentroid(neighbors: readonly Pt[]): Pt | undefined {
  if (neighbors.length === 0) return undefined;
  const sum = neighbors.reduce((acc, n) => ({ x: acc.x + n.x, y: acc.y + n.y }), { x: 0, y: 0 });
  return { x: sum.x / neighbors.length, y: sum.y / neighbors.length };
}

/** A point pushed away from any neighbor closer than SEPARATION_RADIUS_WU —
 * loose organic shoals instead of fish stacking on one point. */
function separationPush(pos: Pt, neighbors: readonly Pt[]): Pt {
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

function tickMayorPatrol(inputs: FishTickInputs, prevPos: Pt, prevHeading: number, phase: number): FishKinematics {
  const target = mayorPatrolPoint(inputs.clockMs, phase);
  const { pos, heading } = seekTarget(prevPos, prevHeading, target, MAYOR_SPEED, inputs.dtS, MAX_TURN_RATE_RAD_PER_S);
  const clamped = clampToWorld(pos);
  return { x: clamped.x, y: clamped.y, heading, speed: MAYOR_SPEED, phase };
}
