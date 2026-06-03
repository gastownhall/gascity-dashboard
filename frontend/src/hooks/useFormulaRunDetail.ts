import type {
  FormulaRunDetail,
  RunScopeKind,
} from 'gas-city-dashboard-shared';
import { errorMessage } from 'gas-city-dashboard-shared';
import { reportClientError } from '../lib/clientErrorReporting';
import { loadSupervisorFormulaRunDetail } from '../supervisor/runDetail';
import { useCachedData } from './useCachedData';

interface FormulaRunDetailState {
  kind: 'idle' | 'loading' | 'ready' | 'failed';
  refresh: () => Promise<void>;
}

type FormulaRunRefreshState =
  | { kind: 'idle' }
  | { kind: 'refreshing' }
  | { kind: 'failed'; error: string };

type FormulaRunDetailPayload =
  | { kind: 'unrequested' }
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
  const detail = await loadSupervisorFormulaRunDetail(runId, params.scopeKind, params.scopeRef);
  return { kind: 'loaded', detail };
}

async function noopRefresh(): Promise<void> {}

function refreshState(
  loading: boolean,
  error: string | null,
): FormulaRunRefreshState {
  if (error !== null) return { kind: 'failed', error };
  return loading ? { kind: 'refreshing' } : { kind: 'idle' };
}

function reportRunDetailError(
  operation: string,
  runId: string,
  err: unknown,
): void {
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
  const parts = [
    'formula-run',
    runId ?? 'missing',
    scopeKind ?? 'default',
    scopeRef ?? 'default',
  ];
  return parts.join(':');
}
