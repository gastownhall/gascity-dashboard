// The derive/ entry point: raw supervisor reads -> one truthful WorldSnapshot,
// plus the next DeriveMemory (tombstone lastSeen + diff-eater bead holders).
// Pure and clock-injected — every autonomous fact (asleep threshold, gulp
// timing, tombstone window) flows from `nowMs`, never Date.now().

import type { AgentResponse, Bead, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import type { AgentPendingSignal } from 'gas-city-dashboard-shared';
import type { WorldSnapshot } from '../contracts';
import { buildFish, type RigLike } from './fish';
import { buildFormations } from './formations';
import { buildPellets, type BeadHolder } from './pellets';
import { diffEatenPellets } from './eating';
import { reconcileFishTombstones, type FishMemory } from './tombstones';
import { isDistressPose } from './pose';

export interface DeriveInputs {
  sessions: SessionResponse[];
  agents: AgentResponse[];
  rigs: Array<RigLike>;
  pendingSignals: AgentPendingSignal[];
  beadsByRig: Record<string, { items: Bead[]; total: number }>;
}

export interface DeriveMemory {
  fish: FishMemory;
  /** the full (uncapped) bead-holder map from the previous call — the
   * diff-eater's basis for detecting a bead that left the feed. */
  prevBeadHolders: Record<string, BeadHolder>;
}

export function deriveWorldSnapshot(
  inputs: DeriveInputs,
  memory: DeriveMemory | null,
  nowMs: number,
): { snapshot: WorldSnapshot; memory: DeriveMemory } {
  const { fish: liveFish, sessionIdByFishId } = buildFish({
    sessions: inputs.sessions,
    agents: inputs.agents,
    pendingSignals: inputs.pendingSignals,
    rigs: inputs.rigs,
    beadsByRig: inputs.beadsByRig,
    nowMs,
  });
  const { fish, memory: fishMemory } = reconcileFishTombstones(
    liveFish,
    memory?.fish ?? null,
    nowMs,
  );

  const {
    pellets: rawPellets,
    pelletOverflow,
    beadHolders,
  } = buildPellets({
    beadsByRig: inputs.beadsByRig,
    sessionIdsByFishId: sessionIdByFishId,
  });
  const eatenPellets = diffEatenPellets(
    new Map(Object.entries(beadHolders)),
    memory?.prevBeadHolders ?? {},
  );

  const formations = buildFormations({
    beadsByRig: inputs.beadsByRig,
    fishHomeKeys: fish.map((f) => f.homeKey),
  });

  const needsAttention = fish.filter((f) => !f.tombstoned && isDistressPose(f.pose)).length;

  return {
    snapshot: {
      formations,
      fish,
      pellets: [...rawPellets, ...eatenPellets],
      needsAttention,
      pelletOverflow,
    },
    memory: { fish: fishMemory, prevBeadHolders: beadHolders },
  };
}
