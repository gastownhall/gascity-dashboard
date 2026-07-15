import { describe, expect, it } from 'vitest';
import type { FishEntity, FishKinematics, PelletEntity, PelletKinematics } from '../contracts';
import { hitTestFish, hitTestPellet, hitTestScene } from './hitTest';

function fish(overrides: Partial<FishEntity> = {}): FishEntity {
  return {
    id: 'fish-1',
    name: 'alpha/worker-1',
    species: 'pool',
    isMayor: false,
    pose: 'working',
    poseWord: 'working',
    bellyPct: 50,
    homeKey: 'reef-alpha',
    linkTo: '/agents/alpha%2Fworker-1',
    tombstoned: false,
    ...overrides,
  };
}

function fishKin(x: number, y: number): FishKinematics {
  return { x, y, heading: 0, speed: 0, phase: 0 };
}

function pellet(overrides: Partial<PelletEntity> = {}): PelletEntity {
  return {
    beadId: 'td-1',
    label: 'td-1',
    title: 'test bead',
    linkTo: '/beads?bead=td-1',
    rigKey: 'reef-alpha',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1,
    ...overrides,
  };
}

function pelletKin(x: number, y: number): PelletKinematics {
  return { x, y, phase: 0 };
}

describe('hitTestFish', () => {
  it('returns the fish under the click within its species radius', () => {
    const f = fish({ id: 'a' });
    const result = hitTestFish(100, 100, [f], { a: fishKin(100, 100) });
    expect(result?.id).toBe('a');
  });

  it('returns null when the click is outside every fish radius', () => {
    const f = fish({ id: 'a', species: 'pool' });
    const result = hitTestFish(1000, 1000, [f], { a: fishKin(100, 100) });
    expect(result).toBeNull();
  });

  it('picks the nearer of two fish in range', () => {
    const near = fish({ id: 'near', species: 'role' });
    const far = fish({ id: 'far', species: 'role' });
    const result = hitTestFish(100, 100, [far, near], {
      far: fishKin(150, 100),
      near: fishKin(110, 100),
    });
    expect(result?.id).toBe('near');
  });

  it('gives the mayor grouper a larger hit radius than a pool worker', () => {
    const grouper = fish({ id: 'g', species: 'grouper', isMayor: true });
    // 120 units away: outside the pool radius (70) but inside grouper (150).
    const hitGrouper = hitTestFish(220, 100, [grouper], { g: fishKin(100, 100) });
    expect(hitGrouper?.id).toBe('g');

    const pool = fish({ id: 'p', species: 'pool' });
    const missPool = hitTestFish(220, 100, [pool], { p: fishKin(100, 100) });
    expect(missPool).toBeNull();
  });

  it('skips a fish with no kinematics entry rather than throwing', () => {
    const f = fish({ id: 'ghost' });
    const result = hitTestFish(100, 100, [f], {});
    expect(result).toBeNull();
  });
});

describe('hitTestPellet', () => {
  it('returns the pellet under the click', () => {
    const p = pellet({ beadId: 'td-1' });
    const result = hitTestPellet(50, 50, [p], { 'td-1': pelletKin(50, 50) });
    expect(result?.beadId).toBe('td-1');
  });

  it('returns null outside the pellet radius', () => {
    const p = pellet({ beadId: 'td-1' });
    const result = hitTestPellet(500, 500, [p], { 'td-1': pelletKin(50, 50) });
    expect(result).toBeNull();
  });
});

describe('hitTestScene', () => {
  it('prefers a fish hit over a pellet at the same point', () => {
    const f = fish({ id: 'a' });
    const p = pellet({ beadId: 'td-1' });
    const result = hitTestScene(
      100,
      100,
      [f],
      { a: fishKin(100, 100) },
      [p],
      { 'td-1': pelletKin(100, 100) },
      true,
    );
    expect(result).toEqual({ kind: 'fish', entity: f });
  });

  it('falls through to a pellet hit when no fish is under the click and pellets are eligible', () => {
    const p = pellet({ beadId: 'td-1' });
    const result = hitTestScene(50, 50, [], {}, [p], { 'td-1': pelletKin(50, 50) }, true);
    expect(result).toEqual({ kind: 'pellet', entity: p });
  });

  it('never returns a pellet hit when pellets are not eligible (below LOD2)', () => {
    const p = pellet({ beadId: 'td-1' });
    const result = hitTestScene(50, 50, [], {}, [p], { 'td-1': pelletKin(50, 50) }, false);
    expect(result).toBeNull();
  });

  it('returns null when nothing is near the click', () => {
    const result = hitTestScene(9999, 9999, [], {}, [], {}, true);
    expect(result).toBeNull();
  });
});
