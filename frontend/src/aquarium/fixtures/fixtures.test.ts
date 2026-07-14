import { describe, expect, it } from 'vitest';
import {
  ALL_POSES,
  CITY_KEY,
  PELLET_RENDER_CAP_PER_RIG,
  UNRIGGED_KEY,
  type AquariumPose,
} from '../contracts';
import {
  buildAquariumFixture,
  buildBlindFixture,
  buildFixtureInputs,
  buildPerfFixture,
} from './index';

function posesOf(fish: readonly { pose: AquariumPose }[]): Set<AquariumPose> {
  return new Set(fish.map((f) => f.pose));
}

describe("'aquarium' fixture", () => {
  const { inputs, manifest } = buildAquariumFixture();

  it('covers all 7 poses at least once', () => {
    const covered = posesOf(manifest.fish);
    for (const pose of ALL_POSES) {
      expect(covered.has(pose), `missing pose "${pose}"`).toBe(true);
    }
  });

  it('has 32-40 fish (a real population, not a handful of solitary fish)', () => {
    expect(manifest.fish.length).toBeGreaterThanOrEqual(32);
    expect(manifest.fish.length).toBeLessThanOrEqual(40);
  });

  it('most fish are working, so each rig schools a visible crew', () => {
    const working = manifest.fish.filter((f) => f.pose === 'working');
    expect(working.length / manifest.fish.length).toBeGreaterThan(0.6);
  });

  it('has 3 rigs, a mayor, and an unrigged shoal', () => {
    expect(manifest.rigs.length).toBe(3);
    const mayor = inputs.agents.find((a) => a.name === 'mayor');
    expect(mayor).toBeDefined();
    expect(mayor?.rig).toBeUndefined();
    const unrigged = manifest.fish.filter((f) => f.rigKey === UNRIGGED_KEY);
    expect(unrigged.length).toBeGreaterThan(1);
  });

  it('has one rig whose open bead total exceeds the render cap', () => {
    const overflowing = manifest.rigs.filter((r) => r.openBeadTotal > PELLET_RENDER_CAP_PER_RIG);
    expect(overflowing.length).toBe(1);
  });

  it('has unique pellet (bead) ids', () => {
    const ids = manifest.pelletBeadIds;
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('needsAttention equals the count of distress-pose fish', () => {
    const distress = manifest.fish.filter((f) =>
      (['awaiting-input', 'stalled', 'rate-limited', 'errored'] as const).includes(f.pose as never),
    );
    expect(manifest.needsAttention).toBe(distress.length);
    expect(manifest.needsAttention).toBeGreaterThan(0);
  });

  it('every fixture bead id is unique across raw inputs (id-level truthfulness parity)', () => {
    const allIds = Object.values(inputs.beadsByRig).flatMap((rig) => rig.items.map((b) => b.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.sort()).toEqual([...manifest.pelletBeadIds].sort());
  });

  it('a rig-homed working fish carries a taskBeadId that resolves to a real in_progress bead', () => {
    // The mayor is also 'working' but patrols rather than holding a task
    // bead (specs/plans/reef-aquarium.md's mayor behavior is patrol, not a
    // pellet-holding pose) — scope this to fish actually homed in a rig.
    const working = manifest.fish.filter((f) => f.pose === 'working' && f.rigKey !== CITY_KEY);
    expect(working.length).toBeGreaterThan(0);
    for (const fish of working) {
      expect(fish.taskBeadId).toBeDefined();
      const bead = Object.values(inputs.beadsByRig)
        .flatMap((rig) => rig.items)
        .find((b) => b.id === fish.taskBeadId);
      expect(bead).toBeDefined();
      expect(bead?.status).toBe('in_progress');
    }
  });

  it('has at least one fish with an indeterminate (undefined) belly percentage', () => {
    expect(manifest.fish.some((f) => f.bellyPct === undefined)).toBe(true);
  });

  it('has at least one distressed fish with no live session (the fallback-fish path)', () => {
    const stalled = manifest.fish.find((f) => f.pose === 'stalled');
    expect(stalled).toBeDefined();
    const hasSession = inputs.sessions.some((s) => s.session_name === stalled?.name);
    expect(hasSession).toBe(false);
  });

  it('does not set blindCams (aquarium-only manifests have none)', () => {
    expect(manifest.blindCams).toBeUndefined();
  });
});

describe("'blind' fixture", () => {
  const { inputs, manifest } = buildBlindFixture();

  it('has exactly 7 fish, one per pose', () => {
    expect(manifest.fish.length).toBe(7);
    const covered = posesOf(manifest.fish);
    expect(covered.size).toBe(7);
    for (const pose of ALL_POSES) {
      expect(covered.has(pose)).toBe(true);
    }
  });

  it('every fish has an empty display name and no task bead', () => {
    for (const fish of manifest.fish) {
      expect(fish.name).toBe('');
      expect(fish.taskBeadId).toBeUndefined();
    }
  });

  it('has blindCams, one per fish, index-aligned with manifest.fish', () => {
    expect(manifest.blindCams).toBeDefined();
    expect(manifest.blindCams?.length).toBe(manifest.fish.length);
  });

  it('every blindCam frames at a zoom strictly below LOD2 (captions never fire)', () => {
    for (const cam of manifest.blindCams ?? []) {
      expect(cam.zoom).toBeGreaterThan(0);
      expect(cam.zoom).toBeLessThan(2.2);
    }
  });

  it('each fish lives alone in its own rig', () => {
    const rigKeys = manifest.fish.map((f) => f.rigKey);
    expect(new Set(rigKeys).size).toBe(rigKeys.length);
    expect(inputs.rigs.length).toBe(7);
  });

  it('has zero pellets (no bead text to leak toward a pose)', () => {
    expect(manifest.pelletBeadIds.length).toBe(0);
  });

  it('every raw agent has a unique non-empty identity (the SSOT needs-you join key), independent of the empty display name', () => {
    // AgentResponse.name is a Map key in shared/src/agents/needsYou.ts —
    // sharing '' across every agent would collapse every distress row onto
    // whichever agent iterates last (a real bug this fixture once had).
    // The DISPLAYED name is session.alias, asserted empty separately below.
    const names = inputs.agents.map((a) => a.name);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const agent of inputs.agents) {
      if (agent.session !== undefined) {
        expect(agent.session.name.length).toBeGreaterThan(0);
      }
    }
    expect(inputs.sessions.every((s) => s.session_name.length > 0)).toBe(true);
  });

  it('every session carries an explicit empty alias — the actual displayed name', () => {
    for (const session of inputs.sessions) {
      expect(session.alias).toBe('');
    }
  });
});

describe("'perf' fixture", () => {
  const { inputs, manifest } = buildPerfFixture();

  it('has 200 fish', () => {
    expect(manifest.fish.length).toBe(200);
  });

  it('has 6 rigs', () => {
    expect(manifest.rigs.length).toBe(6);
    expect(inputs.rigs.length).toBe(6);
  });

  it('has 1000 beads total across rigs', () => {
    const total = Object.values(inputs.beadsByRig).reduce((sum, rig) => sum + rig.items.length, 0);
    expect(total).toBe(1000);
    expect(manifest.pelletBeadIds.length).toBe(1000);
  });

  it('mixes poses rather than using a single pose for every fish', () => {
    const covered = posesOf(manifest.fish);
    expect(covered.size).toBe(7);
  });

  it('every bead id is unique', () => {
    const ids = Object.values(inputs.beadsByRig).flatMap((rig) => rig.items.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildFixtureInputs dispatcher', () => {
  it('routes each FixtureKind to its scene builder', () => {
    expect(buildFixtureInputs('aquarium').manifest.kind).toBe('aquarium');
    expect(buildFixtureInputs('perf').manifest.kind).toBe('perf');
    expect(buildFixtureInputs('blind').manifest.kind).toBe('blind');
  });
});
