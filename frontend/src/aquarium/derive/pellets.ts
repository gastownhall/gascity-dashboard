// Pellets: every rendered pellet IS a real bead. State comes straight off
// the bead's own status (isOpenStatus/isInFlightStatus/isBlockedStatus are
// the shared SSOT normalizer — cased/padded wire spellings still classify),
// never invented. A bead whose status is none of the three known pellet
// states (e.g. closed) simply isn't a pellet.

import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import {
  isBlockedStatus,
  isInFlightStatus,
  isOpenStatus,
  parseAssignee,
} from 'gas-city-dashboard-shared';
import { PELLET_RENDER_CAP_PER_RIG, type PelletEntity, type PelletState } from '../contracts';

export interface BuildPelletsInputs {
  beadsByRig: Readonly<Record<string, { items: readonly Bead[]; total: number }>>;
  /** fish id -> its session id, for resolving a held pellet's holder. */
  sessionIdsByFishId: ReadonlyMap<string, string>;
  /** wall-clock for bead-age derivation (injected, never Date.now() in derive). */
  nowMs: number;
  /** bead ids present on the previous derive — a bead absent here is newly
   *  arrived and drops in from the surface. Empty on first load (no drop storm). */
  prevBeadIds: ReadonlySet<string>;
}

/** Where a live (non-eaten) pellet lives, for the next call's diff-eater. Carries
 * the title so an eaten pellet's gulp card still names its bead. */
export interface BeadHolder {
  rigKey: string;
  fishId: string | undefined;
  title: string;
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

/** total kept characters when a bead id is middle-elided, split front-heavy so
 * the meaningful, rig-prefixed name survives and a short tail still disambiguates
 * sibling ids. */
const LABEL_HEAD_LEN = 8;
const LABEL_TAIL_LEN = 4;
const LABEL_MAX_LEN = LABEL_HEAD_LEN + LABEL_TAIL_LEN;

/** A bead this old (ms) or older sits at the stale floor of the drift column;
 * a sqrt ramp spreads the many recent beads across the upper column rather than
 * bunching them all near the top. */
const AGE_REF_MS = 7 * 24 * 60 * 60 * 1000;

export function buildPellets(inputs: BuildPelletsInputs): BuildPelletsResult {
  const sessionIdToFishId = invert(inputs.sessionIdsByFishId);
  const hadPrev = inputs.prevBeadIds.size > 0;
  const pellets: PelletEntity[] = [];
  const pelletOverflow: Record<string, number> = {};
  const beadHolders: Record<string, BeadHolder> = {};

  for (const [rigKey, entry] of sortedEntries(inputs.beadsByRig)) {
    const rigPellets = entry.items.flatMap((bead) =>
      toPellet(
        bead,
        rigKey,
        sessionIdToFishId,
        inputs.nowMs,
        hadPrev && !inputs.prevBeadIds.has(bead.id),
      ),
    );
    for (const p of rigPellets)
      beadHolders[p.beadId] = { rigKey: p.rigKey, fishId: p.fishId, title: p.title };
    const { rendered, overflow } = capPerRig(rigPellets);
    pellets.push(...rendered);
    if (overflow > 0) pelletOverflow[rigKey] = overflow;
  }

  return { pellets, pelletOverflow, beadHolders };
}

/** Bead age normalized 0 (fresh) .. 1 (stale) on a sqrt ramp. Unparseable or
 * future timestamps read as fresh. */
export function ageFractionFor(createdAt: string, nowMs: number): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 0;
  const ageMs = Math.max(0, nowMs - created);
  return Math.min(1, Math.sqrt(ageMs / AGE_REF_MS));
}

/** Morsel size multiplier from bead priority (bd: lower number = higher
 * priority). A higher-priority bead is a bigger, choicer morsel. */
export function radiusScaleForPriority(priority: number | null | undefined): number {
  if (priority === null || priority === undefined) return 1;
  if (priority <= 0) return 1.4;
  if (priority === 1) return 1.2;
  if (priority === 2) return 1;
  return 0.85;
}

function toPellet(
  bead: Bead,
  rigKey: string,
  sessionIdToFishId: ReadonlyMap<string, string>,
  nowMs: number,
  arriving: boolean,
): PelletEntity[] {
  const state = pelletStateForStatus(bead.status);
  if (state === undefined) return [];
  const fishId =
    state === 'held'
      ? sessionIdToFishId.get(parseAssignee(bead.assignee ?? '').sessionId ?? '')
      : undefined;
  return [
    {
      beadId: bead.id,
      label: pelletLabel(bead.id),
      title: bead.title,
      rigKey,
      state,
      ageFraction: ageFractionFor(bead.created_at, nowMs),
      radiusScale: radiusScaleForPriority(bead.priority),
      ...(arriving ? { arriving } : {}),
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

/** Short display id for LOD2 labels: verbatim if short, else a middle-ellipsis
 * that keeps the meaningful front (the rig-prefixed name) AND a disambiguating
 * tail — a leading ellipsis cut the front off entirely, hiding the very part
 * that names the bead. Also reused by the diff-eater so an 'eaten' pellet's
 * label is derived the same way as a live one's. */
export function pelletLabel(beadId: string): string {
  if (beadId.length <= LABEL_MAX_LEN) return beadId;
  return `${beadId.slice(0, LABEL_HEAD_LEN)}…${beadId.slice(-LABEL_TAIL_LEN)}`;
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
  const ordered = [...rigPellets].sort((a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state]);
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
