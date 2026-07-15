// Rig roster for the legend panel: which colour is which rig, so the operator
// can read a school's project at a glance without zooming to a formation label.
// With ~21 live rigs hashing into a bounded hue palette, hue alone is a coarse
// group; this key resolves the exact rig. Ordered ACTIVE-FIRST — goal #1 is
// "which projects are being worked, by what", so rigs with live agents lead the
// roster and carry their agents' names (the "by whom"); rigs with no live agent
// fold into a "+N quiet" tail the operator can expand. Pure and testable — the
// page feeds it snapshot.formations + snapshot.fish.

import type { FishEntity, RigFormation } from '../contracts';
import { CITY_KEY } from '../contracts';
import { rigHue } from '../render/rigHue';

export interface RigLegendEntry {
  key: string;
  /** rig identity hue (OKLCH degrees), or null for the neutral unrigged stratum */
  hue: number | null;
  openBeadTotal: number;
  /** live (non-ghost) agent names on this rig, sorted; empty = a quiet rig */
  agents: string[];
}

export interface RigLegend {
  /** rigs with ≥1 live agent — always shown, most-crewed first (goal #1) */
  active: RigLegendEntry[];
  /** rigs with no live agent — folded behind a "+N quiet" toggle, busiest first */
  quiet: RigLegendEntry[];
}

/** Live agent names per rig key (a ghost/tombstoned fish is not a live agent, so
 * a rig whose only fish just vanished reads as quiet, not active). */
function agentsByRig(fish: readonly FishEntity[]): Map<string, string[]> {
  const byRig = new Map<string, string[]>();
  for (const f of fish) {
    if (f.tombstoned) continue;
    const list = byRig.get(f.homeKey) ?? [];
    list.push(f.name.length > 0 ? f.name : f.id);
    byRig.set(f.homeKey, list);
  }
  for (const list of byRig.values()) list.sort(compareKey);
  return byRig;
}

export function buildRigLegend(
  formations: readonly RigFormation[],
  fish: readonly FishEntity[] = [],
): RigLegend {
  const agents = agentsByRig(fish);
  // The mayor's city stratum carries no in-scene label (text.ts skips it), so it
  // gets no legend row either; every other formation — rigs and the neutral
  // unrigged stratum — is a group the operator sees coloured in the water.
  const rows: RigLegendEntry[] = formations
    .filter((f) => f.key !== CITY_KEY)
    .map((f) => ({
      key: f.key,
      hue: rigHue(f.key),
      openBeadTotal: f.openBeadTotal,
      agents: agents.get(f.key) ?? [],
    }));
  const active = rows
    .filter((r) => r.agents.length > 0)
    .sort((a, b) => b.agents.length - a.agents.length || byBeadsThenKey(a, b));
  const quiet = rows.filter((r) => r.agents.length === 0).sort(byBeadsThenKey);
  return { active, quiet };
}

function byBeadsThenKey(a: RigLegendEntry, b: RigLegendEntry): number {
  return b.openBeadTotal - a.openBeadTotal || compareKey(a.key, b.key);
}

function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
