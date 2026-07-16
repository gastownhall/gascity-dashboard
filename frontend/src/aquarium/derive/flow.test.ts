import { describe, expect, it } from 'vitest';
import { FLOW_STILL_MIN_OBSERVATION_MS } from '../contracts';
import type { BeadHolder } from './pellets';
import { observeFlow, type FlowMemory } from './flow';

const NOW = Date.parse('2026-07-15T12:00:00.000Z');

function holder(rigKey: string, state: BeadHolder['state'] = 'drifting', isP0 = false): BeadHolder {
  return { rigKey, state, isP0, fishId: undefined, title: '' };
}

function observe(
  current: Record<string, BeadHolder>,
  previous: Record<string, BeadHolder>,
  memory: FlowMemory | null,
  nowMs: number,
  unavailableRigKeys: readonly string[] = [],
) {
  return observeFlow({
    current,
    previous,
    memory,
    nowMs,
    unavailableRigKeys,
    openTotalsByRig: { alpha: 4, beta: 2 },
  });
}

describe('observeFlow', () => {
  it('starts an explicit observation window without inventing historical movement', () => {
    const result = observe({ 'not-an-alpha-id': holder('alpha', 'drifting', true) }, {}, null, NOW);

    expect(result.flow).toMatchObject({
      observedForMs: 0,
      backloggedRigCount: 2,
      movingRigCount: 0,
      p0Waiting: 1,
      stillRigKeys: [],
      receipts: [],
    });
  });

  it('emits one pickup receipt when a bead becomes held, then does not repeat it', () => {
    const first = observe({ b1: holder('alpha') }, {}, null, NOW);
    const pickedUp = observe(
      { b1: holder('alpha', 'held') },
      { b1: holder('alpha') },
      first.memory,
      NOW + 1_000,
    );
    const stable = observe(
      { b1: holder('alpha', 'held') },
      { b1: holder('alpha', 'held') },
      pickedUp.memory,
      NOW + 2_000,
    );

    expect(pickedUp.flow.receipts).toEqual([
      expect.objectContaining({ beadId: 'b1', rigKey: 'alpha', kind: 'pickup' }),
    ]);
    expect(stable.flow.receipts).toHaveLength(1);
  });

  it('attributes completion to the previous holder rig, never to a bead-id prefix', () => {
    const previous = { 'beta-looking-id': holder('alpha', 'held') };
    const first = observe(previous, {}, null, NOW);
    const completed = observe({}, previous, first.memory, NOW + 1_000);

    expect(completed.flow.receipts).toEqual([
      expect.objectContaining({
        beadId: 'beta-looking-id',
        rigKey: 'alpha',
        kind: 'completion',
      }),
    ]);
  });

  it('suppresses transitions and stillness claims for an unavailable rig', () => {
    const previous = { b1: holder('alpha', 'held') };
    const first = observe(previous, {}, null, NOW);
    const unavailable = observe({}, previous, first.memory, NOW + FLOW_STILL_MIN_OBSERVATION_MS, [
      'alpha',
    ]);

    expect(unavailable.flow.receipts).toEqual([]);
    expect(unavailable.flow.backloggedRigCount).toBe(1);
    expect(unavailable.flow.stillRigKeys).toEqual(['beta']);
  });

  it('names still rigs only after the minimum observation period', () => {
    const first = observe({ b1: holder('alpha') }, {}, null, NOW);
    const young = observe(
      { b1: holder('alpha') },
      { b1: holder('alpha') },
      first.memory,
      NOW + FLOW_STILL_MIN_OBSERVATION_MS - 1,
    );
    const mature = observe(
      { b1: holder('alpha') },
      { b1: holder('alpha') },
      young.memory,
      NOW + FLOW_STILL_MIN_OBSERVATION_MS,
    );

    expect(young.flow.stillRigKeys).toEqual([]);
    expect(mature.flow.stillRigKeys).toEqual(['alpha', 'beta']);
  });

  it('caps the reported duration to the rolling observation window', () => {
    const first = observe({}, {}, null, NOW);
    const later = observe({}, {}, first.memory, NOW + 3 * 60 * 60 * 1_000);
    expect(later.flow.observedForMs).toBe(later.flow.windowMs);
  });
});
