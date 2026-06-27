import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../attention/context';
import { NowProvider } from '../contexts/NowContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ViewingAsProvider } from '../contexts/ViewingAsContext';
import { Header } from './Header';

vi.mock('../api/client', () => ({
  api: {
    config: vi.fn(async () => ({
      cityName: 'test-city',
      defaultView: null,
      enabledModules: [],
      readOnly: false,
    })),
  },
}));

vi.mock('../supervisor/client', () => ({
  supervisorApi: () => ({
    listCities: vi.fn(async () => ({
      items: [{ name: 'test-city', path: '/srv/test-city', running: true }],
      total: 1,
    })),
  }),
}));

vi.mock('../runs/runSummarySubscription', () => ({
  useRunSummary: () => ({ sseState: 'open' }),
}));

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

afterEach(() => {
  cleanup();
});

function renderHeader() {
  return render(
    <ThemeProvider>
      <ViewingAsProvider>
        <NowProvider>
          <AttentionProvider contributors={[]}>
            <MemoryRouter
              initialEntries={['/runs']}
              future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
            >
              <Header />
            </MemoryRouter>
          </AttentionProvider>
        </NowProvider>
      </ViewingAsProvider>
    </ThemeProvider>,
  );
}

describe('Header mobile nav', () => {
  it('keeps the inline nav row but hides it below sm (desktop unchanged)', () => {
    const { container } = renderHeader();
    // The desktop row is the ul that becomes a flex row at sm:; on phones it is
    // hidden in favor of the hamburger menu.
    const desktopList = container.querySelector('ul.sm\\:flex');
    expect(desktopList).not.toBeNull();
    expect(desktopList?.className).toContain('hidden');
  });

  it('exposes a hamburger button that is hidden from sm: up', () => {
    renderHeader();
    const button = screen.getByRole('button', { name: /menu/i });
    expect(button.className).toContain('sm:hidden');
    // Closed by default — no dialog yet.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the nav menu with every route when the hamburger is tapped', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /menu/i }));
    const dialog = within(screen.getByRole('dialog'));
    // Scope to the dialog: the desktop row keeps its own copy of each link.
    for (const label of ['Home', 'Agents', 'Beads', 'Runs', 'Convoy', 'Mail']) {
      expect(dialog.getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('gives Convoy a top-level tab pointing at /convoy, ordered between Runs and Mail', () => {
    // gascity-dashboard-0chv3: the convoy view had no front door — this is it.
    renderHeader();
    // Anchor on the semantic primary nav, not the responsive `sm:flex` utility
    // class (an implementation detail). The mobile menu is a separate labelled
    // nav, so this scopes cleanly to the desktop row.
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const convoy = within(nav).getByRole('link', { name: /Convoy/ });
    expect(convoy.getAttribute('href')).toBe('/convoy');
    // Order is explicit (45), so Convoy sits after Runs and before Mail. Assert
    // the relative order without pinning the full set — registry-driven views may
    // also be present depending on the async config fetch's timing.
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent ?? '');
    expect(labels.indexOf('Runs')).toBeLessThan(labels.indexOf('Convoy'));
    expect(labels.indexOf('Convoy')).toBeLessThan(labels.indexOf('Mail'));
  });

  it('closes the menu when a route is selected', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /menu/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('link', { name: /Agents/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the menu on any route change, not just menu-link clicks (e.g. back/forward)', () => {
    // The Header is outside <Routes>, so a navigation that does not originate
    // from a menu link (browser back, a link elsewhere) must still dismiss the
    // open menu rather than strand the scrim over the next page.
    function Harness() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => navigate('/agents')}>navigate elsewhere</button>
          <Header />
        </>
      );
    }
    render(
      <ThemeProvider>
        <ViewingAsProvider>
          <NowProvider>
            <AttentionProvider contributors={[]}>
              <MemoryRouter
                initialEntries={['/runs']}
                future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
              >
                <Harness />
              </MemoryRouter>
            </AttentionProvider>
          </NowProvider>
        </ViewingAsProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Navigate without touching a menu link.
    fireEvent.click(screen.getByRole('button', { name: /navigate elsewhere/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the open menu when the viewport widens past the sm: breakpoint', () => {
    // The hamburger is sm:hidden in CSS, but the open state is React state. When
    // a phone-width viewport widens back to >=640px the desktop nav row returns
    // and the Modal + scrim would otherwise stay stranded over it. Capture the
    // change handler the Header registers on the (min-width: 640px) query so the
    // test can drive the crossing directly — scoped to that query so the theme
    // provider's prefers-color-scheme listener is not also triggered.
    const widthChangeHandlers: Array<(e: MediaQueryListEvent) => void> = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: (_type: string, handler: (e: MediaQueryListEvent) => void) => {
          if (query.includes('min-width')) widthChangeHandlers.push(handler);
        },
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });

    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Simulate the viewport crossing to >=640px (the sm: breakpoint), where the
    // desktop nav row reappears.
    act(() => {
      for (const handler of widthChangeHandlers) {
        handler({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
