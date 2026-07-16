import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AquariumLegend } from './AquariumLegend';
import type { RigLegend, RigLegendEntry } from './rigLegend';

afterEach(cleanup);

function entry(over: Partial<RigLegendEntry> & Pick<RigLegendEntry, 'key'>): RigLegendEntry {
  return { hue: 245, openBeadTotal: 0, agents: [], ...over };
}
function renderLegend(legend: RigLegend) {
  return render(<AquariumLegend legend={legend} />);
}

describe('AquariumLegend', () => {
  it('lists active rigs with their count + agents and a bead-zone key', () => {
    renderLegend({
      active: [
        entry({ key: 'geo', hue: 245, openBeadTotal: 26, agents: ['polecat-1', 'codex-2'] }),
      ],
      quiet: [],
    });
    fireEvent.click(screen.getByRole('button', { name: /map key/i }));
    expect(screen.getByText('geo')).toBeTruthy();
    expect(screen.getByText('26 open')).toBeTruthy();
    // the "by whom": active agent names ride the rig row
    expect(screen.getByText('polecat-1 · codex-2')).toBeTruthy();
    // the zone key names each bead state by WHERE its morsel lives (position,
    // not colour — hue is pure rig identity)
    expect(screen.getByText('open')).toBeTruthy();
    expect(screen.getByText('in progress')).toBeTruthy();
    expect(screen.getByText('blocked')).toBeTruthy();
    expect(screen.getByText('in progress · no live agent')).toBeTruthy();
    expect(screen.getByText('seabed ⊘')).toBeTruthy();
    expect(screen.getByText('needs help')).toBeTruthy();
    expect(screen.getByText('seabed')).toBeTruthy();
  });

  it('folds quiet rigs behind a "+N quiet" toggle that expands the full roster', () => {
    renderLegend({
      active: [entry({ key: 'geo', openBeadTotal: 26, agents: ['w1'] })],
      quiet: [entry({ key: 'aoa', openBeadTotal: 8 }), entry({ key: 'zed', openBeadTotal: 3 })],
    });
    fireEvent.click(screen.getByRole('button', { name: /map key/i }));
    // quiet rigs are hidden until the toggle is opened
    expect(screen.queryByText('aoa')).toBeNull();
    const quietToggle = screen.getByRole('button', { name: /quiet/i });
    expect(quietToggle.textContent).toContain('+2 quiet');
    fireEvent.click(quietToggle);
    expect(screen.getByText('aoa')).toBeTruthy();
    expect(screen.getByText('zed')).toBeTruthy();
  });

  it('colours a rig swatch at its identity hue and the unrigged swatch neutral', () => {
    const { container } = renderLegend({
      active: [entry({ key: 'geo', hue: 245, openBeadTotal: 26, agents: ['w1'] })],
      quiet: [entry({ key: 'unrigged', hue: null, openBeadTotal: 0 })],
    });
    fireEvent.click(screen.getByRole('button', { name: /map key/i }));
    fireEvent.click(screen.getByRole('button', { name: /quiet/i }));
    const swatches = Array.from(container.querySelectorAll('span[aria-hidden="true"]'));
    const styles = swatches.map((s) => (s as HTMLElement).style.background);
    // the geo swatch carries its identity hue (245)
    expect(styles.some((bg) => bg.includes('245'))).toBe(true);
    // the unrigged swatch is the neutral pigment (hue 250, near-zero chroma)
    expect(styles.some((bg) => bg.includes('0.02'))).toBe(true);
  });

  it('starts collapsed to a single toggle and expands on demand', () => {
    const { container } = renderLegend({
      active: [entry({ key: 'geo', openBeadTotal: 26, agents: ['w1'] })],
      quiet: [],
    });
    const toggle = screen.getByRole('button', { name: /map key/i });
    expect(toggle.textContent).toContain('⊘ stranded bead: no live agent');
    expect(screen.queryByText('geo')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.firstElementChild?.className).not.toContain('w-[16rem]');
    expect(container.firstElementChild?.className).not.toContain('backdrop-blur');
    fireEvent.click(toggle);
    expect(screen.queryByText('geo')).toBeTruthy();
  });

  it('explains the current three-bubble recent-movement cue', () => {
    renderLegend({ active: [entry({ key: 'geo', openBeadTotal: 26, agents: ['w1'] })], quiet: [] });
    fireEvent.click(screen.getByRole('button', { name: /map key/i }));
    expect(screen.getByText('work moved in last 15m')).toBeTruthy();
    expect(screen.getByLabelText('three bubble trail')).toBeTruthy();
    expect(screen.queryByText('pickup')).toBeNull();
    expect(screen.queryByText('completion')).toBeNull();
  });

  it('renders nothing when there are no rigs to key', () => {
    const { container } = renderLegend({ active: [], quiet: [] });
    expect(container.firstChild).toBeNull();
  });
});
