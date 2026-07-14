// The 'aquarium' fixture: the hero LOD0 scene the illusion judge scores.
// Three named rigs each carry a real working SCHOOL (most fish are
// 'working', schooling in the pellet band) plus a mayor and a small
// unrigged shoal — every pose still covered at least once. Ground truth
// for the honesty auditor lives in the returned manifest.
//
// FishEntity.name is `session.alias ?? session.session_name`
// (derive/fish.ts) — every fish spec below sets `alias` to the display name
// the manifest predicts; `name` (AgentResponse.name) is a separate,
// realistic-looking identity used only for the SSOT needs-you join.
//
// A working fish's held pellet must actually resolve to that fish
// (buildPellets in derive/pellets.ts resolves a bead's holder by parsing
// bead.assignee back to a supervisor session id) — so every crew bead's
// `assignee` is built with fixtureEntities.fishSessionId() over the exact
// same agent name the fish spec carries, not a bare display name (which
// does not round-trip through parseAssignee; see fishSessionId's doc).

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
import {
  buildFixtureBead,
  buildFishAgent,
  fishSessionId,
  type FishAgentSpec,
} from './fixtureEntities';

const RIG_ALPHA = 'reef-alpha';
const RIG_BETA = 'reef-beta';
const RIG_GAMMA = 'reef-gamma';

// One spec per fixture fish. `pose`/`rigKey`/`taskBeadId` drive manifest
// construction below; they are not part of the raw wire payload.
interface AquariumFishSpec extends FishAgentSpec {
  pose: 'working' | 'idle' | 'asleep' | 'awaiting-input' | 'stalled' | 'rate-limited' | 'errored';
  rigKey: string;
}

// ---------------------------------------------------------------------------
// Non-working named fish: one idle/asleep/distress personality per rig, the
// mayor patrolling open water, and one idle unrigged wanderer. These carry
// no bead — a fish that isn't 'working' never holds a task pellet.

const NAMED_FISH_SPECS: readonly AquariumFishSpec[] = [
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
    // Working but patrols rather than holding a task bead.
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

// ---------------------------------------------------------------------------
// Working schools: most fish in the tank are 'working' (activity: 'in-turn'),
// each carrying its own in_progress bead — this is what fills the mid-water
// with a real population instead of two or three solitary fish.

interface CrewMember {
  /** display alias; the SSOT identity is `${rigPrefix}/${name}`. */
  name: string;
  /** undefined => indeterminate (slim) belly — truthful, not a fake default. */
  bellyPct?: number;
  beadId: string;
  beadTitle: string;
  beadAgedMinutes: number;
}

interface CrewScene {
  fishSpecs: AquariumFishSpec[];
  beads: Bead[];
}

/** Builds one working fish + one matching in_progress bead per crew member.
 * `rigField` is the raw `rig` wire value (undefined for the unrigged shoal,
 * so homeKeyFor's residual-bucket rule applies instead of a resolved rig). */
function buildWorkingCrew(
  rigPrefix: string,
  rigKey: string,
  rigField: string | undefined,
  members: readonly CrewMember[],
): CrewScene {
  const fishSpecs = members.map((m, i): AquariumFishSpec => {
    const agentName = `${rigPrefix}/${m.name}`;
    return {
      name: agentName,
      alias: m.name,
      agentKind: 'pool',
      ...(rigField !== undefined ? { rig: rigField } : {}),
      pose: 'working',
      rigKey,
      state: 'active',
      running: true,
      activity: 'in-turn',
      activeBead: m.beadId,
      lastActiveMinutesAgo: 1 + (i % 5),
      ...(m.bellyPct !== undefined ? { contextPct: m.bellyPct } : {}),
    };
  });
  const beads = members.map((m) =>
    buildFixtureBead({
      id: m.beadId,
      title: m.beadTitle,
      status: 'in_progress',
      assignee: fishSessionId(`${rigPrefix}/${m.name}`),
      agedMinutes: m.beadAgedMinutes,
    }),
  );
  return { fishSpecs, beads };
}

const ALPHA_CREW: readonly CrewMember[] = [
  {
    name: 'scout',
    bellyPct: 62,
    beadId: 'aq-alpha-scout',
    beadTitle: 'Fix checkout retry backoff',
    beadAgedMinutes: 90,
  },
  {
    name: 'wisp',
    bellyPct: 58,
    beadId: 'aq-alpha-wisp',
    beadTitle: 'Patch retry jitter',
    beadAgedMinutes: 40,
  },
  {
    name: 'nudge',
    beadId: 'aq-alpha-nudge',
    beadTitle: 'Wire idempotency key header',
    beadAgedMinutes: 25,
  },
  {
    name: 'ferry',
    bellyPct: 71,
    beadId: 'aq-alpha-ferry',
    beadTitle: 'Backfill cart abandonment metric',
    beadAgedMinutes: 55,
  },
  {
    name: 'quill',
    bellyPct: 44,
    beadId: 'aq-alpha-quill',
    beadTitle: 'Instrument checkout funnel',
    beadAgedMinutes: 70,
  },
  {
    name: 'basin',
    beadId: 'aq-alpha-basin',
    beadTitle: 'Normalize address validation',
    beadAgedMinutes: 33,
  },
  {
    name: 'coho',
    bellyPct: 81,
    beadId: 'aq-alpha-coho',
    beadTitle: 'Cache warm cart totals',
    beadAgedMinutes: 18,
  },
  {
    name: 'ember',
    bellyPct: 37,
    beadId: 'aq-alpha-ember',
    beadTitle: 'Dedupe webhook retries',
    beadAgedMinutes: 62,
  },
  {
    name: 'marlin',
    bellyPct: 66,
    beadId: 'aq-alpha-marlin',
    beadTitle: 'Guard double-submit on checkout',
    beadAgedMinutes: 22,
  },
  {
    name: 'pearl',
    beadId: 'aq-alpha-pearl',
    beadTitle: 'Trim cart payload size',
    beadAgedMinutes: 47,
  },
];

const BETA_CREW: readonly CrewMember[] = [
  {
    name: 'finch',
    bellyPct: 33,
    beadId: 'aq-beta-finch',
    beadTitle: 'Write regression suite for billing',
    beadAgedMinutes: 60,
  },
  {
    name: 'delta',
    bellyPct: 69,
    beadId: 'aq-beta-delta',
    beadTitle: 'Reconcile invoice totals',
    beadAgedMinutes: 35,
  },
  {
    name: 'skiff',
    beadId: 'aq-beta-skiff',
    beadTitle: 'Patch dunning email template',
    beadAgedMinutes: 50,
  },
  {
    name: 'raven',
    bellyPct: 52,
    beadId: 'aq-beta-raven',
    beadTitle: 'Audit refund latency',
    beadAgedMinutes: 44,
  },
  {
    name: 'pike',
    bellyPct: 90,
    beadId: 'aq-beta-pike',
    beadTitle: 'Spike usage-based tier preview',
    beadAgedMinutes: 28,
  },
  {
    name: 'shoal',
    beadId: 'aq-beta-shoal',
    beadTitle: 'Rewrite proration edge cases',
    beadAgedMinutes: 66,
  },
  {
    name: 'cinder',
    bellyPct: 47,
    beadId: 'aq-beta-cinder',
    beadTitle: 'Backfill dunning metrics',
    beadAgedMinutes: 52,
  },
  {
    name: 'tide',
    bellyPct: 58,
    beadId: 'aq-beta-tide',
    beadTitle: 'Cache tax-rate lookups',
    beadAgedMinutes: 31,
  },
  {
    name: 'crest',
    beadId: 'aq-beta-crest',
    beadTitle: 'Backfill invoice PDF cache',
    beadAgedMinutes: 49,
  },
];

const GAMMA_CREW: readonly CrewMember[] = [
  {
    name: 'drift',
    bellyPct: 63,
    beadId: 'aq-gamma-drift',
    beadTitle: 'Triage inbound webhook errors',
    beadAgedMinutes: 45,
  },
  {
    name: 'anchor',
    beadId: 'aq-gamma-anchor',
    beadTitle: 'Rebalance shard hot spot',
    beadAgedMinutes: 55,
  },
  {
    name: 'moth',
    bellyPct: 39,
    beadId: 'aq-gamma-moth',
    beadTitle: 'Patch retry storm guard',
    beadAgedMinutes: 20,
  },
  {
    name: 'reel',
    bellyPct: 77,
    beadId: 'aq-gamma-reel',
    beadTitle: 'Rotate expired API keys',
    beadAgedMinutes: 65,
  },
  {
    name: 'tallow',
    bellyPct: 55,
    beadId: 'aq-gamma-tallow',
    beadTitle: 'Compact event log segment',
    beadAgedMinutes: 38,
  },
  {
    name: 'kelp',
    bellyPct: 72,
    beadId: 'aq-gamma-kelp',
    beadTitle: 'Shard the event index',
    beadAgedMinutes: 27,
  },
  {
    name: 'mica',
    beadId: 'aq-gamma-mica',
    beadTitle: 'Drain dead-letter queue',
    beadAgedMinutes: 53,
  },
  {
    name: 'brine',
    bellyPct: 45,
    beadId: 'aq-gamma-brine',
    beadTitle: 'Compress cold log tier',
    beadAgedMinutes: 19,
  },
];

const UNRIGGED_CREW: readonly CrewMember[] = [
  {
    name: 'sable',
    bellyPct: 41,
    beadId: 'aq-unrigged-sable',
    beadTitle: 'Patch flaky nightly job',
    beadAgedMinutes: 48,
  },
  {
    name: 'quince',
    beadId: 'aq-unrigged-quince',
    beadTitle: 'Rotate log retention policy',
    beadAgedMinutes: 26,
  },
  {
    name: 'birch',
    bellyPct: 68,
    beadId: 'aq-unrigged-birch',
    beadTitle: 'Audit orphaned worktrees',
    beadAgedMinutes: 58,
  },
  {
    name: 'otter',
    bellyPct: 30,
    beadId: 'aq-unrigged-otter',
    beadTitle: 'Sweep stale feature flags',
    beadAgedMinutes: 33,
  },
  {
    name: 'fen',
    bellyPct: 50,
    beadId: 'aq-unrigged-fen',
    beadTitle: 'Prune stale CI caches',
    beadAgedMinutes: 40,
  },
  {
    name: 'gull',
    beadId: 'aq-unrigged-gull',
    beadTitle: 'Rotate staging credentials',
    beadAgedMinutes: 24,
  },
];

const ALPHA_SCENE = buildWorkingCrew('alpha', RIG_ALPHA, RIG_ALPHA, ALPHA_CREW);
const BETA_SCENE = buildWorkingCrew('beta', RIG_BETA, RIG_BETA, BETA_CREW);
const GAMMA_SCENE = buildWorkingCrew('gamma', RIG_GAMMA, RIG_GAMMA, GAMMA_CREW);
const UNRIGGED_SCENE = buildWorkingCrew('stray', UNRIGGED_KEY, undefined, UNRIGGED_CREW);

const FISH_SPECS: readonly AquariumFishSpec[] = [
  ...NAMED_FISH_SPECS,
  ...ALPHA_SCENE.fishSpecs,
  ...BETA_SCENE.fishSpecs,
  ...GAMMA_SCENE.fishSpecs,
  ...UNRIGGED_SCENE.fishSpecs,
];

// ---------------------------------------------------------------------------
// Backlog beads: open (drifting) and blocked (sunken) queue depth on top of
// each rig's held pellets, for a believable spread. reef-gamma's backlog
// deliberately pushes its total past PELLET_RENDER_CAP_PER_RIG so the "+N"
// overflow label renders for that rig.

const ALPHA_BACKLOG: readonly Bead[] = [
  buildFixtureBead({
    id: 'aq-alpha-b1',
    title: 'Audit cart telemetry',
    status: 'open',
    agedMinutes: 200,
  }),
  buildFixtureBead({
    id: 'aq-alpha-b2',
    title: 'Spike: idempotent submit',
    status: 'open',
    agedMinutes: 340,
  }),
  buildFixtureBead({
    id: 'aq-alpha-b3',
    title: 'Waiting on payments API key',
    status: 'blocked',
    agedMinutes: 500,
  }),
  buildFixtureBead({
    id: 'aq-alpha-b4',
    title: 'Draft checkout SLO doc',
    status: 'open',
    agedMinutes: 220,
  }),
];

const BETA_BACKLOG: readonly Bead[] = [
  buildFixtureBead({
    id: 'aq-beta-b1',
    title: 'Draft billing runbook',
    status: 'open',
    agedMinutes: 400,
  }),
  buildFixtureBead({
    id: 'aq-beta-b2',
    title: 'Waiting on Stripe webhook access',
    status: 'blocked',
    agedMinutes: 300,
  }),
  buildFixtureBead({
    id: 'aq-beta-b3',
    title: 'Audit chargeback trend',
    status: 'open',
    agedMinutes: 140,
  }),
];

const UNRIGGED_BACKLOG: readonly Bead[] = [
  buildFixtureBead({
    id: 'aq-unrigged-b1',
    title: 'Draft worktree hygiene doc',
    status: 'open',
    agedMinutes: 150,
  }),
  buildFixtureBead({
    id: 'aq-unrigged-b2',
    title: 'Survey dead cron jobs',
    status: 'open',
    agedMinutes: 210,
  }),
];

/** reef-gamma deliberately exceeds PELLET_RENDER_CAP_PER_RIG so one rig
 *  exercises the "+N" overflow label. */
const GAMMA_OVERFLOW_MARGIN = 6;
const GAMMA_BACKLOG_COUNT = PELLET_RENDER_CAP_PER_RIG - GAMMA_CREW.length + GAMMA_OVERFLOW_MARGIN;

function buildGammaBacklog(): readonly Bead[] {
  return Array.from({ length: GAMMA_BACKLOG_COUNT }, (_, i) => {
    const n = i + 1;
    const id = `aq-gamma-b${String(n).padStart(2, '0')}`;
    return buildFixtureBead({
      id,
      title: `Backlog item ${n}`,
      status: 'open',
      agedMinutes: 60 + n,
    });
  });
}

const ALPHA_BEADS: readonly Bead[] = [...ALPHA_SCENE.beads, ...ALPHA_BACKLOG];
const BETA_BEADS: readonly Bead[] = [...BETA_SCENE.beads, ...BETA_BACKLOG];
const GAMMA_BEADS: readonly Bead[] = [...GAMMA_SCENE.beads, ...buildGammaBacklog()];
const UNRIGGED_BEADS: readonly Bead[] = [...UNRIGGED_SCENE.beads, ...UNRIGGED_BACKLOG];

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

  const allBeads = [...ALPHA_BEADS, ...BETA_BEADS, ...GAMMA_BEADS, ...UNRIGGED_BEADS];
  const beadsByRig: DeriveInputs['beadsByRig'] = {
    [RIG_ALPHA]: { items: [...ALPHA_BEADS], total: ALPHA_BEADS.length },
    [RIG_BETA]: { items: [...BETA_BEADS], total: BETA_BEADS.length },
    [RIG_GAMMA]: { items: [...GAMMA_BEADS], total: GAMMA_BEADS.length },
    [UNRIGGED_KEY]: { items: [...UNRIGGED_BEADS], total: UNRIGGED_BEADS.length },
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
    // Every key here must be one the scene actually draws a "KEY · COUNT"
    // label for (round-2 honesty finding: unrigged rendered "UNRIGGED · 6"
    // with no manifest entry to validate it against). The mayor/city
    // stratum draws no formation or label, so CITY_KEY stays out.
    rigs: [
      { key: RIG_ALPHA, openBeadTotal: ALPHA_BEADS.length },
      { key: RIG_BETA, openBeadTotal: BETA_BEADS.length },
      { key: RIG_GAMMA, openBeadTotal: GAMMA_BEADS.length },
      { key: UNRIGGED_KEY, openBeadTotal: UNRIGGED_BEADS.length },
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
