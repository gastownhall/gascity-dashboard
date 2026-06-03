import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

import type {
  GcSession,
  GcSessionList,
} from 'gas-city-dashboard-shared';
import type {
  AgentResponse,
  ListBodyAgentResponse,
  ListBodyRigResponse,
  RigResponse,
} from '../src/generated/gc-supervisor-client/types.gen.js';

import {
  aggregateAgentsByProvider,
  collectCityStatus,
} from '../src/snapshot/collectors/cityStatus.js';

// cityStatus collector coverage for gascity-dashboard-8nj /
// gascity-dashboard-19w.
//
// Per gascity-dashboard-dkb Q4 resolution (and upstream issue
// gastownhall/gascity#2508): the dashboard does NOT title-parse to infer
// provider. sessionsByProvider aggregates only over sessions where
// GcSession.provider is populated. Sessions without provider are TOLERATED
// (treated as 'unknown provider') and EXCLUDED from the breakdown.
// Demo-dash's inferProviderFromTitle is intentionally NOT ported.
//
// Per gascity-dashboard-19w: rigs are sourced from the supervisor's
// `GET /v0/city/{name}/rigs` HTTP API instead of parsing city.toml off
// the host filesystem. maxSessions is permanently 'unavailable' because
// the supervisor's HTTP API does NOT expose a city-level
// max_active_sessions field today — verified in upstream
// gastownhall/gascity@main: handler_status.go's StatusBody construction
// and handler_config.go's workspaceResponse/configAgentResponse both
// omit it. Tracked for upstream exposure in a follow-up bead.

function sess(partial: Partial<GcSession>): GcSession {
  // 6bv7 F10: running is required on the wire — default it from `state`
  // (gc supervisor marks asleep/closed sessions as running=false) so the
  // factory mirrors live data instead of forcing running=true for every
  // fixture regardless of lifecycle state.
  const state = partial.state ?? 'active';
  const running = partial.running ?? state === 'active';
  return {
    id: 't-1',
    template: 'codex',
    session_name: partial.id ?? 't-1',
    title: partial.id ?? 't-1',
    state,
    created_at: '2026-05-22T00:00:00.000Z',
    attached: false,
    running,
    provider: 'codex',
    ...partial,
  };
}

function agent(partial: Partial<AgentResponse>): AgentResponse {
  // sd4: AgentResponse factory mirroring `sess` — `running` defaults from `state`
  // so fixtures resemble live data. Provider defaults to 'codex' so tests
  // that don't care about the empty-provider edge case stay terse.
  const state = partial.state ?? 'active';
  const running = partial.running ?? state === 'active';
  return {
    name: partial.name ?? 'mayor',
    available: true,
    running,
    suspended: false,
    state,
    provider: 'codex',
    ...partial,
  };
}

function rig(partial: Partial<RigResponse>): RigResponse {
  return {
    name: 'rig-a',
    path: '/data/rig-a',
    agent_count: 0,
    running_count: 0,
    suspended: false,
    ...partial,
  };
}

describe('aggregateAgentsByProvider', () => {
  // gascity-dashboard-sd4: cityStatus.sessionsByProvider now derives from the
  // /agents roster (authoritative provider info) instead of /sessions, which
  // was systematically undercounting because supervisor doesn't populate
  // GcSession.provider for every session today. Agents-derived path removes
  // the undercount completely.

  test('aggregates active+total counts when every agent has provider populated', () => {
    const agents: AgentResponse[] = [
      agent({ name: 'a-1', provider: 'codex', state: 'active' }),
      agent({ name: 'a-2', provider: 'codex', state: 'asleep' }),
      agent({ name: 'a-3', provider: 'codex', state: 'active' }),
      agent({ name: 'a-4', provider: 'claude', state: 'active' }),
      agent({ name: 'a-5', provider: 'claude', state: 'closed' }),
      agent({ name: 'a-6', provider: 'gemini', state: 'active' }),
    ];

    const breakdown = aggregateAgentsByProvider(agents);

    assert.deepEqual(breakdown, [
      { provider: 'codex', active: 2, total: 3 },
      { provider: 'claude', active: 1, total: 2 },
      { provider: 'gemini', active: 1, total: 1 },
    ]);
  });

  test('counts an agent as active when running===true even if state is not "active"', () => {
    // Parity with countActiveAgents(sessions): `running === true || state==='active'`.
    // The Agents view treats running as authoritative for "currently doing work."
    const agents: AgentResponse[] = [
      agent({ name: 'a-1', provider: 'codex', state: 'asleep', running: true }),
      agent({ name: 'a-2', provider: 'codex', state: 'closed', running: false }),
    ];

    assert.deepEqual(aggregateAgentsByProvider(agents), [
      { provider: 'codex', active: 1, total: 2 },
    ]);
  });

  test('skips agents with undefined or empty provider and logs a single warn', () => {
    const warnMock = mock.method(console, 'warn', () => undefined);
    try {
      // Omit `provider` entirely on a-2 to model the supervisor not
      // including the field at all (OpenAPI marks it optional). `provider:
      // undefined` would violate exactOptionalPropertyTypes, but the
      // runtime behavior we want to test is "key absent" — which a fresh
      // object built without the field reproduces faithfully.
      const a2 = agent({ name: 'a-2', state: 'active' });
      delete a2.provider;
      const agents: AgentResponse[] = [
        agent({ name: 'a-1', provider: 'codex', state: 'active' }),
        a2,
        agent({ name: 'a-3', provider: '', state: 'active' }),
        agent({ name: 'a-4', provider: 'claude', state: 'asleep' }),
      ];

      const breakdown = aggregateAgentsByProvider(agents);

      assert.deepEqual(breakdown, [
        { provider: 'codex', active: 1, total: 1 },
        { provider: 'claude', active: 0, total: 1 },
      ]);

      const emptyWarns = warnMock.mock.calls.filter((call) =>
        String(call.arguments[0]).includes(
          'aggregateAgentsByProvider: 2 agents skipped due to empty provider',
        ),
      );
      assert.equal(emptyWarns.length, 1, 'expected exactly one empty-provider warn per call');
    } finally {
      warnMock.mock.restore();
    }
  });

  test('returns empty array on empty input', () => {
    assert.deepEqual(aggregateAgentsByProvider([]), []);
  });
});

describe('collectCityStatus', () => {
  test('builds CityStatusSummary from sessions + agents + rigs HTTP responses; maxSessions stays unavailable', async () => {
    const sessionList: GcSessionList = {
      items: [
        sess({ id: 't-1', provider: 'codex', state: 'active' }),
        sess({ id: 't-2', provider: 'codex', state: 'asleep' }),
        sess({ id: 't-3', provider: 'claude', state: 'active' }),
      ],
      total: 3,
    };
    // sd4: sessionsByProvider now derives from /agents (authoritative
    // provider info). Fixture the agent roster independently of sessions
    // so the test pins that the agents-derived path is in effect.
    const agentList: ListBodyAgentResponse = {
      items: [
        agent({ name: 'a-1', provider: 'codex', state: 'active' }),
        agent({ name: 'a-2', provider: 'codex', state: 'asleep' }),
        agent({ name: 'a-3', provider: 'claude', state: 'active' }),
      ],
      total: 3,
    };
    const rigList: ListBodyRigResponse = {
      items: [
        rig({ name: 'rig-a', path: '/data/rig-a' }),
        rig({ name: 'rig-b', path: '/data/rig-b' }),
      ],
      total: 2,
    };

    const summary = await collectCityStatus({
      listSessions: async () => sessionList,
      listAgents: async () => agentList,
      listRigs: async () => rigList,
    });

    assert.equal(summary.activeAgents, 2);
    assert.equal(summary.totalAgents, 3);
    assert.equal(summary.activeSessions, 2);
    assert.equal(summary.suspendedSessions, 1);
    assert.deepEqual(summary.maxSessions, {
      status: 'unavailable',
      source: 'city',
      error: 'supervisor HTTP API does not expose city-level max_active_sessions',
    });
    assert.deepEqual(summary.rigs, [
      { name: 'rig-a', path: '/data/rig-a' },
      { name: 'rig-b', path: '/data/rig-b' },
    ]);
    // Sort: active desc, then provider asc. codex and claude both have
    // active=1, so alpha tiebreak puts claude first.
    assert.deepEqual(summary.sessionsByProvider, [
      { provider: 'claude', active: 1, total: 1 },
      { provider: 'codex', active: 1, total: 2 },
    ]);
  });

  test('sessionsByProvider matches agent roster even when sessions lack provider (undercount fix)', async () => {
    // sd4 regression guard: this scenario reproduces the original
    // undercount — sessions don't carry provider, but agents do. Old
    // session-derived path would return []; the new agents-derived path
    // returns the correct breakdown.
    const sessionList: GcSessionList = {
      items: [
        // Cast to bypass the wire-required `provider` for this regression
        // fixture — the bug we're guarding against is precisely a session
        // arriving with provider absent / empty.
        { ...sess({ id: 't-1' }), provider: '' } as GcSession,
        { ...sess({ id: 't-2' }), provider: '' } as GcSession,
      ],
      total: 2,
    };
    const agentList: ListBodyAgentResponse = {
      items: [
        agent({ name: 'a-1', provider: 'codex', state: 'active' }),
        agent({ name: 'a-2', provider: 'claude', state: 'asleep' }),
      ],
      total: 2,
    };

    const summary = await collectCityStatus({
      listSessions: async () => sessionList,
      listAgents: async () => agentList,
      listRigs: async () => ({ items: [], total: 0 }),
    });

    assert.deepEqual(summary.sessionsByProvider, [
      { provider: 'codex', active: 1, total: 1 },
      { provider: 'claude', active: 0, total: 1 },
    ]);
  });

  test('empty sessions and empty rigs remain zero counts; maxSessions still unavailable', async () => {
    const summary = await collectCityStatus({
      listSessions: async () => ({ items: [], total: 0 }),
      listAgents: async () => ({ items: [], total: 0 }),
      listRigs: async () => ({ items: [], total: 0 }),
    });

    assert.equal(summary.activeAgents, 0);
    assert.equal(summary.totalAgents, 0);
    assert.equal(summary.activeSessions, 0);
    assert.equal(summary.suspendedSessions, 0);
    assert.deepEqual(summary.maxSessions, {
      status: 'unavailable',
      source: 'city',
      error: 'supervisor HTTP API does not expose city-level max_active_sessions',
    });
    assert.deepEqual(summary.rigs, []);
  });

  test('agents collector failure surfaces — no swallow (sd4)', async () => {
    // sd4: listAgents is the new source of truth for sessionsByProvider.
    // A 5xx must surface as a city-source error, not silently degrade to
    // an empty provider breakdown. Mirrors the rigs failure contract.
    await assert.rejects(
      collectCityStatus({
        listSessions: async () => ({ items: [], total: 0 }),
        listAgents: async () => {
          throw new Error('gc supervisor returned 502');
        },
        listRigs: async () => ({ items: [], total: 0 }),
      }),
      /gc supervisor returned 502/,
    );
  });

  test('rigs collector failure surfaces — no swallow', async () => {
    // gascity-dashboard-19w: listRigs is awaited; if the supervisor 5xx's,
    // the collector throws so the city source goes to status='error' per
    // the failure-isolation contract. We do NOT silently aggregate an
    // empty rigs list, which would mask the upstream outage.
    await assert.rejects(
      collectCityStatus({
        listSessions: async () => ({ items: [], total: 0 }),
        listAgents: async () => ({ items: [], total: 0 }),
        listRigs: async () => {
          throw new Error('gc supervisor returned 502');
        },
      }),
      /gc supervisor returned 502/,
    );
  });

  test('rigs partial: true surfaces degradation via rigsPartial — does not silently report empty', async () => {
    // gascity-dashboard-19w.1: when the supervisor returns
    // `partial: true` with `items` normalized to `[]` (one or more rig
    // backends failed during aggregation), the collector MUST surface
    // the degradation signal so the operator sees "rigs degraded"
    // rather than "no rigs configured." Convention mirrors links and
    // direct supervisor mail reads.
    const rigList: ListBodyRigResponse = {
      items: [],
      partial: true,
      partial_errors: ['backend A: connection refused', 'backend B: 502'],
      total: 0,
    };

    const summary = await collectCityStatus({
      listSessions: async () => ({ items: [], total: 0 }),
      listAgents: async () => ({ items: [], total: 0 }),
      listRigs: async () => rigList,
    });

    assert.equal(summary.rigsPartial, true);
    assert.deepEqual(summary.rigs, []);
  });

  test('rigs partial: true with some items still surfaces degradation AND retains items', async () => {
    // Supervisor can return both: some backends succeeded (items present)
    // AND some backends failed (partial: true). Both signals must reach
    // the operator — we keep the items we got AND mark degradation.
    const rigList: ListBodyRigResponse = {
      items: [rig({ name: 'rig-a', path: '/data/rig-a' })],
      partial: true,
      total: 1,
    };

    const summary = await collectCityStatus({
      listSessions: async () => ({ items: [], total: 0 }),
      listAgents: async () => ({ items: [], total: 0 }),
      listRigs: async () => rigList,
    });

    assert.equal(summary.rigsPartial, true);
    assert.deepEqual(summary.rigs, [{ name: 'rig-a', path: '/data/rig-a' }]);
  });

  test('rigs partial_errors non-empty without partial: true still surfaces degradation', async () => {
    // Defensive parity with links.ts:118 / mail.ts:62: either signal
    // (partial===true OR partial_errors non-empty) is sufficient.
    const rigList: ListBodyRigResponse = {
      items: [rig({ name: 'rig-a', path: '/data/rig-a' })],
      partial_errors: ['backend X: timeout'],
      total: 1,
    };

    const summary = await collectCityStatus({
      listSessions: async () => ({ items: [], total: 0 }),
      listAgents: async () => ({ items: [], total: 0 }),
      listRigs: async () => rigList,
    });

    assert.equal(summary.rigsPartial, true);
  });

  test('RigResponse fixture projects to CityRig with name+path only (19w.2 regression guard)', async () => {
    // 19w.2: toCityRig delegation-only mapper was dropped in favor of an
    // inline projection at the call site. The generated RigResponse carries
    // supervisor fields that CityRig must not expose.
    // This test pins that contract.
    const rigList: ListBodyRigResponse = {
      items: [rig({ name: 'rig-a', path: '/data/rig-a', agent_count: 7, running_count: 3 })],
      total: 1,
    };

    const summary = await collectCityStatus({
      listSessions: async () => ({ items: [], total: 0 }),
      listAgents: async () => ({ items: [], total: 0 }),
      listRigs: async () => rigList,
    });

    assert.deepEqual(summary.rigs, [{ name: 'rig-a', path: '/data/rig-a' }]);
    assert.equal(Object.keys(summary.rigs[0]!).length, 2);
  });

  test('rigs without partial signal — rigsPartial omitted', async () => {
    // Happy path: clean response has no rigsPartial in the summary
    // (the field is optional so callers can use truthy checks).
    const summary = await collectCityStatus({
      listSessions: async () => ({ items: [], total: 0 }),
      listAgents: async () => ({ items: [], total: 0 }),
      listRigs: async () => ({
        items: [rig({ name: 'rig-a', path: '/data/rig-a' })],
        total: 1,
      }),
    });

    assert.equal(summary.rigsPartial, undefined);
  });
});
