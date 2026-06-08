import type { FormulaRunDetail, RunScopeKind } from 'gas-city-dashboard-shared';
import { errorMessage, UnsupportedRunError } from 'gas-city-dashboard-shared';
import { reportClientError } from '../lib/clientErrorReporting';
import { loadSupervisorFormulaRunDetail } from '../supervisor/runDetail';
import { SupervisorApiError } from '../supervisor/errors';
import { useCachedData } from './useCachedData';

interface FormulaRunDetailState {
  kind: 'idle' | 'loading' | 'ready' | 'failed' | 'unsupported';
  refresh: () => Promise<void>;
}

type FormulaRunRefreshState =
  | { kind: 'idle' }
  | { kind: 'refreshing' }
  | { kind: 'failed'; error: string };

// gascity-dashboard-9w3k: a v1 / wisp run (not graph.v2) is surfaced in the run
// list but has no graph.v2 step-detail view. enrichFormulaRun throws an
// UnsupportedRunError('not_run_view') for it. We carry that as a DISTINCT
// frontend payload (not a thrown error → not the generic failed state) so the
// detail page can render an honest "list-only" message instead of an opaque
// "Formula run unavailable." dead-end. No shared wire-shape field is added.
type FormulaRunDetailPayload =
  | { kind: 'unrequested' }
  | { kind: 'unsupported' }
  | {
      kind: 'loaded';
      detail: FormulaRunDetail;
    };

export type FormulaRunDetailLoadState =
  | (FormulaRunDetailState & { kind: 'idle' })
  | (FormulaRunDetailState & { kind: 'loading' })
  | (FormulaRunDetailState & {
      kind: 'ready';
      detail: FormulaRunDetail;
      refreshState: FormulaRunRefreshState;
    })
  | (FormulaRunDetailState & { kind: 'unsupported' })
  | (FormulaRunDetailState & { kind: 'failed'; error: string });

export function useFormulaRunDetail(
  runId: string | undefined,
  scopeKind?: RunScopeKind,
  scopeRef?: string,
): FormulaRunDetailLoadState {
  const key = formulaRunDetailCacheKey(runId, scopeKind, scopeRef);
  const { data, loading, error, refresh } = useCachedData(
    key,
    () => loadFormulaRunDetail(runId, scopeKind, scopeRef),
    {
      onError: (err) => {
        if (runId !== undefined) reportRunDetailError('load detail', runId, err);
      },
    },
  );

  if (runId === undefined) return { kind: 'idle', refresh: noopRefresh };
  if (data?.kind === 'loaded') {
    return {
      kind: 'ready',
      detail: data.detail,
      refresh,
      refreshState: refreshState(loading, error),
    };
  }
  if (data?.kind === 'unsupported') return { kind: 'unsupported', refresh };
  if (error !== null) return { kind: 'failed', error, refresh };
  return { kind: 'loading', refresh };
}

async function loadFormulaRunDetail(
  runId: string | undefined,
  scopeKind?: RunScopeKind,
  scopeRef?: string,
): Promise<FormulaRunDetailPayload> {
  if (!runId) return { kind: 'unrequested' };
  const params: { scopeKind?: RunScopeKind; scopeRef?: string } = {};
  if (scopeKind !== undefined) params.scopeKind = scopeKind;
  if (scopeRef !== undefined) params.scopeRef = scopeRef;
  try {
    const detail = await loadSupervisorFormulaRunDetail(runId, params.scopeKind, params.scopeRef);
    return { kind: 'loaded', detail };
  } catch (err) {
    // gascity-dashboard-9w3k: a v1 / wisp run has no graph.v2 detail view. Two
    // expected shapes for that case, both mapped to the 'unsupported' payload so
    // the page renders the honest list-only message instead of a raw error:
    //   1. the snapshot loads but isn't graph.v2 -> UnsupportedRunError('not_run_view');
    //   2. the supervisor's workflow endpoint 404s the wisp id outright (it only
    //      knows graph.v2 workflows) -> SupervisorApiError status 404.
    // A malformed graph.v2 snapshot ('invalid_snapshot') and any other transport
    // failure still propagate as a generic load error.
    if (
      (err instanceof UnsupportedRunError && err.reason === 'not_run_view') ||
      (err instanceof SupervisorApiError && err.status === 404)
    ) {
      return { kind: 'unsupported' };
    }
    throw err;
  }
}

async function noopRefresh(): Promise<void> {}

function refreshState(loading: boolean, error: string | null): FormulaRunRefreshState {
  if (error !== null) return { kind: 'failed', error };
  return loading ? { kind: 'refreshing' } : { kind: 'idle' };
}

function reportRunDetailError(operation: string, runId: string, err: unknown): void {
  void reportClientError({
    component: 'formula-run-detail',
    operation,
    message: `${runId}: ${errorMessage(err)}`,
  });
}

function formulaRunDetailCacheKey(
  runId: string | undefined,
  scopeKind?: RunScopeKind,
  scopeRef?: string,
): string {
  const parts = ['formula-run', runId ?? 'missing', scopeKind ?? 'default', scopeRef ?? 'default'];
  return parts.join(':');
}
