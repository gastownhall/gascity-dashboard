// Pellets: every rendered pellet IS a real bead. State comes straight off
// the bead's own status (isOpenStatus/isInFlightStatus/isBlockedStatus are
// the shared SSOT normalizer — cased/padded wire spellings still classify),
// never invented. A bead whose status is none of the three known pellet
// states (e.g. closed) simply isn't a pellet.

import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { isBlockedStatus, isInFlightStatus, isOpenStatus, parseAssignee } from 'gas-city-dashboard-shared';
import { PELLET_RENDER_CAP_PER_RIG, type PelletEntity, type PelletState } from '../contracts';

export interface BuildPelletsInputs {
  beadsByRig: Readonly<Record<string, { items: readonly Bead[]; total: number }>>;
  /** fish id -> its session id, for resolving a held pellet's holder. */
  sessionIdsByFishId: ReadonlyMap<string, string>;
}

/** Where a live (non-eaten) pellet lives, for the next call's diff-eater. */
export interface BeadHolder {
  rigKey: string;
  fishId: string | undefined;
}

export interface BuildPelletsResult {
  /** capped, render-eligible pellets (drifting/held/sunken only). */
  pellets: PelletEntity[];
  pelletOverflow: Record<string, number>;
  /** the FULL (uncapped) bead-id -> holder map for this call — the
   * diff-eater's basis, so a bead evicted only by the per-rig cap is never
   * mistaken for a closed (eaten) bead. */
  beadHolders: Record<string, BeadHolder>;
}

const LABEL_MAX_LEN = 12;

export function buildPellets(inputs: BuildPelletsInputs): BuildPelletsResult {
  const sessionIdToFishId = invert(inputs.sessionIdsByFishId);
  const pellets: PelletEntity[] = [];
  const pelletOverflow: Record<string, number> = {};
  const beadHolders: Record<string, BeadHolder> = {};

  for (const [rigKey, entry] of sortedEntries(inputs.beadsByRig)) {
    const rigPellets = entry.items.flatMap((bead) => toPellet(bead, rigKey, sessionIdToFishId));
    for (const p of rigPellets) beadHolders[p.beadId] = { rigKey: p.rigKey, fishId: p.fishId };
    const { rendered, overflow } = capPerRig(rigPellets);
    pellets.push(...rendered);
    if (overflow > 0) pelletOverflow[rigKey] = overflow;
  }

  return { pellets, pelletOverflow, beadHolders };
}

function toPellet(
  bead: Bead,
  rigKey: string,
  sessionIdToFishId: ReadonlyMap<string, string>,
): PelletEntity[] {
  const state = pelletStateForStatus(bead.status);
  if (state === undefined) return [];
  const fishId =
    state === 'held' ? sessionIdToFishId.get(parseAssignee(bead.assignee ?? '').sessionId ?? '') : undefined;
  return [
    {
      beadId: bead.id,
      label: pelletLabel(bead.id),
      rigKey,
      state,
      ...(fishId !== undefined ? { fishId } : {}),
    },
  ];
}

function pelletStateForStatus(status: string): PelletState | undefined {
  if (isOpenStatus(status)) return 'drifting';
  if (isInFlightStatus(status)) return 'held';
  if (isBlockedStatus(status)) return 'sunken';
  return undefined;
}

/** Short display id for LOD2 labels: verbatim if short, else the last 12
 * characters with a leading ellipsis. Also reused by the diff-eater so an
 * 'eaten' pellet's label is derived the same way as a live one's. */
export function pelletLabel(beadId: string): string {
  if (beadId.length <= LABEL_MAX_LEN) return beadId;
  return `…${beadId.slice(-LABEL_MAX_LEN)}`;
}

/** Rendered-pellet priority: held (visible work) > sunken (blocked, needs
 * eyes) > drifting (queue depth, least urgent to see individually). */
const STATE_PRIORITY: Readonly<Record<PelletState, number>> = {
  held: 0,
  sunken: 1,
  drifting: 2,
  eaten: 3,
};

function capPerRig(rigPellets: readonly PelletEntity[]): {
  rendered: PelletEntity[];
  overflow: number;
} {
  if (rigPellets.length <= PELLET_RENDER_CAP_PER_RIG) {
    return { rendered: [...rigPellets], overflow: 0 };
  }
  const ordered = [...rigPellets].sort(
    (a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state],
  );
  return {
    rendered: ordered.slice(0, PELLET_RENDER_CAP_PER_RIG),
    overflow: rigPellets.length - PELLET_RENDER_CAP_PER_RIG,
  };
}

function invert(map: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [fishId, sessionId] of map) out.set(sessionId, fishId);
  return out;
}

function sortedEntries<T>(record: Readonly<Record<string, T>>): Array<[string, T]> {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
