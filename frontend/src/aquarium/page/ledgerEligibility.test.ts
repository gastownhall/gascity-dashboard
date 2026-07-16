import { describe, expect, it } from 'vitest';
import type { FishEntity, PelletEntity, RigFormation, WorldSnapshot } from '../contracts';
import { reefFocusIsEligible } from './ledgerEligibility';

const formation: RigFormation = {
  key: 'alpha',
  anchorX: 1_000,
  anchorY: 1_900,
  radius: 200,
  seed: 1,
  openBeadTotal: 1,
};
const pellet: PelletEntity = {
  beadId: 'p0-1',
  label: 'p0-1',
  title: 'urgent',
  linkTo: '/beads?bead=p0-1',
  rigKey: 'alpha',
  state: 'drifting',
  ageFraction: 0,
  radiusScale: 1.8,
  isP0: true,
};
const fish: FishEntity = {
  id: 'agent-1',
  name: 'agent',
  species: 'role',
  isMayor: false,
  pose: 'awaiting-input',
  poseWord: 'awaiting input',
  bellyPct: 50,
  homeKey: 'alpha',
  linkTo: '/agents/agent',
  tombstoned: false,
};

function snapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    fish: [fish],
    formations: [formation],
    pellets: [pellet],
    needsAttention: 1,
    strandedWork: [],
    pelletOverflow: {},
    flow: {
      observedForMs: 0,
      windowMs: 60_000,
      observedRigCount: 1,
      totalRigCount: 1,
      backloggedRigCount: 1,
      movingRigCount: 0,
      stillRigKeys: [],
      p0Waiting: 1,
      receipts: [],
    },
    ...overrides,
  };
}

describe('reefFocusIsEligible', () => {
  it('clears a bead focus when the P0 is picked up', () => {
    expect(
      reefFocusIsEligible(
        snapshot({ pellets: [{ ...pellet, state: 'held' }] }),
        { kind: 'bead', beadId: 'p0-1' },
        [],
      ),
    ).toBe(false);
  });

  it('clears rig and fish focus when their operator rows disappear', () => {
    expect(
      reefFocusIsEligible(
        snapshot({ formations: [{ ...formation, openBeadTotal: 0 }] }),
        { kind: 'rig', rigKey: 'alpha' },
        [],
      ),
    ).toBe(false);
    expect(
      reefFocusIsEligible(
        snapshot({ fish: [{ ...fish, pose: 'idle', poseWord: 'idle' }] }),
        { kind: 'fish', fishId: 'agent-1' },
        [],
      ),
    ).toBe(false);
  });

  it('excludes focus targets belonging to unavailable rigs', () => {
    expect(reefFocusIsEligible(snapshot(), { kind: 'bead', beadId: 'p0-1' }, ['alpha'])).toBe(
      false,
    );
    expect(reefFocusIsEligible(snapshot(), { kind: 'rig', rigKey: 'alpha' }, ['alpha'])).toBe(
      false,
    );
  });
});
