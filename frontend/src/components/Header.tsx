import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Modal } from './Modal';
import { QuickJump } from './QuickJump';
import { api } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { NavAttentionIndicator } from '../attention/NavAttentionIndicator';
import { BoardLiveness, useBoardLiveness } from './BoardLiveness';
import { useAttentionModel } from '../attention/context';
import type { AttentionDomain } from '../attention/compose';
import { useTheme } from '../contexts/ThemeContext';
import { useOperatorConfig } from '../contexts/OperatorConfigContext';
import { useViewingAs } from '../contexts/ViewingAsContext';
import { displayLabel } from '../hooks/aliasPriority';
import { useCachedData } from '../hooks/useCachedData';
import { supervisorApi } from '../supervisor/client';
import { ALL_VIEWS } from '../views/registry';
import { filterEnabledViews } from '../views/resolve';

interface NavRoute {
  to: string;
  label: string;
  end?: boolean;
  order: number;
}

// Hand-maintained routes for the views that PR-A has NOT yet ported to
// the modular registry. Each entry carries an explicit `order` so the
// registry-driven entries (currently /health at 60) interleave cleanly
// here without a separate "where does Health go" decision. PR-B+ will
// move entries out of this list as they land in ALL_VIEWS.
const EXPLICIT_ROUTES: ReadonlyArray<NavRoute> = [
  // gascity-dashboard-kb3: Home is the L0 ambient page at `/`.
  // `end: true` so the NavLink active-state matches `/` exactly
  // (otherwise every nested route would also be 'active').
  { to: '/', label: 'Home', end: true, order: 10 },
  { to: '/agents', label: 'Agents', order: 20 },
  { to: '/beads', label: 'Beads', order: 30 },
  { to: '/runs', label: 'Runs', order: 40 },
  // gascity-dashboard-0chv3: Convoy gets a real front door between Runs and Mail
  // (the /convoy index lists active convoy roots; detail stays at /convoy/:root).
  { to: '/convoy', label: 'Convoy', order: 45 },
  { to: '/mail', label: 'Mail', order: 50 },
];

const NAV_ATTENTION_DOMAINS: Readonly<Record<string, AttentionDomain>> = {
  '/agents': 'agents',
  '/beads': 'beads',
  '/runs': 'runs',
  '/mail': 'mail',
  '/activity': 'activity',
  '/health': 'health',
  '/maintainer': 'maintainer',
};

// The header is page furniture, not chrome. A small wordmark, the
// route names typeset as a row, a textual theme toggle. The
// route weight contrast IS the active-state affordance; no underline,
// no background pill.
export function Header() {
  const { resolved, toggle } = useTheme();
  const { viewingAs } = useViewingAs();
  const { operatorAlias } = useOperatorConfig();
  const attention = useAttentionModel();
  // gascity-dashboard-fchh major 4 (DESIGN.md One Mark): when the liveness line
  // is degraded it owns the viewport's single maroon mark, so the other accents
  // here — the "reading as" indicator and the nav attention badges — drop to
  // neutral. A frozen/erroring board is the loudest thing on the header.
  const livenessOwnsMark = useBoardLiveness().degraded;
  const { data: config } = useCachedData('config', () => api.config());
  // City switcher source (gascity-dashboard-ucc). Lists every managed city;
  // selecting one navigates (full reload) to that city's `/city/:name/`
  // basename so the app remounts with the new active city. A bare full
  // navigation — not client-side — keeps the active-city base, router
  // basename, and every city-scoped fetch consistent without a per-fetch
  // city argument.
  const { data: cities } = useCachedData('cities', () => supervisorApi().listCities());
  const activeCity = getActiveCity();
  const cityItems = cities?.items ?? [];
  const onSwitchCity = (next: string): void => {
    if (next === activeCity) return;
    window.location.assign(`/city/${encodeURIComponent(next)}/`);
  };
  // PR-C: filter the registry views by the backend-advertised
  // enabledModules so a disabled module's nav entry disappears in lockstep
  // with its route. While the config fetch is in flight `enabledModules`
  // is null — meaning every firstParty view appears, matching the
  // first-paint route tree in App.tsx.
  const ROUTES: ReadonlyArray<NavRoute> = useMemo(() => {
    const enabled = filterEnabledViews(ALL_VIEWS, config?.enabledModules ?? null);
    const registry: NavRoute[] = enabled.flatMap((v) =>
      v.nav === null
        ? []
        : [{ to: v.path, label: v.nav.label, end: v.path === '/', order: v.nav.order }],
    );
    // Spread already allocates a new mutable array, so .sort() in-place is
    // safe — no .slice() needed (PR-A Phase-4 TS M4).
    return [...EXPLICIT_ROUTES, ...registry].sort((a, b) => a.order - b.order);
  }, [config?.enabledModules]);
  const { pathname } = useLocation();
  // "Reading as" is a Mail-only concept — the value persists across views
  // (for Maintainer's impersonation guard + AgentDetail's chat filter) but
  // the header indicator only makes sense inside the mail surface.
  const showReadingAs = !viewingAs.isOperator && pathname.startsWith('/mail');

  // On phones the inline route row stacks to several lines, so it collapses
  // behind a hamburger that opens the routes in the shared Modal. Both layouts
  // render the same routes through navItem so they cannot drift.
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);

  // The Header lives in Layout, outside <Routes>, so its state survives SPA
  // navigation. Menu-link clicks close the menu themselves, but a back/forward
  // or any navigation that doesn't originate from a menu link would otherwise
  // leave the dialog + scrim stranded over the next page. Close on route change.
  useEffect(() => {
    setMenuOpen(false);
    setQuickJumpOpen(false);
  }, [pathname]);

  // #117 client-side slice: Cmd-K (Ctrl-K off Mac) opens quick-jump from
  // anywhere in the app, mirroring the reserved-shortcut convention of
  // GitHub/Linear/VS Code rather than a page-scoped search box.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setQuickJumpOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The hamburger is `sm:hidden`, but `menuOpen` is React state, not CSS — so a
  // viewport that widens past the sm: breakpoint while the menu is open brings
  // the desktop nav row back (`hidden sm:flex`) with the Modal + scrim still
  // stranded over it. Close the menu the moment we cross to >=640px so the
  // dialog never outlives the phone layout that justifies it. <640px crossings
  // never reopen it — the operator must tap the hamburger again.
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const navItem = (r: NavRoute, sizeClass: string, onClick?: () => void) => {
    const domain = NAV_ATTENTION_DOMAINS[r.to];
    return (
      <li key={r.to}>
        <NavLink
          to={r.to}
          end={r.end ?? false}
          onClick={onClick}
          className={({ isActive }: { isActive: boolean }) =>
            [
              sizeClass,
              'transition-colors duration-150 ease-out-quart focus-mark',
              isActive ? 'text-fg font-semibold' : 'text-fg-muted font-medium hover:text-fg',
            ].join(' ')
          }
        >
          {r.label}
          {domain !== undefined && (
            <NavAttentionIndicator
              label={r.label}
              summary={attention.byDomain[domain]}
              suppressAccent={livenessOwnsMark}
            />
          )}
        </NavLink>
      </li>
    );
  };

  return (
    <header className="border-b border-rule">
      <div className="max-w-dashboard mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-baseline gap-x-6 lg:gap-x-8 gap-y-2 flex-wrap">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-title font-semibold tracking-tight text-fg">gas city</span>
          <span className="text-fg-muted" aria-hidden="true">
            ·
          </span>
          {cityItems.length > 1 ? (
            <label className="sr-only" htmlFor="city-switcher">
              Switch city
            </label>
          ) : null}
          {cityItems.length > 1 ? (
            <select
              id="city-switcher"
              value={activeCity ?? config?.cityName ?? ''}
              onChange={(e) => onSwitchCity(e.target.value)}
              className="text-label uppercase tracking-wider text-fg-muted bg-transparent border-0 focus-mark cursor-pointer hover:text-fg transition-colors duration-150 ease-out-quart"
            >
              {cityItems.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.running ? '' : ' (stopped)'}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-label uppercase tracking-wider text-fg-muted">
              {activeCity ?? config?.cityName ?? 'city'}
            </span>
          )}
          {showReadingAs && (
            <span
              className={`text-label uppercase tracking-wider ml-3 ${
                livenessOwnsMark ? 'text-fg-muted' : 'text-accent'
              }`}
            >
              · reading as {displayLabel(viewingAs.alias, operatorAlias)}
            </span>
          )}
        </div>

        <nav className="flex-1" aria-label="Primary">
          {/* Desktop: the route names typeset as a row. Hidden on phones, where
              the hamburger below opens the same routes in a Modal. */}
          <ul className="hidden sm:flex items-baseline gap-x-5 lg:gap-x-7 gap-y-1 flex-wrap">
            {ROUTES.map((r) => navItem(r, 'text-title'))}
          </ul>
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          {...(menuOpen ? { 'aria-controls': 'mobile-nav-menu' } : {})}
          className="sm:hidden ml-auto text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark text-lg leading-none"
        >
          <span aria-hidden="true">☰</span>
        </button>

        <BoardLiveness />

        <button
          type="button"
          onClick={() => setQuickJumpOpen(true)}
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+K Control+K"
          className="text-label uppercase tracking-wider text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark"
        >
          Jump <span aria-hidden="true">⌘K</span>
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
          className="text-label uppercase tracking-wider text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark"
        >
          {resolved === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" widthClass="max-w-xs">
        <nav id="mobile-nav-menu" aria-label="Mobile navigation">
          <ul className="flex flex-col gap-y-3">
            {ROUTES.map((r) => navItem(r, 'text-headline', () => setMenuOpen(false)))}
          </ul>
        </nav>
      </Modal>

      <QuickJump open={quickJumpOpen} onClose={() => setQuickJumpOpen(false)} />
    </header>
  );
}
