import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MaintainerTriage } from 'gas-city-dashboard-shared';
import { api } from '../../../api/client';
import { invalidateKey } from '../../../api/cache';
import { NowProvider } from '../../../contexts/NowContext';
import { ViewingAsProvider } from '../../../contexts/ViewingAsContext';
import { MaintainerPage } from './Maintainer';

// gascity-dashboard-ppe: end-to-end pin of the dual-intent dispatch
// contract on MaintainerPage. The bar-level unit tests in
// Maintainer.test.tsx stop at the props boundary — they confirm
// onSendDraft is invoked, but the path from click → handleSend('draft')
// → buildSlingRequests(intent='draft') → api.maintainerSling({intent:'draft'})
// has no integration coverage, and TypeScript narrowing alone doesn't
// catch a wrong-string regression where the draft button gets wired to
// the triage intent (or the success label).
//
// This file mounts the whole page with a synthetic envelope, mocks the
// api client at module boundary, and asserts both arms separately:
//
//   - Click 'Send to triage agent' → mock.calls[0][0].intent === 'triage'
//     AND success line reads 'Slung 1 to triage agent.'
//   - Click 'Send to draft agent'  → mock.calls[0][0].intent === 'draft'
//     AND success line reads 'Slung 1 to draft agent.'
//
// Failure mode this catches: a future refactor that wires the draft
// button to dispatch the triage intent (or vice-versa), or that swaps
// the success label constants.

// Mock the api client at module boundary — same pattern as
// ViewingAsContext.test.tsx. Test cases install per-call behaviour
// in beforeEach (mockReset wipes everything across tests).
vi.mock('../../../api/client', () => ({
  api: {
    maintainerTriage: vi.fn(),
    maintainerRefresh: vi.fn(),
    maintainerSling: vi.fn(),
  },
  ApiClientError: class extends Error {},
}));

const mockListSupervisorSessions = vi.hoisted(() => vi.fn());
const mockListSupervisorMail = vi.hoisted(() => vi.fn());

vi.mock('../../../supervisor/sessionReads', () => ({
  listSupervisorSessions: mockListSupervisorSessions,
}));

vi.mock('../../../supervisor/mailReads', () => ({
  listSupervisorMail: mockListSupervisorMail,
}));

const mockTriage = api.maintainerTriage as Mock;
const mockSling = api.maintainerSling as Mock;

// MaintainerPage opens an EventSource on /api/maintainer/events for SSE
// refresh. jsdom has no EventSource — stub a no-op so the mount doesn't
// throw. The handler shape is intentionally minimal (addEventListener +
// removeEventListener + close); the component never dispatches into it
// during these tests.
class NoopEventSource {
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

// Synthetic envelope: a single regression_breaking unclustered open
// issue. is_marked=false so the row reads as a generic selectable item
// (the selection checkbox, not the maroon ●, drives the test). slung=null
// so the SlungLink doesn't render. triage_assessment=null so the
// heuristic 't<n>' affordance renders rather than the vetted check
// glyph. Author tier=trusted to keep ContributorByline neutral. The
// envelope's exact priority/cluster shape is incidental — what matters
// is that ONE item ends up flattened into allItems and selectable.
const SYNTHETIC_ITEM_NUMBER = 4242;
const SYNTHETIC_ITEM_URL = 'https://github.com/gastownhall/gascity/issues/4242';

function syntheticEnvelope(): MaintainerTriage {
  return {
    computed_at: '2026-05-24T00:00:00.000Z',
    repo: 'gastownhall/gascity',
    totals: { issues_open: 1, prs_open: 0 },
    tiers: [
      {
        tier: 'regression_breaking' as const,
        clusters: [],
        unclustered: [
          {
            kind: 'issue' as const,
            number: SYNTHETIC_ITEM_NUMBER,
            title: 'fixture issue for dual-intent dispatch contract test',
            status: 'open' as const,
            author: {
              login: 'fixture-bot',
              tier: 'trusted' as const,
              issues_accepted: 0,
              issues_opened: 1,
              prs_merged: 0,
              prs_opened: 0,
              computed_at: '2026-05-24T00:00:00.000Z',
            },
            created_at: '2026-05-23T00:00:00.000Z',
            updated_at: '2026-05-24T00:00:00.000Z',
            labels: ['priority/p1'],
            tier: 'regression_breaking' as const,
            triage_score: 215,
            triage_assessment: null,
            slung: null,
            cluster_id: null,
            blast_files: [],
            lines_changed: null,
            weak_ties: [],
            linked_numbers: [],
            html_url: SYNTHETIC_ITEM_URL,
            is_marked: false,
            has_in_flight_pr: false,
          },
        ],
      },
      { tier: 'regression' as const, clusters: [], unclustered: [] },
      { tier: 'stability' as const, clusters: [], unclustered: [] },
    ],
  };
}

beforeEach(() => {
  mockTriage.mockReset();
  mockSling.mockReset();
  mockListSupervisorSessions.mockReset();
  mockListSupervisorMail.mockReset();
  // The MaintainerPage's useCachedData hook reads from a module-level
  // in-memory cache (api/cache.ts). Without clearing between tests, a
  // later test would skip the mockTriage call entirely and seed off the
  // prior test's data — making mockSling assertions still correct, but
  // the test wouldn't actually exercise the fetch path. Drop the entry
  // so each test fully re-fetches.
  invalidateKey('maintainer-triage');
  mockTriage.mockResolvedValue(syntheticEnvelope());
  // ViewingAsProvider doesn't fire loadAliases unless asked, but the
  // visibilitychange effect still mounts. Resolve the two prefetch
  // entry-points to safe defaults in case anything calls them.
  mockListSupervisorSessions.mockResolvedValue({ items: [] });
  mockListSupervisorMail.mockResolvedValue({ items: [] });
  // Stub EventSource for MaintainerPage's /api/maintainer/events subscribe.
  // jsdom doesn't provide it; without this the mount throws.
  (globalThis as unknown as { EventSource: typeof NoopEventSource }).EventSource =
    NoopEventSource;
});

afterEach(() => {
  cleanup();
});

function mount() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <NowProvider intervalMs={1_000_000}>
        <ViewingAsProvider>
          <MaintainerPage />
        </ViewingAsProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

async function selectFixtureItem() {
  // Wait for the synthetic item to render after the initial fetch
  // resolves — the title is the most distinctive selector and doesn't
  // depend on the bar / checkbox markup that the test is about to act on.
  await screen.findByText(/fixture issue for dual-intent/i);
  // The selection checkbox aria-label format comes from SelectCheckbox:
  //   `select ${kind} #${number} for bulk triage`
  // Using the formal label keeps the selector stable against innocuous
  // row layout changes.
  const checkbox = screen.getByRole('checkbox', {
    name: new RegExp(`select issue #${SYNTHETIC_ITEM_NUMBER} for bulk triage`, 'i'),
  }) as HTMLInputElement;
  await act(async () => {
    checkbox.click();
  });
  expect(checkbox.checked).toBe(true);
}

async function clickButton(name: RegExp) {
  const btn = screen.getByRole('button', { name }) as HTMLButtonElement;
  await act(async () => {
    btn.click();
  });
}

describe('MaintainerPage — dual-intent dispatch contract (gascity-dashboard-ppe)', () => {
  it('click "Send to triage agent" produces a POST with intent="triage" and the triage success label', async () => {
    mockSling.mockResolvedValue({ ok: true });
    mount();
    await selectFixtureItem();
    await clickButton(/send to triage agent/i);

    // Wait for the dispatch to settle: the bar flips out of 'Sending'
    // back to the static label, and the success line appears.
    await waitFor(() => {
      expect(mockSling).toHaveBeenCalledTimes(1);
    });

    const payload = mockSling.mock.calls[0]?.[0] as {
      kind: 'pr' | 'issue';
      number: number;
      html_url: string;
      intent: 'review' | 'draft' | 'triage';
      target?: string;
    };
    expect(payload.intent).toBe('triage');
    expect(payload.kind).toBe('issue');
    expect(payload.number).toBe(SYNTHETIC_ITEM_NUMBER);
    expect(payload.html_url).toBe(SYNTHETIC_ITEM_URL);
    // Backend resolves the target from MAINTAINER_TRIAGE_TARGET /
    // MAINTAINER_SLING_TARGET — the frontend must NOT pass an explicit
    // target so the server owns the routing decision. Pinning this
    // catches a regression where someone hardcodes a target client-side.
    expect(payload.target).toBeUndefined();

    // Success line uses the triage label, not the draft label.
    const status = await screen.findByRole('status');
    const normalised = status.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(normalised).toMatch(/^Slung 1 to triage agent\./);
  });

  it('click "Send to draft agent" produces a POST with intent="draft" and the draft success label', async () => {
    mockSling.mockResolvedValue({ ok: true });
    mount();
    await selectFixtureItem();
    await clickButton(/send to draft agent/i);

    await waitFor(() => {
      expect(mockSling).toHaveBeenCalledTimes(1);
    });

    const payload = mockSling.mock.calls[0]?.[0] as {
      kind: 'pr' | 'issue';
      number: number;
      html_url: string;
      intent: 'review' | 'draft' | 'triage';
      target?: string;
    };
    // The core contract this bead pins: the draft button MUST dispatch
    // intent='draft'. A regression that wires the draft button to the
    // triage handler would flip this string back to 'triage' and fail.
    expect(payload.intent).toBe('draft');
    expect(payload.kind).toBe('issue');
    expect(payload.number).toBe(SYNTHETIC_ITEM_NUMBER);
    expect(payload.html_url).toBe(SYNTHETIC_ITEM_URL);
    expect(payload.target).toBeUndefined();

    // Success line uses the DRAFT label, not the triage label. Renaming
    // DRAFT_TARGET_LABEL to anything else (or routing the success-line
    // builder to TRIAGE_TARGET_LABEL on the draft arm) would fail here.
    const status = await screen.findByRole('status');
    const normalised = status.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(normalised).toMatch(/^Slung 1 to draft agent\./);
  });
});

// gascity-dashboard-2yr: end-to-end pin that MaintainerPage wires
// `data.slung_section` into the <SlungSection> group. The component-level
// tests in Maintainer.test.tsx render SlungSection in isolation; this
// confirms the page actually passes the envelope's slung_section through
// and that the lifted item appears in the in-flight group rather than the
// backlog tier. Failure mode caught: a refactor that drops the
// slung_section render branch or feeds it the wrong field.
describe('MaintainerPage — slung section wiring (gascity-dashboard-2yr)', () => {
  it('renders the "Slung · awaiting agent" group with the lifted item from data.slung_section', async () => {
    const env = syntheticEnvelope();
    // This test pins ONLY the slung_section → <SlungSection> wiring on
    // MaintainerPage. The actual lift-out-of-tier behaviour (the backend
    // overlay removing the item from its tier) is covered by the backend
    // overlay tests; here the slung PR (7700) is simply placed directly in
    // slung_section — it is intentionally NOT in env.tiers, mirroring what
    // the wire looks like AFTER the backend has already lifted it.
    env.slung_section = [
      {
        kind: 'pr',
        number: 7700,
        title: 'slung fixture PR awaiting the triage agent',
        status: 'open',
        author: {
          login: 'fixture-bot',
          tier: 'trusted',
          issues_accepted: 0,
          issues_opened: 0,
          prs_merged: 0,
          prs_opened: 1,
          computed_at: '2026-05-24T00:00:00.000Z',
        },
        created_at: '2026-05-23T00:00:00.000Z',
        updated_at: '2026-05-24T00:00:00.000Z',
        labels: ['kind/bug'],
        tier: 'regression_breaking',
        triage_score: 300,
        triage_assessment: null,
        slung: {
          slung_at: '2026-05-26T10:30:00Z',
          target: 'chief-of-staff',
          bead_id: 'gc-7700',
          resolved_session_name: 'oversight-rig__chief-of-staff',
        },
        cluster_id: null,
        blast_files: [],
        lines_changed: 50,
        weak_ties: [],
        linked_numbers: [],
        html_url: 'https://github.com/gastownhall/gascity/pull/7700',
        is_marked: false,
        has_in_flight_pr: false,
      },
    ];
    mockTriage.mockResolvedValue(env);
    mount();

    // The section header renders, and the lifted item's drill-in link is
    // present (proving RowList → SlungLink fired for the section).
    await screen.findByRole('button', { name: /slung/i });
    const link = await screen.findByRole('link', {
      name: /slung to chief-of-staff/i,
    });
    expect(link.getAttribute('href')).toBe('/agents/oversight-rig__chief-of-staff');
  });
});
