import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AquariumPage } from './AquariumPage';
import { buildFixtureInputs } from './fixtures';

// ThemeProvider reads window.matchMedia unconditionally on mount; jsdom has
// no implementation. Query-aware so the two independent consumers get their
// expected values: prefers-color-scheme:false (ThemeProvider resolves a
// stable 'light' system theme) and prefers-reduced-motion:true (matches
// usePrefersReducedMotion's own fail-safe default when matchMedia is
// missing entirely, keeping this suite off the continuous rAF loop —
// jsdom has no requestAnimationFrame budget to spend on it, and
// canvas.getContext('2d') is null here regardless).
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  seedThemeTokens();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
});

/**
 * jsdom never loads the real stylesheet (styles/index.css), so
 * getComputedStyle would otherwise return '' for every --token and
 * buildScenePalette (render/palette.ts) fails loudly on a missing token —
 * correctly, in production, where an unstyled page IS a real bug. Seed the
 * app's actual light-theme `:root` values directly so this suite exercises
 * the real palette-building path instead of stubbing it away.
 */
function seedThemeTokens(): void {
  const tokens: Record<string, string> = {
    surface: '96% 0.012 75',
    fg: '18% 0.012 75',
    'fg-muted': '42% 0.014 75',
    'fg-faint': '52% 0.014 75',
    rule: '80% 0.012 75',
    accent: '40% 0.13 25',
    ok: '50% 0.085 150',
    warn: '60% 0.14 60',
  };
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
}

function renderAquarium(fixtureOverride: 'aquarium' | 'perf' | 'blind' | 'flow') {
  return render(
    <ThemeProvider>
      <MemoryRouter
        initialEntries={['/reef']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <AquariumPage fixtureOverride={fixtureOverride} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('AquariumPage (fixture mode)', () => {
  it('renders a role=img canvas with a live summary aria-label', () => {
    renderAquarium('aquarium');
    const canvas = screen.getByRole('img');
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.getAttribute('aria-label')).toMatch(
      /\d+ fish; \d+ need attention; connection fixture/,
    );
  });

  it('the canvas is keyboard-focusable for camera controls', () => {
    renderAquarium('aquarium');
    expect(screen.getByRole('img').getAttribute('tabindex')).toBe('0');
  });

  it('the ledger count matches the fixture manifest exactly', () => {
    const { manifest } = buildFixtureInputs('aquarium');
    renderAquarium('aquarium');
    const canvas = screen.getByRole('img');
    expect(canvas.getAttribute('aria-label')).toContain(
      `${manifest.needsAttention} need attention`,
    );
  });

  it('shows the "fixture" tank light, not a live connection state', () => {
    renderAquarium('aquarium');
    expect(screen.getByRole('status').textContent).toContain('fixture');
  });

  it('lists every fish in the sr-only nav, one link per fish, matching the manifest count', () => {
    const { manifest } = buildFixtureInputs('aquarium');
    renderAquarium('aquarium');
    const nav = screen.getByRole('navigation', { name: 'fish' });
    const links = within(nav).getAllByRole('link');
    expect(links.length).toBe(manifest.fish.length);
  });

  it('every sr-only fish link points at an /agents/<name> route', () => {
    renderAquarium('aquarium');
    const nav = screen.getByRole('navigation', { name: 'fish' });
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/agents\//);
    }
  });

  it('renders the quiet zoom controls (+, −, Reset)', () => {
    renderAquarium('aquarium');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset camera' })).toBeTruthy();
  });

  it('keeps the blind fixture attention count in the canvas summary', () => {
    const { manifest } = buildFixtureInputs('blind');
    renderAquarium('blind');
    const canvas = screen.getByRole('img');
    expect(canvas.getAttribute('aria-label')).toContain(
      `${manifest.needsAttention} need attention`,
    );
  });

  it('renders 200 sr-only fish links for the perf fixture', () => {
    renderAquarium('perf');
    const nav = screen.getByRole('navigation', { name: 'fish' });
    expect(within(nav).getAllByRole('link').length).toBe(200);
  });

  it('does not crash when canvas.getContext("2d") is unavailable (jsdom)', () => {
    // No assertion beyond "renders" — this is the guard the paint pipeline
    // relies on (useAquariumRenderLoop skips painting silently on a null
    // context); the real proof is that render() above didn't throw.
    expect(() => renderAquarium('aquarium')).not.toThrow();
  });

  it('publishes the rigs with recent movement for the flow fixture', async () => {
    renderAquarium('flow');
    await waitFor(() => {
      expect(window.__aquariumFlow?.recentlyMovingRigKeys).toEqual(['reef-alpha', 'reef-beta']);
    });
  });

  it('connects the backlogged-rig drill-down selection to the page focus state', () => {
    renderAquarium('aquarium');
    fireEvent.click(screen.getByRole('button', { name: /backlogged rigs$/i }));
    const row = screen.getAllByRole('button', { name: /^Highlight rig / })[0];
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(row?.getAttribute('aria-pressed')).toBe('true');
  });

  it('connects the needs-attention drill-down selection to the page focus state', () => {
    renderAquarium('aquarium');
    fireEvent.click(screen.getByRole('button', { name: /need attention$/i }));
    const row = screen.getAllByRole('button', { name: /^Highlight agent / })[0];
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(row?.getAttribute('aria-pressed')).toBe('true');
  });
});
