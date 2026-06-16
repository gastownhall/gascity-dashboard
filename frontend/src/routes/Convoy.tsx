import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  ConvoyStep,
  ConvoyStepExposure,
  ConvoyView,
  BeadStatus,
} from 'gas-city-dashboard-shared';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { PartialDataNotice } from '../components/PartialDataNotice';
import { RelatedEntities } from '../components/RelatedEntities';
import { BeadDetailModal } from '../components/BeadDetailModal';
import { useNow } from '../contexts/NowContext';
import { useConvoyView } from '../hooks/useConvoyView';
import { useEntityLinks } from '../hooks/useEntityLinks';

// The convoy page (gascity-dashboard-caag, Shape A): one route keyed by the
// root bead that gives the operator the single end-to-end picture of a unit of
// work — formula identity, step timeline, progress, live session, and the
// existing related-entity index — by COMPOSING supervisor reads and reusing the
// run-detail furniture. When the supervisor cannot expose the step DAG
// (graph.v2 collapses run snapshots to the root) the page says so in words
// rather than fabricating a timeline.

export function ConvoyPage() {
  const { rootBead } = useParams<{ rootBead: string }>();
  const rootBeadId = rootBead ?? null;
  const { state, refresh } = useConvoyView(rootBeadId);
  const links = useEntityLinks(rootBeadId);
  const [viewingBeadId, setViewingBeadId] = useState<string | null>(null);
  const now = useNow();

  const ready = state.kind === 'ready' ? state : null;
  const view = ready?.load.view ?? null;
  const refreshing = ready?.refreshing ?? false;
  const loading = state.kind === 'loading';

  return (
    <section>
      <PageHeader
        title={view ? (view.formulaName ?? 'Convoy') : 'Convoy'}
        synopsis={view ? convoySynopsis(view) : undefined}
        meta={
          <>
            <Link
              to="/runs"
              className="focus-mark text-label uppercase tracking-wider text-fg-muted hover:text-fg"
            >
              Runs
            </Link>
            <Button size="sm" onClick={() => void refresh()} disabled={loading || refreshing}>
              {refreshing ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      {loading ? (
        <p className="text-body text-fg-muted italic">Loading convoy.</p>
      ) : state.kind === 'not_found' ? (
        <p className="text-body text-fg-muted" role="status">
          No bead with id <span className="tnum">{rootBeadId}</span> was found. The convoy may have
          been pruned, or the id is wrong.
        </p>
      ) : state.kind === 'failed' ? (
        <p className="text-body text-accent" role="alert">
          {state.error}
        </p>
      ) : ready && view ? (
        <>
          {ready.load.partial && (
            <PartialDataNotice
              glyph="◐"
              label="Partial convoy: the city bead read was truncated, so some steps may be missing."
              title="Raise the fetch window if steps sit past the bounded read."
            />
          )}
          <ConvoyMetadata view={view} />
          <ConvoyTimeline exposure={view.exposure} />
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

function convoySynopsis(view: ConvoyView): string {
  const progress = view.progress;
  const progressPart =
    progress === null
      ? 'No step progress available'
      : `${progress.closed} of ${progress.total} steps closed`;
  return `${view.root.title}. ${progressPart}.`;
}

function ConvoyMetadata({ view }: { view: ConvoyView }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 mb-8">
      <FormulaMeta view={view} />
      <Meta label="Root" value={view.rootBeadId} />
      <Meta label="Status" value={view.root.status} />
      <Meta label="Session" value={view.sessionName ?? 'not live'} />
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
  'name inferred from bead title; supervisor did not set gc.formula on this graph.v2 root';

/**
 * Formula identity cell with provenance. Mirrors FormulaRunDetail's FormulaMeta
 * (gascity-dashboard-e7hj): a title-fallback name is surfaced in a warn tone
 * with a textual correlate per DESIGN.md "states have words", never passed off
 * as canonical metadata.
 */
function FormulaMeta({ view }: { view: ConvoyView }) {
  if (view.formulaName === null) {
    return <Meta label="Formula" value="metadata missing" />;
  }
  if (view.formulaNameProvenance === 'title_fallback') {
    return (
      <div>
        <dt className="text-label uppercase tracking-wider text-fg-faint">Formula</dt>
        <dd
          className="text-body text-warn break-all tnum"
          title={TITLE_FALLBACK_TOOLTIP}
          aria-label={`${view.formulaName} (${TITLE_FALLBACK_TOOLTIP})`}
        >
          {view.formulaName}
          <span className="ml-2 text-label uppercase tracking-wider text-warn">
            inferred from bead title
          </span>
        </dd>
      </div>
    );
  }
  return <Meta label="Formula" value={view.formulaName} />;
}

function ConvoyTimeline({ exposure }: { exposure: ConvoyStepExposure }) {
  if (exposure.kind === 'collapsed') {
    return (
      <p className="text-body text-fg-muted" role="status">
        {exposure.reason === 'graph_v2_root_only'
          ? 'The supervisor does not expose this run’s step graph (graph.v2 collapses run snapshots to the root bead), so the step timeline is unavailable. Tracked by gascity-dashboard-jl3c.'
          : 'No steps sit below this bead.'}
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {exposure.steps.map((step) => (
        <StepRow key={step.bead.id} step={step} />
      ))}
    </ol>
  );
}

function StepRow({ step }: { step: ConvoyStep }) {
  const status = describeStatus(step.bead.status);
  return (
    <li className="border-b border-rule pb-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          to={`/convoy/${encodeURIComponent(step.bead.id)}`}
          className="focus-mark text-body text-fg hover:text-accent leading-snug min-w-0 break-words"
        >
          {step.bead.title}
        </Link>
        <span className="text-label uppercase tracking-wider text-fg-muted shrink-0">
          <span aria-hidden="true">{status.glyph}</span> {status.word}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-label uppercase tracking-wider text-fg-faint">
        <span className="tnum">{step.bead.id}</span>
        {step.stepRef !== null && <span>step {step.stepRef}</span>}
        {step.blockedBy.length > 0 && <span>waiting on {step.blockedBy.join(', ')}</span>}
      </div>
    </li>
  );
}

interface StatusDisplay {
  glyph: string;
  word: string;
}

// Bead-status glyph + word, kept greyscale-neutral so the timeline honors the
// One Mark Rule: a list of many steps must not paint several maroons. Status is
// carried by the glyph and word, not tone (DESIGN.md "states have words").
function describeStatus(status: BeadStatus): StatusDisplay {
  switch (status) {
    case 'closed':
      return { glyph: '✓', word: 'closed' };
    case 'in_progress':
      return { glyph: '●', word: 'in progress' };
    case 'blocked':
      return { glyph: '!', word: 'blocked' };
    case 'deferred':
      return { glyph: '∅', word: 'deferred' };
    case 'open':
      return { glyph: '·', word: 'open' };
    default:
      return { glyph: '·', word: status };
  }
}
