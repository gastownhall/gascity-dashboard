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
  buildFlowFixture,
  buildPerfFixture,
} from './index';
import { RICH_FISH_BUDGET } from '../render/fishPainter';

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

  it('has a dense-but-rich population: a real crowd, capped so every fish still shades', () => {
    // lower bound: a real populated reef, not a handful of solitary fish.
    expect(manifest.fish.length).toBeGreaterThanOrEqual(32);
    // upper bound: must stay within the rich-shading budget, or the whole
    // aquarium drops to the cheap flat path and fish read as flat icons again
    // (fishPainter.paintFishLayer gates the rich path on this count).
    expect(manifest.fish.length).toBeLessThanOrEqual(RICH_FISH_BUDGET);
  });

  it('most fish are working, so each rig schools a visible crew', () => {
    const working = manifest.fish.filter((f) => f.pose === 'working');
    expect(working.length / manifest.fish.length).toBeGreaterThan(0.6);
  });

  it('has 3 named rigs plus the unrigged bucket, a mayor, and an unrigged shoal', () => {
    // manifest.rigs is a complete rollup of every "KEY · COUNT" label the
    // scene renders, so the unrigged bucket belongs here too (round-2
    // honesty finding: it rendered on screen with no manifest entry to
    // validate against). CITY_KEY (the mayor) draws no label and stays out.
    expect(manifest.rigs.length).toBe(4);
    const rigKeys = manifest.rigs.map((r) => r.key);
    const namedRigKeys = inputs.rigs.map((r) => r.name);
    expect(namedRigKeys.length).toBe(3);
    expect(rigKeys).toEqual(expect.arrayContaining([...namedRigKeys, UNRIGGED_KEY]));
    const mayor = inputs.agents.find((a) => a.name === 'mayor');
    expect(mayor).toBeDefined();
    expect(mayor?.rig).toBeUndefined();
    const unrigged = manifest.fish.filter((f) => f.rigKey === UNRIGGED_KEY);
    expect(unrigged.length).toBeGreaterThan(1);
  });

  it("manifest.rigs' openBeadTotal for the unrigged bucket matches the fixture's unrigged bead count", () => {
    // The exact regression this bead is fixing: the scene renders
    // "UNRIGGED · N" from beadsByRig[unrigged].total; the manifest entry
    // must equal that same total so the honesty auditor has ground truth.
    const unriggedRig = manifest.rigs.find((r) => r.key === UNRIGGED_KEY);
    expect(unriggedRig).toBeDefined();
    expect(unriggedRig?.openBeadTotal).toBe(inputs.beadsByRig[UNRIGGED_KEY]?.total);
  });

  it('every rig key with fish or pellets appears in manifest.rigs (complete label rollup)', () => {
    const renderedKeys = new Set<string>([
      ...manifest.fish.map((f) => f.rigKey).filter((k) => k !== CITY_KEY),
      ...Object.entries(inputs.beadsByRig)
        .filter(([, rig]) => rig.items.length > 0)
        .map(([key]) => key),
    ]);
    const manifestKeys = new Set(manifest.rigs.map((r) => r.key));
    for (const key of renderedKeys) {
      expect(manifestKeys.has(key), `manifest.rigs is missing rendered rig "${key}"`).toBe(true);
    }
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
    expect(buildFixtureInputs('flow').manifest.kind).toBe('flow');
  });
});

describe("'flow' fixture", () => {
  const scene = buildFlowFixture();

  it('provides a baseline and current snapshot with one expected pickup and completion', () => {
    expect(scene.transitionBaselineInputs).toBeDefined();
    expect(scene.manifest.flowReceipts).toEqual([
      { beadId: 'aq-alpha-scout', rigKey: 'reef-alpha', kind: 'pickup' },
      { beadId: 'flow-beta-completed', rigKey: 'reef-beta', kind: 'completion' },
    ]);
  });
});
