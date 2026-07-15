import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { CITY_KEY, UNRIGGED_KEY, WORLD } from '../contracts';
import { buildFormations, formationCoreRadius, type FormationInputs } from './formations';

function bead(id: string): Bead {
  return { id, created_at: '2026-01-01T00:00:00Z', issue_type: 'task', status: 'open', title: id };
}

function beadsByRig(entries: Record<string, number>): FormationInputs['beadsByRig'] {
  const out: Record<string, { items: Bead[]; total: number }> = {};
  for (const [key, total] of Object.entries(entries)) {
    out[key] = {
      items: Array.from({ length: Math.min(total, 3) }, (_, i) => bead(`${key}-${i}`)),
      total,
    };
  }
  return out;
}

describe('buildFormations', () => {
  it('is deterministic for identical inputs', () => {
    const inputs: FormationInputs = {
      beadsByRig: beadsByRig({ alpha: 5, beta: 2 }),
      fishHomeKeys: ['alpha', 'alpha', 'beta'],
    };
    const first = buildFormations(inputs);
    const second = buildFormations(inputs);
    expect(second).toEqual(first);
  });

  it('unions beadsByRig keys and fish homeKeys, one formation per key', () => {
    const inputs: FormationInputs = {
      beadsByRig: beadsByRig({ alpha: 3 }),
      fishHomeKeys: ['beta', 'beta'],
    };
    const keys = buildFormations(inputs)
      .map((f) => f.key)
      .sort();
    expect(keys).toEqual(['alpha', 'beta']);
  });

  it('never emits a formation for CITY_KEY', () => {
    const inputs: FormationInputs = {
      beadsByRig: { [CITY_KEY]: { items: [bead('c-1')], total: 1 } },
      fishHomeKeys: [CITY_KEY, CITY_KEY],
    };
    expect(buildFormations(inputs)).toEqual([]);
  });

  it('includes UNRIGGED_KEY only when it has fish or pellets', () => {
    expect(buildFormations({ beadsByRig: {}, fishHomeKeys: [] })).toEqual([]);

    const withFish = buildFormations({ beadsByRig: {}, fishHomeKeys: [UNRIGGED_KEY] });
    expect(withFish.map((f) => f.key)).toEqual([UNRIGGED_KEY]);

    const withPellets = buildFormations({
      beadsByRig: { [UNRIGGED_KEY]: { items: [bead('u-1')], total: 1 } },
      fishHomeKeys: [],
    });
    expect(withPellets.map((f) => f.key)).toEqual([UNRIGGED_KEY]);
  });

  it('sets openBeadTotal from beadsByRig[key].total, defaulting to 0 when absent', () => {
    const inputs: FormationInputs = {
      beadsByRig: beadsByRig({ alpha: 17 }),
      fishHomeKeys: ['alpha', 'beta'],
    };
    const byKey = new Map(buildFormations(inputs).map((f) => [f.key, f]));
    expect(byKey.get('alpha')?.openBeadTotal).toBe(17);
    expect(byKey.get('beta')?.openBeadTotal).toBe(0);
  });

  it('scales radius with crew count within the [140, 420] clamp, with per-rig size variety', () => {
    const inputs: FormationInputs = {
      beadsByRig: beadsByRig({ solo: 0, crowded: 0 }),
      fishHomeKeys: [...Array(50).fill('crowded')] as string[],
    };
    const byKey = new Map(buildFormations(inputs).map((f) => [f.key, f]));
    const solo = byKey.get('solo')!;
    const crowded = byKey.get('crowded')!;
    // A huge crew saturates the size ceiling; a zero-crew rig sits near the floor.
    expect(crowded.radius).toBe(420);
    expect(solo.radius).toBeGreaterThanOrEqual(140);
    // Crew still drives size: the crowded rig is far larger than the solo one.
    expect(solo.radius).toBeLessThan(crowded.radius);
    // Every formation stays inside the clamp envelope.
    for (const f of buildFormations(layoutInputs())) {
      expect(f.radius).toBeGreaterThanOrEqual(140);
      expect(f.radius).toBeLessThanOrEqual(420);
    }
  });

  it('gives equal-crew rigs gently different footprints (size variety, not one repeated icon)', () => {
    const inputs: FormationInputs = {
      beadsByRig: {},
      fishHomeKeys: ['ay', 'ay', 'ay', 'bee', 'bee', 'bee'],
    };
    const byKey = new Map(buildFormations(inputs).map((f) => [f.key, f]));
    expect(byKey.get('ay')!.radius).not.toBe(byKey.get('bee')!.radius);
  });

  it('seeds each formation deterministically from a hash of its key', () => {
    const inputs: FormationInputs = { beadsByRig: beadsByRig({ alpha: 1 }), fishHomeKeys: [] };
    const [formation] = buildFormations(inputs);
    expect(formation).toBeDefined();
    expect(Number.isInteger(formation!.seed)).toBe(true);
    expect(formation!.seed).toBeGreaterThanOrEqual(0);
  });

  it('places anchors on the seabed band within the world bounds, at varied depths', () => {
    const inputs: FormationInputs = {
      beadsByRig: beadsByRig({ alpha: 1, beta: 2, gamma: 3, delta: 1 }),
      fishHomeKeys: [],
    };
    for (const f of buildFormations(inputs)) {
      expect(f.anchorY).toBeGreaterThanOrEqual(WORLD.seabedY);
      expect(f.anchorY).toBeLessThan(WORLD.height);
      expect(f.anchorX).toBeGreaterThan(0);
      expect(f.anchorX).toBeLessThan(WORLD.width);
    }
  });

  const layoutInputs = (): FormationInputs => {
    const rigKeys = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    const crewCounts = [1, 3, 6, 2, 8, 4, 1, 5];
    const fishHomeKeys = rigKeys.flatMap((key, i) => Array(crewCounts[i]).fill(key) as string[]);
    return {
      beadsByRig: beadsByRig(Object.fromEntries(rigKeys.map((k) => [k, 2]))),
      fishHomeKeys,
    };
  };

  it('keeps CORES from overlapping while allowing silhouettes to cluster', () => {
    const formations = [...buildFormations(layoutInputs())].sort((a, b) => a.anchorX - b.anchorX);
    expect(formations).toHaveLength(8);
    for (let i = 1; i < formations.length; i += 1) {
      const prev = formations[i - 1]!;
      const cur = formations[i]!;
      const centerGap = cur.anchorX - prev.anchorX;
      expect(centerGap).toBeGreaterThanOrEqual(
        formationCoreRadius(prev.radius) + formationCoreRadius(cur.radius),
      );
    }
  });

  it('spaces formations irregularly — varied gaps, not a bar chart', () => {
    const formations = [...buildFormations(layoutInputs())].sort((a, b) => a.anchorX - b.anchorX);
    const gaps = formations.slice(1).map((f, i) => f.anchorX - formations[i]!.anchorX);
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread).toBeGreaterThan(60);
  });

  // A busy city (ds-research: 22 rigs) needs more cores+gaps than the 3600-wu
  // usable band, so the min-gap ratchet used to run the chain off the tank
  // (max anchorX ~7400, ~2x WORLD.width); those formations were wall-clamped and
  // their schools piled on the right. The chain must fold back into the band.
  const largeFleetInputs = (): FormationInputs => {
    const rigKeys = Array.from({ length: 26 }, (_, i) => `rig-${i.toString().padStart(2, '0')}`);
    const fishHomeKeys = rigKeys.flatMap((key) => Array(8).fill(key) as string[]);
    return {
      beadsByRig: beadsByRig(Object.fromEntries(rigKeys.map((k) => [k, 5]))),
      fishHomeKeys,
    };
  };

  it('folds a tank-overflowing fleet back into the world, centred (no right-wall pile)', () => {
    const formations = [...buildFormations(largeFleetInputs())].sort(
      (a, b) => a.anchorX - b.anchorX,
    );
    expect(formations).toHaveLength(26);
    for (const f of formations) {
      // no anchor past the world (the bug shoved them to ~7400); a wall-clamped
      // school is what produced the pile.
      expect(f.anchorX).toBeGreaterThan(0);
      expect(f.anchorX).toBeLessThan(WORLD.width);
    }
    // the CORE-gap floor still holds after compression — radii shrink with the
    // positions, so cores never interpenetrate (this is the invariant a naive
    // position-only rescale broke: it would merge every rig's shoal home).
    for (let i = 1; i < formations.length; i += 1) {
      const prev = formations[i - 1]!;
      const cur = formations[i]!;
      expect(cur.anchorX - prev.anchorX).toBeGreaterThanOrEqual(
        formationCoreRadius(prev.radius) + formationCoreRadius(cur.radius),
      );
    }
    const centroid = formations.reduce((sum, f) => sum + f.anchorX, 0) / formations.length;
    // centroid lands near the world midpoint the home camera frames on
    expect(centroid).toBeGreaterThan(WORLD.width / 2 - 350);
    expect(centroid).toBeLessThan(WORLD.width / 2 + 350);
  });

  it('leaves a fleet that already fits unchanged and deterministic', () => {
    // The 8-rig layout fits the band, so folding is a no-op: still deterministic
    // and still honouring the CORE-gap floor (locked by the tests above).
    const first = buildFormations(layoutInputs());
    const second = buildFormations(layoutInputs());
    expect(second).toEqual(first);
    const span =
      Math.max(...first.map((f) => f.anchorX)) - Math.min(...first.map((f) => f.anchorX));
    expect(span).toBeLessThan(WORLD.width - 2 * 200); // within the usable band → untouched
  });

  it('varies formation depth so bases are not all on one baseline', () => {
    const formations = buildFormations(layoutInputs());
    const distinctDepths = new Set(formations.map((f) => f.anchorY));
    expect(distinctDepths.size).toBeGreaterThan(1);
  });

  it('spreads formation depth across distinct planes, wider than the round-3 band', () => {
    const ys = buildFormations(layoutInputs()).map((f) => f.anchorY);
    const depthSpread = Math.max(...ys) - Math.min(...ys);
    // Round-3 produced ~199 wu of spread for this layout; round 4 widens the
    // seabed-depth band so near/far formations occupy visibly different planes.
    expect(depthSpread).toBeGreaterThan(240);
    // Bases stay on the seabed and never sink off the bottom of the tank.
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(WORLD.seabedY);
      expect(y).toBeLessThan(WORLD.height);
    }
  });
});
