import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorMessage } from 'gas-city-dashboard-shared';
import { reportClientError } from '../lib/clientErrorReporting';

interface ViewErrorBoundaryProps {
  /** Short name of the wrapped view — surfaced in the dashboard error log. */
  view: string;
  children: ReactNode;
}

interface ViewErrorBoundaryState {
  failed: boolean;
}

// A per-view error boundary. When one view's render throws — e.g. an
// unanticipated partial or degenerate supervisor shape that slips past the data
// layer's guards while the dolt store is slow — this degrades THAT view to a
// calm, DESIGN-compliant "unavailable" tier (the word + a retry affordance)
// instead of letting the throw bubble to the app-root ErrorBoundary, which
// replaces the WHOLE dashboard with the generic crash page.
//
// It is defense-in-depth, not a substitute for handling errors at the data
// edge: the underlying error is still REPORTED to the local dashboard log
// (never swallowed), and Retry remounts the subtree so transient slowness
// clears without a full-page reload. Greyscale-readable per DESIGN.md (the
// state is carried by the word, not by tone; glyph-less like the app-root
// ErrorBoundary so it adds no mark to the run/bead status glyph vocabulary) and
// non-counting (no maroon mark, so the One Mark Rule is unaffected).
//
// The neutral grey is deliberate and distinct from the convoy DATA layer's
// Stuck Maroon "failed" tier: a render crash is an unexpected fault in the view
// itself, mirroring the app-root ErrorBoundary, not a counted domain signal.
export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  override state: ViewErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ViewErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _errorInfo: ErrorInfo): void {
    void reportClientError({
      component: 'ViewErrorBoundary',
      operation: this.props.view,
      message: errorMessage(error),
    });
  }

  private readonly retry = (): void => this.setState({ failed: false });

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className="space-y-3" role="alert">
          <p className="text-body text-fg-muted">
            Unavailable. This view could not be rendered; the supervisor store may be slow or
            returning partial data. The error was reported to the local dashboard log.
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="text-label uppercase tracking-wider text-fg-faint hover:text-fg focus-mark"
          >
            Retry
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
