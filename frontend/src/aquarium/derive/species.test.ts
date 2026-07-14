import { describe, expect, it } from 'vitest';
import { deriveSpecies } from './species';

describe('deriveSpecies', () => {
  it('is "pool" whenever agent_kind is pool, even for a mayor-named identity', () => {
    expect(
      deriveSpecies({ agentKind: 'pool', alias: 'mayor', primaryName: 'mayor', displayName: undefined }),
    ).toEqual({ species: 'pool', isMayor: false });
  });

  it('is "grouper" + isMayor when alias is exactly "mayor"', () => {
    expect(
      deriveSpecies({ agentKind: undefined, alias: 'mayor', primaryName: 'sess-1', displayName: undefined }),
    ).toEqual({ species: 'grouper', isMayor: true });
  });

  it('is "grouper" + isMayor when the primary (session/agent) name starts with "mayor"', () => {
    expect(
      deriveSpecies({
        agentKind: undefined,
        alias: undefined,
        primaryName: 'mayor-2',
        displayName: undefined,
      }),
    ).toEqual({ species: 'grouper', isMayor: true });
  });

  it('is "grouper" + isMayor when display_name starts with "mayor"', () => {
    expect(
      deriveSpecies({
        agentKind: undefined,
        alias: undefined,
        primaryName: 'city-control',
        displayName: 'mayor-ops',
      }),
    ).toEqual({ species: 'grouper', isMayor: true });
  });

  it('is "role" for a plain non-mayor, non-pool identity', () => {
    expect(
      deriveSpecies({
        agentKind: 'role',
        alias: 'polecat',
        primaryName: 'polecat-gc-1',
        displayName: undefined,
      }),
    ).toEqual({ species: 'role', isMayor: false });
  });

  it('does not treat "mayoral-review" or a mid-string "mayor" as the mayor (startsWith only)', () => {
    expect(
      deriveSpecies({
        agentKind: undefined,
        alias: undefined,
        primaryName: 'city-mayor-review',
        displayName: undefined,
      }),
    ).toEqual({ species: 'role', isMayor: false });
  });
});
