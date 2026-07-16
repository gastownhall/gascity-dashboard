import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import type { FixtureManifest } from '../contracts';
import type { DeriveInputs } from '../derive/deriveWorld';
import { buildAquariumFixture } from './aquariumFixture';
import { buildFixtureBead } from './fixtureEntities';

const PICKUP_BEAD_ID = 'aq-alpha-scout';
const COMPLETION_BEAD_ID = 'flow-beta-completed';
const ALPHA_RIG = 'reef-alpha';
const BETA_RIG = 'reef-beta';

/** A deterministic two-snapshot scene: one bead becomes held and one leaves
 * the feed. AquariumPage derives the baseline first, then the current inputs,
 * exercising the same session-memory path as live supervisor updates. */
export function buildFlowFixture(): {
  inputs: DeriveInputs;
  transitionBaselineInputs: DeriveInputs;
  manifest: FixtureManifest;
} {
  const current = buildAquariumFixture();
  const alpha = current.inputs.beadsByRig[ALPHA_RIG];
  const beta = current.inputs.beadsByRig[BETA_RIG];
  if (alpha === undefined || beta === undefined) {
    throw new Error('flow fixture requires reef-alpha and reef-beta bead stores');
  }

  const completedBead = buildFixtureBead({
    id: COMPLETION_BEAD_ID,
    title: 'Publish reef transition ledger',
    status: 'open',
    agedMinutes: 45,
  });
  const transitionBaselineInputs: DeriveInputs = {
    ...current.inputs,
    beadsByRig: {
      ...current.inputs.beadsByRig,
      [ALPHA_RIG]: {
        items: alpha.items.map((bead) => (bead.id === PICKUP_BEAD_ID ? releaseBead(bead) : bead)),
        total: alpha.total,
      },
      [BETA_RIG]: { items: [...beta.items, completedBead], total: beta.total + 1 },
    },
  };

  return {
    inputs: current.inputs,
    transitionBaselineInputs,
    manifest: {
      ...current.manifest,
      kind: 'flow',
      recentlyMovingRigKeys: [ALPHA_RIG, BETA_RIG],
    },
  };
}

function releaseBead(bead: Bead): Bead {
  const { assignee: _assignee, ...released } = bead;
  return { ...released, status: 'open' };
}
