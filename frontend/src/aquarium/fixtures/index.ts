// Fixture entry point. `AquariumPage` (dev-only, `?fixture=<kind>`) and the
// snapshot harness both go through this single dispatcher — one place maps
// a `FixtureKind` to its scene, so a new kind can never be reachable from
// the URL without also being wired here.

import type { DeriveInputs } from '../derive/deriveWorld';
import type { FixtureKind, FixtureManifest } from '../contracts';
import { buildAquariumFixture } from './aquariumFixture';
import { buildPerfFixture } from './perfFixture';
import { buildBlindFixture } from './blindFixture';
import { buildFlowFixture } from './flowFixture';
import { buildLayoutFixture } from './layoutFixture';

export interface FixtureScene {
  inputs: DeriveInputs;
  manifest: FixtureManifest;
  transitionBaselineInputs?: DeriveInputs;
}

export function buildFixtureInputs(kind: FixtureKind): FixtureScene {
  switch (kind) {
    case 'aquarium':
      return buildAquariumFixture();
    case 'perf':
      return buildPerfFixture();
    case 'blind':
      return buildBlindFixture();
    case 'flow':
      return buildFlowFixture();
    case 'layout':
      return buildLayoutFixture();
  }
}

export {
  buildAquariumFixture,
  buildPerfFixture,
  buildBlindFixture,
  buildFlowFixture,
  buildLayoutFixture,
};
