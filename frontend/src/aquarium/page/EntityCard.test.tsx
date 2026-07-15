import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PelletEntity } from '../contracts';
import { EntityCard } from './EntityCard';
import type { HitResult } from './hitTest';

afterEach(cleanup);

function pellet(over: Partial<PelletEntity> = {}): PelletEntity {
  return {
    beadId: 'mem-shs5t',
    label: 'mem-shs5t',
    title: 'Finalize the workflow',
    linkTo: '/beads?bead=mem-shs5t',
    rigKey: 'mem',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1,
    ...over,
  };
}

const VIEWPORT = { cssWidth: 1200, cssHeight: 800 };

function renderCard(hit: NonNullable<HitResult>, anchorX = 0, anchorY = 0) {
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <EntityCard
        hit={hit}
        anchorX={anchorX}
        anchorY={anchorY}
        viewport={VIEWPORT}
        onDismiss={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('EntityCard pellet body', () => {
  it('links a bead pellet to its supervisor bead-detail route', () => {
    renderCard({ kind: 'pellet', entity: pellet() });
    const link = screen.getByRole('link', { name: /open bead/i });
    expect(link.getAttribute('href')).toBe('/beads?bead=mem-shs5t');
  });

  it('shows the bead title, status word, and id', () => {
    renderCard({
      kind: 'pellet',
      entity: pellet({ title: 'Finalize the workflow', state: 'held' }),
    });
    expect(screen.getByText('Finalize the workflow')).toBeTruthy();
    expect(screen.getByText(/in progress/i)).toBeTruthy(); // held → "in progress"
    expect(screen.getByText(/mem-shs5t/)).toBeTruthy();
  });
});

describe('EntityCard placement', () => {
  it('offsets the card down-and-right of its anchor (placeNearCursor is wired)', () => {
    renderCard({ kind: 'pellet', entity: pellet() }, 40, 60);
    const card = screen.getByRole('dialog');
    expect(card.style.left).toBe('56px'); // 40 + CARD_OFFSET_PX
    expect(card.style.top).toBe('76px'); // 60 + CARD_OFFSET_PX
  });
});
