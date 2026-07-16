// Dev-only fixture-mode URL contract: `/reef?fixture=<kind>#cam=x,y,zoom`
// (specs/plans/reef-aquarium.md, mirrored in contracts.ts and the
// snapshot harness). Resolving it is a pure function of the search string
// so AquariumPage and its tests can drive it without a real navigation.

import { FIXTURE_QUERY_PARAM, type FixtureKind } from '../contracts';

const VALID_KINDS: ReadonlySet<string> = new Set<FixtureKind>([
  'aquarium',
  'perf',
  'blind',
  'flow',
]);

function isFixtureKind(value: string): value is FixtureKind {
  return VALID_KINDS.has(value);
}

/**
 * Resolve the fixture kind from a route's search string, or null for live
 * mode. Fixture mode is a development-only affordance — `import.meta.env.DEV`
 * gates it so a production build can never accidentally serve synthetic data
 * from a stray query param.
 */
export function resolveFixtureKindFromSearch(search: string): FixtureKind | null {
  if (!import.meta.env.DEV) return null;
  const raw = new URLSearchParams(search).get(FIXTURE_QUERY_PARAM);
  if (raw === null || !isFixtureKind(raw)) return null;
  return raw;
}
