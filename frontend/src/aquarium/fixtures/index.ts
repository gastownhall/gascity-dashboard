// Fixture entry point. `AquariumPage` (dev-only, `?fixture=<kind>`) and the
// snapshot harness both go through this single dispatcher — one place maps
// a `FixtureKind` to its scene, so a new kind can never be reachable from
// the URL without also being wired here.

import type { DeriveInputs } from '../derive/deriveWorld';
import type { FixtureKind, FixtureManifest } from '../contracts';
import { buildAquariumFixture } from './aquariumFixture';
import { buildPerfFixture } from './perfFixture';
import { buildBlindFixture } from './blindFixture';

export interface FixtureScene {
  inputs: DeriveInputs;
  manifest: FixtureManifest;
}

export function buildFixtureInputs(kind: FixtureKind): FixtureScene {
  switch (kind) {
    case 'aquarium':
      return buildAquariumFixture();
    case 'perf':
      return buildPerfFixture();
    case 'blind':
      return buildBlindFixture();
  }
}

export { buildAquariumFixture, buildPerfFixture, buildBlindFixture };
