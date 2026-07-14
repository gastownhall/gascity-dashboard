// The sim/ entry point: one pure frame-advance over a WorldSnapshot.
// Deterministic given (snapshot, prev, dtMs, reducedMotion) — no Math.random,
// no Date.now. Per-entity variation comes entirely from an id-hash seed.

import {
  WORLD,
  type AdvanceSim,
  type FishEntity,
  type FishKinematics,
  type PelletEntity,
  type PelletKinematics,
  type RigFormation,
  type SimState,
} from '../contracts';
import { hashString, hashUnit } from '../derive/hash';
import { DT_CLAMP_MS, MOUTH_OFFSET_WU } from './constants';
import { tickFish, type FishTickInputs, type Neighbor } from './fishTick';
import { tickPellet, type FormationAnchor } from './pelletTick';
import { type Pt } from './steer';

export { MOUTH_OFFSET_WU };

/** Open-water home for CITY_KEY fish (mayor, city-stratum agents) and for
 * any fish whose homeKey resolves to no formation (a defensive fallback —
 * every real rig key in beadsByRig gets a formation per derive/formations.ts). */
const DEFAULT_ANCHOR: FormationAnchor = {
  x: WORLD.width / 2,
  y: (WORLD.waterlineY + WORLD.seabedY) / 2,
  radius: 260,
};

export const advanceSim: AdvanceSim = (snapshot, prev, dtMs, reducedMotion) => {
  const dtMsClamped = Math.min(Math.max(dtMs, 0), DT_CLAMP_MS);
  const dtS = reducedMotion ? 0 : dtMsClamped / 1000;
  const clockMs = reducedMotion ? prev.clockMs : prev.clockMs + dtMsClamped;
  const tickClockMs = reducedMotion ? 0 : clockMs;

  const anchorByKey = formationAnchors(snapshot.formations);
  const workingGroups = groupWorkingFishByHome(snapshot.fish);

  const fish: Record<string, FishKinematics> = {};
  for (const entity of snapshot.fish) {
    fish[entity.id] = advanceOneFish(entity, {
      prev,
      anchorByKey,
      workingGroups,
      dtS,
      clockMs: tickClockMs,
      reducedMotion,
    });
  }

  const pellets: Record<string, PelletKinematics> = {};
  for (const entity of snapshot.pellets) {
    pellets[entity.beadId] = advanceOnePellet(entity, {
      prev,
      anchorByKey,
      fish,
      dtS,
      clockMs: tickClockMs,
    });
  }

  return { fish, pellets, clockMs };
};

function formationAnchors(formations: readonly RigFormation[]): Map<string, FormationAnchor> {
  const map = new Map<string, FormationAnchor>();
  for (const f of formations) map.set(f.key, { x: f.anchorX, y: f.anchorY, radius: f.radius });
  return map;
}

/** homeKey -> ids of its non-tombstoned working-pose fish (boids neighbors). */
function groupWorkingFishByHome(fish: readonly FishEntity[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of fish) {
    if (f.pose !== 'working' || f.tombstoned) continue;
    const list = groups.get(f.homeKey);
    if (list === undefined) groups.set(f.homeKey, [f.id]);
    else list.push(f.id);
  }
  return groups;
}

interface FishTickContext {
  prev: SimState;
  anchorByKey: ReadonlyMap<string, FormationAnchor>;
  workingGroups: ReadonlyMap<string, string[]>;
  dtS: number;
  clockMs: number;
  reducedMotion: boolean;
}

function advanceOneFish(entity: FishEntity, ctx: FishTickContext): FishKinematics {
  const seed = hashString(entity.id);
  const anchor = ctx.anchorByKey.get(entity.homeKey) ?? DEFAULT_ANCHOR;
  const prevKin = ctx.prev.fish[entity.id];
  const taskTarget = taskPelletTarget(entity, ctx.prev);
  const neighbors = neighborPositions(entity, ctx);

  const inputs: FishTickInputs = {
    seed,
    pose: entity.pose,
    isMayor: entity.isMayor,
    tombstoned: entity.tombstoned,
    prevKin: ctx.reducedMotion ? undefined : prevKin,
    homeAnchor: anchor,
    taskTarget,
    neighbors,
    clockMs: ctx.clockMs,
    dtS: ctx.dtS,
  };

  const kin = tickFish(inputs);
  if (!ctx.reducedMotion) return kin;
  // Reduced motion: tickFish with dtS=0 already yields each pose's settled
  // rest point (a hold pose's target equals its own spawn point, so it's
  // "arrived" instantly; working/idle resolve to their deterministic band
  // scatter spawn since a zero step never moves off it) — only the reported
  // speed and a legible per-pose heading need forcing.
  if (entity.tombstoned) return kin;
  return { ...kin, heading: reducedMotionHeading(entity.pose, seed), speed: 0 };
}

/** A settled, truthful heading for the frozen frame: surfacing/rising poses
 * nose up toward the waterline; everyone else holds a horizontal cruise,
 * facing left or right by hash so a frozen shoal is not a rigid lattice all
 * pointing the same way. */
function reducedMotionHeading(pose: FishEntity['pose'], seed: number): number {
  if (pose === 'awaiting-input' || pose === 'errored') return -Math.PI / 2;
  return hashUnit(seed ^ 0x51ed270b) < 0.5 ? 0 : Math.PI;
}

function taskPelletTarget(entity: FishEntity, prev: SimState): Pt | undefined {
  if (entity.pose !== 'working' || entity.taskBeadId === undefined) return undefined;
  return prev.pellets[entity.taskBeadId];
}

function neighborPositions(entity: FishEntity, ctx: FishTickContext): Neighbor[] {
  if (entity.pose !== 'working' || entity.tombstoned) return [];
  const groupIds = ctx.workingGroups.get(entity.homeKey) ?? [];
  return groupIds.flatMap((id) => {
    if (id === entity.id) return [];
    const kin = ctx.prev.fish[id];
    return kin !== undefined ? [kin] : [];
  });
}

interface PelletTickContext {
  prev: SimState;
  anchorByKey: ReadonlyMap<string, FormationAnchor>;
  fish: Readonly<Record<string, FishKinematics>>;
  dtS: number;
  clockMs: number;
}

function advanceOnePellet(entity: PelletEntity, ctx: PelletTickContext): PelletKinematics {
  const seed = hashString(entity.beadId);
  const anchor = ctx.anchorByKey.get(entity.rigKey) ?? DEFAULT_ANCHOR;
  const holderKin = entity.fishId !== undefined ? ctx.fish[entity.fishId] : undefined;
  return tickPellet({
    beadId: entity.beadId,
    state: entity.state,
    formationAnchor: anchor,
    holderKin,
    prevKin: ctx.prev.pellets[entity.beadId],
    gulpMsLeft: entity.gulpMsLeft,
    seed,
    clockMs: ctx.clockMs,
    dtS: ctx.dtS,
  });
}
