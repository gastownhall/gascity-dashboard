import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  SupervisorApiError,
  type SupervisorApi,
} from './client';
import {
  fetchSupervisorBead,
  listSupervisorBeads,
  listSupervisorBeadsAssignedTo,
} from './beadReads';

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

    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 1000 });
    expect(result.items.map((item) => item.id)).toEqual(['rc-decision', 'td-task']);
    expect(result.total).toBe(2);
    expect(result.upstream_total).toBe(4);
  });

  it('drops wire-resolved spellings (completed/done) like closed, keeps in-flight wire spellings', async () => {
    // The city bead list can emit supervisor-wire status spellings. The default
    // (includeClosed: false) read must filter out the wire-closed spellings
    // (completed/done), not only the bd-ledger 'closed', or resolved beads would
    // linger on the board; in-flight wire spellings (active/running) must stay.
    const listBeads = vi.fn(async () => ({
      items: [
        bead({ id: 'td-open', status: 'open' }),
        bead({ id: 'td-active', status: 'active' }),
        bead({ id: 'td-running', status: 'running' }),
        bead({ id: 'td-completed', status: 'completed' }),
        bead({ id: 'td-done', status: 'done' }),
        bead({ id: 'td-closed', status: 'closed' }),
      ],
      total: 6,
    }));
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const result = await listSupervisorBeads();

    expect(result.items.map((item) => item.id)).toEqual(['td-open', 'td-active', 'td-running']);
  });

  it('keeps wire-resolved spellings when includeClosed is set', async () => {
    const listBeads = vi.fn(async () => ({
      items: [
        bead({ id: 'td-open', status: 'open' }),
        bead({ id: 'td-completed', status: 'completed' }),
        bead({ id: 'td-done', status: 'done' }),
      ],
      total: 3,
    }));
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const result = await listSupervisorBeads({ includeClosed: true });

    expect(result.items.map((item) => item.id)).toEqual(['td-open', 'td-completed', 'td-done']);
    expect(listBeads).toHaveBeenCalledWith('test-city', { limit: 1000, all: true });
  });

  it('drops terminal failed/skipped wire spellings from the default list (no work remains)', async () => {
    // failed and skipped are terminal in the shared status vocabulary — no work
    // remains — so the default (includeClosed: false) board read must filter them
    // out alongside completed/done/closed, or a finished-but-not-'closed' bead
    // lingers on the open board.
    const listBeads = vi.fn(async () => ({
      items: [
        bead({ id: 'td-open', status: 'open' }),
        bead({ id: 'td-failed', status: 'failed' }),
        bead({ id: 'td-skipped', status: 'skipped' }),
      ],
      total: 3,
    }));
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const result = await listSupervisorBeads();

    expect(result.items.map((item) => item.id)).toEqual(['td-open']);
  });

  // gascity-dashboard-sg9o: a "needs you" decision alert can deep-link to a
  // bead the supervisor has since pruned (e.g. gc-316879). fetchSupervisorBead
  // is the data edge the deep-link modal sits on: it must surface a true 404 as
  // a SupervisorApiError(404) so useBeadDetail can render the calm "resolved or
  // removed" state instead of a hard error.
  it('re-raises a 404 when a deep-linked bead is gone and absent from the fallback list', async () => {
    const getBead = vi.fn(async () => {
      throw new SupervisorApiError(404, 'bead missing', undefined);
    });
    const listBeads = vi.fn(async () => ({ items: [bead({ id: 'td-other' })], total: 1 }));
    setSupervisorApiForTests({ ...baseApi, getBead, listBeads });

    await expect(fetchSupervisorBead('gc-316879')).rejects.toMatchObject({
      name: 'SupervisorApiError',
      status: 404,
    });
    expect(getBead).toHaveBeenCalledWith('test-city', 'gc-316879');
  });

  it('recovers a deep-linked bead from the fallback list when getBead 404s but it still lists', async () => {
    const getBead = vi.fn(async () => {
      throw new SupervisorApiError(404, 'bead missing', undefined);
    });
    const listBeads = vi.fn(async () => ({
      items: [bead({ id: 'rc-decision', issue_type: 'decision' })],
      total: 1,
    }));
    setSupervisorApiForTests({ ...baseApi, getBead, listBeads });

    const hit = await fetchSupervisorBead('rc-decision');

    expect(hit.id).toBe('rc-decision');
  });

  it('propagates non-404 read failures without consulting the fallback list', async () => {
    const getBead = vi.fn(async () => {
      throw new SupervisorApiError(503, 'supervisor unavailable', undefined);
    });
    const listBeads = vi.fn();
    setSupervisorApiForTests({ ...baseApi, getBead, listBeads });

    await expect(fetchSupervisorBead('rc-decision')).rejects.toMatchObject({ status: 503 });
    expect(listBeads).not.toHaveBeenCalled();
  });

  it('does not flag the assigned-bead union partial when assignees merely share a bead', async () => {
    // Each leg is complete (total === its own page) but both legs return the
    // same bead. The union dedups to one item; a summed-total-vs-deduped-count
    // check would false-trip partial. Per-leg incompleteness must not.
    const shared = bead({ id: 'td-shared' });
    const listBeads = vi.fn(async () => ({ items: [shared], total: 1 }));
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const result = await listSupervisorBeadsAssignedTo(['a', 'b']);

    expect(result.items).toHaveLength(1);
    expect(result.partial).toBe(false);
  });

  it('flags the assigned-bead union partial when any single leg was truncated', async () => {
    const listBeads = vi.fn(async (_city: string, query?: { assignee?: string }) =>
      query?.assignee === 'a'
        ? { items: [bead({ id: 'td-a' })], total: 9 }
        : { items: [bead({ id: 'td-b' })], total: 1 },
    );
    setSupervisorApiForTests({ ...baseApi, listBeads });

    const result = await listSupervisorBeadsAssignedTo(['a', 'b']);

    expect(result.partial).toBe(true);
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
