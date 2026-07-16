import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import type { FixtureManifest } from '../contracts';
import type { DeriveInputs } from '../derive/deriveWorld';
import { buildAquariumFixture } from './aquariumFixture';

const ORPHANED_BEAD_ID = 'layout-orphaned-work';

/** Worst-case overlay fixture for responsive browser verification. It keeps
 * the representative aquarium scene, then adds one genuinely orphaned bead
 * and one unavailable rig read so attention, stranded work, long counts, and
 * partial coverage are all present in the same deterministic frame. */
export function buildLayoutFixture(): { inputs: DeriveInputs; manifest: FixtureManifest } {
  const base = buildAquariumFixture();
  const targetRig = base.inputs.rigs[0]?.name;
  const unavailableRig = base.inputs.rigs[1]?.name;
  if (targetRig === undefined || unavailableRig === undefined) {
    throw new Error('layout fixture requires at least two named rigs');
  }
  const targetStore = base.inputs.beadsByRig[targetRig];
  if (targetStore === undefined) throw new Error(`layout fixture is missing rig ${targetRig}`);

  const orphaned: Bead = {
    id: ORPHANED_BEAD_ID,
    assignee: 'layout-worker-gc-999999',
    created_at: '2026-07-15T12:00:00.000Z',
    issue_type: 'task',
    status: 'in_progress',
    title: 'Recover the abandoned layout verification run',
  };
  const inputs: DeriveInputs = {
    ...base.inputs,
    unavailableBeadRigKeys: [unavailableRig],
    beadsByRig: {
      ...base.inputs.beadsByRig,
      [targetRig]: {
        items: [...targetStore.items, orphaned],
        total: targetStore.total + 1,
      },
    },
  };
  const manifest: FixtureManifest = {
    ...base.manifest,
    kind: 'layout',
    pelletBeadIds: [...base.manifest.pelletBeadIds, ORPHANED_BEAD_ID],
    rigs: base.manifest.rigs.map((rig) =>
      rig.key === targetRig ? { ...rig, openBeadTotal: rig.openBeadTotal + 1 } : rig,
    ),
  };
  return { inputs, manifest };
}
