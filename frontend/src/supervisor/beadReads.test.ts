import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from './client';
import { listSupervisorBeads } from './beadReads';

const baseApi: SupervisorApi = {
  baseUrl: '/gc-supervisor',
  health: vi.fn(),
  cityHealth: vi.fn(),
  cityStatus: vi.fn(),
  listCities: vi.fn(),
  listAgents: vi.fn(),
  listBeads: vi.fn(),
  listEvents: vi.fn(),
  getBead: vi.fn(),
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

describe('supervisor bead reads', () => {
  beforeEach(() => {
    setActiveCity('test-city');
  });

  afterEach(() => {
    resetSupervisorApiForTests();
  });

  it('keeps decision beads in the default work queue while excluding bookkeeping/system rows', async () => {
    const listBeads = vi.fn(async () => ({
      items: [
        bead({ id: 'rc-decision', issue_type: 'decision' }),
        bead({ id: 'td-task', issue_type: 'task' }),
        bead({ id: 'sys-session', issue_type: 'session' }),
        bead({ id: 'gc-task', issue_type: 'task', labels: ['gc:internal'] }),
      ],
      total: 4,
    }));
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const result = await listSupervisorBeads();

    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 2000 });
    expect(result.items.map((item) => item.id)).toEqual(['rc-decision', 'td-task']);
    expect(result.total).toBe(2);
    expect(result.upstream_total).toBe(4);
  });
});

function bead(overrides: Partial<Bead>): Bead {
  return {
    id: 'td-default',
    issue_type: 'task',
    title: 'Default bead',
    status: 'open',
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}
