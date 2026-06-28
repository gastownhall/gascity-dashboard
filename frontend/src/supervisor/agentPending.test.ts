import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentResponse,
  PendingInteraction,
  SessionPendingResponse,
  SessionResponse,
} from 'gas-city-dashboard-shared/gc-supervisor';
import { setActiveCity } from '../api/cityBase';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from './client';
import {
  attachCommand,
  listAgentPendingInteractions,
  respondToAgentPendingInteraction,
} from './agentPending';

function agent(name: string, sessionName?: string): AgentResponse {
  return {
    name,
    available: true,
    running: true,
    state: 'idle',
    suspended: false,
    ...(sessionName === undefined ? {} : { session: { name: sessionName, attached: false } }),
  };
}

function session(id: string, sessionName: string): SessionResponse {
  return {
    id,
    template: 'claude',
    session_name: sessionName,
    title: id,
    state: 'running',
    created_at: '2026-06-28T00:00:00Z',
    attached: false,
    running: true,
    provider: 'claude',
  };
}

function pending(requestId: string): PendingInteraction {
  return { kind: 'permission', request_id: requestId };
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

describe('attachCommand', () => {
  it('leaves a safe agent name unquoted', () => {
    expect(attachCommand('claude-1')).toBe('gc agent attach claude-1');
    expect(attachCommand('rig/dir:claude_2.codex')).toBe('gc agent attach rig/dir:claude_2.codex');
  });

  it('single-quotes a name containing whitespace', () => {
    expect(attachCommand('my agent')).toBe("gc agent attach 'my agent'");
  });

  it('single-quotes and escapes shell metacharacters (injection-adjacent)', () => {
    // The displayed command must be paste-safe: a name carrying shell control
    // characters cannot break out of the single-quoted token.
    expect(attachCommand('a;rm -rf /')).toBe("gc agent attach 'a;rm -rf /'");
    expect(attachCommand('$(whoami)')).toBe("gc agent attach '$(whoami)'");
    expect(attachCommand('a`id`b')).toBe("gc agent attach 'a`id`b'");
  });

  it('escapes embedded single quotes with the close-escape-reopen idiom', () => {
    // The only way a single-quote can appear inside a single-quoted string.
    expect(attachCommand("a'b")).toBe("gc agent attach 'a'\\''b'");
  });

  it('quotes the empty string rather than emitting a bare token', () => {
    expect(attachCommand('')).toBe("gc agent attach ''");
  });
});

describe('listAgentPendingInteractions', () => {
  it('returns one entry per agent whose session has a pending interaction', async () => {
    const sessionPending = vi.fn(
      async (_city: string, sessionId: string): Promise<SessionPendingResponse> => ({
        supported: true,
        pending: pending(`req-${sessionId}`),
      }),
    );
    setSupervisorApiForTests({ ...baseApi, sessionPending });

    const result = await listAgentPendingInteractions(
      [agent('claude-1', 'tmux-1')],
      [session('sess-1', 'tmux-1')],
    );

    expect(sessionPending).toHaveBeenCalledWith('test-city', 'sess-1');
    expect(result).toEqual([
      {
        agentName: 'claude-1',
        sessionId: 'sess-1',
        sessionName: 'tmux-1',
        pending: pending('req-sess-1'),
      },
    ]);
  });

  it('skips an agent with no bound session', async () => {
    const sessionPending = vi.fn();
    setSupervisorApiForTests({ ...baseApi, sessionPending });

    const result = await listAgentPendingInteractions([agent('claude-1')], []);

    expect(result).toEqual([]);
    expect(sessionPending).not.toHaveBeenCalled();
  });

  it('skips an agent whose session name resolves to no live session id', async () => {
    const sessionPending = vi.fn();
    setSupervisorApiForTests({ ...baseApi, sessionPending });

    const result = await listAgentPendingInteractions(
      [agent('claude-1', 'tmux-ghost')],
      [session('sess-1', 'tmux-1')],
    );

    expect(result).toEqual([]);
    expect(sessionPending).not.toHaveBeenCalled();
  });

  it('drops candidates whose session reports no pending interaction', async () => {
    const sessionPending = vi.fn(
      async (_city: string, sessionId: string): Promise<SessionPendingResponse> =>
        sessionId === 'sess-1' ? { supported: true } : { supported: true, pending: pending('req') },
    );
    setSupervisorApiForTests({ ...baseApi, sessionPending });

    const result = await listAgentPendingInteractions(
      [agent('claude-1', 'tmux-1'), agent('claude-2', 'tmux-2')],
      [session('sess-1', 'tmux-1'), session('sess-2', 'tmux-2')],
    );

    expect(result.map((item) => item.agentName)).toEqual(['claude-2']);
  });

  it('ignores wire sessions that carry no session_name when indexing', async () => {
    const sessionPending = vi.fn(
      async (): Promise<SessionPendingResponse> => ({ supported: true, pending: pending('req') }),
    );
    setSupervisorApiForTests({ ...baseApi, sessionPending });
    const nameless = {
      ...session('sess-2', 'tmux-1'),
      session_name: undefined,
    } as unknown as SessionResponse;

    const result = await listAgentPendingInteractions(
      [agent('claude-1', 'tmux-1')],
      [session('sess-1', 'tmux-1'), nameless],
    );

    // The named session wins the index; the nameless one is never reachable.
    expect(result).toEqual([
      {
        agentName: 'claude-1',
        sessionId: 'sess-1',
        sessionName: 'tmux-1',
        pending: pending('req'),
      },
    ]);
  });
});

describe('respondToAgentPendingInteraction', () => {
  it('routes the response to the active city and session', async () => {
    const respondSession = vi.fn(async () => ({ id: 'sess-1' }) as never);
    setSupervisorApiForTests({ ...baseApi, respondSession });

    await respondToAgentPendingInteraction('sess-1', { request_id: 'req-1', action: 'allow' });

    expect(respondSession).toHaveBeenCalledWith('test-city', 'sess-1', {
      request_id: 'req-1',
      action: 'allow',
    });
  });
});
