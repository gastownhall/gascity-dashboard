import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AquariumOverlay } from './AquariumOverlay';
import type {
  FishEntity,
  FlowObservation,
  PelletEntity,
  ReefFocus,
  RigFormation,
} from '../contracts';

afterEach(cleanup);

function renderOverlay(overrides: Partial<Parameters<typeof AquariumOverlay>[0]> = {}) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  const onFocusChange = vi.fn<(focus: ReefFocus | null) => void>();
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AquariumOverlay
        needsAttention={0}
        flow={FLOW}
        connState="open"
        dataState="complete"
        coverageKnown
        formations={FORMATIONS}
        fish={ATTENTION_FISH}
        pellets={P0_PELLETS}
        unavailableRigKeys={[]}
        focus={null}
        onFocusChange={onFocusChange}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={onReset}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onZoomIn, onZoomOut, onReset, onFocusChange };
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
  recentlyMovingRigKeys: ['alpha'],
};

const FORMATIONS: RigFormation[] = [
  { key: 'alpha', anchorX: 900, anchorY: 1_900, radius: 200, seed: 1, openBeadTotal: 9 },
  { key: 'beta', anchorX: 2_000, anchorY: 1_900, radius: 180, seed: 2, openBeadTotal: 4 },
];

const P0_PELLETS: PelletEntity[] = [
  {
    beadId: 'p0-1',
    label: 'p0-1',
    title: 'Repair the supervisor feed',
    linkTo: '/beads?bead=p0-1',
    rigKey: 'alpha',
    state: 'drifting',
    ageFraction: 0.5,
    radiusScale: 1.8,
    isP0: true,
  },
];

const ATTENTION_FISH: FishEntity[] = [
  {
    id: 'tinker-session',
    name: 'tinker',
    species: 'role',
    isMayor: false,
    pose: 'awaiting-input',
    poseWord: 'awaiting input',
    bellyPct: 50,
    homeKey: 'alpha',
    linkTo: '/agents/tinker',
    tombstoned: false,
  },
];

describe('AquariumOverlay', () => {
  it('shows the observation-window tide report instead of claiming all work is calm', () => {
    renderOverlay({ needsAttention: 0 });
    expect(screen.queryByText('all calm')).toBeNull();
    const ledger = screen.getByTestId('aquarium-tide-line');
    expect(ledger.textContent).toBe('observing flow · 2 backlogged rigs · 3 P0 waiting');
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
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AquariumOverlay
          needsAttention={2}
          flow={FLOW}
          connState="degraded"
          dataState="complete"
          coverageKnown
          formations={FORMATIONS}
          fish={ATTENTION_FISH}
          pellets={P0_PELLETS}
          unavailableRigKeys={[]}
          focus={null}
          onFocusChange={vi.fn()}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      </MemoryRouter>,
    );
    const accented = container.querySelectorAll('.text-accent');
    expect(accented.length).toBe(1);
  });

  it('expands P0 work and highlights the selected bead', () => {
    const { onFocusChange } = renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: '3 P0 waiting' }));
    expect(screen.getByRole('region', { name: 'P0 waiting details' })).toBeTruthy();
    expect(screen.getByText('Repair the supervisor feed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Highlight bead p0-1' }));
    expect(onFocusChange).toHaveBeenCalledWith({ kind: 'bead', beadId: 'p0-1' });
  });

  it('does not expose an empty drill-down button when no P0 work is waiting', () => {
    renderOverlay({ flow: { ...FLOW, p0Waiting: 0 }, pellets: [] });
    expect(screen.getByText('0 P0 waiting')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '0 P0 waiting' })).toBeNull();
  });

  it('expands backlogged rigs, explains current work and recent movement, and highlights a rig', () => {
    const { onFocusChange } = renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: '2 backlogged rigs' }));
    expect(screen.getByRole('region', { name: 'Backlogged rig details' })).toBeTruthy();
    expect(screen.getByText(/a morsel held at a fish's mouth is that agent's current bead/i)).toBeTruthy();
    expect(screen.getByText(/bubble trail means work moved in the last 15 minutes/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Highlight rig alpha' }).textContent).toContain(
      'moved recently',
    );
    expect(screen.getByRole('button', { name: 'Highlight rig beta' }).textContent).not.toContain(
      'moved recently',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Highlight rig alpha' }));
    expect(onFocusChange).toHaveBeenCalledWith({ kind: 'rig', rigKey: 'alpha' });
  });

  it('excludes unavailable rigs from backlog and P0 drill-down rows', () => {
    renderOverlay({
      unavailableRigKeys: ['beta'],
      flow: { ...FLOW, backloggedRigCount: 1, p0Waiting: 1 },
      pellets: [P0_PELLETS[0]!, { ...P0_PELLETS[0]!, beadId: 'p0-2', rigKey: 'beta' }],
    });
    fireEvent.click(screen.getByRole('button', { name: '1 backlogged rig' }));
    expect(screen.getByRole('button', { name: 'Highlight rig alpha' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Highlight rig beta' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 P0 waiting' }));
    expect(screen.getByRole('button', { name: 'Highlight bead p0-1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Highlight bead p0-2' })).toBeNull();
  });

  it('closes an expanded metric when a live update reduces its count to zero', () => {
    const onFocusChange = vi.fn<(focus: ReefFocus | null) => void>();
    const view = render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AquariumOverlay
          needsAttention={0}
          flow={FLOW}
          connState="open"
          dataState="complete"
          coverageKnown
          formations={FORMATIONS}
          fish={ATTENTION_FISH}
          pellets={P0_PELLETS}
          unavailableRigKeys={[]}
          focus={null}
          onFocusChange={onFocusChange}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '2 backlogged rigs' }));
    expect(screen.getByRole('region', { name: 'Backlogged rig details' })).toBeTruthy();

    view.rerender(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AquariumOverlay
          needsAttention={0}
          flow={{ ...FLOW, backloggedRigCount: 0 }}
          connState="open"
          dataState="complete"
          coverageKnown
          formations={[]}
          fish={ATTENTION_FISH}
          pellets={P0_PELLETS}
          unavailableRigKeys={[]}
          focus={{ kind: 'rig', rigKey: 'alpha' }}
          onFocusChange={onFocusChange}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region', { name: 'Backlogged rig details' })).toBeNull();
    expect(onFocusChange).toHaveBeenLastCalledWith(null);
  });

  it('expands needs-attention agents and highlights the selected fish', () => {
    const { onFocusChange } = renderOverlay({ needsAttention: 1 });
    fireEvent.click(screen.getByRole('button', { name: '1 need attention' }));
    expect(screen.getByRole('region', { name: 'Needs attention details' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Highlight agent tinker' }));
    expect(onFocusChange).toHaveBeenCalledWith({ kind: 'fish', fishId: 'tinker-session' });
  });

  it('explains exact partial coverage and names the missing rig reads', () => {
    renderOverlay({
      dataState: 'partial',
      unavailableRigKeys: ['gamma', 'delta'],
      flow: { ...FLOW, observedRigCount: 19, totalRigCount: 21 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Explain partial bead coverage' }));
    expect(screen.getByRole('region', { name: 'Partial coverage details' }).textContent).toContain(
      '19 of 21 rig bead reads completed',
    );
    expect(screen.getByText('GAMMA')).toBeTruthy();
    expect(screen.getByText('DELTA')).toBeTruthy();
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

  it('does not misdescribe unrelated stale data as partial rig coverage', () => {
    renderOverlay({
      dataState: 'partial',
      coverageKnown: true,
      unavailableRigKeys: [],
      flow: { ...FLOW, observedRigCount: 2, totalRigCount: 2 },
    });
    expect(screen.getByRole('note', { name: 'Partial inventory' }).textContent).toContain(
      'partial inventory',
    );
    expect(screen.queryByRole('button', { name: 'Explain partial bead coverage' })).toBeNull();
  });

  it('keeps the status ledger clear of mobile zoom controls', () => {
    const { container } = render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AquariumOverlay
          needsAttention={0}
          flow={FLOW}
          connState="open"
          dataState="complete"
          coverageKnown
          formations={FORMATIONS}
          fish={ATTENTION_FISH}
          pellets={P0_PELLETS}
          unavailableRigKeys={[]}
          focus={null}
          onFocusChange={vi.fn()}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      </MemoryRouter>,
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
