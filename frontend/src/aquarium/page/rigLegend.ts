// Rig roster for the legend panel: which colour is which rig, so the operator
// can read a school's project at a glance without zooming to a formation label.
// With ~21 live rigs hashing into a bounded hue palette, hue alone is a coarse
// group; this key resolves the exact rig. Sorted by open-bead activity so the
// rigs most present in the water are the ones listed; the long tail folds into
// a "+N" count. Pure and testable — the page feeds it snapshot.formations.

import type { RigFormation } from '../contracts';
import { CITY_KEY } from '../contracts';
import { rigHue } from '../render/rigHue';

export interface RigLegendEntry {
  key: string;
  /** rig identity hue (OKLCH degrees), or null for the neutral unrigged stratum */
  hue: number | null;
  openBeadTotal: number;
}

export interface RigLegend {
  entries: RigLegendEntry[];
  /** rigs beyond the cap, folded into a "+N more" line */
  hiddenCount: number;
}

/** How many rigs the panel lists before folding the rest. Keeps the key compact
 * over the ambient scene; the folded tail is the least-active rigs. */
export const RIG_LEGEND_MAX_ENTRIES = 12;

export function buildRigLegend(
  formations: readonly RigFormation[],
  max: number = RIG_LEGEND_MAX_ENTRIES,
): RigLegend {
  // The mayor's city stratum carries no in-scene label (text.ts skips it), so it
  // gets no legend row either; every other formation — rigs and the neutral
  // unrigged stratum — is a group the operator sees coloured in the water.
  const ranked = formations
    .filter((f) => f.key !== CITY_KEY)
    .map((f) => ({ key: f.key, hue: rigHue(f.key), openBeadTotal: f.openBeadTotal }))
    .sort((a, b) => b.openBeadTotal - a.openBeadTotal || compareKey(a.key, b.key));
  return {
    entries: ranked.slice(0, max),
    hiddenCount: Math.max(0, ranked.length - max),
  };
}

function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
