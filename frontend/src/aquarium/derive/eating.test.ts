import { describe, expect, it } from 'vitest';
import type { BeadHolder } from './pellets';
import { diffEatenPellets, GULP_MS } from './eating';

describe('diffEatenPellets', () => {
  it('emits one eaten pellet, carrying the bead title, for a bead present in prev but absent now', () => {
    const prev: Record<string, BeadHolder> = {
      'gc-1': { rigKey: 'alpha', fishId: 'fish-1', title: 'wire the reef legend' },
    };
    const eaten = diffEatenPellets(new Map(), prev);
    expect(eaten).toHaveLength(1);
    expect(eaten[0]).toMatchObject({
      beadId: 'gc-1',
      rigKey: 'alpha',
      state: 'eaten',
      fishId: 'fish-1',
      title: 'wire the reef legend',
      gulpMsLeft: GULP_MS,
    });
  });

  it('emits nothing for a bead still present now', () => {
    const prev: Record<string, BeadHolder> = {
      'gc-1': { rigKey: 'alpha', fishId: 'fish-1', title: 't' },
    };
    const current = new Map([['gc-1', { rigKey: 'alpha', fishId: 'fish-1', title: 't' }]]);
    expect(diffEatenPellets(current, prev)).toEqual([]);
  });

  it('emits nothing when prev is empty (first-ever call)', () => {
    expect(diffEatenPellets(new Map(), {})).toEqual([]);
  });

  it('omits fishId when the vanished bead had no known holder', () => {
    const prev: Record<string, BeadHolder> = {
      'gc-1': { rigKey: 'alpha', fishId: undefined, title: '' },
    };
    const eaten = diffEatenPellets(new Map(), prev);
    expect(eaten[0]?.fishId).toBeUndefined();
  });

  it('labels an eaten pellet the same way a live pellet would be labeled', () => {
    const longId = 'gascity-dashboard-mwx0-extra-long-id';
    const prev: Record<string, BeadHolder> = {
      [longId]: { rigKey: 'alpha', fishId: undefined, title: '' },
    };
    const eaten = diffEatenPellets(new Map(), prev);
    expect(eaten[0]?.label).toBe('gascity-…g-id');
  });

  it('emits one row per vanished bead, sorted deterministically by bead id', () => {
    const prev: Record<string, BeadHolder> = {
      'gc-2': { rigKey: 'alpha', fishId: undefined, title: '' },
      'gc-1': { rigKey: 'alpha', fishId: undefined, title: '' },
    };
    const eaten = diffEatenPellets(new Map(), prev);
    expect(eaten.map((p) => p.beadId)).toEqual(['gc-1', 'gc-2']);
  });
});
