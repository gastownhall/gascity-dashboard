import type {
  FormulaRunDetail,
  FormulaRunPartialReason,
  GcFormulaDetail,
  GcRunSnapshot,
  GcSession,
  RunFormulaDetailFetchFailure,
  RunFormulaDetailState,
  RunScopeKind,
} from 'gas-city-dashboard-shared';
import {
  enrichFormulaRun,
  formulaRunCompleteness,
  resolveRunFormulaIdentity,
} from 'gas-city-dashboard-shared';
import { getActiveCity } from '../api/cityBase';
import type {
  FormulaDetailResponse,
  WorkflowSnapshotResponse,
} from '../generated/gc-supervisor-client/types.gen';
import { SupervisorApiError, supervisorApi, type SupervisorApi } from './client';

export async function loadSupervisorFormulaRunDetail(
  runId: string,
  scopeKind?: RunScopeKind,
  scopeRef?: string,
): Promise<FormulaRunDetail> {
  const cityName = activeCityOrThrow('load supervisor formula run detail');
  const query = runScopeQuery(scopeKind, scopeRef);
  const api = supervisorApi();
  const [raw, sessionsLookup] = await Promise.all([
    api.workflowRun(cityName, runId, query),
    loadRunSessions(cityName),
  ]);
  const snapshot = toGcRunSnapshot(raw);
  const formulaDetailLookup = await loadRunFormulaDetail(api, cityName, snapshot, query);
  const detail = enrichFormulaRun(snapshot, {
    sessions: sessionsLookup.sessions,
    formulaDetailState: formulaDetailLookup.state,
    ...(formulaDetailLookup.kind === 'available'
      ? { formulaDetail: formulaDetailLookup.detail }
      : {}),
  });
  const reasons: FormulaRunPartialReason[] = [
    ...(detail.completeness.kind === 'partial' ? detail.completeness.reasons : []),
    ...(sessionsLookup.kind === 'unavailable' ? ['session_list_failed' as const] : []),
    ...(formulaDetailLookup.kind === 'unavailable'
      ? [formulaDetailPartialReason(formulaDetailLookup.state.reason)]
      : []),
  ];
  return {
    ...detail,
    completeness: formulaRunCompleteness(reasons),
  };
}

type RunSessionsLookup =
  | { kind: 'available'; sessions: readonly GcSession[] }
  | { kind: 'unavailable'; sessions: readonly GcSession[] };

type RunFormulaDetailLookup =
  | { kind: 'available'; detail: GcFormulaDetail; state: RunFormulaDetailState }
  | {
      kind: 'unavailable';
      state: Extract<RunFormulaDetailState, { kind: 'unavailable' }>;
    };

async function loadRunSessions(cityName: string): Promise<RunSessionsLookup> {
  try {
    const list = await supervisorApi().listSessions(cityName);
    return {
      kind: 'available',
      sessions: (list.items ?? []) as GcSession[],
    };
  } catch {
    return { kind: 'unavailable', sessions: [] };
  }
}

async function loadRunFormulaDetail(
  api: SupervisorApi,
  cityName: string,
  snapshot: GcRunSnapshot,
  scopeQuery: { scope_kind?: string; scope_ref?: string } | undefined,
): Promise<RunFormulaDetailLookup> {
  const root = snapshot.beads?.find((bead) => bead.id === snapshot.root_bead_id);
  const resolved = resolveRunFormulaIdentity('route', { root });
  const name = resolved.name ?? undefined;
  const target = resolved.target ?? undefined;
  if (name === undefined) {
    return {
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'missing_formula_metadata' },
    };
  }
  if (target === undefined) {
    return {
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'missing_run_target', name },
    };
  }
  try {
    const detail = toGcFormulaDetail(await api.formulaDetail(cityName, name, {
      target,
      ...(scopeQuery ?? {}),
    }));
    return {
      kind: 'available',
      detail,
      state: { kind: 'available', name, target },
    };
  } catch (err) {
    return {
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'fetch_failed',
        name,
        target,
        failure: formulaDetailFetchFailure(err),
      },
    };
  }
}

function toGcRunSnapshot(raw: WorkflowSnapshotResponse): GcRunSnapshot {
  const snapshot: GcRunSnapshot = {
    run_id: raw.workflow_id,
    root_bead_id: raw.root_bead_id,
    root_store_ref: raw.root_store_ref,
    resolved_root_store: raw.resolved_root_store,
    scope_kind: raw.scope_kind,
    scope_ref: raw.scope_ref,
    snapshot_version: raw.snapshot_version,
    partial: raw.partial,
    stores_scanned: raw.stores_scanned,
    beads: raw.beads,
    deps: raw.deps,
    logical_nodes: raw.logical_nodes as GcRunSnapshot['logical_nodes'],
    logical_edges: raw.logical_edges,
    scope_groups: raw.scope_groups as GcRunSnapshot['scope_groups'],
  };
  if (raw.snapshot_event_seq !== undefined) {
    snapshot.snapshot_event_seq = raw.snapshot_event_seq;
  }
  return snapshot;
}

function toGcFormulaDetail(raw: FormulaDetailResponse): GcFormulaDetail {
  const detail: GcFormulaDetail = { name: raw.name };
  const preview: NonNullable<GcFormulaDetail['preview']> = {};
  if (Array.isArray(raw.preview.nodes)) {
    preview.nodes = raw.preview.nodes;
  }
  if (Array.isArray(raw.preview.edges)) {
    preview.edges = raw.preview.edges;
  }
  if (preview.nodes !== undefined || preview.edges !== undefined) {
    detail.preview = preview;
  }
  if (Array.isArray(raw.steps)) {
    detail.steps = raw.steps;
  }
  if (Array.isArray(raw.deps)) {
    detail.deps = raw.deps;
  }
  return detail;
}

function formulaDetailPartialReason(
  reason: Extract<RunFormulaDetailState, { kind: 'unavailable' }>['reason'],
): FormulaRunPartialReason {
  switch (reason) {
    case 'missing_formula_metadata':
      return 'formula_detail_missing_formula_metadata';
    case 'missing_run_target':
      return 'formula_detail_missing_run_target';
    case 'fetch_failed':
      return 'formula_detail_fetch_failed';
  }
}

function formulaDetailFetchFailure(err: unknown): RunFormulaDetailFetchFailure {
  if (err instanceof SupervisorApiError && err.status === 404) return 'not_found';
  return 'upstream_error';
}

function runScopeQuery(
  scopeKind?: RunScopeKind,
  scopeRef?: string,
): { scope_kind?: string; scope_ref?: string } | undefined {
  if (scopeKind === undefined && scopeRef === undefined) return undefined;
  const query: { scope_kind?: string; scope_ref?: string } = {};
  if (scopeKind !== undefined) query.scope_kind = scopeKind;
  if (scopeRef !== undefined) query.scope_ref = scopeRef;
  return query;
}

function activeCityOrThrow(operation: string): string {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error(`${operation} called before an active city was resolved`);
  }
  return cityName;
}
