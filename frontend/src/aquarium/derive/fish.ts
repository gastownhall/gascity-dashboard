// Fish: one per live session, plus a fallback fish for a distressed agent
// with no live session (a stalled/errored/rate-limited/awaiting-input agent
// must never be invisible just because it has no tmux session backing it).

import type { AgentResponse, Bead, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import {
  effectiveContextPct,
  isInFlightStatus,
  parseAssignee,
  selectAgentsNeedingYou,
  type AgentNeedsYou,
  type AgentPendingSignal,
} from 'gas-city-dashboard-shared';
import { resolveRigName, type RigNameSource } from '../../lib/rigNames';
import { CITY_KEY, UNRIGGED_KEY, type FishEntity } from '../contracts';
import { derivePose, poseWord } from './pose';
import { deriveSpecies } from './species';

/** A rig identity with an OPTIONAL path — the DeriveInputs-level shape.
 * resolveRigName requires RigNameSource's path to be a definite string, so
 * buildFish normalizes (missing path -> '', a value no real rig path ever
 * equals) once at the top rather than threading the narrower type through
 * every call site. */
export interface RigLike {
  name: string;
  path?: string;
}

export interface BuildFishInputs {
  sessions: readonly SessionResponse[];
  agents: readonly AgentResponse[];
  pendingSignals: readonly AgentPendingSignal[];
  rigs: ReadonlyArray<RigLike>;
  beadsByRig: Readonly<Record<string, { items: readonly Bead[]; total: number }>>;
  nowMs: number;
}

export interface BuildFishResult {
  fish: FishEntity[];
  /** fish id -> supervisor session id, for session-backed fish only (used
   * downstream to resolve which fish is holding a pellet). */
  sessionIdByFishId: Map<string, string>;
}

export function buildFish(inputs: BuildFishInputs): BuildFishResult {
  const rigs = toRigNameSources(inputs.rigs);
  const needsYouByAgentName = new Map(
    selectAgentsNeedingYou(inputs.agents, inputs.pendingSignals).map((row) => [row.name, row]),
  );
  const distressBySessionName = mapDistressToSessionName(inputs.agents, needsYouByAgentName);
  const taskBeadIdBySessionId = firstInFlightBeadIdBySessionId(inputs.beadsByRig);

  const sessionIdByFishId = new Map<string, string>();
  const sessionFish = inputs.sessions.map((session) => {
    sessionIdByFishId.set(session.session_name, session.id);
    return fishFromSession(
      session,
      distressBySessionName.get(session.session_name),
      rigs,
      taskBeadIdBySessionId,
      inputs.nowMs,
    );
  });

  // Fallback fish are only for agents with NO live session (a.session ===
  // undefined) — an agent whose session is live already got a session-fish
  // above, carrying its distress pose via distressBySessionName.
  const fallbackFish = inputs.agents.flatMap((a) => {
    if (a.session !== undefined) return [];
    const distress = needsYouByAgentName.get(a.name);
    if (distress === undefined) return [];
    return [fishFromAgent(a, distress, rigs, inputs.nowMs)];
  });

  return { fish: [...sessionFish, ...fallbackFish], sessionIdByFishId };
}

function toRigNameSources(rigs: ReadonlyArray<RigLike>): RigNameSource[] {
  return rigs.map((r) => ({ name: r.name, path: r.path ?? '' }));
}

/** Join each agent's distress row (keyed by agent.name) to its live session
 * name via agent.session.name — the only reliable agent<->session key
 * (confirmed by agentPending.ts / sessionSlug.ts's own resolution order). */
function mapDistressToSessionName(
  agents: readonly AgentResponse[],
  needsYouByAgentName: ReadonlyMap<string, AgentNeedsYou>,
): Map<string, AgentNeedsYou> {
  const out = new Map<string, AgentNeedsYou>();
  for (const agent of agents) {
    const sessionName = agent.session?.name;
    if (sessionName === undefined) continue;
    const row = needsYouByAgentName.get(agent.name);
    if (row !== undefined) out.set(sessionName, row);
  }
  return out;
}

/** First in-flight bead per assignee session id, in stable rig-key order —
 * a deterministic tiebreak for the rare case of two in-flight beads sharing
 * an assignee. */
function firstInFlightBeadIdBySessionId(
  beadsByRig: BuildFishInputs['beadsByRig'],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const rigKey of Object.keys(beadsByRig).sort()) {
    for (const bead of beadsByRig[rigKey]!.items) {
      if (!isInFlightStatus(bead.status)) continue;
      const sessionId = parseAssignee(bead.assignee ?? '').sessionId;
      if (sessionId === undefined || out.has(sessionId)) continue;
      out.set(sessionId, bead.id);
    }
  }
  return out;
}

function fishFromSession(
  session: SessionResponse,
  distress: AgentNeedsYou | undefined,
  rigs: ReadonlyArray<RigNameSource>,
  taskBeadIdBySessionId: ReadonlyMap<string, string>,
  nowMs: number,
): FishEntity {
  const { species, isMayor } = deriveSpecies({
    agentKind: session.agent_kind,
    alias: session.alias,
    primaryName: session.session_name,
    displayName: session.display_name,
  });
  const name = session.alias ?? session.session_name;
  const taskBeadId = session.active_bead ?? taskBeadIdBySessionId.get(session.id);
  const pose = derivePose(distress, session, nowMs);
  return {
    id: session.session_name,
    name,
    species,
    isMayor,
    pose,
    poseWord: poseWord(pose),
    bellyPct: effectiveContextPct(session),
    homeKey: homeKeyFor(isMayor, session.rig, rigs),
    ...(taskBeadId !== undefined ? { taskBeadId } : {}),
    linkTo: `/agents/${encodeURIComponent(name)}`,
    tombstoned: false,
  };
}

function fishFromAgent(
  agent: AgentResponse,
  distress: AgentNeedsYou,
  rigs: ReadonlyArray<RigNameSource>,
  nowMs: number,
): FishEntity {
  const { species, isMayor } = deriveSpecies({
    agentKind: undefined,
    alias: agent.name,
    primaryName: agent.name,
    displayName: agent.display_name,
  });
  const pose = derivePose(distress, undefined, nowMs);
  return {
    id: agent.name,
    name: agent.name,
    species,
    isMayor,
    pose,
    poseWord: poseWord(pose),
    bellyPct: effectiveContextPct(agent),
    homeKey: homeKeyFor(isMayor, agent.rig, rigs),
    ...(agent.active_bead !== undefined ? { taskBeadId: agent.active_bead } : {}),
    linkTo: `/agents/${encodeURIComponent(agent.name)}`,
    tombstoned: false,
  };
}

function homeKeyFor(
  isMayor: boolean,
  rig: string | undefined,
  rigs: ReadonlyArray<RigNameSource>,
): string {
  if (isMayor) return CITY_KEY;
  return resolveRigName(rig, rigs) ?? UNRIGGED_KEY;
}
