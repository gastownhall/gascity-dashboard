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

/** Just under LOD2 so pose/pellet captions never fade in (Honest Zoom Rule)
 *  while the fish still fills the frame for a close-up crop. */
const BLIND_ZOOM = LOD2_ZOOM - 0.05;

interface BlindFish {
  pose: AquariumPose;
  rigKey: string;
  sessionName: string;
}

export function buildBlindFixture(): { inputs: DeriveInputs; manifest: FixtureManifest } {
  const plan: BlindFish[] = ALL_POSES.map((pose, i) => ({
    pose,
    rigKey: `blind-${i + 1}`,
    sessionName: `blind-session-${i + 1}`,
  }));

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

  const formations = buildFormations({
    beadsByRig,
    fishHomeKeys: plan.map((p) => p.rigKey),
  });
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

  const inputs: DeriveInputs = {
    sessions,
    agents,
    rigs,
    pendingSignals,
    beadsByRig,
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
