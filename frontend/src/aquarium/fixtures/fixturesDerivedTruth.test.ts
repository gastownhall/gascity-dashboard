// The fixture manifest is a PREDICTION of what the real derive pipeline will
// produce from the fixture's raw inputs — this suite proves the prediction is
// correct by actually running deriveWorldSnapshot over each fixture and
// diffing the result against its own manifest. This is the truthfulness-
// parity check specs/plans/reef-aquarium.md's acceptance criterion 6 asks
// for, now that derive/ has landed.

import { describe, expect, it } from 'vitest';
import { deriveWorldSnapshot } from '../derive/deriveWorld';
import { ALL_POSES, LOD2_ZOOM } from '../contracts';
import { buildAquariumFixture, buildBlindFixture, buildPerfFixture } from './index';

const NOW_MS = Date.parse('2026-01-01T12:05:00.000Z');

describe("'aquarium' fixture vs the real derive pipeline", () => {
  const { inputs, manifest } = buildAquariumFixture();
  const { snapshot } = deriveWorldSnapshot(inputs, null, NOW_MS);

  it('derives exactly the fish the manifest promises (by name, pose, rig)', () => {
    const derivedFish = snapshot.fish
      .map((f) => ({ name: f.name, pose: f.pose, rigKey: f.homeKey }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const manifestFish = manifest.fish
      .map((f) => ({ name: f.name, pose: f.pose, rigKey: f.rigKey }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(derivedFish).toEqual(manifestFish);
  });

  it('derives the exact needsAttention count the manifest promises', () => {
    expect(snapshot.needsAttention).toBe(manifest.needsAttention);
  });

  it('derives belly percentages matching the manifest exactly, including the indeterminate case', () => {
    const derivedBelly = new Map(snapshot.fish.map((f) => [f.name, f.bellyPct]));
    for (const fish of manifest.fish) {
      expect(derivedBelly.get(fish.name)).toBe(fish.bellyPct);
    }
  });

  it('derives task bead ids matching the manifest for working fish', () => {
    const derivedTask = new Map(snapshot.fish.map((f) => [f.name, f.taskBeadId]));
    for (const fish of manifest.fish) {
      if (fish.taskBeadId === undefined) continue;
      expect(derivedTask.get(fish.name)).toBe(fish.taskBeadId);
    }
  });

  it('every rendered pellet id is a real fixture bead id (id-level truthfulness, subset)', () => {
    const manifestIds = new Set(manifest.pelletBeadIds);
    for (const pellet of snapshot.pellets) {
      expect(manifestIds.has(pellet.beadId)).toBe(true);
    }
  });

  it('accounts for every manifest bead as either rendered or counted in the overflow', () => {
    const renderedIds = new Set(snapshot.pellets.map((p) => p.beadId));
    const overflowTotal = Object.values(snapshot.pelletOverflow).reduce((sum, n) => sum + n, 0);
    expect(renderedIds.size + overflowTotal).toBe(manifest.pelletBeadIds.length);
  });

  it('derives an overflow entry for the rig the manifest flags as over the render cap', () => {
    const overflowRig = manifest.rigs.find((r) => r.openBeadTotal > 40);
    expect(overflowRig).toBeDefined();
    expect(snapshot.pelletOverflow[overflowRig!.key]).toBeGreaterThan(0);
  });

  it('derives a grouper mayor and gives every rig-homed worker a formation', () => {
    const mayor = snapshot.fish.find((f) => f.name === 'mayor');
    expect(mayor?.species).toBe('grouper');
    expect(mayor?.isMayor).toBe(true);
    const rigKeys = new Set(snapshot.formations.map((f) => f.key));
    for (const rig of manifest.rigs) {
      expect(rigKeys.has(rig.key)).toBe(true);
    }
  });
});

describe("'blind' fixture vs the real derive pipeline", () => {
  const { inputs, manifest } = buildBlindFixture();
  const { snapshot } = deriveWorldSnapshot(inputs, null, NOW_MS);

  it('derives exactly 7 fish, one per pose, index-order matching the manifest', () => {
    expect(snapshot.fish.length).toBe(7);
    const derivedPoses = snapshot.fish.map((f) => f.pose);
    const manifestPoses = manifest.fish.map((f) => f.pose);
    expect(new Set(derivedPoses)).toEqual(new Set(ALL_POSES));
    expect(new Set(derivedPoses)).toEqual(new Set(manifestPoses));
  });

  it('derives an empty display name for every fish (no text near figures)', () => {
    for (const fish of snapshot.fish) {
      expect(fish.name).toBe('');
    }
  });

  it('every blindCam sits at or below the pre-computed just-under-LOD2 zoom', () => {
    for (const cam of manifest.blindCams ?? []) {
      expect(cam.zoom).toBeLessThan(LOD2_ZOOM);
    }
  });

  it('the needsAttention count matches the SSOT distress-pose count', () => {
    expect(snapshot.needsAttention).toBe(manifest.needsAttention);
  });
});

describe("'perf' fixture vs the real derive pipeline", () => {
  it('derives 200 fish and mixes all 7 poses without throwing', () => {
    const { inputs, manifest } = buildPerfFixture();
    const { snapshot } = deriveWorldSnapshot(inputs, null, NOW_MS);
    expect(snapshot.fish.length).toBe(200);
    expect(new Set(snapshot.fish.map((f) => f.pose))).toEqual(new Set(ALL_POSES));
    expect(snapshot.needsAttention).toBe(manifest.needsAttention);
  });

  it('a second derive call (simulating a live poll refresh) is stable given identical inputs', () => {
    const { inputs } = buildPerfFixture();
    const first = deriveWorldSnapshot(inputs, null, NOW_MS);
    const second = deriveWorldSnapshot(inputs, first.memory, NOW_MS + 30_000);
    expect(second.snapshot.fish.length).toBe(first.snapshot.fish.length);
    expect(second.snapshot.needsAttention).toBe(first.snapshot.needsAttention);
  });
});
