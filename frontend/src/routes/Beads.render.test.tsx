import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import { invalidate } from '../api/cache';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor } from '../attention/compose';
import { NowProvider } from '../contexts/NowContext';
import type { SupervisorBead } from '../supervisor/beadReads';
import { BeadsPage } from './Beads';

interface FetchCall {
  method: string;
  path: string;
  query: URLSearchParams;
}

const fetchCalls: FetchCall[] = [];

beforeEach(() => {
  setActiveCity('test-city');
  fetchCalls.length = 0;
  invalidate('beads:board');
  invalidate('sessions');
  invalidate('agents');
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BeadsPage supervisor reads', () => {
  it('shows only real work while requesting all closed/open supervisor statuses', async () => {
    renderPage();

    await screen.findByText('direct supervisor bead');

    expect(screen.queryByText('supervisor noise bead')).toBeNull();
    expect(fetchCalls.some((call) => call.path === '/api/city/test-city/beads')).toBe(false);
    expect(beadFetches().every((call) => call.query.get('all') === 'true')).toBe(true);
  });

  it('resolves a bead query param even when the bead is outside the list window', async () => {
    renderPage('/beads?bead=td-window-miss');

    expect(await screen.findByRole('heading', { name: 'detail-only bead' })).toBeTruthy();
    expect(screen.getAllByText(/td-window-miss/i).length).toBeGreaterThan(0);
    expect(fetchCalls.some((call) =>
      call.path === '/gc-supervisor/v0/city/test-city/bead/td-window-miss'
    )).toBe(true);
  });

  it('renders dependency navigation and live-run access in the bead detail modal', async () => {
    renderPage('/beads?bead=td-bead-abc123');

    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('heading', { name: 'direct supervisor bead' })).toBeTruthy();
    expect(within(dialog).getByText('Dependencies')).toBeTruthy();
    expect(within(dialog).getByText('td-parent-1')).toBeTruthy();
    expect(within(dialog).getByText(/parent bead/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /view live run/i })).toBeTruthy();
  });

  it('marks attention beads on the board while preserving non-attention rows', async () => {
    renderPage('/beads', [
      contributor('beads', [{
        id: 'beads:td-bead-abc123:high-priority',
        domain: 'beads',
        severity: 'attention',
        title: 'td-bead-abc123 high priority',
      }]),
    ]);

    const boardRow = (await screen.findByText('direct supervisor bead')).closest('li');
    expect(boardRow?.getAttribute('data-attention-severity')).toBe('attention');
  });
});

function renderPage(path = '/beads', contributors: readonly AttentionContributor[] = []) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <NowProvider intervalMs={1_000_000}>
        <AttentionProvider contributors={contributors}>
          <BeadsPage />
        </AttentionProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = parsedUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    fetchCalls.push({ method, path: url.pathname, query: url.searchParams });

    if (url.pathname === '/gc-supervisor/v0/city/test-city/beads') {
      return jsonResponse(beadListForType(url.searchParams.get('type')));
    }
    if (url.pathname === '/gc-supervisor/v0/city/test-city/bead/td-window-miss') {
      return jsonResponse(bead({
        id: 'td-window-miss',
        title: 'detail-only bead',
        description: 'fetched by deep-link id',
      }));
    }
    if (url.pathname === '/gc-supervisor/v0/city/test-city/bead/td-bead-abc123') {
      return jsonResponse(bead({
        id: 'td-bead-abc123',
        title: 'direct supervisor bead',
        assignee: 'mayor',
        needs: ['td-parent-1'],
      }));
    }
    if (url.pathname === '/gc-supervisor/v0/city/test-city/sessions') {
      return jsonResponse({
        items: [{
          id: 'gc-session-1',
          session_name: 'mayor',
          alias: 'mayor',
          template: 'mayor',
          title: 'mayor',
          state: 'active',
          provider: 'claude',
          running: true,
          attached: false,
          created_at: '2026-06-01T00:00:00Z',
        }],
        total: 1,
      });
    }
    if (url.pathname === '/gc-supervisor/v0/city/test-city/agents') {
      return jsonResponse({
        items: [{
          name: 'mayor',
          display_name: 'Mayor',
          rig: 'east',
          available: true,
          running: true,
          state: 'active',
          suspended: false,
        }],
        total: 1,
      });
    }
    if (url.pathname.startsWith('/api/city/test-city/links/')) {
      throw new Error('old dashboard links mirror should not be called');
    }
    if (url.pathname.startsWith('/api/city/test-city/beads')) {
      throw new Error('old dashboard bead read mirror should not be called');
    }
    throw new Error(`unexpected fetch: ${url.pathname}${url.search}`);
  }));
}

function beadListForType(type: string | null): { items: SupervisorBead[]; total: number } {
  if (type === 'task') {
    return {
      items: [
        bead({
          id: 'td-bead-abc123',
          title: 'direct supervisor bead',
          assignee: 'mayor',
          needs: ['td-parent-1'],
        }),
        bead({
          id: 'td-noise-abc123',
          title: 'supervisor noise bead',
          labels: ['gc:session'],
        }),
      ],
      total: 2,
    };
  }
  if (type === 'bug') {
    return {
      items: [
        bead({
          id: 'td-parent-1',
          title: 'parent bead',
          status: 'closed',
          issue_type: 'bug',
        }),
      ],
      total: 1,
    };
  }
  return { items: [], total: 0 };
}

function bead(overrides: Partial<SupervisorBead>): SupervisorBead {
  return {
    id: 'td-bead',
    title: 'bead',
    status: 'open',
    issue_type: 'task',
    priority: 0,
    labels: [],
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function beadFetches(): FetchCall[] {
  return fetchCalls.filter((call) => call.path === '/gc-supervisor/v0/city/test-city/beads');
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function parsedUrl(input: RequestInfo | URL): URL {
  const value = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.toString()
      : String(input);
  return new URL(value, window.location.origin);
}

function contributor(
  domain: 'beads',
  items: ReturnType<AttentionContributor['getItems']>,
): AttentionContributor {
  return {
    id: `${domain}:test`,
    domain,
    getItems: () => items,
  };
}
