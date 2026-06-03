import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MaintainerTriage, TriageItem, TriageItemStatus } from 'gas-city-dashboard-shared';
import { api } from '../../../api/client';
import { invalidateKey } from '../../../api/cache';
import { AttentionProvider } from '../../../attention/context';
import { createAttentionContributors } from '../../../attention/registry';
import { NowProvider } from '../../../contexts/NowContext';
import { ViewingAsProvider } from '../../../contexts/ViewingAsContext';
import { MaintainerPage } from './Maintainer';

// dw8 — `/maintainer?view=needs-you` activates the Needs-You composite
// filter mode. This file covers the page-level behaviour: the mode pill
// renders, only matching items are surfaced, the "Awaiting triage only"
// chip is hidden (its intersection with needs-you is empty by PR
// lifecycle), and "Show all" navigates back to `/maintainer`.
//
// Pure predicate coverage lives in `needsYou.test.ts`. This file pins
// the wiring between the URL query, the mode pill, and the filtered tier.

vi.mock('../../../api/client', () => ({
  api: {
    maintainerTriage: vi.fn(),
    maintainerRefresh: vi.fn(),
    maintainerSling: vi.fn(),
    config: vi.fn(),
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

class NoopEventSource {
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

function mkItem(
  overrides: Partial<TriageItem> & {
    kind: 'pr' | 'issue';
    number: number;
    status: TriageItemStatus;
  },
): TriageItem {
  return {
    kind: overrides.kind,
    number: overrides.number,
    title: overrides.title ?? `Item ${overrides.number}`,
    html_url:
      overrides.html_url ??
      `https://github.com/gastownhall/gascity/${overrides.kind === 'pr' ? 'pull' : 'issues'}/${overrides.number}`,
    labels: overrides.labels ?? [],
    status: overrides.status,
    author: overrides.author ?? {
      login: 'someone',
      tier: 'trusted',
      issues_opened: null,
      issues_accepted: null,
      prs_opened: null,
      prs_merged: null,
      computed_at: null,
    },
    tier: overrides.tier ?? 'regression_breaking',
    triage_score: overrides.triage_score ?? 200,
    triage_assessment: overrides.triage_assessment ?? null,
    slung: overrides.slung ?? null,
    cluster_id: overrides.cluster_id ?? null,
    blast_files: overrides.blast_files ?? [],
    lines_changed: overrides.lines_changed ?? null,
    is_marked: overrides.is_marked ?? false,
    has_in_flight_pr: overrides.has_in_flight_pr ?? false,
    linked_numbers: overrides.linked_numbers ?? [],
    weak_ties: overrides.weak_ties ?? [],
    created_at: overrides.created_at ?? '2026-05-20T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-29T00:00:00.000Z',
  };
}

function envelope(items: TriageItem[]): MaintainerTriage {
  return {
    computed_at: '2026-05-30T00:00:00.000Z',
    repo: 'gastownhall/gascity',
    totals: { issues_open: 0, prs_open: items.filter((i) => i.kind === 'pr').length },
    tiers: [
      { tier: 'regression_breaking', clusters: [], unclustered: items },
      { tier: 'regression', clusters: [], unclustered: [] },
      { tier: 'stability', clusters: [], unclustered: [] },
    ],
  };
}

beforeEach(() => {
  mockTriage.mockReset();
  mockListSupervisorSessions.mockReset();
  mockListSupervisorMail.mockReset();
  invalidateKey('maintainer-triage');
  mockListSupervisorSessions.mockResolvedValue({ items: [] });
  mockListSupervisorMail.mockResolvedValue({ items: [] });
  (globalThis as unknown as { EventSource: typeof NoopEventSource }).EventSource =
    NoopEventSource;
});

afterEach(() => {
  cleanup();
});

function mount(
  initialEntries: string[],
  options: { attention?: MaintainerTriage } = {},
) {
  const contributors = createAttentionContributors(
    options.attention === undefined
      ? {}
      : {
          maintainer: {
            nowMs: Date.parse('2026-06-01T12:00:00.000Z'),
            triage: options.attention,
          },
        },
  );
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      {/* intervalMs pushed off into 'never fires during the test' range so
          the 1s default tick does not race with cleanup and produce
          act-warning noise. Matches the pattern at AmbientHome.test.tsx. */}
      <NowProvider intervalMs={1_000_000}>
        <ViewingAsProvider>
          <AttentionProvider contributors={contributors}>
            <MaintainerPage />
          </AttentionProvider>
        </ViewingAsProvider>
      </NowProvider>
    </MemoryRouter>,
  );
}

describe('MaintainerPage — needs-you mode (dw8)', () => {
  it('renders the "Needs you" pill in the header when ?view=needs-you', async () => {
    mockTriage.mockResolvedValue(
      envelope([
        mkItem({ kind: 'pr', number: 1, status: 'changes_requested', title: 'needs you item' }),
      ]),
    );
    mount(['/maintainer?view=needs-you']);
    expect(await screen.findByRole('status', { name: /needs.you mode/i })).toBeTruthy();
  });

  it('does NOT render the "Needs you" pill on plain /maintainer', async () => {
    mockTriage.mockResolvedValue(
      envelope([
        mkItem({ kind: 'pr', number: 1, status: 'changes_requested', title: 'needs you item' }),
      ]),
    );
    mount(['/maintainer']);
    await screen.findByText(/needs you item/);
    expect(screen.queryByRole('status', { name: /needs.you mode/i })).toBeNull();
  });

  it('shows only items that match the composite predicate', async () => {
    const keep = mkItem({
      kind: 'pr',
      number: 1,
      status: 'changes_requested',
      title: 'keep changes-requested',
    });
    const drop = mkItem({
      kind: 'pr',
      number: 2,
      status: 'open',
      title: 'drop open-only',
      updated_at: '2026-05-29T00:00:00.000Z', // fresh, not stalled
    });
    mockTriage.mockResolvedValue(envelope([keep, drop]));
    mount(['/maintainer?view=needs-you']);

    await screen.findByText(/keep changes-requested/);
    expect(screen.queryByText(/drop open-only/)).toBeNull();
  });

  it('hides the "Awaiting triage only" chip in needs-you mode (intersection ~empty)', async () => {
    mockTriage.mockResolvedValue(
      envelope([mkItem({ kind: 'pr', number: 1, status: 'changes_requested' })]),
    );
    mount(['/maintainer?view=needs-you']);
    await screen.findByRole('status', { name: /needs.you mode/i });
    expect(screen.queryByRole('button', { name: /awaiting triage only/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /show vetted too/i })).toBeNull();
  });

  it('keeps the "Awaiting triage only" chip on plain /maintainer', async () => {
    mockTriage.mockResolvedValue(
      envelope([mkItem({ kind: 'pr', number: 1, status: 'open' })]),
    );
    mount(['/maintainer']);
    expect(await screen.findByRole('button', { name: /awaiting triage only/i })).toBeTruthy();
  });

  it('renders a "Show all" link back to /maintainer in needs-you mode', async () => {
    mockTriage.mockResolvedValue(
      envelope([mkItem({ kind: 'pr', number: 1, status: 'changes_requested' })]),
    );
    mount(['/maintainer?view=needs-you']);
    const pill = await screen.findByRole('status', { name: /needs.you mode/i });
    const link = within(pill).getByRole('link', { name: /show all/i });
    expect(link.getAttribute('href')).toBe('/maintainer');
  });

  it('renders the runs cross-link in needs-you mode', async () => {
    mockTriage.mockResolvedValue(
      envelope([mkItem({ kind: 'pr', number: 1, status: 'changes_requested' })]),
    );
    mount(['/maintainer?view=needs-you']);
    const link = await screen.findByRole('link', { name: /runs/i });
    expect(link.getAttribute('href')).toBe('/runs');
  });

  it('highlights rows that match Maintainer attention facts', async () => {
    const triage = envelope([
      mkItem({
        kind: 'pr',
        number: 1,
        status: 'changes_requested',
        title: 'keep changes-requested',
      }),
    ]);
    mockTriage.mockResolvedValue(triage);

    mount(['/maintainer'], { attention: triage });

    const rowText = await screen.findByText(/keep changes-requested/);
    const highlighted = rowText.closest('[data-attention-severity]');
    expect(highlighted?.getAttribute('data-attention-severity')).toBe('attention');
  });
});
