import type { ReactNode } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
  /**
   * Route path patterns (react-router `path` syntax, e.g. `/reef`) that opt
   * out of the padded reading-measure column. A matching route renders its
   * children directly inside an unpadded, relatively-positioned `<main>` —
   * the Header still renders above it. Defaults to none: every route keeps
   * the standard shell unless it explicitly opts out (`ViewDescriptor.fullBleed`).
   */
  fullBleedPaths?: readonly string[];
}

const DEFAULT_FULL_BLEED_PATHS: readonly string[] = [];

// Vertical shell. The Header is page furniture; the main column is
// constrained to a comfortable reading measure and breathes in the
// gutters either side — unless the active route is full-bleed, in which
// case `<main>` gets out of the way entirely and the route owns the whole
// viewport under the header (e.g. `/reef`'s canvas scene).
export function Layout({ children, fullBleedPaths = DEFAULT_FULL_BLEED_PATHS }: LayoutProps) {
  const location = useLocation();
  const isFullBleed = fullBleedPaths.some((path) => matchPath(path, location.pathname) !== null);

  return (
    <div className="min-h-screen bg-surface text-fg antialiased">
      <Header />
      <main
        className={isFullBleed ? 'relative' : 'max-w-dashboard mx-auto px-4 sm:px-6 lg:px-8 py-12'}
      >
        {children}
      </main>
    </div>
  );
}
