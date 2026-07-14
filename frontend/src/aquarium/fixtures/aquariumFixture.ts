// The 'aquarium' fixture: a small, hand-authored scene covering every pose
// at least once, a truthful pellet spread across three rigs (one of which
// overflows the per-rig render cap), a mayor, and one unrigged worker.
// Ground truth for the honesty auditor lives in the returned manifest.
//
// FishEntity.name is `session.alias ?? session.session_name`
// (derive/fish.ts) — every fish spec below sets `alias` to the display name
// the manifest predicts; `name` (AgentResponse.name) is a separate,
// realistic-looking identity used only for the SSOT needs-you join.

import type { AgentResponse, Bead, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import type { AgentPendingSignal } from 'gas-city-dashboard-shared';
import type { DeriveInputs } from '../derive/deriveWorld';
import { poseWord } from '../derive/pose';
import {
  CITY_KEY,
  PELLET_RENDER_CAP_PER_RIG,
  UNRIGGED_KEY,
  type FixtureManifest,
} from '../contracts';
import { buildFixtureBead, buildFishAgent, type FishAgentSpec } from './fixtureEntities';

const RIG_ALPHA = 'reef-alpha';
const RIG_BETA = 'reef-beta';
const RIG_GAMMA = 'reef-gamma';

// One spec per fixture fish, covering all 7 poses across three rigs plus the
// mayor and one unrigged worker. `pose`/`rigKey`/`taskBeadId` drive manifest
// construction below; they are not part of the raw wire payload.
interface AquariumFishSpec extends FishAgentSpec {
  pose: 'working' | 'idle' | 'asleep' | 'awaiting-input' | 'stalled' | 'rate-limited' | 'errored';
  rigKey: string;
}

const FISH_SPECS: readonly AquariumFishSpec[] = [
  {
    name: 'alpha/scout',
    alias: 'scout',
    agentKind: 'pool',
    rig: RIG_ALPHA,
    pose: 'working',
    rigKey: RIG_ALPHA,
    state: 'active',
    running: true,
    activity: 'in-turn',
    contextPct: 62,
    activeBead: 'aq-alpha-1',
    lastActiveMinutesAgo: 1,
  },
  {
    name: 'alpha/mason',
    alias: 'mason',
    agentKind: 'pool',
    rig: RIG_ALPHA,
    pose: 'idle',
    rigKey: RIG_ALPHA,
    state: 'idle',
    running: true,
    contextPct: 18,
    lastActiveMinutesAgo: 12,
  },
  {
    name: 'alpha/warden',
    alias: 'warden',
    agentKind: 'pool',
    rig: RIG_ALPHA,
    pose: 'asleep',
    rigKey: RIG_ALPHA,
    state: 'asleep',
    running: false,
    lastActiveMinutesAgo: 130,
  },
  {
    name: 'alpha/tinker',
    alias: 'tinker',
    agentKind: 'pool',
    rig: RIG_ALPHA,
    pose: 'awaiting-input',
    rigKey: RIG_ALPHA,
    state: 'active',
    running: true,
    contextPct: 74,
    lastActiveMinutesAgo: 3,
    hasPending: true,
    pendingPrompt: 'Approve deploying the staging config to prod?',
  },
  {
    // The fallback-fish path (no live session — fishFromAgent in
    // derive/fish.ts) uses AgentResponse.name verbatim as both `id` and
    // `name`; there is no session.alias to redirect display through, so
    // `name` itself must already be the display name here.
    name: 'drifter',
    rig: RIG_ALPHA,
    pose: 'stalled',
    rigKey: RIG_ALPHA,
    state: 'detached',
    running: false,
    withSession: false,
  },
  {
    name: 'beta/forge',
    alias: 'forge',
    rig: RIG_BETA,
    pose: 'rate-limited',
    rigKey: RIG_BETA,
    state: 'rate-limited',
    running: true,
    contextPct: 55,
    lastActiveMinutesAgo: 20,
  },
  {
    name: 'beta/keeper',
    alias: 'keeper',
    rig: RIG_BETA,
    pose: 'errored',
    rigKey: RIG_BETA,
    state: 'failed',
    running: false,
    contextPct: 88,
    lastActiveMinutesAgo: 45,
  },
  {
    name: 'beta/finch',
    alias: 'finch',
    rig: RIG_BETA,
    pose: 'working',
    rigKey: RIG_BETA,
    state: 'active',
    running: true,
    activity: 'in-turn',
    contextPct: 33,
    activeBead: 'aq-beta-1',
    lastActiveMinutesAgo: 1,
  },
  {
    name: 'gamma/loom',
    alias: 'loom',
    agentKind: 'pool',
    rig: RIG_GAMMA,
    pose: 'idle',
    rigKey: RIG_GAMMA,
    state: 'idle',
    running: true,
    contextPct: 5,
    lastActiveMinutesAgo: 8,
  },
  {
    name: 'gamma/piper',
    alias: 'piper',
    agentKind: 'pool',
    rig: RIG_GAMMA,
    pose: 'asleep',
    rigKey: RIG_GAMMA,
    state: 'asleep',
    running: false,
    lastActiveMinutesAgo: 300,
  },
  {
    // No `rig` — the mayor is cross-rig orchestration, open water. Species
    // detection (derive/species.ts) matches on the name itself, so no
    // separate `alias` is needed: session_name === 'mayor' already wins.
    name: 'mayor',
    pose: 'working',
    rigKey: CITY_KEY,
    state: 'active',
    running: true,
    activity: 'in-turn',
    contextPct: 8,
    lastActiveMinutesAgo: 1,
  },
  {
    // No `rig`, no `pool` in the maintenance set, not a mayor-prefixed name
    // — falls into the residual (no rig) bucket, homed at UNRIGGED_KEY.
    name: 'stray/roamer',
    alias: 'roamer',
    pose: 'idle',
    rigKey: UNRIGGED_KEY,
    state: 'idle',
    running: true,
    contextPct: 40,
    lastActiveMinutesAgo: 15,
  },
];

const ALPHA_BEADS: readonly Bead[] = [
  buildFixtureBead({
    id: 'aq-alpha-1',
    title: 'Fix checkout retry backoff',
    status: 'in_progress',
    assignee: 'alpha/scout',
    agedMinutes: 90,
  }),
  buildFixtureBead({
    id: 'aq-alpha-2',
    title: 'Audit cart telemetry',
    status: 'open',
    agedMinutes: 200,
  }),
  buildFixtureBead({
    id: 'aq-alpha-3',
    title: 'Spike: idempotent submit',
    status: 'open',
    agedMinutes: 340,
  }),
  buildFixtureBead({
    id: 'aq-alpha-4',
    title: 'Waiting on payments API key',
    status: 'blocked',
    agedMinutes: 500,
  }),
];

const BETA_BEADS: readonly Bead[] = [
  buildFixtureBead({
    id: 'aq-beta-1',
    title: 'Write regression suite for billing',
    status: 'in_progress',
    assignee: 'beta/finch',
    agedMinutes: 60,
  }),
  buildFixtureBead({
    id: 'aq-beta-2',
    title: 'Draft billing runbook',
    status: 'open',
    agedMinutes: 400,
  }),
];

/** reef-gamma deliberately exceeds PELLET_RENDER_CAP_PER_RIG so one rig
 *  exercises the "+N" overflow label. */
const GAMMA_OVERFLOW_COUNT = PELLET_RENDER_CAP_PER_RIG + 5;

function buildGammaBeads(): readonly Bead[] {
  return Array.from({ length: GAMMA_OVERFLOW_COUNT }, (_, i) => {
    const n = i + 1;
    const id = `aq-gamma-${String(n).padStart(2, '0')}`;
    return buildFixtureBead({
      id,
      title: `Backlog item ${n}`,
      status: 'open',
      agedMinutes: 60 + n,
    });
  });
}

export function buildAquariumFixture(): { inputs: DeriveInputs; manifest: FixtureManifest } {
  const agents: AgentResponse[] = [];
  const sessions: SessionResponse[] = [];
  const pendingSignals: AgentPendingSignal[] = [];

  for (const spec of FISH_SPECS) {
    const built = buildFishAgent(spec);
    agents.push(built.agent);
    if (built.session !== undefined) sessions.push(built.session);
    if (built.pending !== undefined) pendingSignals.push(built.pending);
  }

  const gammaBeads = buildGammaBeads();
  const allBeads = [...ALPHA_BEADS, ...BETA_BEADS, ...gammaBeads];
  const beadsByRig: DeriveInputs['beadsByRig'] = {
    [RIG_ALPHA]: { items: [...ALPHA_BEADS], total: ALPHA_BEADS.length },
    [RIG_BETA]: { items: [...BETA_BEADS], total: BETA_BEADS.length },
    [RIG_GAMMA]: { items: [...gammaBeads], total: gammaBeads.length },
  };

  const inputs: DeriveInputs = {
    sessions,
    agents,
    rigs: [
      { name: RIG_ALPHA, path: `/rigs/${RIG_ALPHA}` },
      { name: RIG_BETA, path: `/rigs/${RIG_BETA}` },
      { name: RIG_GAMMA, path: `/rigs/${RIG_GAMMA}` },
    ],
    pendingSignals,
    beadsByRig,
  };

  const manifest: FixtureManifest = {
    kind: 'aquarium',
    rigs: [
      { key: RIG_ALPHA, openBeadTotal: ALPHA_BEADS.length },
      { key: RIG_BETA, openBeadTotal: BETA_BEADS.length },
      { key: RIG_GAMMA, openBeadTotal: gammaBeads.length },
    ],
    fish: FISH_SPECS.map((spec) => ({
      name: spec.alias ?? spec.name,
      poseWord: poseWord(spec.pose),
      pose: spec.pose,
      rigKey: spec.rigKey,
      bellyPct: spec.contextPct,
      ...(spec.activeBead !== undefined ? { taskBeadId: spec.activeBead } : {}),
    })),
    pelletBeadIds: allBeads.map((b) => b.id),
    needsAttention: FISH_SPECS.filter((s) => DISTRESS_POSES.has(s.pose)).length,
  };

  return { inputs, manifest };
}

const DISTRESS_POSES: ReadonlySet<AquariumFishSpec['pose']> = new Set([
  'awaiting-input',
  'stalled',
  'rate-limited',
  'errored',
]);
