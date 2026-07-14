import { describe, expect, it } from 'vitest';
import { resolveFixtureKindFromSearch } from './fixtureMode';

describe('resolveFixtureKindFromSearch', () => {
  it('resolves a known fixture kind from the query string', () => {
    expect(resolveFixtureKindFromSearch('?fixture=aquarium')).toBe('aquarium');
    expect(resolveFixtureKindFromSearch('?fixture=perf')).toBe('perf');
    expect(resolveFixtureKindFromSearch('?fixture=blind')).toBe('blind');
  });

  it('returns null when the query param is absent', () => {
    expect(resolveFixtureKindFromSearch('')).toBeNull();
    expect(resolveFixtureKindFromSearch('?other=1')).toBeNull();
  });

  it('returns null for an unknown fixture kind value', () => {
    expect(resolveFixtureKindFromSearch('?fixture=bogus')).toBeNull();
  });
});
