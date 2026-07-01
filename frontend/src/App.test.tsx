import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ThemeProvider } from './contexts/ThemeContext';

vi.mock('./api/client', () => ({
  api: {
    config: vi.fn(async () => ({
      cityName: 'test-city',
      defaultView: null,
      enabledModules: [],
      readOnly: false,
      operatorAlias: 'stephanie',
      operatorWireAlias: 'human',
      decisionLabel: 'needs/stephanie',
    })),
  },
}));

vi.mock('./supervisor/client', () => ({
  supervisorApi: () => ({
    listCities: vi.fn(async () => ({
      items: [{ name: 'test-city', path: '/srv/gc/test-city', running: true }],
      total: 1,
    })),
  }),
}));

vi.mock('./routes/Runs', () => ({
  RunsPage: () => <h1>Runs route</h1>,
}));

// The convoy index render throws — standing in for an unanticipated partial or
// degenerate supervisor shape that slips past the data layer under store
// slowness (gascity-dashboard-sw1w). The per-view boundary must catch it.
vi.mock('./routes/ConvoyIndex', () => ({
  ConvoyIndex: () => {
    throw new Error('convoy render exploded');
  },
}));

// The convoy detail page throws for one specific root and renders cleanly for
// another, standing in for a degenerate supervisor shape that crashes the view
// for convoy root A while root B is healthy (gascity-dashboard-sw1w). Used to
// pin the route-latch regression: the per-view boundary must reset when the
// :rootBead param changes, not keep masking B behind A's tripped fallback.
vi.mock('./routes/Convoy', async () => {
  const { useParams } = await import('react-router-dom');
  return {
    ConvoyPage: () => {
      const { rootBead } = useParams<{ rootBead: string }>();
      if (rootBead === 'root-a') throw new Error('convoy root A exploded');
      return <h1>convoy root {rootBead}</h1>;
    },
  };
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <App />
        <LocationProbe />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('App routes', () => {
  afterEach(() => {
    cleanup();
    // Guarantee stub/spy cleanup even if a test throws before its own cleanup:
    // restoreAllMocks reverts spyOn spies (console.error), unstubAllGlobals
    // reverts stubGlobal (fetch). Without this a mid-test throw leaks them into
    // later files in the same Vitest worker.
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  it.each(['/workflows', '/kanban'])('%s is not a compatibility redirect', async (path) => {
    renderAt(path);

    await waitFor(() => {
      expect(screen.getByTestId('pathname').textContent).toBe(path);
    });
    expect(screen.queryByRole('heading', { name: 'Runs route' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('/runs still renders the run list route', async () => {
    renderAt('/runs');

    expect(await screen.findByRole('heading', { name: 'Runs route' })).toBeTruthy();
    expect(screen.getByTestId('pathname').textContent).toBe('/runs');
  });

  it('degrades a throwing convoy view to the per-view unavailable tier, not a whole-app crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })),
    );

    renderAt('/convoy');

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('Unavailable');
    expect(notice.textContent).toContain('◌');
    // The route stayed mounted at /convoy — the throw was contained, not fatal.
    expect(screen.getByTestId('pathname').textContent).toBe('/convoy');
  });

  it('resets a tripped convoy-detail boundary when navigating from a throwing root to a healthy one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })),
    );

    render(
      <ThemeProvider>
        <MemoryRouter
          initialEntries={['/convoy/root-a']}
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        >
          <App />
          {/* A persistent link outside the boundary, mirroring an in-shell
              step-row link to a healthy convoy root. */}
          <Link to="/convoy/root-b">to-root-b</Link>
        </MemoryRouter>
      </ThemeProvider>,
    );

    // Convoy root A throws -> the per-view boundary degrades to the unavailable tier.
    expect((await screen.findByRole('alert')).textContent).toContain('Unavailable');

    // Navigating to a HEALTHY root B must clear the tripped boundary (it is keyed
    // by :rootBead) instead of masking B's good data behind the cached fallback.
    fireEvent.click(screen.getByRole('link', { name: 'to-root-b' }));

    expect(await screen.findByRole('heading', { name: 'convoy root root-b' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
