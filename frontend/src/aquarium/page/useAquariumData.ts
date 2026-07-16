// Data plumbing for /reef. Deliberately independent of derive/deriveWorld —
// this hook produces the raw DeriveInputs shape (sessions/agents/rigs/
// pendingSignals/beadsByRig) and nothing else, so it is unit-testable
// without the derive pipeline existing (derive owns turning these raw wire
// objects into a WorldSnapshot; AquariumPage wires the two together).

import { useCallback, useMemo } from 'react';
import { errorMessage, GC_EVENT_PREFIX, type AgentPendingSignal } from 'gas-city-dashboard-shared';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { ATTENTION_READ_REFRESH_INTERVAL_MS } from '../../attention/compose';
import { useCachedData } from '../../hooks/useCachedData';
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh';
import { useGcEventRefresh, type GcEventConnState } from '../../hooks/useGcEvents';
import { LOG_COMPONENT, logError } from '../../lib/logging';
import { rigNameOptions } from '../../lib/rigNames';
import { listAgentPendingInteractions } from '../../supervisor/agentPending';
import { listSupervisorAgents, type SupervisorAgentList } from '../../supervisor/agentReads';
import { listSupervisorBeads } from '../../supervisor/beadReads';
import { listSupervisorRigs, type SupervisorRigList } from '../../supervisor/rigReads';
// NOTE: deliberately NOT importing normalizeSessions — it drops
// `active_bead`, which derive/ needs to place a working fish's held
// pellet. DeriveInputs.sessions carries the RAW SessionResponse[] instead.
import { listSupervisorSessions, type SupervisorSessionList } from '../../supervisor/sessionReads';
import type { FixtureKind, FixtureManifest } from '../contracts';
import type { DeriveInputs } from '../derive/deriveWorld';
import { buildFixtureInputs } from '../fixtures';

export type AquariumConnState = GcEventConnState | 'fixture';

export interface AquariumDataResult {
  inputs: DeriveInputs;
  connState: AquariumConnState;
  /** Non-null only in fixture mode — the ground truth AquariumPage exposes
   *  as `window.__aquariumManifest` for the honesty-auditor screenshot pass. */
  manifest: FixtureManifest | null;
  refresh: () => Promise<void>;
}

const RIG_BEAD_LIMIT = 250;
const EMPTY_BEADS_BY_RIG: DeriveInputs['beadsByRig'] = {};
const EMPTY_BEAD_READ: BeadReadResult = { beadsByRig: EMPTY_BEADS_BY_RIG, unavailableRigKeys: [] };
const EMPTY_PENDING: AgentPendingSignal[] = [];
const EMPTY_AGENTS: SupervisorAgentList = { items: [], total: 0 };
const EMPTY_SESSIONS: SupervisorSessionList = { items: [], total: 0 };
const EMPTY_RIGS: SupervisorRigList = { items: [], total: 0 };

/**
 * `fixtureKind === null` is live mode: real supervisor reads, polled +
 * SSE-refreshed. A non-null kind is fixture mode: zero supervisor calls —
 * every live-data fetcher short-circuits to an empty result before it would
 * otherwise hit the network, and the returned `inputs` come from the
 * fixture builder instead.
 */
export function useAquariumData(fixtureKind: FixtureKind | null): AquariumDataResult {
  const isFixture = fixtureKind !== null;

  const agentsCache = useCachedData('agents', () =>
    isFixture ? Promise.resolve(EMPTY_AGENTS) : listSupervisorAgents(),
  );
  const sessionsCache = useCachedData('sessions', () =>
    isFixture ? Promise.resolve(EMPTY_SESSIONS) : listSupervisorSessions(),
  );
  const rigsCache = useCachedData('rigs', () =>
    isFixture ? Promise.resolve(EMPTY_RIGS) : listSupervisorRigs(),
  );

  const agentItems = useMemo(() => agentsCache.data?.items ?? [], [agentsCache.data]);
  const sessionItems = useMemo(() => sessionsCache.data?.items ?? [], [sessionsCache.data]);
  const rigItems = useMemo(() => rigsCache.data?.items ?? [], [rigsCache.data]);

  const pendingKey = `aquarium:pending:${agentItems
    .map((a) => a.name)
    .sort()
    .join(',')}:${sessionItems
    .map((s) => s.id)
    .sort()
    .join(',')}`;
  const pendingCache = useCachedData(pendingKey, async () => {
    if (isFixture) return EMPTY_PENDING;
    const interactions = await listAgentPendingInteractions(agentItems, sessionItems);
    return interactions.map(
      (interaction): AgentPendingSignal =>
        interaction.pending.prompt !== undefined
          ? { agentName: interaction.agentName, prompt: interaction.pending.prompt }
          : { agentName: interaction.agentName },
    );
  });

  const rigNames = useMemo(() => rigNameOptions(rigItems), [rigItems]);
  const beadsKey = `aquarium:beads:${rigNames.join(',')}`;
  const beadsCache = useCachedData(beadsKey, () =>
    isFixture ? Promise.resolve(EMPTY_BEAD_READ) : fetchBeadsByRig(rigNames),
  );

  const refresh = useCallback(async () => {
    if (isFixture) return;
    await Promise.all([
      agentsCache.refresh(),
      sessionsCache.refresh(),
      rigsCache.refresh(),
      pendingCache.refresh(),
      beadsCache.refresh(),
    ]);
  }, [isFixture, agentsCache, sessionsCache, rigsCache, pendingCache, beadsCache]);

  useVisibleRefresh(refresh, ATTENTION_READ_REFRESH_INTERVAL_MS, { enabled: !isFixture });
  const sseState = useGcEventRefresh(
    isFixture ? [] : [GC_EVENT_PREFIX.session, GC_EVENT_PREFIX.bead, 'agent.'],
    () => void refresh(),
  );

  const fixtureScene = useMemo(
    () => (fixtureKind !== null ? buildFixtureInputs(fixtureKind) : null),
    [fixtureKind],
  );

  const liveInputs = useMemo<DeriveInputs>(
    () => ({
      sessions: sessionItems,
      agents: agentItems,
      rigs: rigItems,
      pendingSignals: pendingCache.data ?? EMPTY_PENDING,
      beadsByRig: beadsCache.data?.beadsByRig ?? EMPTY_BEADS_BY_RIG,
      unavailableBeadRigKeys: beadsCache.data?.unavailableRigKeys ?? [],
    }),
    [sessionItems, agentItems, rigItems, pendingCache.data, beadsCache.data],
  );

  return {
    inputs: fixtureScene?.inputs ?? liveInputs,
    connState: isFixture
      ? 'fixture'
      : (beadsCache.data?.unavailableRigKeys.length ?? 0) > 0
        ? 'degraded'
        : sseState,
    manifest: fixtureScene?.manifest ?? null,
    refresh,
  };
}

/**
 * Fan out one bounded bead read per rig (Promise.allSettled — one rejected
 * rig must not blank the others). A rejected leg stays in the map as an empty
 * placeholder and is named in `unavailableRigKeys`; derive uses that marker to
 * preserve prior transition state and exclude the rig from flow claims.
 */
interface BeadReadResult {
  beadsByRig: DeriveInputs['beadsByRig'];
  unavailableRigKeys: string[];
}

async function fetchBeadsByRig(rigNames: readonly string[]): Promise<BeadReadResult> {
  const results = await Promise.allSettled(
    rigNames.map((rigFilter) => listSupervisorBeads({ rigFilter, limit: RIG_BEAD_LIMIT })),
  );
  const beadsByRig: Record<string, { items: Bead[]; total: number }> = {};
  const unavailableRigKeys: string[] = [];
  results.forEach((result, i) => {
    const rigName = rigNames[i];
    if (rigName === undefined) return;
    if (result.status === 'fulfilled') {
      beadsByRig[rigName] = { items: result.value.items, total: result.value.total };
      if (result.value.partial) unavailableRigKeys.push(rigName);
    } else {
      logError(
        LOG_COMPONENT.aquarium,
        `bead read failed for rig "${rigName}": ${errorMessage(result.reason)}`,
      );
      beadsByRig[rigName] = { items: [], total: 0 };
      unavailableRigKeys.push(rigName);
    }
  });
  return { beadsByRig, unavailableRigKeys };
}
