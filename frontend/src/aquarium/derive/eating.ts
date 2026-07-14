// The diff-eater: a bead that left the render-eligible set between derive
// calls (closed, or removed from the feed) triggers exactly one 'eaten'
// gulp on its last-known holder. Never timer-invented — purely a diff of
// this call's full bead-holder map against the previous call's.
//
// Single-emission is structural, not tracked with a seen-set: the caller
// (deriveWorld.ts) replaces memory.prevBeadHolders with THIS call's full
// map every time, so a bead that just ate its one gulp is already absent
// from next call's "prev" and can never re-diff as eaten again.

import type { PelletEntity } from '../contracts';
import { pelletLabel, type BeadHolder } from './pellets';

/** Duration of the gulp animation once a pellet is eaten. */
export const GULP_MS = 1200;

export function diffEatenPellets(
  currentBeadHolders: ReadonlyMap<string, BeadHolder>,
  prevBeadHolders: Readonly<Record<string, BeadHolder>>,
): PelletEntity[] {
  const vanishedIds = Object.keys(prevBeadHolders)
    .filter((beadId) => !currentBeadHolders.has(beadId))
    .sort();

  return vanishedIds.map((beadId) => {
    const holder = prevBeadHolders[beadId]!;
    return {
      beadId,
      label: pelletLabel(beadId),
      title: holder.title,
      rigKey: holder.rigKey,
      state: 'eaten',
      gulpMsLeft: GULP_MS,
      ...(holder.fishId !== undefined ? { fishId: holder.fishId } : {}),
    };
  });
}
