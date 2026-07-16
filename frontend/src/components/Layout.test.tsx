import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

// Layout's opt-out logic is the unit under test here, not the real Header
// (which needs Theme/Attention/Now/ViewingAs providers + api mocks to
// render). Stubbing it keeps this test scoped to Layout's own branching.
vi.mock('./Header', () => ({
  Header: () => <header data-testid="mock-header">header</header>,
}));

afterEach(cleanup);

function renderAt(path: string, fullBleedPaths?: readonly string[]) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <Layout {...(fullBleedPaths !== undefined ? { fullBleedPaths } : {})}>
        <div data-testid="content">page content</div>
      </Layout>
    </MemoryRouter>,
  );
}

describe('Layout', () => {
  it('renders the standard padded, max-width column when no fullBleedPaths are given', () => {
    renderAt('/reef');

    const main = screen.getByRole('main');
    expect(main.className).toContain('max-w-dashboard');
    expect(main.className).toContain('px-4');
    expect(main.className).not.toContain('relative');
    expect(screen.getByTestId('mock-header')).toBeTruthy();
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('renders the standard column for a route that does not match fullBleedPaths', () => {
    renderAt('/agents', ['/reef']);

    const main = screen.getByRole('main');
    expect(main.className).toContain('max-w-dashboard');
  });

  it('renders an unpadded, relatively-positioned <main> for a route matching fullBleedPaths', () => {
    renderAt('/reef', ['/reef']);

    const main = screen.getByRole('main');
    expect(main.className).toBe('relative');
    expect(main.className).not.toContain('max-w-dashboard');
    expect(main.className).not.toContain('px-4');
    // Header still renders above the full-bleed main.
    expect(screen.getByTestId('mock-header')).toBeTruthy();
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('matches full-bleed paths with react-router path syntax (params), not exact string equality', () => {
    renderAt('/reef/tank', ['/reef/:tab']);

    const main = screen.getByRole('main');
    expect(main.className).toBe('relative');
  });
});
