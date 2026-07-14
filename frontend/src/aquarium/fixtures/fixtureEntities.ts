// Low-level raw-wire-shape builders shared by the aquarium fixture scenes.
// Every stage of the aquarium pipeline (derive/sim/camera/render) consumes
// RAW supervisor wire objects (SessionResponse/AgentResponse/Bead), never a
// dashboard-invented DTO — so fixtures build those same raw shapes directly
// and the real derive pipeline runs unmodified against them. Field shapes:
// shared/src/generated/gc-supervisor-client/types.gen.ts (crib pattern:
// shared/src/fixtures/test-city/data.ts's specToAgent/buildSessions).

import type { AgentResponse, Bead, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import type { AgentPendingSignal } from 'gas-city-dashboard-shared';

/** Fixed epoch — fixtures are static scenes, not wall-clock relative, so a
 *  timestamp built at fixture-construction time stays valid for the life
 *  of a dev session or a CI run. */
const FIXTURE_EPOCH_MS = Date.parse('2026-01-01T12:00:00.000Z');

function isoMinutesAgo(minutes: number): string {
  return new Date(FIXTURE_EPOCH_MS - minutes * 60_000).toISOString();
}

export interface FishAgentSpec {
  /** AgentResponse.name — the agent's own identity/alias. This is the SSOT
   *  needs-you join key (shared/src/agents/needsYou.ts), NOT what ends up on
   *  screen: derive/fish.ts's FishEntity.name is `session.alias ??
   *  session.session_name`. Set `alias` below to control the displayed name. */
  name: string;
  /** Session identity (SessionResponse.id/session_name, and the `name` on
   *  AgentResponse.session — the three must agree for the pending-interaction
   *  agent<->session join in supervisor/agentPending.ts to work). Defaults
   *  to `name` — real agent/session naming is 1:1 in every fixture except
   *  the blind one, which needs a non-empty session identity alongside an
   *  empty display name. */
  sessionName?: string;
  /** SessionResponse.alias — what derive/fish.ts actually displays as the
   *  fish's name (falling back to the session identity when unset). */
  alias?: string;
  /** SessionResponse.agent_kind — 'pool' forces the small-worker-fish
   *  species (derive/species.ts); anything else (including unset) falls
   *  through to the mayor-name check, then 'role'. */
  agentKind?: string;
  rig?: string;
  pool?: string;
  provider?: string;
  model?: string;
  /** Set on BOTH AgentResponse.state and SessionResponse.state — the SSOT
   *  selector (shared/src/agents/needsYou.ts) reads the agent's state, and
   *  a calm-tier derivation may read the session's; carrying the same word
   *  on both keeps the fixture unambiguous either way. */
  state: string;
  running: boolean;
  /** false models a distressed agent with no live session — the
   *  fallback-fish path (specs/plans/reef-aquarium.md "Tombstones" /
   *  semantic mapping). Defaults to true. */
  withSession?: boolean;
  activity?: string;
  contextPct?: number;
  activeBead?: string;
  lastActiveMinutesAgo?: number;
  hasPending?: boolean;
  pendingPrompt?: string;
}

export interface BuiltFishAgent {
  agent: AgentResponse;
  session?: SessionResponse;
  pending?: AgentPendingSignal;
}

export function buildFishAgent(spec: FishAgentSpec): BuiltFishAgent {
  const withSession = spec.withSession ?? true;
  const sessionName = spec.sessionName ?? spec.name;

  const agent: AgentResponse = {
    name: spec.name,
    state: spec.state,
    available: true,
    running: spec.running,
    suspended: false,
  };
  if (spec.rig !== undefined) agent.rig = spec.rig;
  if (spec.pool !== undefined) agent.pool = spec.pool;
  if (spec.provider !== undefined) agent.provider = spec.provider;
  if (spec.model !== undefined) agent.model = spec.model;
  if (spec.activity !== undefined) agent.activity = spec.activity;
  if (spec.contextPct !== undefined) agent.context_pct = spec.contextPct;
  if (spec.activeBead !== undefined) agent.active_bead = spec.activeBead;

  const pending = buildPendingSignal(spec);

  if (!withSession) {
    return pending !== undefined ? { agent, pending } : { agent };
  }

  agent.session = {
    name: sessionName,
    attached: spec.running,
    ...(spec.lastActiveMinutesAgo !== undefined
      ? { last_activity: isoMinutesAgo(spec.lastActiveMinutesAgo) }
      : {}),
  };

  const session: SessionResponse = {
    id: sessionIdFor(sessionName),
    session_name: sessionName,
    title: sessionName,
    template: 'pool-worker',
    state: spec.state,
    provider: spec.provider ?? 'claude',
    attached: spec.running,
    running: spec.running,
    created_at: isoMinutesAgo(360),
  };
  if (spec.alias !== undefined) session.alias = spec.alias;
  if (spec.agentKind !== undefined) session.agent_kind = spec.agentKind;
  if (spec.rig !== undefined) session.rig = spec.rig;
  if (spec.pool !== undefined) session.pool = spec.pool;
  if (spec.model !== undefined) session.model = spec.model;
  if (spec.activity !== undefined) session.activity = spec.activity;
  if (spec.contextPct !== undefined) session.context_pct = spec.contextPct;
  if (spec.activeBead !== undefined) session.active_bead = spec.activeBead;
  if (spec.lastActiveMinutesAgo !== undefined) {
    session.last_active = isoMinutesAgo(spec.lastActiveMinutesAgo);
  }

  return pending !== undefined ? { agent, session, pending } : { agent, session };
}

function buildPendingSignal(spec: FishAgentSpec): AgentPendingSignal | undefined {
  if (spec.hasPending !== true) return undefined;
  return spec.pendingPrompt !== undefined
    ? { agentName: spec.name, prompt: spec.pendingPrompt }
    : { agentName: spec.name };
}

function sessionIdFor(agentName: string): string {
  return `gc-fx-${agentName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

export interface FixtureBeadSpec {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'blocked';
  assignee?: string;
  agedMinutes?: number;
}

export function buildFixtureBead(spec: FixtureBeadSpec): Bead {
  const bead: Bead = {
    id: spec.id,
    title: spec.title,
    status: spec.status,
    issue_type: 'task',
    created_at: isoMinutesAgo(spec.agedMinutes ?? 30),
  };
  if (spec.assignee !== undefined) bead.assignee = spec.assignee;
  return bead;
}
