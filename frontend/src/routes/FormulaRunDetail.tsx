import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { GC_EVENT_PREFIX, SCOPE_REF_RE } from 'gas-city-dashboard-shared';
import type {
  FormulaRunDetail as FormulaRunDetailData,
  FormulaRunProgress,
  RunNodeStatus,
  FormulaRunPartialReason,
  RunScopeKind,
} from 'gas-city-dashboard-shared';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { RelatedEntities } from '../components/RelatedEntities';
import { BeadDetailModal } from '../components/BeadDetailModal';
import { FormulaRunDiagram } from '../components/run/FormulaRunDiagram';
import { FormulaRunTabs } from '../components/run/FormulaRunTabs';
import { StageLadder } from '../components/run/StageLadder';
import { useNow } from '../contexts/NowContext';
import { useGcEventRefresh } from '../hooks/useGcEvents';
import {
  runEventIdentity,
  formulaRunDetailEventMatches,
} from '../hooks/runEventIdentity';
import { useRunNodeSelection } from '../hooks/useRunNodeSelection';
import { useFormulaRunDetail } from '../hooks/useFormulaRunDetail';
import { useRunDiff } from '../hooks/useRunDiff';
import { useEntityLinks } from '../hooks/useEntityLinks';
import { useCachedData } from '../hooks/useCachedData';
import { api } from '../api/client';
import { NEEDS_YOU_VIEW_PARAM } from '../views/modules/maintainer/needsYou';

const RUN_DETAIL_EVENT_PREFIXES = [
  GC_EVENT_PREFIX.bead,
  GC_EVENT_PREFIX.session,
] as const;
const NO_EVENT_PREFIXES: readonly string[] = [];

export function FormulaRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [search] = useSearchParams();
  const parsedScope = parseScope(search);
  const scope = parsedScope.ok ? parsedScope.scope : undefined;
  const routeError = parsedScope.ok ? null : parsedScope.error;
  const initialNodeId = search.get('node');
  const routeSelectionKey = [
    runId ?? '',
    scope?.scopeKind ?? '',
    scope?.scopeRef ?? '',
    initialNodeId ?? '',
  ].join('\u0000');
  const runDetail = useFormulaRunDetail(
    routeError ? undefined : runId,
    scope?.scopeKind,
    scope?.scopeRef,
  );
  const runDiff = useRunDiff(
    routeError ? undefined : runId,
    scope?.scopeKind,
    scope?.scopeRef,
  );
  const readyRun = runDetail.kind === 'ready' ? runDetail : null;
  const detail = readyRun?.detail ?? null;
  const initialLoading = runDetail.kind === 'loading';
  const refreshing =
    (readyRun !== null && readyRun.refreshState.kind === 'refreshing') ||
    (runDiff.kind === 'ready' && runDiff.refreshState.kind === 'refreshing');
  const diffInitialLoading = detail !== null && runDiff.kind === 'loading';
  const loading = initialLoading || refreshing || diffInitialLoading;
  const loadError =
    runDetail.kind === 'failed'
      ? runDetail.error
      : readyRun !== null && readyRun.refreshState.kind === 'failed'
        ? readyRun.refreshState.error
        : null;
  useGcEventRefresh(
    routeError ? NO_EVENT_PREFIXES : RUN_DETAIL_EVENT_PREFIXES,
    () => void refreshRunResources(runDetail.refresh, runDiff.refresh),
    {
      matches: (event) =>
        detail === null ||
        formulaRunDetailEventMatches(runEventIdentity(event), {
          runId: detail.runId,
          rootBeadId: detail.rootBeadId,
        }),
    },
  );
  const pageError = routeError ?? loadError;
  const { selectedNodeId, selectedNode, toggleNode } = useRunNodeSelection(
    detail,
    initialNodeId,
    routeSelectionKey,
  );

  // Related entities (gascity-dashboard-j4x). Focus on the run's root
  // bead so the index surfaces the molecule members, sessions, and the
  // PR/issue this run is adopting.
  const links = useEntityLinks(detail?.rootBeadId ?? null);
  const [viewingBeadId, setViewingBeadId] = useState<string | null>(null);
  const now = useNow();

  // Optimistic skeleton (gascity-dashboard-wqsk): the first load of a run is
  // bounded by the supervisor's all-store scan (seconds). The snapshot cache —
  // already warm when the operator arrives from /runs — carries this run's lane
  // (title + phase stages), so render that instantly instead of a blank spinner
  // while the full detail assembles. Shares the 'snapshot' cache key with the
  // Runs list, so list→detail navigation pays no extra fetch; a cold deep-link
  // does one cheap snapshot GET and falls back to the plain spinner if the lane
  // isn't present.
  const snapshot = useCachedData('snapshot', () => api.snapshot());
  const skeletonLane = useMemo(() => {
    if (!runId) return null;
    const runs = snapshot.data?.sources.runs;
    const runsData =
      runs && (runs.status === 'fresh' || runs.status === 'stale' || runs.status === 'fixture')
        ? runs.data
        : null;
    return runsData?.lanes.find((lane) => lane.id === runId) ?? null;
  }, [snapshot.data, runId]);

  const synopsis = detail
    ? `${detail.progress.visibleNodeCount} nodes. ${summarizeNodeStatuses(detail.progress)}. Local changes are shown for the run execution folder.`
    : initialLoading && !routeError
      ? undefined
      : 'Formula run unavailable.';

  return (
    <section>
      <PageHeader
        title={detail?.title ?? 'Formula Run'}
        synopsis={synopsis}
        meta={
          <>
            {/* `from=triage` is display-only: it gates whether this back-link
                renders. The destination is always the NEEDS_YOU_VIEW_PARAM
                constant, never derived from the param — do not refactor to
                `to={search.get('from')}` (would open an open-redirect). */}
            {search.get('from') === 'triage' && (
              <Link
                to={`/maintainer?view=${NEEDS_YOU_VIEW_PARAM}`}
                className="focus-mark text-label uppercase tracking-wider text-fg-muted hover:text-fg"
                aria-label="Back to Needs-You triage"
              >
                ← Triage
              </Link>
            )}
            <Link
              to="/runs"
              className="focus-mark text-label uppercase tracking-wider text-fg-muted hover:text-fg"
            >
              Runs
            </Link>
            {pageError && detail && (
              <span
                className="normal-case text-body text-accent"
                role="alert"
              >
                {pageError}
              </span>
            )}
            {detail && (
              <span className="text-label uppercase tracking-wider text-fg-faint tnum">
                {snapshotLabel(detail)}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void refreshRunResources(runDetail.refresh, runDiff.refresh)}
              disabled={loading || Boolean(routeError)}
            >
              {refreshing ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      {loading && !routeError && !detail ? (
        skeletonLane ? (
          <>
            <StageLadder stages={skeletonLane.stages} label={skeletonLane.title} />
            <p className="text-body text-fg-muted italic mt-8">Loading run detail.</p>
          </>
        ) : (
          <p className="text-body text-fg-muted italic">Loading formula run.</p>
        )
      ) : pageError && !detail ? (
        <p className="text-body text-accent" role="alert">{pageError}</p>
      ) : readyRun ? (
        <>
          <RunMetadata detail={readyRun.detail} />
          <StageLadder
            stages={readyRun.detail.stages}
            label={readyRun.detail.title}
          />
          <FormulaRunPartialNotice detail={readyRun.detail} />
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(22rem,1.05fr)]">
            <FormulaRunDiagram
              detail={readyRun.detail}
              selectedNodeId={selectedNodeId}
              onToggleNode={toggleNode}
            />
            <FormulaRunTabs diff={runDiff} selectedNode={selectedNode} />
          </div>
          <RelatedEntities
            view={links.view}
            loading={links.loading}
            error={links.error}
            now={now}
            onOpenBead={setViewingBeadId}
          />
          <BeadDetailModal
            open={viewingBeadId !== null}
            onClose={() => setViewingBeadId(null)}
            beadId={viewingBeadId}
            onOpenBead={setViewingBeadId}
          />
        </>
      ) : null}
    </section>
  );
}

async function refreshRunResources(
  refreshDetail: () => Promise<void>,
  refreshDiff: () => Promise<void>,
): Promise<void> {
  await Promise.all([refreshDetail(), refreshDiff()]);
}

function RunMetadata({
  detail,
}: {
  detail: FormulaRunDetailData;
}) {
  const formulaDetail = formulaDetailLabel(detail.formulaDetail);
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      <FormulaMeta formula={detail.formula} />
      {formulaDetail !== null && <Meta label="Formula Detail" value={formulaDetail} />}
      <Meta label="Root" value={detail.rootBeadId} />
      <Meta label="Scope" value={`${detail.scopeKind}:${detail.scopeRef}`} />
      <Meta label="Store" value={detail.resolvedRootStore || detail.rootStoreRef || 'unknown'} />
    </dl>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label uppercase tracking-wider text-fg-faint">{label}</dt>
      <dd className="text-body text-fg break-all tnum">{value}</dd>
    </div>
  );
}

const TITLE_FALLBACK_TOOLTIP =
  'name inferred from bead title — supervisor did not set gc.formula on this graph.v2 root';

/**
 * Render the formula metadata cell with provenance.
 *
 * gascity-dashboard-e7hj: when the backend resolved the formula name via
 * the gated title fallback (source === 'title_fallback') we surface that
 * in a warn tone with an explanatory aside, matching the Health.tsx
 * "not reported by supervisor" precedent (PR #36). Per DESIGN.md's
 * "States have words" rule the warn tone is paired with a short textual
 * correlate ("inferred from bead title") and the longer explanation
 * lives in the native tooltip so the cell stays legible in greyscale.
 */
function FormulaMeta({ formula }: { formula: FormulaRunDetailData['formula'] }) {
  if (formula.kind !== 'known') {
    return <Meta label="Formula" value="metadata missing" />;
  }
  switch (formula.source) {
    case 'metadata':
      return <Meta label="Formula" value={formula.name} />;
    case 'title_fallback':
      return (
        <div>
          <dt className="text-label uppercase tracking-wider text-fg-faint">Formula</dt>
          <dd
            className="text-body text-warn break-all tnum"
            title={TITLE_FALLBACK_TOOLTIP}
            aria-label={`${formula.name} (${TITLE_FALLBACK_TOOLTIP})`}
          >
            {formula.name}
            <span className="ml-2 text-label uppercase tracking-wider text-warn">
              inferred from bead title
            </span>
          </dd>
        </div>
      );
    default: {
      // Exhaustiveness: a new RunFormulaSource variant must declare its
      // own render path — falling through to a default warn tone would
      // silently misrepresent its provenance.
      const _exhaustive: never = formula.source;
      return _exhaustive;
    }
  }
}

function snapshotLabel(
  detail: FormulaRunDetailData,
): string {
  return detail.snapshotEventSeq.kind === 'known'
    ? `v${detail.snapshotVersion} · seq ${detail.snapshotEventSeq.seq}`
    : `v${detail.snapshotVersion}`;
}

function formulaDetailLabel(formulaDetail: FormulaRunDetailData['formulaDetail']): string | null {
  if (formulaDetail.kind === 'available') return `available for ${formulaDetail.target}`;
  if (formulaDetail.reason === 'missing_formula_metadata') return null;
  if (formulaDetail.reason === 'missing_run_target') return `missing run target for ${formulaDetail.name}`;
  return `${formulaDetail.failure} for ${formulaDetail.target}`;
}

function FormulaRunPartialNotice({ detail }: { detail: FormulaRunDetailData }) {
  if (detail.completeness.kind !== 'partial') return null;
  const reasons = pageLevelPartialReasons(detail.completeness.reasons);
  if (reasons.length === 0) return null;
  return (
    <p className="mt-5 text-label uppercase tracking-wider text-warn" role="status">
      Partial run data: {partialReasonsLabel(reasons)}.
    </p>
  );
}

function pageLevelPartialReasons(
  reasons: readonly FormulaRunPartialReason[],
): FormulaRunPartialReason[] {
  return reasons.filter((reason) => !isFormulaDetailPartialReason(reason));
}

function isFormulaDetailPartialReason(reason: FormulaRunPartialReason): boolean {
  switch (reason) {
    case 'formula_detail_missing_formula_metadata':
    case 'formula_detail_missing_run_target':
    case 'formula_detail_fetch_failed':
      return true;
    case 'supervisor_snapshot_partial':
    case 'runtime_bead_read_failed':
    case 'session_list_failed':
      return false;
  }
}

function partialReasonsLabel(reasons: readonly FormulaRunPartialReason[]): string {
  return reasons.map(partialReasonLabel).join(', ');
}

function partialReasonLabel(reason: FormulaRunPartialReason): string {
  switch (reason) {
    case 'supervisor_snapshot_partial':
      return 'supervisor snapshot is partial';
    case 'runtime_bead_read_failed':
      return 'runtime bead refresh failed';
    case 'session_list_failed':
      return 'session list failed';
    case 'formula_detail_missing_formula_metadata':
      return 'formula metadata is missing';
    case 'formula_detail_missing_run_target':
      return 'formula run target is missing';
    case 'formula_detail_fetch_failed':
      return 'formula detail fetch failed';
  }
}

type ScopeParseResult =
  | { ok: true; scope?: { scopeKind: RunScopeKind; scopeRef: string } }
  | { ok: false; error: string };

function parseScope(search: URLSearchParams): ScopeParseResult {
  const rawKinds = search.getAll('scope_kind');
  const rawRefs = search.getAll('scope_ref');
  if (rawKinds.length > 1 || rawRefs.length > 1) {
    return { ok: false, error: 'Invalid run scope query.' };
  }

  const rawKind = rawKinds[0];
  const rawRef = rawRefs[0];
  if (rawKind === undefined && rawRef === undefined) return { ok: true };

  // Reject a half-specified scope (one of kind/ref present) rather than
  // silently dropping it — the backend rejects the same input as a 400, so
  // failing closed here keeps a truncated deep link from loading the WRONG
  // (default city) run instead of erroring.
  if (rawKind === undefined || rawRef === undefined) {
    return { ok: false, error: 'Invalid run scope query.' };
  }

  if (rawKind !== 'city' && rawKind !== 'rig') {
    return { ok: false, error: 'Invalid run scope query.' };
  }
  if (!SCOPE_REF_RE.test(rawRef)) {
    return { ok: false, error: 'Invalid run scope query.' };
  }

  return { ok: true, scope: { scopeKind: rawKind, scopeRef: rawRef } };
}

function summarizeNodeStatuses(progress: FormulaRunProgress): string {
  const parts = [
    statusSummaryPart(progress, ['active', 'running'], 'running'),
    statusSummaryPart(progress, ['completed', 'done'], 'done'),
    statusSummaryPart(progress, 'ready', 'ready'),
    statusSummaryPart(progress, 'blocked', 'blocked'),
    statusSummaryPart(progress, 'failed', 'failed'),
    statusSummaryPart(progress, 'skipped', 'skipped'),
    statusSummaryPart(progress, 'pending', 'pending'),
  ]
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'No node status yet';
}

function statusSummaryPart(
  progress: FormulaRunProgress,
  statuses: RunNodeStatus | readonly RunNodeStatus[],
  label: string,
): string | null {
  const keys: readonly RunNodeStatus[] =
    typeof statuses === 'string' ? [statuses] : statuses;
  const count = keys.reduce((sum, status) => sum + (progress.statusCounts[status] ?? 0), 0);
  return count > 0 ? `${count} ${label}` : null;
}
