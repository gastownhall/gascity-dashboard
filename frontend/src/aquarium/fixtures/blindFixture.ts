// The 'blind' fixture: exactly 7 fish, one per pose, each alone in its own
// rig so it can be framed without a neighbor drifting into the crop, with
// no display name and no task bead — nothing textual for a judge to read
// off. Ground truth (the real pose per index) travels in `manifest.fish`;
// `manifest.blindCams` is the per-fish camera the harness re-navigates to
// for each unlabeled screenshot (scripts/snap-reef-aquarium.mjs).
//
// blindCams' (x, y) is computed with the REAL formation + rest-position
// pipeline (buildFormations + restPosition), not guessed: every hold pose
// (asleep/awaiting-input/rate-limited/stalled/errored)'s spawn point IS its
// steady-state position from frame one (sim/advanceSim.ts — spawn and the
// hold target are the same restPosition() call, so "arrived" is immediate),
// so this is exact regardless of how long the harness has been animating.
// working/idle are not steady-state (they wander continuously); their spawn
// point is still where the harness's screenshot will show them centered
// near, since both poses' steering is anchor-tethered (fish.ts weights
// cohesion/idle-orbit back toward the home anchor) — good enough for a
// close-up crop, not claimed pixel-exact.
//
// Round-3 single-fish-crop fix: round-2 judges repeatedly saw two fish in a
// blind crop. Two of a rig's 7 pose-bands sit close enough in world y that a
// zoom crop can't rely on vertical separation alone — working/stalled
// (~188 wu apart at closest), working/idle (~153 wu), awaiting-input/errored
// (~26 wu), and rate-limited/asleep (their bands can literally overlap) —
// see sim/constants.ts's BAND_* values. buildFormations' placeAlongSeabed
// guarantees, as a hard invariant (not a probabilistic one), that any two
// rig anchors N hash-ranks apart sit at least N * (2*CORE_RADIUS_FRACTION*
// radius + MIN_CORE_GAP_WU) apart in world x, regardless of jitter — for
// this fixture's uniform 1-fish-per-rig radius (166 wu) that floor is
// ~239.2 wu per hash-rank. POSE_BY_HASH_RANK spends that guarantee on
// exactly the 4 close-band pairs above (>= 3 ranks apart, >= 6 for
// working/idle) so their worst-case combined rest-position spread plus the
// BLIND_ZOOM crop's half-width can never overlap — see the derivation this
// bead verified with scripts run against derive/formations.ts +
// sim/restPositions.ts (no collision at any of the 21 fish pairs, nearest
// risky-pair margin ~1000 wu in the concrete run). Every other pose pair is
// already band-separated by more than the crop's half-height, so it doesn't
// need the same x-rank budget.

import type { AgentResponse, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import type { AgentPendingSignal } from 'gas-city-dashboard-shared';
import type { DeriveInputs } from '../derive/deriveWorld';
import { buildFormations } from '../derive/formations';
import { hashString } from '../derive/hash';
import { poseWord } from '../derive/pose';
import { restPosition } from '../sim/restPositions';
import { ALL_POSES, LOD2_ZOOM, type AquariumPose, type FixtureManifest } from '../contracts';
import { buildFishAgent } from './fixtureEntities';

// Mirrors the SSOT vocabulary (shared/src/agents/needsYou.ts /
// derive/pose.ts) — one state word per pose. Kept local rather than shared
// with perfFixture.ts's identical table: the two fixtures' choices are
// allowed to diverge without coupling them.
const STATE_BY_POSE: Record<AquariumPose, string> = {
  working: 'active',
  idle: 'idle',
  asleep: 'asleep',
  'awaiting-input': 'active',
  stalled: 'detached',
  'rate-limited': 'rate-limited',
  errored: 'failed',
};

const DISTRESS_POSES: ReadonlySet<AquariumPose> = new Set([
  'awaiting-input',
  'stalled',
  'rate-limited',
  'errored',
]);

// Captions (name / pose word / bead / belly) fade in across
// [0.8·LOD2_ZOOM, 1.1·LOD2_ZOOM] (render/lod.ts fadeAcross). A blind crop must
// carry NO state text, so it sits just below the fade start (0.8·LOD2_ZOOM):
// the fish still fills the frame at this zoom, but poseWord never renders, so
// the crop leaks nothing but posture. (Rig labels are harmless — a "BLIND-3"
// tag does not reveal which pose the fish is in.)
const CAPTION_FADE_START = LOD2_ZOOM * 0.8;
const BLIND_ZOOM = CAPTION_FADE_START - 0.05;

interface BlindFish {
  pose: AquariumPose;
  rigKey: string;
  sessionName: string;
}

/** Candidate rig keys for the 7 blind fish. Any 7 distinct strings work —
 * buildFormations' per-hash-rank minimum-gap floor (see the header comment)
 * holds for any key set — but the specific strings are pinned so the
 * hash-rank order (and thus the pose assignment below) is deterministic and
 * doesn't shift if this list is ever reordered. */
const BLIND_RIG_KEYS: readonly string[] = [
  'blind-1',
  'blind-2',
  'blind-3',
  'blind-4',
  'blind-5',
  'blind-6',
  'blind-7',
];

/** Poses ordered by how much hash-rank separation they need from their
 * closest-band neighbor (see the header comment's pair list). Zipped
 * against BLIND_RIG_KEYS sorted into buildFormations' own hash-rank order
 * below, so working/stalled, working/idle, awaiting-input/errored, and
 * rate-limited/asleep always land far enough apart in world x. */
const POSE_BY_HASH_RANK: readonly AquariumPose[] = [
  'working',
  'awaiting-input',
  'rate-limited',
  'stalled',
  'errored',
  'asleep',
  'idle',
];

// A hand-ordered list drifting out of sync with ALL_POSES (a pose added,
// renamed, or dropped) would silently lose the "one per pose" contract this
// fixture promises — fail loudly at import time instead.
const posePermutationIsComplete =
  POSE_BY_HASH_RANK.length === ALL_POSES.length &&
  new Set(POSE_BY_HASH_RANK).size === ALL_POSES.length;
if (!posePermutationIsComplete) {
  throw new Error('blind fixture: POSE_BY_HASH_RANK must be a permutation of ALL_POSES');
}
for (const pose of ALL_POSES) {
  if (!POSE_BY_HASH_RANK.includes(pose)) {
    throw new Error(`blind fixture: POSE_BY_HASH_RANK is missing pose "${pose}"`);
  }
}

/** Mirrors derive/formations.ts's private `byHashThenKey` exactly, so the
 * rank order computed here matches the spatial order buildFormations will
 * actually produce for the same keys. */
function byFormationHashRank(a: string, b: string): number {
  const diff = hashString(a) - hashString(b);
  return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
}

const RIG_KEYS_BY_HASH_RANK = [...BLIND_RIG_KEYS].sort(byFormationHashRank);

function buildPlan(): BlindFish[] {
  return RIG_KEYS_BY_HASH_RANK.map((rigKey, i) => ({
    pose: POSE_BY_HASH_RANK[i]!,
    rigKey,
    sessionName: `blind-session-${rigKey}`,
  }));
}

interface RawScene {
  agents: AgentResponse[];
  sessions: SessionResponse[];
  pendingSignals: AgentPendingSignal[];
  rigs: DeriveInputs['rigs'];
  beadsByRig: DeriveInputs['beadsByRig'];
}

/** One agent (+ optional session/pending signal) per plan entry, each in its
 * own empty-queue rig — no beads, so no pellets ever compete for a crop. */
function buildRawScene(plan: readonly BlindFish[]): RawScene {
  const agents: AgentResponse[] = [];
  const sessions: SessionResponse[] = [];
  const pendingSignals: AgentPendingSignal[] = [];
  const rigs: DeriveInputs['rigs'] = [];
  const beadsByRig: DeriveInputs['beadsByRig'] = {};

  for (const p of plan) {
    const built = buildFishAgent({
      // AgentResponse.name is the SSOT needs-you join key (Map-keyed in
      // shared/src/agents/needsYou.ts) — it must be unique per agent, or
      // every agent's distress row collapses onto whichever one is last in
      // iteration order. `alias: ''` (not `name`) is what actually empties
      // the DISPLAYED name: derive/fish.ts's FishEntity.name is
      // `session.alias ?? session.session_name`.
      name: `blind-agent-${p.rigKey}`,
      alias: '',
      sessionName: p.sessionName,
      rig: p.rigKey,
      state: STATE_BY_POSE[p.pose],
      running: p.pose !== 'asleep' && p.pose !== 'errored',
      // No contextPct, no activeBead, no pending prompt text: a
      // belly-percentage caption or a task-bead label would leak toward the
      // pose too. 'working' needs the exact 'in-turn' activity sentinel
      // (derive/pose.ts's derivePose); 'awaiting-input' still needs
      // hasPending (the SSOT selector checks it before state at all), just
      // with no prompt string to render.
      ...(p.pose === 'working' ? { activity: 'in-turn' } : {}),
      ...(p.pose === 'awaiting-input' ? { hasPending: true } : {}),
    });
    agents.push(built.agent);
    if (built.session !== undefined) sessions.push(built.session);
    if (built.pending !== undefined) pendingSignals.push(built.pending);
    rigs.push({ name: p.rigKey, path: `/fixtures/${p.rigKey}` });
    beadsByRig[p.rigKey] = { items: [], total: 0 };
  }

  return { agents, sessions, pendingSignals, rigs, beadsByRig };
}

/** Each fish's manifest entry plus the camera the harness re-navigates to
 * for its unlabeled crop, computed from the REAL formation + rest-position
 * pipeline (see the header comment). */
function buildFishAndCams(
  plan: readonly BlindFish[],
  beadsByRig: DeriveInputs['beadsByRig'],
): { fish: FixtureManifest['fish']; blindCams: NonNullable<FixtureManifest['blindCams']> } {
  const formations = buildFormations({ beadsByRig, fishHomeKeys: plan.map((p) => p.rigKey) });
  const formationByKey = new Map(formations.map((f) => [f.key, f]));

  const fish: FixtureManifest['fish'] = [];
  const blindCams: NonNullable<FixtureManifest['blindCams']> = [];
  for (const p of plan) {
    const formation = formationByKey.get(p.rigKey);
    if (formation === undefined) {
      throw new Error(`blind fixture: no formation resolved for rig "${p.rigKey}"`);
    }
    const seed = hashString(p.sessionName);
    const pos = restPosition(
      p.pose,
      { x: formation.anchorX, y: formation.anchorY, radius: formation.radius },
      seed,
    );
    fish.push({
      name: '',
      poseWord: poseWord(p.pose),
      pose: p.pose,
      rigKey: p.rigKey,
      bellyPct: undefined,
    });
    blindCams.push({ x: pos.x, y: pos.y, zoom: BLIND_ZOOM });
  }
  return { fish, blindCams };
}

export function buildBlindFixture(): { inputs: DeriveInputs; manifest: FixtureManifest } {
  const plan = buildPlan();
  const { agents, sessions, pendingSignals, rigs, beadsByRig } = buildRawScene(plan);
  const { fish, blindCams } = buildFishAndCams(plan, beadsByRig);

  const inputs: DeriveInputs = {
    sessions,
    agents,
    rigs,
    pendingSignals,
    beadsByRig,
    unavailableBeadRigKeys: [],
  };

  const manifest: FixtureManifest = {
    kind: 'blind',
    rigs: rigs.map((r) => ({ key: r.name, openBeadTotal: 0 })),
    fish,
    pelletBeadIds: [],
    needsAttention: fish.filter((f) => DISTRESS_POSES.has(f.pose)).length,
    blindCams,
  };

  return { inputs, manifest };
}
