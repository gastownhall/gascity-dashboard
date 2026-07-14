import { describe, expect, it } from 'vitest';
import type { FishEntity } from '../contracts';
import { reconcileFishTombstones, TOMBSTONE_WINDOW_MS, type FishMemory } from './tombstones';

function fish(id: string, overrides: Partial<FishEntity> = {}): FishEntity {
  return {
    id,
    name: id,
    species: 'role',
    isMayor: false,
    pose: 'idle',
    poseWord: 'idle',
    bellyPct: undefined,
    homeKey: 'alpha',
    linkTo: `/agents/${id}`,
    tombstoned: false,
    ...overrides,
  };
}

const T0 = 1_000_000;

describe('reconcileFishTombstones', () => {
  it('passes live fish through untouched and seeds memory for them', () => {
    const live = [fish('a'), fish('b')];
    const { fish: out, memory } = reconcileFishTombstones(live, null, T0);
    expect(out).toEqual(live);
    expect(memory.lastSeenMs).toEqual({ a: T0, b: T0 });
  });

  it('ghosts a fish missing from the current read, within the tombstone window', () => {
    const prevMemory: FishMemory = {
      lastSeenMs: { a: T0 },
      lastKnown: { a: fish('a', { pose: 'errored', poseWord: 'errored' }) },
    };
    const { fish: out } = reconcileFishTombstones([], prevMemory, T0 + 10_000);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('a');
    expect(out[0]?.tombstoned).toBe(true);
    expect(out[0]?.pose).toBe('errored'); // retains its last-known facts
  });

  it('drops a fish once the tombstone window has elapsed', () => {
    const prevMemory: FishMemory = { lastSeenMs: { a: T0 }, lastKnown: { a: fish('a') } };
    const { fish: out, memory } = reconcileFishTombstones([], prevMemory, T0 + TOMBSTONE_WINDOW_MS);
    expect(out).toEqual([]);
    expect(memory.lastSeenMs.a).toBeUndefined();
  });

  it('keeps a ghost right up to (but not including) the window boundary', () => {
    const prevMemory: FishMemory = { lastSeenMs: { a: T0 }, lastKnown: { a: fish('a') } };
    const { fish: out } = reconcileFishTombstones([], prevMemory, T0 + TOMBSTONE_WINDOW_MS - 1);
    expect(out).toHaveLength(1);
  });

  it('measures the window from the ORIGINAL miss time across repeated ghost rounds, not each re-derive', () => {
    const prevMemory: FishMemory = { lastSeenMs: { a: T0 }, lastKnown: { a: fish('a') } };
    const round2 = reconcileFishTombstones([], prevMemory, T0 + 10_000);
    expect(round2.memory.lastSeenMs.a).toBe(T0); // unchanged, not bumped to round2's now
    const round3 = reconcileFishTombstones([], round2.memory, T0 + TOMBSTONE_WINDOW_MS);
    expect(round3.fish).toEqual([]); // dropped: 35s since the ORIGINAL miss, not since round2
  });

  it('a fish that reappears is never duplicated and its lastSeen resets to now', () => {
    const prevMemory: FishMemory = { lastSeenMs: { a: T0 }, lastKnown: { a: fish('a') } };
    const revived = fish('a', { pose: 'working', poseWord: 'working' });
    const { fish: out, memory } = reconcileFishTombstones([revived], prevMemory, T0 + 10_000);
    expect(out).toEqual([revived]);
    expect(memory.lastSeenMs.a).toBe(T0 + 10_000);
  });

  it('handles a null previous memory (first-ever call) with no ghosts', () => {
    const { fish: out } = reconcileFishTombstones([fish('a')], null, T0);
    expect(out).toHaveLength(1);
    expect(out.every((f) => !f.tombstoned)).toBe(true);
  });
});
