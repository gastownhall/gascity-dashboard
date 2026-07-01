import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { ViewErrorBoundary } from './ViewErrorBoundary';

function BrokenChild(): never {
  throw new Error('convoy render exploded');
}

// A child whose throwing is driven by external state (not self-consumed during
// render, so React's double-invoke is harmless), letting a test flip the
// transient off and observe Retry remounting the subtree cleanly.
function FlakyChild({ gate }: { gate: { shouldThrow: boolean } }) {
  if (gate.shouldThrow) throw new Error('transient store slowness');
  return <p>convoy contents</p>;
}

describe('ViewErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // restoreAllMocks reverts spyOn spies but NOT stubGlobal; unstub the fetch
    // stub explicitly so it cannot leak into later files in the same worker.
    vi.unstubAllGlobals();
  });

  it('renders its children when they do not throw', () => {
    render(
      <ViewErrorBoundary view="convoy">
        <p>convoy contents</p>
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('convoy contents')).toBeTruthy();
  });

  it('degrades a child render throw to a glyph+word unavailable tier instead of failing the whole app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })),
    );

    // The view boundary sits INSIDE the app-root boundary, exactly as App.tsx
    // wires it: a single view's throw must stop here, not replace the dashboard.
    render(
      <ErrorBoundary>
        <ViewErrorBoundary view="convoy">
          <BrokenChild />
        </ViewErrorBoundary>
      </ErrorBoundary>,
    );

    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain('Unavailable');
    // Greyscale-readable: the state is carried by a glyph + the word, not tone.
    expect(notice.textContent).toContain('◌');
    // The app-root crash page must NOT have taken over the whole dashboard.
    expect(screen.queryByText('Dashboard view failed.')).toBeNull();
  });

  it('reports the underlying error to the local dashboard log rather than swallowing it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <ViewErrorBoundary view="convoy">
        <BrokenChild />
      </ViewErrorBoundary>,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/client-errors',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          component: 'ViewErrorBoundary',
          operation: 'convoy',
          message: 'convoy render exploded',
        }),
      }),
    );
  });

  it('retries by remounting the subtree, clearing a transient failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })),
    );
    const gate = { shouldThrow: true };

    render(
      <ViewErrorBoundary view="convoy">
        <FlakyChild gate={gate} />
      </ViewErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toContain('Unavailable');

    // The transient slowness clears, then the operator retries the view.
    gate.shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(screen.getByText('convoy contents')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
