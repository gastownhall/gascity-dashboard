import type { Response } from 'express';
import { Router } from 'express';
import type {
  GcBead,
  GcFormulaDetail,
  GcRunSnapshot,
  GcSession,
  FormulaRunDetail,
  RunFormulaDetailFetchFailure,
  RunFormulaDetailState,
  FormulaRunPartialReason,
  RunScopeKind,
} from 'gas-city-dashboard-shared';
import { GcClient } from '../gc-client.js';
import { BEAD_ID_RE } from '../lib/beadId.js';
import { HTTP_STATUS } from '../lib/http-status.js';
import { isPartialList } from '../lib/partial-list.js';
import { fromRequestScope } from '../lib/run-scope.js';
import { errorMessage, LOG_COMPONENT, logWarn } from '../logging.js';
import {
  routeUpstreamError,
  routeValidationError,
  writeRouteError,
} from '../route-errors.js';
import { nonEmpty } from '../runs/bead-fields.js';
import { resolveRunFormulaIdentity } from '../runs/formula-name.js';
import { readRunGitDiff } from '../runs/diff.js';
import {
  enrichFormulaRun,
  formulaRunCompleteness,
  UnsupportedRunError,
} from '../runs/enrich.js';
import { mergeRunRuntimeState } from '../runs/runtime-state.js';
import { KeyedSwrCache } from '../runs/run-detail-cache.js';

// Run-detail reads are cached with stale-while-revalidate because the
// supervisor's single-run endpoint scans every store in the city to assemble
// one run (gascity-dashboard-wqsk). 30s mirrors the ambient-glance cadence of
// the snapshot list (60s) while keeping the focused detail view fresher; SSE
// bead events and the manual Refresh button bypass it via `?refresh=1`.
const RUN_DETAIL_CACHE_TTL_MS = 30_000;

export interface RunsRouterOptions {
  rigRoot?: string;
  /**
   * Stale-while-revalidate TTL for the run-detail cache, in ms. Defaults to
   * RUN_DETAIL_CACHE_TTL_MS. Exposed for tests that exercise the stale path.
   */
  runDetailCacheTtlMs?: number;
  /** Injectable clock for the run-detail cache (tests only). */
  now?: () => number;
  /**
   * Opt-in path-prefix allowlist for run-detail git reads
   * (gascity-dashboard-k2b8). Threaded into readRunGitDiff so the cwd fed to
   * `git -C` must live under a sanctioned root. Empty / omitted preserves the
   * prior shape-only validation. Sourced from config.runCwdAllowedRoots.
   */
  runCwdAllowedRoots?: readonly string[];
}

export function runsRouter(
  gc: GcClient,
  opts: RunsRouterOptions = {},
): Router {
  const router = Router();
  const detailCache = new KeyedSwrCache<FormulaRunDetail>({
    ttlMs: opts.runDetailCacheTtlMs ?? RUN_DETAIL_CACHE_TTL_MS,
    ...(opts.now ? { now: opts.now } : {}),
  });

  router.get('/:runId/diff', async (req, res) => {
    const parsed = parseRunRequest(req.params.runId, req.query);
    if (!parsed.ok) {
      writeRouteError(res, routeValidationError(parsed.error));
      return;
    }
    try {
      const scope = parsed.scope ?? defaultRunScope(gc.cityName);
      // Reuse the cached detail assemble — it already carries executionPath —
      // so the diff endpoint never re-pays the supervisor's all-store scan that
      // the detail endpoint just paid. On a run-detail page the two fetches
      // fire together and share one scan via the cache's single-flight; repeat
      // loads are served from memory (gascity-dashboard-wqsk). `?refresh=1`
      // forces a fresh assemble in lockstep with the detail refresh.
      const force = req.query.refresh === '1';
      const cacheKey = runDetailCacheKey(parsed.runId, scope);
      const detail = await detailCache.get(
        cacheKey,
        () => assembleRunDetail(gc, parsed.runId, scope, opts),
        { force },
      );
      const diff = await readRunGitDiff(detail.executionPath, opts.runCwdAllowedRoots ?? []);
      res.json(diff);
    } catch (err) {
      writeRunError(res, err, 'failed to fetch run diff');
    }
  });

  router.get('/:runId', async (req, res) => {
    const parsed = parseRunRequest(req.params.runId, req.query);
    if (!parsed.ok) {
      writeRouteError(res, routeValidationError(parsed.error));
      return;
    }
    try {
      const scope = parsed.scope ?? defaultRunScope(gc.cityName);
      // Cache the assembled detail keyed by run + scope: the supervisor scans
      // every store to build one run (~seconds), so repeat navigations and
      // concurrent clients would each re-pay it. `?refresh=1` (the manual
      // Refresh button + SSE-driven refresh) forces a fresh assemble
      // (gascity-dashboard-wqsk).
      const force = req.query.refresh === '1';
      const cacheKey = runDetailCacheKey(parsed.runId, scope);
      const detail = await detailCache.get(
        cacheKey,
        () => assembleRunDetail(gc, parsed.runId, scope, opts),
        { force },
      );
      res.json(detail);
    } catch (err) {
      writeRunError(res, err, 'failed to fetch run');
    }
  });

  return router;
}

// Cache key for one run's assembled detail. Scope is part of the identity:
// the same runId resolves to different snapshots under different scopes. The
// components are all identifiers (bead id, 'city'|'rig', scope name) with no
// embedded spaces, so a space delimiter cannot collide.
function runDetailCacheKey(
  runId: string,
  scope: { scopeKind: RunScopeKind; scopeRef: string },
): string {
  return [runId, scope.scopeKind, scope.scopeRef].join(' ');
}

// Assemble the full run-detail response from the supervisor. Extracted from
// the route handler so it can be the cache's load() closure
// (gascity-dashboard-wqsk). getRunSessions is a city-wide listSessions
// independent of this run, so it overlaps the run+runtime-state fetch instead
// of serializing after (gascity-dashboard-ey8i). getRunFormulaDetail genuinely
// depends on the run's raw root bead, so it stays sequential after the run fetch.
async function assembleRunDetail(
  gc: GcClient,
  runId: string,
  scope: { scopeKind: RunScopeKind; scopeRef: string },
  opts: RunsRouterOptions,
): Promise<FormulaRunDetail> {
  const [{ raw, partial: runtimePartial }, sessionsLookup] = await Promise.all([
    getRunWithRuntimeState(gc, runId, scope),
    getRunSessions(gc),
  ]);
  const formulaDetailLookup = await getRunFormulaDetail(gc, raw, scope);
  const detail = enrichFormulaRun(raw, enrichOptions(opts, sessionsLookup, formulaDetailLookup));
  const completeness = formulaRunCompleteness([
    ...runPartialReasons(detail.completeness),
    ...(runtimePartial ? ['runtime_bead_read_failed' as const] : []),
    ...(sessionsLookup.kind === 'unavailable' ? ['session_list_failed' as const] : []),
    ...(formulaDetailLookup.kind === 'unavailable'
      ? [formulaDetailPartialReason(formulaDetailLookup.state.reason)]
      : []),
  ]);
  return { ...detail, completeness };
}

async function getRunFormulaDetail(
  gc: GcClient,
  raw: GcRunSnapshot,
  scope: { scopeKind: RunScopeKind; scopeRef: string },
): Promise<RunFormulaDetailLookup> {
  const root = raw.beads?.find((bead) => nonEmpty(bead.id) === raw.root_bead_id);
  // Resolution precedence for the formula-detail fetch:
  //   1. explicit `gc.formula`         (resolver `metadata` path)
  //   2. `gc.formula_name`             (pre-graph.v2 metadata key the
  //                                     resolver does not cover)
  //   3. graph.v2 title fallback       (resolver `title_fallback` path)
  // gc.formula_name MUST win over the title fallback: the live graph.v2
  // roots carry the formula name in the title rather than `gc.formula`, so
  // the title fallback lets us fetch the registered formula detail when the
  // supervisor has it (gascity-dashboard-sadp) — but when the supervisor
  // DID report an explicit `gc.formula_name` that is canonical and must not
  // be shadowed by the bead title.
  const resolved = resolveRunFormulaIdentity('route', { root });
  const formula = resolved.name ?? undefined;
  const target = resolved.target ?? undefined;
  if (!formula) {
    return {
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'missing_formula_metadata' },
    };
  }
  if (!target) {
    return {
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'missing_run_target', name: formula },
    };
  }
  try {
    return {
      kind: 'available',
      detail: await gc.getFormulaDetail(formula, scope, target),
      state: { kind: 'available', name: formula, target },
    };
  } catch (err) {
    logWarn(LOG_COMPONENT.runs, `failed to fetch formula detail for ${formula}: ${errorMessage(err)}`);
    return {
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'fetch_failed',
        name: formula,
        target,
        failure: formulaDetailFetchFailure(err),
      },
    };
  }
}

async function getRunSessions(
  gc: GcClient,
): Promise<RunSessionsLookup> {
  try {
    const list = await gc.listSessions();
    const items = Array.isArray(list.items) ? list.items : [];
    // A supervisor-reported partial session list is a degraded read: propagate
    // it as unavailable so run-detail completeness surfaces session_list_failed
    // instead of a misleadingly clean badge (matches links.ts; restored after
    // the workflow→run rename dropped the check).
    if (isPartialList(list)) {
      logWarn(
        LOG_COMPONENT.runs,
        `supervisor reported partial session list for run detail; serving as unavailable`,
      );
      return { kind: 'unavailable', sessions: items };
    }
    return { kind: 'available', sessions: items };
  } catch (err) {
    logWarn(LOG_COMPONENT.runs, `failed to fetch sessions for run detail: ${errorMessage(err)}`);
    return { kind: 'unavailable', sessions: [] };
  }
}

async function getRunWithRuntimeState(
  gc: GcClient,
  runId: string,
  scope: { scopeKind: RunScopeKind; scopeRef: string },
): Promise<{ raw: GcRunSnapshot; partial: boolean }> {
  const raw = await gc.getRun(runId, undefined, scope);
  // The per-bead canonical refresh below only works for runs whose beads
  // live in the city store: the supervisor exposes bead reads solely at
  // /v0/city/{city}/bead/{id}, with no rig-store bead endpoint. For a
  // non-city-store run (e.g. root_store_ref=rig:<rig>) every /bead read
  // 404s structurally, not transiently — refreshing would fire N pointless
  // failing requests AND raise a misleading 'partial' badge (which signals a
  // recoverable flake). Treat the embedded snapshot rows as authoritative
  // instead and skip the refresh entirely. City runs keep the refresh
  // and the allSettled-based partial flagging (see below).
  if (!isCityStore(raw, gc.cityName)) {
    return { raw, partial: false };
  }
  const ids = runBeadIds(raw);
  // Fan out runtime bead reads with allSettled, NOT Promise.all: a single
  // failed /bead/:id read (transient timeout, 404, etc.) must not collapse the
  // whole run-detail request to a 502. Keep every bead we did get and flag
  // the response partial so the UI can show a degraded badge.
  const results = await Promise.allSettled(ids.map((id) => gc.getBead(id)));
  const runtime: GcBead[] = [];
  let failed = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') runtime.push(result.value);
    else failed += 1;
  }
  if (failed > 0) {
    logWarn(
      LOG_COMPONENT.runs,
      `${failed}/${ids.length} runtime bead reads failed for ${runId}; serving partial runtime state`,
    );
  }
  return { raw: mergeRunRuntimeState(raw, runtime), partial: failed > 0 };
}

/**
 * True when the run's root bead store is the dashboard's city store, i.e.
 * its beads are individually addressable via /v0/city/{city}/bead/{id}. The
 * supervisor identifies the city store as `city:<cityName>` in root_store_ref;
 * anything else (notably `rig:<rig>`) is not addressable through the city bead
 * endpoint.
 */
function isCityStore(raw: GcRunSnapshot, cityName: string): boolean {
  return nonEmpty(raw.root_store_ref) === `city:${cityName}`;
}

function runBeadIds(raw: GcRunSnapshot): string[] {
  const ids = new Set<string>();
  for (const bead of raw.beads ?? []) {
    if (BEAD_ID_RE.test(bead.id)) ids.add(bead.id);
  }
  return [...ids];
}

type ParseResult =
  | {
    ok: true;
    runId: string;
    scope?: { scopeKind: RunScopeKind; scopeRef: string };
  }
  | { ok: false; error: string };

function parseRunRequest(
  runId: string,
  query: Record<string, unknown>,
): ParseResult {
  if (!BEAD_ID_RE.test(runId)) {
    return { ok: false, error: 'invalid run id' };
  }
  if (query.scope_kind !== undefined && typeof query.scope_kind !== 'string') {
    return { ok: false, error: 'invalid scope kind' };
  }
  if (query.scope_ref !== undefined && typeof query.scope_ref !== 'string') {
    return { ok: false, error: 'invalid scope ref' };
  }
  const scope = fromRequestScope(query);
  if (!scope.ok) return scope;
  return scope.scope !== undefined
    ? { ok: true, runId, scope: scope.scope }
    : { ok: true, runId };
}

function defaultRunScope(cityName: string): { scopeKind: RunScopeKind; scopeRef: string } {
  return { scopeKind: 'city', scopeRef: cityName };
}

function enrichOptions(
  opts: RunsRouterOptions,
  sessions: RunSessionsLookup,
  formulaDetail: RunFormulaDetailLookup,
): {
  rigRoot?: string;
  sessions: readonly GcSession[];
  formulaDetail?: GcFormulaDetail;
  formulaDetailState: RunFormulaDetailState;
} {
  return {
    ...(opts.rigRoot !== undefined ? { rigRoot: opts.rigRoot } : {}),
    sessions: sessions.sessions,
    formulaDetailState: formulaDetail.state,
    ...(formulaDetail.kind === 'available'
      ? { formulaDetail: formulaDetail.detail }
      : {}),
  };
}

type RunFormulaDetailLookup =
  | { kind: 'available'; detail: GcFormulaDetail; state: RunFormulaDetailState }
  | {
    kind: 'unavailable';
    state: Extract<RunFormulaDetailState, { kind: 'unavailable' }>;
  };

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
  if (GcClient.isTimeoutError(err)) return 'timeout';
  const message = errorMessage(err);
  if (/gc supervisor returned 404\b/.test(message)) return 'not_found';
  if (message.includes('invalid gc supervisor getFormulaDetail payload')) return 'invalid_payload';
  if (message.includes('empty response body')) return 'empty_response';
  return 'upstream_error';
}

type RunSessionsLookup =
  | { kind: 'available'; sessions: readonly GcSession[] }
  | { kind: 'unavailable'; sessions: readonly GcSession[] };

function runPartialReasons(
  completeness: ReturnType<typeof formulaRunCompleteness>,
): FormulaRunPartialReason[] {
  return completeness.kind === 'partial' ? completeness.reasons : [];
}

function writeRunError(
  res: Response,
  err: unknown,
  fallbackMessage: string,
): void {
  if (err instanceof UnsupportedRunError) {
    res.status(HTTP_STATUS.unprocessableContent).json({ error: err.message, kind: 'unsupported' });
    return;
  }
  writeRouteError(res, routeUpstreamError(err, {
    component: LOG_COMPONENT.runs,
    operation: fallbackMessage,
    responseError: fallbackMessage,
    isTimeout: GcClient.isTimeoutError,
    notFound: { error: 'run not found', kind: 'not_found' },
  }));
}
