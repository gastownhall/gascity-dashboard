import { describe, expect, it } from 'vitest';
import { deriveSpecies } from './species';

describe('deriveSpecies', () => {
  it('keeps the mayor largest even when the supervisor mis-tags it as pool-kind', () => {
    expect(
      deriveSpecies({
        agentKind: 'pool',
        alias: 'mayor',
        primaryName: 'mayor',
        displayName: undefined,
      }),
    ).toEqual({ species: 'grouper', isMayor: true });
  });

  it('promotes a project-lead identity above workers even when agent_kind says pool', () => {
    expect(
      deriveSpecies({
        agentKind: 'pool',
        alias: 'aoa/oversight-rig.project-lead',
        primaryName: 'aoa--oversight-rig__project-lead',
        displayName: 'Claude',
      }),
    ).toEqual({ species: 'role', isMayor: false });

    expect(
      deriveSpecies({
        agentKind: 'pool',
        alias: '/home/ds/gascity-dashboard/gascity-dashboard-pl',
        primaryName: 'gascity-dashboard-pl-gc-123',
        displayName: 'Claude',
      }),
    ).toEqual({ species: 'role', isMayor: false });
  });

  it('keeps an ordinary pool worker at worker size', () => {
    expect(
      deriveSpecies({
        agentKind: 'pool',
        alias: '/home/ds/aoa/aoa-worker-1',
        primaryName: 'aoa-worker-gc-123',
        displayName: 'Claude',
      }),
    ).toEqual({ species: 'pool', isMayor: false });
  });

  it('is "grouper" + isMayor when alias is exactly "mayor"', () => {
    expect(
      deriveSpecies({
        agentKind: undefined,
        alias: 'mayor',
        primaryName: 'sess-1',
        displayName: undefined,
      }),
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
