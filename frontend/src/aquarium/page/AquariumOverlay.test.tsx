import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AquariumOverlay } from './AquariumOverlay';
import type { FlowObservation } from '../contracts';

afterEach(cleanup);

function renderOverlay(overrides: Partial<Parameters<typeof AquariumOverlay>[0]> = {}) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  render(
    <AquariumOverlay
      needsAttention={0}
      flow={FLOW}
      connState="open"
      dataState="complete"
      coverageKnown
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onZoomIn, onZoomOut, onReset };
}

const FLOW: FlowObservation = {
  observedForMs: 0,
  windowMs: 60 * 60 * 1_000,
  observedRigCount: 2,
  totalRigCount: 2,
  backloggedRigCount: 2,
  movingRigCount: 0,
  stillRigKeys: [],
  p0Waiting: 3,
  receipts: [],
};

describe('AquariumOverlay', () => {
  it('shows the observation-window tide report instead of claiming all work is calm', () => {
    renderOverlay({ needsAttention: 0 });
    expect(screen.queryByText('all calm')).toBeNull();
    const ledger = screen.getByText('observing flow · 2 backlogged rigs · 3 P0 waiting');
    expect(ledger.className).not.toContain('text-accent');
  });

  it('labels a cold inventory read as loading instead of reporting zero work', () => {
    renderOverlay({ dataState: 'loading' });
    expect(screen.getByText('loading reef inventory')).toBeTruthy();
    expect(screen.queryByText(/0 backlogged rigs/i)).toBeNull();
  });

  it('surfaces an unavailable inventory read instead of reporting zero work', () => {
    renderOverlay({ dataState: 'unavailable' });
    expect(screen.getByText('reef inventory unavailable')).toBeTruthy();
    expect(screen.queryByText(/0 backlogged rigs/i)).toBeNull();
  });

  it('reads "<n> need attention" in the accent tone when n > 0', () => {
    renderOverlay({ needsAttention: 3 });
    const ledger = screen.getByText('3 need attention');
    expect(ledger.className).toContain('text-accent');
  });

  it('is the only element carrying the accent tone (One Mark Rule)', () => {
    const { container } = render(
      <AquariumOverlay
        needsAttention={2}
        flow={FLOW}
        connState="degraded"
        dataState="complete"
        coverageKnown
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const accented = container.querySelectorAll('.text-accent');
    expect(accented.length).toBe(1);
  });

  it.each([
    ['connecting', 'connecting'],
    ['open', 'clear'],
    ['degraded', 'degraded'],
    ['closed', 'drained'],
    ['fixture', 'fixture'],
  ] as const)('shows the tank light word for connState=%s', (connState, word) => {
    renderOverlay({ connState });
    expect(screen.getByRole('status').textContent).toContain(word);
  });

  it('shows the fixture tank light in a muted, not accent or ok/warn, tone', () => {
    renderOverlay({ connState: 'fixture' });
    const status = screen.getByRole('status');
    expect(status.className).toContain('text-fg-muted');
    expect(status.className).not.toContain('text-accent');
  });

  it('reports partial bead coverage separately from an open event connection', () => {
    renderOverlay({
      connState: 'open',
      dataState: 'partial',
      flow: { ...FLOW, observedRigCount: 1, totalRigCount: 2 },
    });
    expect(screen.getByRole('status').textContent).toContain('clear');
    expect(screen.getByRole('note', { name: 'Bead coverage' }).textContent).toContain(
      'partial · 1/2 rigs',
    );
  });

  it('does not claim exact coverage when an upstream list is partial', () => {
    renderOverlay({ connState: 'open', dataState: 'partial', coverageKnown: false });
    expect(screen.getByRole('note', { name: 'Bead coverage' }).textContent).toContain(
      'partial inventory',
    );
    expect(screen.getByRole('note', { name: 'Bead coverage' }).textContent).not.toContain('2/2');
  });

  it('keeps the status ledger clear of mobile zoom controls', () => {
    const { container } = render(
      <AquariumOverlay
        needsAttention={0}
        flow={FLOW}
        connState="open"
        dataState="complete"
        coverageKnown
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const zoomControls = container.querySelector('[data-aquarium-zoom]');
    expect(zoomControls?.className).toContain('bottom-4');
    expect(zoomControls?.className).toContain('sm:top-4');
    expect(zoomControls?.className).toContain('bg-surface/70');
    expect(zoomControls?.className).not.toContain('backdrop-blur');
  });

  it('invokes the zoom/reset callbacks from the top-right controls', () => {
    const { onZoomIn, onZoomOut, onReset } = renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset camera' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
