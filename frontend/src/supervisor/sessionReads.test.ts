import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ListBodySessionResponse,
  OutputTurn,
  SessionResponse,
  SessionTranscriptGetResponse,
} from 'gas-city-dashboard-shared/gc-supervisor';
import type { DashboardSession } from 'gas-city-dashboard-shared';
import { setActiveCity } from '../api/cityBase';
import {
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  GC_MUTATION_HEADERS,
  type SupervisorApi,
} from './client';
import {
  fetchSupervisorSessionTranscript,
  listSupervisorSessions,
  normalizeSessions,
  sessionTranscriptView,
} from './sessionReads';

// The required wire fields a SessionResponse always carries; the optional ones
// are layered on per-test to exercise the include-only-when-defined branches.
function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    id: 'sess-1',
    template: 'claude',
    session_name: 'tmux-1',
    title: 'Session One',
    state: 'running',
    created_at: '2026-06-28T00:00:00Z',
    attached: false,
    running: true,
    provider: 'claude',
    ...overrides,
  };
}

function turn(text: string, role = 'assistant'): OutputTurn {
  return { role, text };
}

function sessionList(items: SessionResponse[]): ListBodySessionResponse {
  return { items, total: items.length };
}

function normalizeOne(overrides: Partial<SessionResponse> = {}): DashboardSession {
  const [result] = normalizeSessions(sessionList([session(overrides)]));
  if (result === undefined) throw new Error('expected exactly one normalized session');
  return result;
}

const baseApi: SupervisorApi = {
  baseUrl: '/gc-supervisor',
  health: vi.fn(),
  cityHealth: vi.fn(),
  cityStatus: vi.fn(),
  listCities: vi.fn(),
  listAgents: vi.fn(),
  listRigs: vi.fn(),
  listBeads: vi.fn(),
  listEvents: vi.fn(),
  getBead: vi.fn(),
  beadsGraph: vi.fn(),
  createBead: vi.fn(),
  updateBead: vi.fn(),
  closeBead: vi.fn(),
  nudgeAgent: vi.fn(),
  agentPrime: vi.fn(),
  sling: vi.fn(),
  formulaFeed: vi.fn(),
  listMail: vi.fn(),
  markMailRead: vi.fn(),
  markMailUnread: vi.fn(),
  archiveMail: vi.fn(),
  replyMail: vi.fn(),
  sendMail: vi.fn(),
  mailThread: vi.fn(),
  cityEventStreamUrl: vi.fn(),
  sessionStreamUrl: vi.fn(),
  listSessions: vi.fn(),
  sessionPending: vi.fn(),
  respondSession: vi.fn(),
  sessionTranscript: vi.fn(),
  workflowRun: vi.fn(),
  formulaDetail: vi.fn(),
  mutationHeaders: () => ({ ...GC_MUTATION_HEADERS }),
};

beforeEach(() => {
  setActiveCity('test-city');
});

afterEach(() => {
  resetSupervisorApiForTests();
});

describe('normalizeSessions', () => {
  it('maps every required field across the list', () => {
    const result = normalizeSessions(sessionList([session({ id: 'a' }), session({ id: 'b' })]));

    expect(result.map((s) => s.id)).toEqual(['a', 'b']);
    expect(result[0]).toMatchObject({
      id: 'a',
      template: 'claude',
      session_name: 'tmux-1',
      title: 'Session One',
      state: 'running',
      created_at: '2026-06-28T00:00:00Z',
      attached: false,
      running: true,
      provider: 'claude',
    });
  });

  it('treats a missing items array as an empty list', () => {
    expect(normalizeSessions({} as ListBodySessionResponse)).toEqual([]);
  });

  it('omits optional keys entirely when the wire field is undefined', () => {
    const result = normalizeOne();

    // Absence must be a missing key, not an explicit `undefined` value — the
    // DashboardSession contract treats these as optional, and a spurious
    // `alias: undefined` would defeat `'alias' in session` consumers.
    for (const key of [
      'alias',
      'reason',
      'display_name',
      'last_active',
      'rig',
      'pool',
      'agent_kind',
      'model',
      'context_pct',
      'context_window',
      'activity',
    ]) {
      expect(key in result).toBe(false);
    }
  });

  it('carries every optional field through when the wire field is present', () => {
    const result = normalizeOne({
      alias: 'claude-1',
      reason: 'city-stop',
      display_name: 'Claude Code',
      last_active: '2026-06-28T01:00:00Z',
      rig: 'gascity-dashboard',
      pool: 'default',
      agent_kind: 'pool',
      model: 'opus',
      context_pct: 42,
      context_window: 200000,
      activity: 'thinking',
    });

    expect(result).toMatchObject({
      alias: 'claude-1',
      reason: 'city-stop',
      display_name: 'Claude Code',
      last_active: '2026-06-28T01:00:00Z',
      rig: 'gascity-dashboard',
      pool: 'default',
      agent_kind: 'pool',
      model: 'opus',
      context_pct: 42,
      context_window: 200000,
      activity: 'thinking',
    });
  });

  it('preserves a falsy-but-present optional field (context_pct: 0)', () => {
    // `!== undefined` is the right guard, not truthiness — a 0% context window
    // is a real value and must survive normalization.
    const result = normalizeOne({ context_pct: 0 });
    expect('context_pct' in result).toBe(true);
    expect(result.context_pct).toBe(0);
  });
});

describe('sessionTranscriptView', () => {
  function transcript(
    overrides: Partial<SessionTranscriptGetResponse> = {},
  ): SessionTranscriptGetResponse {
    return { turns: [], ...overrides } as SessionTranscriptGetResponse;
  }

  it('sums total_chars over the turn texts', () => {
    const view = sessionTranscriptView(
      transcript({ turns: [turn('abc'), turn('de'), turn('')] }),
      '2026-06-28T02:00:00Z',
    );

    expect(view.total_chars).toBe(5);
    expect(view.turns).toHaveLength(3);
    expect(view.captured_at).toBe('2026-06-28T02:00:00Z');
    expect(view.truncated).toBe(false);
  });

  it('defaults turns to an empty array and total_chars to 0 when turns are null', () => {
    const view = sessionTranscriptView(
      { turns: null } as unknown as SessionTranscriptGetResponse,
      '2026-06-28T02:00:00Z',
    );

    expect(view.turns).toEqual([]);
    expect(view.total_chars).toBe(0);
  });

  it('stamps captured_at from the wall clock when no value is supplied', () => {
    const before = Date.now();
    const view = sessionTranscriptView(transcript({ turns: [turn('hi')] }));
    const captured = Date.parse(view.captured_at);

    expect(Number.isNaN(captured)).toBe(false);
    expect(captured).toBeGreaterThanOrEqual(before);
  });
});

describe('supervisor session read wrappers', () => {
  it('lists sessions for the active city', async () => {
    const listSessions = vi.fn(async () => ({ items: [session()], total: 1 }));
    setSupervisorApiForTests({ ...baseApi, listSessions });

    const result = await listSupervisorSessions();

    expect(listSessions).toHaveBeenCalledWith('test-city');
    expect(result.items).toHaveLength(1);
  });

  it('fetches a transcript and derives the view on the real edge', async () => {
    const sessionTranscript = vi.fn(async () => transcriptResponse());
    setSupervisorApiForTests({ ...baseApi, sessionTranscript });

    const view = await fetchSupervisorSessionTranscript('sess-1');

    expect(sessionTranscript).toHaveBeenCalledWith('test-city', 'sess-1');
    expect(view.total_chars).toBe(7);
    expect(view.truncated).toBe(false);
  });

  function transcriptResponse(): SessionTranscriptGetResponse {
    return { turns: [turn('hello '), turn('x')] } as SessionTranscriptGetResponse;
  }
});
