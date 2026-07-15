import { describe, expect, it } from 'vitest';
import type { RigFormation } from '../contracts';
import { CITY_KEY, UNRIGGED_KEY } from '../contracts';
import { rigHue } from '../render/rigHue';
import { buildRigLegend } from './rigLegend';

function formation(key: string, openBeadTotal: number): RigFormation {
  return { key, anchorX: 0, anchorY: 0, radius: 100, seed: 1, openBeadTotal };
}

describe('buildRigLegend', () => {
  it('ranks rigs by open-bead activity, most-present first', () => {
    const legend = buildRigLegend([
      formation('aoa', 8),
      formation('geo', 26),
      formation('cension', 17),
    ]);
    expect(legend.entries.map((e) => e.key)).toEqual(['geo', 'cension', 'aoa']);
    expect(legend.hiddenCount).toBe(0);
  });

  it('carries each rig its identity hue, neutral (null) for the unrigged stratum', () => {
    const legend = buildRigLegend([formation('cension', 5), formation(UNRIGGED_KEY, 3)]);
    const byKey = new Map(legend.entries.map((e) => [e.key, e]));
    expect(byKey.get('cension')?.hue).toBe(rigHue('cension'));
    expect(byKey.get(UNRIGGED_KEY)?.hue).toBeNull();
  });

  it('omits the mayor city stratum (no in-scene label, no legend row)', () => {
    const legend = buildRigLegend([formation(CITY_KEY, 40), formation('aoa', 2)]);
    expect(legend.entries.map((e) => e.key)).toEqual(['aoa']);
  });

  it('caps the list and folds the long tail into hiddenCount', () => {
    const many = Array.from({ length: 15 }, (_, i) => formation(`rig-${i}`, i));
    const legend = buildRigLegend(many, 12);
    expect(legend.entries).toHaveLength(12);
    expect(legend.hiddenCount).toBe(3);
    // the folded ones are the least active (rig-0..rig-2, open beads 0..2)
    expect(legend.entries.some((e) => e.key === 'rig-0')).toBe(false);
    expect(legend.entries[0]?.key).toBe('rig-14');
  });

  it('breaks ties on rig key so the order is stable across refreshes', () => {
    const legend = buildRigLegend([formation('beta', 5), formation('alpha', 5)]);
    expect(legend.entries.map((e) => e.key)).toEqual(['alpha', 'beta']);
  });
});
