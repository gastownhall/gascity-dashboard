import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { StrandedWorkItem } from '../contracts';
import { StrandedShelf } from './StrandedShelf';

afterEach(cleanup);

function item(
  over: Partial<StrandedWorkItem> & Pick<StrandedWorkItem, 'beadId'>,
): StrandedWorkItem {
  return {
    title: over.beadId,
    rigKey: 'geo',
    linkTo: `/beads?bead=${over.beadId}`,
    ...over,
  };
}

function renderShelf(work: StrandedWorkItem[]) {
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <StrandedShelf work={work} />
    </MemoryRouter>,
  );
}

describe('StrandedShelf', () => {
  it('renders nothing when there is no orphaned work', () => {
    const { container } = render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <StrandedShelf work={[]} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe('');
  });

  it('summarises the total orphaned count in one pill', () => {
    renderShelf([item({ beadId: 'b1' }), item({ beadId: 'b2', rigKey: 'mem' })]);
    expect(screen.getByRole('button', { name: /2 stranded/i })).toBeTruthy();
  });

  it('is collapsed by default (no drill-in list until toggled)', () => {
    renderShelf([item({ beadId: 'b1', title: 'Fix the latch' })]);
    expect(screen.queryByText('Fix the latch')).toBeNull();
  });

  it('expands to a drill-in list linking each orphaned bead to its detail', () => {
    renderShelf([
      item({ beadId: 'b1', title: 'Fix the latch', rigKey: 'geo' }),
      item({ beadId: 'b2', title: 'Reroute mail', rigKey: 'mem' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /stranded/i }));
    const link = screen.getByRole('link', { name: /Fix the latch/i });
    expect(link.getAttribute('href')).toBe('/beads?bead=b1');
    expect(screen.getByRole('link', { name: /Reroute mail/i }).getAttribute('href')).toBe(
      '/beads?bead=b2',
    );
  });

  it('names the owning rig for each orphaned bead in the drill-in', () => {
    renderShelf([item({ beadId: 'b1', title: 'Fix the latch', rigKey: 'geo' })]);
    fireEvent.click(screen.getByRole('button', { name: /stranded/i }));
    expect(screen.getByText(/geo/i)).toBeTruthy();
  });

  it('orders beads with the same rig by title', () => {
    renderShelf([
      item({ beadId: 'b2', title: 'Zulu', rigKey: 'geo' }),
      item({ beadId: 'b1', title: 'Alpha', rigKey: 'geo' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /stranded/i }));
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Zulu'),
    ]);
  });
});
