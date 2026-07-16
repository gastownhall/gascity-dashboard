import { describe, expect, it } from 'vitest';
import type { AgentResponse, Bead, SessionResponse } from 'gas-city-dashboard-shared/gc-supervisor';
import type { AgentPendingSignal } from 'gas-city-dashboard-shared';
import { CITY_KEY, UNRIGGED_KEY } from '../contracts';
import { buildFish, type BuildFishInputs } from './fish';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const RIGS = [{ name: 'alpha-rig', path: '/home/ds/alpha' }];

function session(
  overrides: Partial<SessionResponse> & { session_name: string; id: string },
): SessionResponse {
  return {
    attached: false,
    created_at: '2026-01-01T00:00:00Z',
    provider: 'claude',
    running: true,
    state: 'active',
    template: 'default',
    title: overrides.session_name,
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

function inputs(overrides: Partial<BuildFishInputs>): BuildFishInputs {
  return {
    sessions: [],
    agents: [],
    pendingSignals: [],
    rigs: RIGS,
    beadsByRig: {},
    nowMs: NOW,
    ...overrides,
  };
}

describe('buildFish — session-backed fish', () => {
  it('creates one fish per live session, keyed by session_name', () => {
    const s1 = session({ session_name: 'sess-1', id: 'gc-1' });
    const s2 = session({ session_name: 'sess-2', id: 'gc-2' });
    const { fish } = buildFish(inputs({ sessions: [s1, s2] }));
    expect(fish.map((f) => f.id).sort()).toEqual(['sess-1', 'sess-2']);
    expect(fish.every((f) => f.tombstoned === false)).toBe(true);
  });

  it('normalizes a worktree-path alias to a "rig · agent" display name, keeping linkTo on the raw alias', () => {
    const s = session({
      session_name: 'gascity-maintenance-pl-gc-1',
      id: 'gc-1',
      alias: '/home/ds/gascity-main/gascity-maintenance-pl',
    });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.name).toBe('gascity · gascity-maintenance-pl');
    // routing/identity stays the raw alias, never the display form
    expect(fish[0]?.linkTo).toBe(
      `/agents/${encodeURIComponent('/home/ds/gascity-main/gascity-maintenance-pl')}`,
    );
  });

  it('passes a clean alias through as the display name unchanged', () => {
    const s = session({ session_name: 'codex-gc-1', id: 'gc-1', alias: 'codex-1' });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.name).toBe('codex-1');
  });

  it('is calm-idle by default with no distress and no in-turn activity', () => {
    const s = session({
      session_name: 'sess-1',
      id: 'gc-1',
      activity: 'thinking',
      state: 'active',
    });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.pose).toBe('idle');
  });

  it('labels a live Codex-style session concisely as active and preserves the telemetry caveat for details', () => {
    const s = session({
      id: 'gc-2568',
      session_name: 'mayor',
      alias: 'mayor',
      provider: 'codex-mayor',
      state: 'active',
      running: true,
    });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.pose).toBe('idle');
    expect(fish[0]?.poseWord).toBe('active');
    expect(fish[0]?.turnActivityUnavailable).toBe(true);
  });

  it('is working when activity is in-turn', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1', activity: 'in-turn' });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.pose).toBe('working');
  });

  it('carries a distress pose verbatim, joined agent<->session via agent.session.name', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1', activity: 'in-turn' });
    const a = agent({
      name: 'polecat-alpha',
      state: 'failed',
      session: { attached: true, name: 'sess-1' },
    });
    const { fish } = buildFish(inputs({ sessions: [s], agents: [a] }));
    // errored outranks the raw activity=in-turn calm derivation entirely.
    expect(fish[0]?.pose).toBe('errored');
  });

  it('resolves the home rig via resolveRigName, defaulting to UNRIGGED_KEY', () => {
    const withRig = session({ session_name: 'sess-1', id: 'gc-1', rig: 'alpha-rig' });
    const withoutRig = session({ session_name: 'sess-2', id: 'gc-2' });
    const { fish } = buildFish(inputs({ sessions: [withRig, withoutRig] }));
    const byId = new Map(fish.map((f) => [f.id, f]));
    expect(byId.get('sess-1')?.homeKey).toBe('alpha-rig');
    expect(byId.get('sess-2')?.homeKey).toBe(UNRIGGED_KEY);
  });

  it('accepts a supervisor rig that does not publish a host path', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1', rig: 'alpha-rig' });
    const { fish } = buildFish(inputs({ sessions: [s], rigs: [{ name: 'alpha-rig' }] }));
    expect(fish[0]?.homeKey).toBe('alpha-rig');
  });

  it('sends the mayor home to CITY_KEY even when rig is set', () => {
    const s = session({ session_name: 'mayor', id: 'gc-1', alias: 'mayor', rig: 'alpha-rig' });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.homeKey).toBe(CITY_KEY);
    expect(fish[0]?.species).toBe('grouper');
    expect(fish[0]?.isMayor).toBe(true);
  });

  it('carries effectiveContextPct as bellyPct, undefined when indeterminate', () => {
    // No model/context_window scale factor available: effectiveContextPct
    // fails open to the raw gc percentage rather than inventing a scale.
    const withPct = session({ session_name: 'sess-1', id: 'gc-1', context_pct: 42 });
    const withoutPct = session({ session_name: 'sess-2', id: 'gc-2' });
    const { fish } = buildFish(inputs({ sessions: [withPct, withoutPct] }));
    const byId = new Map(fish.map((f) => [f.id, f]));
    expect(byId.get('sess-1')?.bellyPct).toBe(42);
    expect(byId.get('sess-2')?.bellyPct).toBeUndefined();
  });

  it('prefers raw active_bead for taskBeadId', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1', active_bead: 'gc-777' });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.taskBeadId).toBe('gc-777');
  });

  it('falls back to scanning in-flight beads by assignee session id', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-42' });
    const beadsByRig = {
      'alpha-rig': { items: [bead('gc-888', 'in_progress', 'polecat-gc-42')], total: 1 },
    };
    const { fish } = buildFish(inputs({ sessions: [s], beadsByRig }));
    expect(fish[0]?.taskBeadId).toBe('gc-888');
  });

  it('leaves taskBeadId undefined when no active_bead and no matching in-flight bead', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1' });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.taskBeadId).toBeUndefined();
  });

  it('links to /agents/<name> with the session alias preferred over session_name', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1', alias: 'nice name' });
    const { fish } = buildFish(inputs({ sessions: [s] }));
    expect(fish[0]?.linkTo).toBe(`/agents/${encodeURIComponent('nice name')}`);
  });

  it('returns a fishId -> sessionId map for every session-backed fish', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1' });
    const { sessionIdByFishId } = buildFish(inputs({ sessions: [s] }));
    expect(sessionIdByFishId.get('sess-1')).toBe('gc-1');
  });
});

describe('buildFish — fallback fish for sessionless distressed agents', () => {
  it('creates a fallback fish for an agent with no session that needs attention', () => {
    const a = agent({ name: 'stuck-agent', running: true, state: 'detached' });
    const { fish } = buildFish(inputs({ agents: [a] }));
    expect(fish).toHaveLength(1);
    expect(fish[0]?.id).toBe('stuck-agent');
    expect(fish[0]?.pose).toBe('stalled');
    expect(fish[0]?.tombstoned).toBe(false);
  });

  it('never creates a fish for a sessionless agent that is not distressed', () => {
    const a = agent({ name: 'quiet-agent', running: false, state: 'idle' });
    const { fish } = buildFish(inputs({ agents: [a] }));
    expect(fish).toHaveLength(0);
  });

  it('does not duplicate a fish for a distressed agent that DOES have a live session', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1' });
    const a = agent({
      name: 'agent-1',
      state: 'failed',
      session: { attached: true, name: 'sess-1' },
    });
    const { fish } = buildFish(inputs({ sessions: [s], agents: [a] }));
    expect(fish).toHaveLength(1);
    expect(fish[0]?.id).toBe('sess-1');
  });

  it('uses agent.rig / agent.active_bead / agent.name for a fallback fish home and task', () => {
    const a = agent({
      name: 'stuck-agent',
      running: true,
      state: 'detached',
      rig: 'alpha-rig',
      active_bead: 'gc-500',
    });
    const { fish } = buildFish(inputs({ agents: [a] }));
    expect(fish[0]?.homeKey).toBe('alpha-rig');
    expect(fish[0]?.taskBeadId).toBe('gc-500');
    expect(fish[0]?.linkTo).toBe('/agents/stuck-agent');
  });

  it('a fallback fish is never returned in the sessionId map', () => {
    const a = agent({ name: 'stuck-agent', running: true, state: 'detached' });
    const { sessionIdByFishId } = buildFish(inputs({ agents: [a] }));
    expect(sessionIdByFishId.has('stuck-agent')).toBe(false);
  });
});

describe('buildFish — pending signals', () => {
  it('surfaces awaiting-input via a pending signal keyed by agent name, joined to the session', () => {
    const s = session({ session_name: 'sess-1', id: 'gc-1' });
    const a = agent({ name: 'agent-1', session: { attached: true, name: 'sess-1' } });
    const pendingSignals: AgentPendingSignal[] = [{ agentName: 'agent-1', prompt: 'pick one' }];
    const { fish } = buildFish(inputs({ sessions: [s], agents: [a], pendingSignals }));
    expect(fish[0]?.pose).toBe('awaiting-input');
  });
});
