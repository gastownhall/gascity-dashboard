import { describe, expect, it } from 'vitest';
import type { FlowObservation } from '../contracts';
import { formatTideReport } from './tideReport';

function flow(overrides: Partial<FlowObservation> = {}): FlowObservation {
  return {
    observedForMs: 0,
    windowMs: 60 * 60 * 1_000,
    observedRigCount: 2,
    totalRigCount: 2,
    backloggedRigCount: 2,
    movingRigCount: 0,
    stillRigKeys: [],
    p0Waiting: 3,
    receipts: [],
    ...overrides,
  };
}

describe('formatTideReport', () => {
  it('labels a young session as observation, not as a historical flow claim', () => {
    expect(formatTideReport(flow())).toBe('observing flow · 2 backlogged rigs · 3 P0 waiting');
  });

  it('reports movement, duration, and bounded still-rig names after observation matures', () => {
    expect(
      formatTideReport(
        flow({
          observedForMs: 17 * 60 * 1_000,
          movingRigCount: 1,
          stillRigKeys: ['gas-city', 'memory'],
        }),
      ),
    ).toBe('work moved in 1 of 2 rigs over 17m · GAS CITY, MEMORY still · 3 P0 waiting');
  });

  it('uses singular grammar and keeps a zero-P0 statement explicit', () => {
    expect(
      formatTideReport(
        flow({
          observedForMs: 6 * 60 * 1_000,
          backloggedRigCount: 1,
          movingRigCount: 1,
          p0Waiting: 0,
        }),
      ),
    ).toBe('work moved in 1 of 1 rig over 6m · 0 P0 waiting');
  });

  it('names incomplete rig coverage instead of presenting sampled backlog as a total', () => {
    expect(
      formatTideReport(
        flow({
          observedRigCount: 1,
          totalRigCount: 2,
        }),
      ),
    ).toBe('observing flow · 2 observed backlogged rigs · 3 P0 waiting');
  });

  it('keeps mature movement claims scoped to observed rigs under partial coverage', () => {
    expect(
      formatTideReport(
        flow({
          observedForMs: 6 * 60 * 1_000,
          observedRigCount: 1,
          totalRigCount: 2,
          backloggedRigCount: 1,
          movingRigCount: 1,
        }),
      ),
    ).toBe('work moved in 1 of 1 observed backlogged rig over 6m · 3 P0 waiting');
  });
});
