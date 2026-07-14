import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AquariumOverlay } from './AquariumOverlay';

afterEach(cleanup);

function renderOverlay(overrides: Partial<Parameters<typeof AquariumOverlay>[0]> = {}) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  render(
    <AquariumOverlay
      needsAttention={0}
      connState="open"
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onZoomIn, onZoomOut, onReset };
}

describe('AquariumOverlay', () => {
  it('reads "all calm" in neutral tone when nothing needs attention', () => {
    renderOverlay({ needsAttention: 0 });
    const ledger = screen.getByText('all calm');
    expect(ledger.className).not.toContain('text-accent');
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
        connState="degraded"
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
