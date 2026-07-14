// Tombstones: a fish that misses one read ghosts (dimmed, last-known facts,
// tombstoned=true) instead of vanishing — a single flaky poll must never
// read as a death. Pure and clock-injected: the caller supplies nowMs.

import type { FishEntity } from '../contracts';

/** How long a missing fish stays a ghost before it is dropped entirely. */
export const TOMBSTONE_WINDOW_MS = 35_000;

export interface FishMemory {
  /** fish id -> wall-clock ms it was last present in a live read. */
  lastSeenMs: Readonly<Record<string, number>>;
  /** fish id -> its last-known full entity, retained while tombstoned. */
  lastKnown: Readonly<Record<string, FishEntity>>;
}

export interface ReconcileFishResult {
  /** live fish, unmodified, followed by any in-window ghosts. */
  fish: FishEntity[];
  memory: FishMemory;
}

export function reconcileFishTombstones(
  liveFish: readonly FishEntity[],
  prevMemory: FishMemory | null,
  nowMs: number,
): ReconcileFishResult {
  const liveIds = new Set(liveFish.map((f) => f.id));
  const lastSeenMs: Record<string, number> = {};
  const lastKnown: Record<string, FishEntity> = {};
  for (const f of liveFish) {
    lastSeenMs[f.id] = nowMs;
    lastKnown[f.id] = f;
  }

  const ghosts =
    prevMemory === null ? [] : missingGhosts(prevMemory, liveIds, nowMs, lastSeenMs, lastKnown);

  return { fish: [...liveFish, ...ghosts], memory: { lastSeenMs, lastKnown } };
}

/** Carries forward every previously-tracked fish that is still missing and
 * still within the tombstone window, preserving its ORIGINAL miss time
 * (not resetting the clock on every ghost round) so the window measures
 * total time-missing, not time-since-last-checked. */
function missingGhosts(
  prevMemory: FishMemory,
  liveIds: ReadonlySet<string>,
  nowMs: number,
  nextLastSeenMs: Record<string, number>,
  nextLastKnown: Record<string, FishEntity>,
): FishEntity[] {
  const ghosts: FishEntity[] = [];
  for (const [id, seenMs] of Object.entries(prevMemory.lastSeenMs)) {
    if (liveIds.has(id)) continue;
    if (nowMs - seenMs >= TOMBSTONE_WINDOW_MS) continue;
    const known = prevMemory.lastKnown[id];
    if (known === undefined) continue;
    ghosts.push({ ...known, tombstoned: true });
    nextLastSeenMs[id] = seenMs;
    nextLastKnown[id] = known;
  }
  return ghosts;
}
