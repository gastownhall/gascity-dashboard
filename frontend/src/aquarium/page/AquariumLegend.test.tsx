import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AquariumLegend, type BeadStatusColors } from './AquariumLegend';
import type { RigLegend } from './rigLegend';

afterEach(cleanup);

const STATUS: BeadStatusColors = {
  open: 'oklch(74% 0.095 80)',
  inProgress: 'oklch(85% 0.14 85)',
  blocked: 'oklch(50% 0.035 75)',
};

function renderLegend(legend: RigLegend) {
  return render(<AquariumLegend legend={legend} statusColors={STATUS} />);
}

describe('AquariumLegend', () => {
  it('lists each rig with its open-bead count and a bead-status key', () => {
    renderLegend({
      entries: [
        { key: 'geo', hue: 245, openBeadTotal: 26 },
        { key: 'aoa', hue: 338, openBeadTotal: 8 },
      ],
      hiddenCount: 0,
    });
    expect(screen.getByText('geo')).toBeTruthy();
    expect(screen.getByText('26')).toBeTruthy();
    expect(screen.getByText('aoa')).toBeTruthy();
    // the status key names every bead status the shades encode
    expect(screen.getByText('open')).toBeTruthy();
    expect(screen.getByText('in progress')).toBeTruthy();
    expect(screen.getByText('blocked')).toBeTruthy();
  });

  it('folds the long tail into a "+N more" line', () => {
    renderLegend({
      entries: [{ key: 'geo', hue: 245, openBeadTotal: 26 }],
      hiddenCount: 9,
    });
    expect(screen.getByText('+9 more')).toBeTruthy();
  });

  it('colours a rig swatch at its identity hue and the unrigged swatch neutral', () => {
    const { container } = renderLegend({
      entries: [
        { key: 'geo', hue: 245, openBeadTotal: 26 },
        { key: 'unrigged', hue: null, openBeadTotal: 0 },
      ],
      hiddenCount: 0,
    });
    const swatches = Array.from(container.querySelectorAll('span[aria-hidden="true"]'));
    const styles = swatches.map((s) => (s as HTMLElement).style.background);
    // the geo swatch carries its identity hue (245)
    expect(styles.some((bg) => bg.includes('245'))).toBe(true);
    // the unrigged swatch is the neutral pigment (hue 250, near-zero chroma)
    expect(styles.some((bg) => bg.includes('0.02'))).toBe(true);
  });

  it('collapses to just the toggle and expands again (clears the glass on demand)', () => {
    renderLegend({
      entries: [{ key: 'geo', hue: 245, openBeadTotal: 26 }],
      hiddenCount: 0,
    });
    const toggle = screen.getByRole('button', { name: /key/i });
    expect(screen.queryByText('geo')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText('geo')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.queryByText('geo')).toBeTruthy();
  });

  it('renders nothing when there are no rigs to key', () => {
    const { container } = renderLegend({ entries: [], hiddenCount: 0 });
    expect(container.firstChild).toBeNull();
  });
});
