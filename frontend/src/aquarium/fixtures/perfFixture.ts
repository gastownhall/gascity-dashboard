// The 'perf' fixture: 200 fish across 6 rigs and 1000 beads, for the camera
// sweep's p95 frame-time budget (criterion 5, specs/plans/reef-aquarium.md).
// Scale and a broad pose mix matter here, not manifest precision — no
// screenshot honesty-audit reads this fixture's labels.

import type { AgentResponse, Bead, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import type { AgentPendingSignal } from 'gas-city-dashboard-shared';
import type { DeriveInputs } from '../derive/deriveWorld';
import { poseWord } from '../derive/pose';
import { ALL_POSES, type AquariumPose, type FixtureManifest } from '../contracts';
import { buildFishAgent } from './fixtureEntities';

const FISH_COUNT = 200;
const RIG_COUNT = 6;
const BEAD_COUNT = 1_000;

const RIG_NAMES: readonly string[] = Array.from({ length: RIG_COUNT }, (_, i) => `perf-rig-${i}`);

// One state word per pose, mirroring the SSOT vocabulary the aquarium
// fixture uses (shared/src/agents/needsYou.ts). 'detached' alone trips
// isStalled regardless of session presence, so every perf fish can safely
// carry a live session — no reliance on the sessionless fallback-fish path.
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

// A working-biased pose cycle rather than an even round-robin: the camera
// sweep should stress the realistic worst case (large working schools doing
// boid/shoal steering), not an evenly-split roster no live fleet resembles.
// Every non-working pose still gets its own slot each cycle (full 7-pose
// coverage, unaffected by future ALL_POSES additions), just outnumbered by
// 'working' the way a healthy fleet's rigs actually school.
const WORKING_FILLER_PER_POSE = 3;
const POSE_CYCLE: readonly AquariumPose[] = ALL_POSES.flatMap((pose) =>
  pose === 'working'
    ? [pose]
    : [...Array<AquariumPose>(WORKING_FILLER_PER_POSE).fill('working'), pose],
);

function poseAt(index: number): AquariumPose {
  const pose = POSE_CYCLE[index % POSE_CYCLE.length];
  if (pose === undefined) throw new Error(`perf fixture: pose index ${index} out of range`);
  return pose;
}

export function buildPerfFixture(): { inputs: DeriveInputs; manifest: FixtureManifest } {
  const agents: AgentResponse[] = [];
  const sessions: SessionResponse[] = [];
  const pendingSignals: AgentPendingSignal[] = [];
  const fishManifest: FixtureManifest['fish'] = [];

  for (let i = 0; i < FISH_COUNT; i += 1) {
    const rigIndex = i % RIG_COUNT;
    const rigName = RIG_NAMES[rigIndex];
    if (rigName === undefined) throw new Error(`perf fixture: rig index ${rigIndex} out of range`);
    const pose = poseAt(i);
    const name = `${rigName}/agent-${i}`;
    const alias = `agent-${i}`;
    const built = buildFishAgent({
      name,
      alias,
      rig: rigName,
      state: STATE_BY_POSE[pose],
      running: pose !== 'asleep' && pose !== 'errored',
      contextPct: (i * 7) % 101,
      ...(pose === 'working' ? { activity: 'in-turn' } : {}),
      ...(pose === 'awaiting-input'
        ? { hasPending: true, pendingPrompt: 'Approve the next step?' }
        : {}),
    });
    agents.push(built.agent);
    if (built.session !== undefined) sessions.push(built.session);
    if (built.pending !== undefined) pendingSignals.push(built.pending);
    fishManifest.push({
      name: alias,
      poseWord: poseWord(pose),
      pose,
      rigKey: rigName,
      bellyPct: (i * 7) % 101,
    });
  }

  const beadsByRig: DeriveInputs['beadsByRig'] = {};
  const pelletBeadIds: string[] = [];
  const beadsPerRig = Math.floor(BEAD_COUNT / RIG_COUNT);
  const statuses = ['open', 'in_progress', 'blocked'] as const;
  for (let r = 0; r < RIG_COUNT; r += 1) {
    const rigName = RIG_NAMES[r];
    if (rigName === undefined) throw new Error(`perf fixture: rig index ${r} out of range`);
    const items: Bead[] = [];
    const countForRig =
      r === RIG_COUNT - 1 ? BEAD_COUNT - beadsPerRig * (RIG_COUNT - 1) : beadsPerRig;
    for (let b = 0; b < countForRig; b += 1) {
      const id = `perf-bead-${r}-${String(b).padStart(4, '0')}`;
      const status = statuses[b % statuses.length] ?? 'open';
      items.push({
        id,
        title: `Perf bead ${id}`,
        status,
        issue_type: 'task',
        created_at: '2026-01-01T00:00:00.000Z',
      });
      pelletBeadIds.push(id);
    }
    beadsByRig[rigName] = { items, total: items.length };
  }

  const inputs: DeriveInputs = {
    sessions,
    agents,
    rigs: RIG_NAMES.map((name) => ({ name, path: `/rigs/${name}` })),
    pendingSignals,
    beadsByRig,
  };

  const manifest: FixtureManifest = {
    kind: 'perf',
    rigs: RIG_NAMES.map((key) => ({ key, openBeadTotal: beadsByRig[key]?.total ?? 0 })),
    fish: fishManifest,
    pelletBeadIds,
    needsAttention: fishManifest.filter((f) => DISTRESS_POSES.has(f.pose)).length,
  };

  return { inputs, manifest };
}
