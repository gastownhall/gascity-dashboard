import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '../../attention/compose';
import { composeAttention } from '../../attention/compose';
import { createAttentionContributors } from '../../attention/registry';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { BeadAttentionPanel, beadIdFromHref } from './BeadAttentionPanel';

afterEach(() => cleanup());

function attentionItem(
  overrides: Partial<AttentionItem> & Pick<AttentionItem, 'id'>,
): AttentionItem {
  return {
    domain: 'beads',
    severity: 'attention',
    title: 'Bead',
    ...overrides,
  };
}

function supervisorBead(overrides: Partial<SupervisorBead> & { id: string }): SupervisorBead {
  return {
    created_at: '2026-06-07T11:00:00.000Z',
    issue_type: 'task',
    status: 'open',
    title: 'Bead',
    ...overrides,
  };
}

function bead(overrides: Partial<Bead>): Bead {
  return {
    created_at: '2026-06-01T11:00:00.000Z',
    id: 'B-0',
    issue_type: 'task',
    status: 'open',
    title: 'Bead',
    ...overrides,
  };
}

describe('beadIdFromHref', () => {
  it('extracts the bead id from a /beads?bead=… href', () => {
    expect(beadIdFromHref('/beads?bead=B-1')).toBe('B-1');
  });
  it('returns null for an href with no bead param', () => {
    expect(beadIdFromHref('/beads')).toBeNull();
    expect(beadIdFromHref(undefined)).toBeNull();
  });
});

describe('BeadAttentionPanel (gascity-dashboard-2j8e.3)', () => {
  const noop = () => undefined;

  it('offers Claim for a ready-unclaimed bead the board loaded, Open otherwise', () => {
    const onClaim = vi.fn();
    const onOpen = vi.fn();
    render(
      <BeadAttentionPanel
        items={[
          attentionItem({
            id: 'beads:B-ready:ready-unclaimed',
            severity: 'watch',
            title: 'B-ready unclaimed',
            href: '/beads?bead=B-ready',
          }),
          attentionItem({
            id: 'beads:B-esc:escalated',
            title: 'B-esc escalated',
            href: '/beads?bead=B-esc',
          }),
        ]}
        beadById={(id) => (id === 'B-ready' ? supervisorBead({ id: 'B-ready' }) : undefined)}
        onOpen={onOpen}
        onClaim={onClaim}
        readOnly={false}
        claimingId={null}
      />,
    );

    expect(screen.getByText('Needs you').textContent).toContain('(2)');
    const readyRow = screen.getByText('B-ready unclaimed').closest('li') as HTMLElement;
    within(readyRow).getByRole('button', { name: 'Claim' }).click();
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 'B-ready' }));

    const escRow = screen.getByText('B-esc escalated').closest('li') as HTMLElement;
    expect(within(escRow).queryByRole('button', { name: 'Claim' })).toBeNull();
    within(escRow).getByRole('button', { name: 'Open' }).click();
    expect(onOpen).toHaveBeenCalledWith('B-esc');
  });

  it('disables Claim in read-only mode', () => {
    render(
      <BeadAttentionPanel
        items={[
          attentionItem({
            id: 'beads:B-ready:ready-unclaimed',
            severity: 'watch',
            title: 'B-ready unclaimed',
            href: '/beads?bead=B-ready',
          }),
        ]}
        beadById={() => supervisorBead({ id: 'B-ready' })}
        onOpen={noop}
        onClaim={noop}
        readOnly
        claimingId={null}
      />,
    );
    expect((screen.getByRole('button', { name: 'Claim' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('renders nothing when there are no badge-counting items', () => {
    const { container } = render(
      <BeadAttentionPanel
        items={[]}
        beadById={() => undefined}
        onOpen={noop}
        onClaim={noop}
        readOnly={false}
        claimingId={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders exactly the nav-badge count — page and badge read the same model', () => {
    // Build the real composed model the nav badge reads, then assert the panel
    // renders one row per badge-counted item (attention + watch).
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          nowMs: Date.parse('2026-06-07T12:00:00.000Z'),
          items: [
            bead({ id: 'B-ready', status: 'open', created_at: '2026-06-04T11:00:00.000Z' }),
            // plain dependency-blocked — excluded from both badge and page.
            bead({ id: 'B-dep', status: 'blocked' }),
          ],
          escalations: [bead({ id: 'B-esc', status: 'blocked', labels: ['gc:escalation'] })],
          // mayor-decision items count toward the badge too — they must also
          // render in the panel, so the parity holds across every source.
          decisions: [bead({ id: 'B-dec', title: 'Decide: X', labels: ['needs/stephanie'] })],
        },
      }),
    );
    const summary = model.byDomain.beads;
    const navTotal = summary.attention + summary.watch;
    expect(navTotal).toBe(3);

    render(
      <BeadAttentionPanel
        items={summary.items}
        beadById={() => undefined}
        onOpen={noop}
        onClaim={noop}
        readOnly={false}
        claimingId={null}
      />,
    );

    expect(screen.getByText('Needs you').textContent).toContain(`(${navTotal})`);
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(navTotal);
  });
});
