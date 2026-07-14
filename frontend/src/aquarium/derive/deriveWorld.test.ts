import { describe, expect, it } from 'vitest';
import type { AgentResponse, Bead, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import { CITY_KEY, PELLET_RENDER_CAP_PER_RIG } from '../contracts';
import { deriveWorldSnapshot, type DeriveInputs } from './deriveWorld';
import { TOMBSTONE_WINDOW_MS } from './tombstones';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const RIGS = [{ name: 'alpha-rig', path: '/home/ds/alpha' }];

function session(overrides: Partial<SessionResponse> & { session_name: string; id: string }): SessionResponse {
  return {
    attached: false,
    created_at: '2026-01-01T00:00:00Z',
    provider: 'claude',
    running: true,
    state: 'active',
    template: 'default',
    title: overrides.session_name,
    rig: 'alpha-rig',
    ...overrides,
  };
}

function agent(overrides: Partial<AgentResponse> & { name: string }): AgentResponse {
  return { available: true, running: false, state: 'idle', suspended: false, ...overrides };
}

function bead(id: string, status: string, assignee?: string): Bead {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    issue_type: 'task',
    status,
    title: id,
    ...(assignee === undefined ? {} : { assignee }),
  };
}

function baseInputs(overrides: Partial<DeriveInputs> = {}): DeriveInputs {
  return { sessions: [], agents: [], rigs: RIGS, pendingSignals: [], beadsByRig: {}, ...overrides };
}

describe('deriveWorldSnapshot — pose SSOT parity', () => {
  it('a session in a failure state gets the errored pose from selectAgentsNeedingYou, not re-derived calm logic', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1', activity: 'in-turn' });
    const a = agent({ name: 'agent-1', state: 'failed', session: { attached: true, name: 'sess-1' } });
    const { snapshot } = deriveWorldSnapshot(baseInputs({ sessions: [s], agents: [a] }), null, NOW);
    expect(snapshot.fish[0]?.pose).toBe('errored');
    expect(snapshot.needsAttention).toBe(1);
  });

  it('needsAttention counts only non-tombstoned distress fish', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1' });
    const { snapshot: round1, memory } = deriveWorldSnapshot(
      baseInputs({
        sessions: [s],
        agents: [agent({ name: 'a1', state: 'failed', session: { attached: true, name: 'sess-1' } })],
      }),
      null,
      NOW,
    );
    expect(round1.needsAttention).toBe(1);
    // the session vanishes from the next read -> it ghosts, but a ghost must
    // not keep inflating the attention count.
    const { snapshot: round2 } = deriveWorldSnapshot(baseInputs({}), memory, NOW + 1000);
    expect(round2.fish.some((f) => f.tombstoned)).toBe(true);
    expect(round2.needsAttention).toBe(0);
  });
});

describe('deriveWorldSnapshot — pellet set truthfulness', () => {
  it('pellet set matches the bead set 1:1 (id-level) up to the per-rig cap, with overflow accounted', () => {
    const items: Bead[] = [];
    for (let i = 0; i < PELLET_RENDER_CAP_PER_RIG + 5; i += 1) items.push(bead(`b-${i}`, 'open'));
    const beadsByRig = { 'alpha-rig': { items, total: items.length } };
    const { snapshot } = deriveWorldSnapshot(baseInputs({ beadsByRig }), null, NOW);
    expect(snapshot.pellets).toHaveLength(PELLET_RENDER_CAP_PER_RIG);
    expect(snapshot.pelletOverflow['alpha-rig']).toBe(5);
    for (const p of snapshot.pellets) {
      expect(items.some((b) => b.id === p.beadId)).toBe(true);
    }
  });

  it('under the cap, every bead in beadsByRig has exactly one pellet, no phantoms', () => {
    const items = [bead('b-1', 'open'), bead('b-2', 'in_progress'), bead('b-3', 'blocked')];
    const beadsByRig = { 'alpha-rig': { items, total: 3 } };
    const { snapshot } = deriveWorldSnapshot(baseInputs({ beadsByRig }), null, NOW);
    expect(snapshot.pellets.map((p) => p.beadId).sort()).toEqual(['b-1', 'b-2', 'b-3']);
  });
});

describe('deriveWorldSnapshot — diff-eater', () => {
  it('a bead that disappears between calls triggers exactly one eaten pellet, then never again', () => {
    const beadsRound1 = { 'alpha-rig': { items: [bead('b-1', 'open')], total: 1 } };
    const { snapshot: round1, memory } = deriveWorldSnapshot(
      baseInputs({ beadsByRig: beadsRound1 }),
      null,
      NOW,
    );
    expect(round1.pellets.map((p) => p.beadId)).toEqual(['b-1']);

    const { snapshot: round2, memory: memory2 } = deriveWorldSnapshot(
      baseInputs({ beadsByRig: {} }),
      memory,
      NOW + 1000,
    );
    expect(round2.pellets).toHaveLength(1);
    expect(round2.pellets[0]).toMatchObject({ beadId: 'b-1', state: 'eaten' });

    const { snapshot: round3 } = deriveWorldSnapshot(baseInputs({ beadsByRig: {} }), memory2, NOW + 2000);
    expect(round3.pellets).toEqual([]);
  });

  it('a bead evicted only by the render cap is never mistaken for eaten', () => {
    const items: Bead[] = [];
    for (let i = 0; i < PELLET_RENDER_CAP_PER_RIG + 1; i += 1) items.push(bead(`b-${i}`, 'open'));
    const { memory } = deriveWorldSnapshot(
      baseInputs({ beadsByRig: { 'alpha-rig': { items, total: items.length } } }),
      null,
      NOW,
    );
    // second call: same full bead set (nothing actually closed) -> zero eaten pellets.
    const { snapshot: round2 } = deriveWorldSnapshot(
      baseInputs({ beadsByRig: { 'alpha-rig': { items, total: items.length } } }),
      memory,
      NOW + 1000,
    );
    expect(round2.pellets.filter((p) => p.state === 'eaten')).toEqual([]);
  });
});

describe('deriveWorldSnapshot — formation determinism', () => {
  it('produces the same formation anchors across two independent calls with the same input', () => {
    const beadsByRig = { 'alpha-rig': { items: [bead('b-1', 'open')], total: 1 } };
    const inputs = baseInputs({ beadsByRig });
    const first = deriveWorldSnapshot(inputs, null, NOW).snapshot.formations;
    const second = deriveWorldSnapshot(inputs, null, NOW + 5000).snapshot.formations;
    expect(second).toEqual(first);
  });

  it('never places a formation at CITY_KEY, even for a mayor fish', () => {
    const s = session({ session_name: 'mayor', id: 'gc-1', alias: 'mayor' });
    const { snapshot } = deriveWorldSnapshot(baseInputs({ sessions: [s] }), null, NOW);
    expect(snapshot.fish[0]?.homeKey).toBe(CITY_KEY);
    expect(snapshot.formations.some((f) => f.key === CITY_KEY)).toBe(false);
  });
});

describe('deriveWorldSnapshot — tombstone window end to end', () => {
  it('drops a vanished fish once 35s have elapsed since it was last seen', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1' });
    const a = agent({ name: 'a1', state: 'failed', session: { attached: true, name: 'sess-1' } });
    const { memory } = deriveWorldSnapshot(baseInputs({ sessions: [s], agents: [a] }), null, NOW);
    const { snapshot: stillGhost } = deriveWorldSnapshot(
      baseInputs({}),
      memory,
      NOW + TOMBSTONE_WINDOW_MS - 1,
    );
    expect(stillGhost.fish).toHaveLength(1);
    const { snapshot: dropped } = deriveWorldSnapshot(baseInputs({}), memory, NOW + TOMBSTONE_WINDOW_MS);
    expect(dropped.fish).toHaveLength(0);
  });
});
