import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GC_MUTATION_HEADERS,
  resetSupervisorApiForTests,
  setSupervisorApiForTests,
  type SupervisorApi,
} from './client';
import { setActiveCity } from '../api/cityBase';
import {
  claimSupervisorBead,
  closeSupervisorBead,
  createAndSlingSupervisorBead,
  nudgeSupervisorAgent,
} from './beadWrites';

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

describe('supervisor bead writes', () => {
  beforeEach(() => {
    setActiveCity('test-city');
  });

  afterEach(() => {
    resetSupervisorApiForTests();
  });

  it('claims a bead directly through the supervisor API as the operator', async () => {
    const updateBead = vi.fn(async () => ({ status: 'ok' }));
    setSupervisorApiForTests({ ...baseApi, updateBead });

    await claimSupervisorBead('td-bead-abc123');

    expect(updateBead).toHaveBeenCalledWith('test-city', 'td-bead-abc123', {
      status: 'in_progress',
      assignee: 'stephanie',
    });
  });

  it('closes a bead directly through the supervisor API with a trimmed reason', async () => {
    const closeBead = vi.fn(async () => ({ status: 'closed' }));
    setSupervisorApiForTests({ ...baseApi, closeBead });

    await closeSupervisorBead('td-bead-abc123', '  operator verified duplicate  ');

    expect(closeBead).toHaveBeenCalledWith('test-city', 'td-bead-abc123', {
      reason: 'operator verified duplicate',
    });
  });

  it('omits the optional close body when the reason is blank', async () => {
    const closeBead = vi.fn(async () => ({ status: 'closed' }));
    setSupervisorApiForTests({ ...baseApi, closeBead });

    await closeSupervisorBead('td-bead-abc123', '   ');

    expect(closeBead).toHaveBeenCalledWith('test-city', 'td-bead-abc123', undefined);
  });

  it('nudges an agent directly through the supervisor API with a trimmed alias', async () => {
    const nudgeAgent = vi.fn(async () => ({ status: 'ok' }));
    setSupervisorApiForTests({ ...baseApi, nudgeAgent });

    await nudgeSupervisorAgent('  mayor  ');

    expect(nudgeAgent).toHaveBeenCalledWith('test-city', 'mayor');
  });

  it('creates and slings a bead directly through the supervisor API with trimmed input', async () => {
    const createBead = vi.fn(async () => ({
      id: 'td-new-1',
      title: 'Route failing work',
      status: 'open',
      issue_type: 'task',
      created_at: '2026-06-01T00:00:00Z',
    }));
    const sling = vi.fn(async () => ({
      status: 'ok',
      bead: 'td-new-1',
      target: 'mayor',
    }));
    setSupervisorApiForTests({ ...baseApi, createBead, sling });

    const result = await createAndSlingSupervisorBead({
      title: '  Route failing work  ',
      description: '  Please investigate.  ',
      rig: '  east  ',
      target: '  mayor  ',
    });

    expect(result.bead.id).toBe('td-new-1');
    expect(createBead).toHaveBeenCalledWith('test-city', {
      title: 'Route failing work',
      description: 'Please investigate.',
    });
    expect(sling).toHaveBeenCalledWith('test-city', {
      bead: 'td-new-1',
      rig: 'east',
      target: 'mayor',
    });
  });

  it('requires a title and sling target before creating a bead', async () => {
    const createBead = vi.fn(async () => ({
      id: 'td-new-1',
      title: 'Route failing work',
      status: 'open',
      issue_type: 'task',
      created_at: '2026-06-01T00:00:00Z',
    }));
    const sling = vi.fn(async () => ({ status: 'ok', bead: 'td-new-1', target: 'mayor' }));
    setSupervisorApiForTests({ ...baseApi, createBead, sling });

    await expect(createAndSlingSupervisorBead({
      title: ' ',
      description: '',
      rig: 'east',
      target: 'mayor',
    })).rejects.toThrow(/title is required/i);
    await expect(createAndSlingSupervisorBead({
      title: 'Route failing work',
      description: '',
      rig: 'east',
      target: ' ',
    })).rejects.toThrow(/target is required/i);
    expect(createBead).not.toHaveBeenCalled();
    expect(sling).not.toHaveBeenCalled();
  });
});
