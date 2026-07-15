import { describe, expect, it } from 'vitest';
import type { FishEntity, RigFormation } from '../contracts';
import { CITY_KEY, UNRIGGED_KEY } from '../contracts';
import { rigHue } from '../render/rigHue';
import { buildRigLegend } from './rigLegend';

function formation(key: string, openBeadTotal: number): RigFormation {
  return { key, anchorX: 0, anchorY: 0, radius: 100, seed: 1, openBeadTotal };
}

function fish(homeKey: string, name: string, over: Partial<FishEntity> = {}): FishEntity {
  return {
    id: name,
    name,
    species: 'pool',
    isMayor: false,
    pose: 'working',
    poseWord: 'working',
    bellyPct: 50,
    homeKey,
    linkTo: '',
    tombstoned: false,
    ...over,
  };
}

describe('buildRigLegend', () => {
  it('puts rigs with live agents first (most-crewed first); quiet rigs fold aside', () => {
    const legend = buildRigLegend(
      [formation('aoa', 8), formation('geo', 26), formation('cension', 17)],
      [fish('geo', 'polecat-1'), fish('cension', 'codex-2'), fish('cension', 'codex-3')],
    );
    // cension has 2 agents, geo has 1 → active, most-crewed first; aoa is quiet
    expect(legend.active.map((e) => e.key)).toEqual(['cension', 'geo']);
    expect(legend.quiet.map((e) => e.key)).toEqual(['aoa']);
  });

  it('carries each active rig its live agent names, sorted', () => {
    const legend = buildRigLegend(
      [formation('geo', 10)],
      [fish('geo', 'zeta'), fish('geo', 'alpha')],
    );
    expect(legend.active[0]?.agents).toEqual(['alpha', 'zeta']);
  });

  it('a tombstoned (ghost) fish does not make a rig active', () => {
    const legend = buildRigLegend(
      [formation('geo', 10)],
      [fish('geo', 'ghost', { tombstoned: true })],
    );
    expect(legend.active).toHaveLength(0);
    expect(legend.quiet.map((e) => e.key)).toEqual(['geo']);
  });

  it('carries each rig its identity hue, neutral (null) for the unrigged stratum', () => {
    const legend = buildRigLegend([formation('cension', 5), formation(UNRIGGED_KEY, 3)]);
    const byKey = new Map([...legend.active, ...legend.quiet].map((e) => [e.key, e]));
    expect(byKey.get('cension')?.hue).toBe(rigHue('cension'));
    expect(byKey.get(UNRIGGED_KEY)?.hue).toBeNull();
  });

  it('omits the mayor city stratum (no in-scene label, no legend row)', () => {
    const legend = buildRigLegend(
      [formation(CITY_KEY, 40), formation('aoa', 2)],
      [fish(CITY_KEY, 'mayor'), fish('aoa', 'worker')],
    );
    expect([...legend.active, ...legend.quiet].map((e) => e.key)).toEqual(['aoa']);
  });

  it('orders quiet rigs by open-bead count, busiest first', () => {
    const legend = buildRigLegend([formation('a', 3), formation('b', 20), formation('c', 9)]);
    expect(legend.active).toHaveLength(0);
    expect(legend.quiet.map((e) => e.key)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties on rig key so the order is stable across refreshes', () => {
    const legend = buildRigLegend([formation('beta', 5), formation('alpha', 5)]);
    expect(legend.quiet.map((e) => e.key)).toEqual(['alpha', 'beta']);
  });
});
