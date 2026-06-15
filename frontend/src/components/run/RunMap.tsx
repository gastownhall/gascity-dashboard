import { useState } from 'react';
import {
  MAX_VISIBLE_ACTIVE_LANES,
  selectBlockedRuns,
  selectStrandedRuns,
  type RunHistory,
  type RunLane,
  type RunSummary,
  type SourceState,
} from 'gas-city-dashboard-shared';
import type { BadgeSeverity } from '../../attention/compose';
import { PartialDataNotice } from '../PartialDataNotice';
import { LaneCard } from './LaneCard';

// Run phase-lane map (gascity-dashboard-0t6). Renders the snapshot's
// runs source as a typographic block list — count summary up top,
// hairline-separated lanes below. No card chrome anywhere; hierarchy is
// carried by space, weight, and tracked-uppercase column heads, matching
// the Flat Page Rule and Greyscale Test in DESIGN.md.
//
// gascity-dashboard-yh5i: the active/historical split is rendered as two
// optional sections. Active lanes always show; historical lanes show only
// when `showHistory` is true (controlled by ?history=1 in the URL,
// threaded down from /runs). The historical section is labeled and
// hairlined to keep the typographic register continuous with active.
//
// Header-first restructure: the historical section renders from its OWN lazy
// source (`history`, loaded on toggle by runs/runHistory) instead of fields on
// the run summary, with its own loading/unavailable/partial states — so the
// default summary refresh never pays the closed-history fan-out.

interface RunMapProps {
  source: SourceState<RunSummary>;
  now: number;
  showHistory: boolean;
  /** The lazy history payload; undefined until the first history read lands. */
  history?: SourceState<RunHistory> | undefined;
  /** True while a history read is in flight (loading or refreshing). */
  historyLoading?: boolean;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}

const COUNT_LABELS: Array<[keyof RunSummary['runCounts'], string]> = [
  ['prReview', 'PR'],
  ['designReview', 'Design'],
  ['bugfix', 'Bugfix'],
  ['other', 'Other'],
];

const HISTORICAL_SECTION_ID = 'runs-historical-section';
const HISTORICAL_LIST_ID = 'runs-historical-list';
const ACTIVE_LIST_ID = 'runs-active-list';
// How many completed runs show before the operator opts into the rest.
// The wire carries up to MAX_HISTORICAL_LANES most-recent historical lanes
// (gascity-dashboard-l9q9, recency-bounded in gascity-dashboard-9w3k); this
// preview keeps the section ambient by default per DESIGN.md.
const HISTORICAL_PREVIEW = 5;

export function RunMap({
  source,
  now,
  showHistory,
  history,
  historyLoading = false,
  attentionSeverity,
}: RunMapProps) {
  if (source.status === 'error') {
    return (
      <section>
        <CountsHeader summary={null} />
        <p className="mt-8 text-body text-fg-muted italic">
          {`Run data unavailable: ${source.error}.`}
        </p>
      </section>
    );
  }

  const summary = source.data;
  // Reconcile the lazy history payload against the live summary before it feeds
  // either the count hint or the Historical section (see reconcileHistory): the
  // two sources refresh on independent clocks, so a completed run that has since
  // reactivated must render and count in the live Active/Blocked set only.
  const reconciledHistory: SourceState<RunHistory> | undefined =
    history !== undefined && history.status !== 'error'
      ? { ...history, data: reconcileHistory(history.data, summary) }
      : history;
  // The "(N completed.)" hint on the active empty state needs the lazy history
  // payload; before it loads the count is honestly unknown, so the hint is
  // omitted rather than rendered as a fabricated zero.
  const completedCount =
    reconciledHistory !== undefined && reconciledHistory.status !== 'error'
      ? reconciledHistory.data.totalHistorical
      : null;

  return (
    <section>
      <CountsHeader summary={summary} />
      <ActiveSection
        summary={summary}
        now={now}
        completedCount={completedCount}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      <BlockedSection
        summary={summary}
        now={now}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      <StrandedSection
        summary={summary}
        now={now}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      {showHistory && (
        <HistoricalSection
          history={reconciledHistory}
          historyLoading={historyLoading}
          now={now}
          {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
        />
      )}
    </section>
  );
}

/**
 * Reconcile the lazy history payload against the live summary at the render
 * boundary. History (loaded on open / explicit Refresh) and the active+blocked
 * summary (refreshed on every SSE burst) run on independent clocks, so a run
 * that was `complete` when history last loaded can reactivate into the live set
 * before history is refreshed. Drop any history lane whose run is now live and
 * subtract those from `totalHistorical`, so the live set wins and a single run
 * is never rendered or counted in both regions.
 *
 * Only the rendered (MAX_HISTORICAL_LANES-capped) lanes can be reconciled here;
 * a reactivation of a run beyond that window is invisible at the render
 * boundary. The operator-facing double-render — a run live in Active while still
 * listed under Historical — is what this restores, holding the invariant the
 * pre-split single summary maintained continuously.
 */
function reconcileHistory(history: RunHistory, summary: RunSummary): RunHistory {
  if (
    summary.lanes.length === 0 &&
    summary.blockedLanes.length === 0 &&
    summary.strandedLanes.length === 0
  ) {
    return history;
  }
  const liveIds = new Set<string>();
  for (const lane of summary.lanes) liveIds.add(lane.id);
  for (const lane of summary.blockedLanes) liveIds.add(lane.id);
  for (const lane of summary.strandedLanes) liveIds.add(lane.id);
  const lanes = history.lanes.filter((lane) => !liveIds.has(lane.id));
  if (lanes.length === history.lanes.length) return history;
  return {
    ...history,
    lanes,
    totalHistorical: history.totalHistorical - (history.lanes.length - lanes.length),
  };
}

function ActiveSection({
  summary,
  now,
  completedCount,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  /** totalHistorical from the lazy history payload, or null before it loads. */
  completedCount: number | null;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  // gascity-dashboard: `lanes` now carries the FULL active set; the collapsed
  // window (MAX_VISIBLE_ACTIVE_LANES) and its "Show N more runs" expander live
  // here, mirroring HistoricalSection. Collapsed by default keeps the calm
  // density; expansion is opt-in. The hook precedes the empty-state early
  // returns so hook order stays stable across renders.
  const [expanded, setExpanded] = useState(false);

  if (summary.lanes.length === 0) {
    // gascity-dashboard-4xcv: a partial fetch with zero lanes is "we could
    // not see the runs", not "there are no runs". Never present a degraded
    // read as an empty store; say so in words instead.
    if (summary.lanesPartial === true) {
      return (
        <p className="mt-8 text-body text-fg-muted italic">
          Run sources were partially unavailable; the lane set may be incomplete.
        </p>
      );
    }
    // Distinguish "nothing at all" from "nothing active but N completed". The
    // count comes from the lazy history payload, so the hint appears only once
    // history has loaded (header-first: the default read cannot know it).
    const trailer =
      completedCount !== null && completedCount > 0 ? ` (${completedCount} completed.)` : '';
    return (
      <p className="mt-8 text-body text-fg-muted italic">{`No active formula runs.${trailer}`}</p>
    );
  }
  const shown = expanded ? summary.lanes : summary.lanes.slice(0, MAX_VISIBLE_ACTIVE_LANES);
  // gascity-dashboard-7hek: organize active lanes by rig (the run-root store).
  // A flat list of same-named molecule runs is indistinguishable; grouping
  // under the rig — a section head, no card, per the Flat Page Rule — gives
  // the operator the store context they navigate by. Within a group, lanes
  // keep their pre-sorted (recency/priority) order.
  const groups = groupLanesByRig(shown);
  return (
    <>
      <div id={ACTIVE_LIST_ID}>
        {groups.map(({ rig, lanes }) => (
          <div key={rig} className="mt-6">
            <h3 className="text-label uppercase tracking-wider text-fg-faint">{rigLabel(rig)}</h3>
            <LaneList
              lanes={lanes}
              now={now}
              {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
            />
          </div>
        ))}
      </div>
      {summary.lanes.length > MAX_VISIBLE_ACTIVE_LANES && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={ACTIVE_LIST_ID}
          className="mt-3 text-label uppercase tracking-wider text-fg-faint tnum hover:text-fg focus-mark"
        >
          {expanded
            ? 'Show fewer'
            : `Show ${summary.lanes.length - MAX_VISIBLE_ACTIVE_LANES} more runs`}
        </button>
      )}
    </>
  );
}

/** The hairline-separated lane list shared by the active rig groups, the
 *  Blocked section, and the Historical section. */
function LaneList({
  lanes,
  now,
  attentionSeverity,
  listId,
}: {
  lanes: readonly RunLane[];
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
  listId?: string;
}) {
  return (
    <ol {...(listId === undefined ? {} : { id: listId })} className="mt-3 divide-y divide-rule">
      {lanes.map((lane) => (
        <LaneCard
          key={lane.id}
          lane={lane}
          now={now}
          {...(attentionSeverity === undefined
            ? {}
            : { attentionSeverity: attentionSeverity(lane) })}
        />
      ))}
    </ol>
  );
}

/** Group lanes by their run-root rig, preserving first-seen (pre-sorted)
 *  order so the most-recently-active rig surfaces first.
 *
 *  gascity-dashboard-4xcv: non-rig lanes group under 'city'. A city-scoped
 *  run (control-dispatcher work) is not an "unknown rig" — and a lane whose
 *  scope metadata is unavailable still came from the city's bead store, so
 *  the city group is the honest default. */
function groupLanesByRig(lanes: readonly RunLane[]): Array<{ rig: string; lanes: RunLane[] }> {
  const order: string[] = [];
  const byRig = new Map<string, RunLane[]>();
  for (const lane of lanes) {
    const rig =
      lane.scope.status === 'available' && lane.scope.kind === 'rig'
        ? lane.scope.rootStoreRef
        : 'city';
    let bucket = byRig.get(rig);
    if (bucket === undefined) {
      bucket = [];
      byRig.set(rig, bucket);
      order.push(rig);
    }
    bucket.push(lane);
  }
  return order.map((rig) => ({ rig, lanes: byRig.get(rig) as RunLane[] }));
}

function rigLabel(rig: string): string {
  return rig.replace(/^rig:/, '');
}

/** Blocked runs (gascity-dashboard-4xcv). A blocked lane needs the operator,
 *  so it stays on the page — but in its own labeled section, never mixed
 *  into (or counted with) the Active set. Hidden entirely when nothing is
 *  blocked: the calm room does not announce the absence of trouble. */
function BlockedSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  // gascity-dashboard-2j8e.2: selectBlockedRuns is the SAME selector the nav
  // badge counts, so the header count here and the badge number are one number.
  // Each row carries why-blocked + how-to-unblock (LaneCard `blocked`), so the
  // destination is a path to action, not just a list. Rendered inline rather
  // than through the shared LaneList so that generic list stays blocked-unaware.
  const detailById = new Map(selectBlockedRuns(summary.blockedLanes).map((run) => [run.id, run]));
  if (detailById.size === 0) return null;
  return (
    <section aria-label="Blocked runs" className="mt-12">
      <h2 className="text-label uppercase tracking-wider text-fg-faint tnum">
        Blocked ({detailById.size})
      </h2>
      <ol className="mt-3 divide-y divide-rule">
        {summary.blockedLanes.map((lane) => {
          const detail = detailById.get(lane.id);
          return (
            <LaneCard
              key={lane.id}
              lane={lane}
              now={now}
              {...(attentionSeverity === undefined
                ? {}
                : { attentionSeverity: attentionSeverity(lane) })}
              {...(detail === undefined ? {} : { blocked: detail })}
            />
          );
        })}
      </ol>
    </section>
  );
}

/** Stranded runs (gascity-dashboard-pxvb). An orphaned molecule that never
 *  executed and never will — partitioned out of Active alongside Blocked so it
 *  stops reading as live work, but kept on the page in its own labeled section
 *  because it is the state most needing an operator action (clean up /
 *  re-dispatch). Hidden entirely when nothing is stranded: the calm room does
 *  not announce the absence of trouble. Mirrors BlockedSection. */
function StrandedSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  // gascity-dashboard-pxvb: selectStrandedRuns is the SAME selector the nav
  // badge counts, so the header count here and the badge number are one number.
  // Each row carries why-stranded + how-to-resolve (LaneCard `stranded`), so the
  // destination is a path to action, not just a list.
  const detailById = new Map(selectStrandedRuns(summary.strandedLanes).map((run) => [run.id, run]));
  if (detailById.size === 0) return null;
  return (
    <section aria-label="Stranded runs" className="mt-12">
      <h2 className="text-label uppercase tracking-wider text-fg-faint tnum">
        Stranded ({detailById.size})
      </h2>
      <ol className="mt-3 divide-y divide-rule">
        {summary.strandedLanes.map((lane) => {
          const detail = detailById.get(lane.id);
          return (
            <LaneCard
              key={lane.id}
              lane={lane}
              now={now}
              {...(attentionSeverity === undefined
                ? {}
                : { attentionSeverity: attentionSeverity(lane) })}
              {...(detail === undefined ? {} : { stranded: detail })}
            />
          );
        })}
      </ol>
    </section>
  );
}

// Header-first: the historical section renders from the lazy history source,
// with explicit loading / unavailable / partial states of its own. The summary's
// lanesPartial never speaks for history, and vice versa — each signal flags only
// its own fan-out (honest-partial rule, gascity-dashboard-n6f1).
function HistoricalSection({
  history,
  historyLoading,
  now,
  attentionSeverity,
}: {
  history: SourceState<RunHistory> | undefined;
  historyLoading: boolean;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section id={HISTORICAL_SECTION_ID} aria-label="Historical runs" className="mt-12">
      <h2 className="text-label uppercase tracking-wider text-fg-faint">
        Historical
        {/* One mark per region (DESIGN.md): partial and stale are mutually
            exclusive cues. Stale (a failed refresh re-publishing the last-good
            set) outranks partial here — it is the more urgent "this is behind,
            press Refresh" signal — so the partial notice yields when both
            apply, and the two never stack in the same header. */}
        {history !== undefined &&
          history.status !== 'error' &&
          history.status !== 'stale' &&
          history.data.lanesPartial && (
            <span className="ml-3 normal-case tracking-normal">
              <PartialDataNotice
                glyph="◐"
                label="history partial"
                title="one or more closed-history reads were unavailable; the completed set may be incomplete"
              />
            </span>
          )}
        {/* A failed explicit refresh AFTER a good load keeps serving the last
            good payload re-published as 'stale' (last-good retention in
            useRunHistory). Surface that as a glyph+word cue so stale completed
            lanes never read as a fresh load — the operator sees the refresh
            failed and can Refresh again rather than trusting silently-behind
            data. Honest-degradation rule (gascity-dashboard-n6f1); reopen
            reuses the cache, so this visible warning is what keeps the
            suppressed retry honest. */}
        {history !== undefined && history.status === 'stale' && (
          <span className="ml-3 normal-case tracking-normal">
            <PartialDataNotice
              glyph="◐"
              label="history stale"
              title="the last history refresh failed; showing the most recent completed runs that loaded (use Refresh to retry)"
            />
          </span>
        )}
      </h2>
      {history === undefined || (historyLoading && history.status === 'error') ? (
        <p className="mt-3 text-body text-fg-muted italic">Loading completed runs.</p>
      ) : history.status === 'error' ? (
        <p className="mt-3 text-body text-fg-muted italic">
          {`Completed runs unavailable: ${history.error}.`}
        </p>
      ) : (
        <HistoricalLanes
          history={history.data}
          now={now}
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
        />
      )}
    </section>
  );
}

function HistoricalLanes({
  history,
  now,
  expanded,
  onToggle,
  attentionSeverity,
}: {
  history: RunHistory;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  const lanes = history.lanes;
  const shown = expanded ? lanes : lanes.slice(0, HISTORICAL_PREVIEW);

  if (lanes.length === 0) {
    return (
      <p className="mt-3 text-body text-fg-muted italic">
        No completed runs in the current window.
      </p>
    );
  }

  return (
    <>
      <LaneList
        lanes={shown}
        now={now}
        listId={HISTORICAL_LIST_ID}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      {lanes.length > HISTORICAL_PREVIEW && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={HISTORICAL_LIST_ID}
          className="mt-3 text-label uppercase tracking-wider text-fg-faint tnum hover:text-fg focus-mark"
        >
          {expanded ? 'Show fewer' : `Show ${lanes.length - HISTORICAL_PREVIEW} more`}
        </button>
      )}
      {/* gascity-dashboard-9w3k: the wire caps history lanes at
          MAX_HISTORICAL_LANES while totalHistorical keeps the true count.
          Disclose the cap so the operator knows the rendered set is the
          recent window, not the whole history — mirroring the Active
          section's "N more not shown" note (same typographic register). */}
      {history.totalHistorical > lanes.length && (
        <p className="mt-3 text-label uppercase tracking-wider text-fg-faint tnum">
          Showing {lanes.length} most-recent of {history.totalHistorical}
        </p>
      )}
    </>
  );
}

function CountsHeader({ summary }: { summary: RunSummary | null }) {
  // yh5i: tile labeled "Active" (was "Runs") so the denominator is
  // self-describing — runCounts.total counts only active lanes after the
  // split. Sub-tiles (PR / Design / Bugfix / Other) break down the active
  // set by formula kind, matching the headline metric. Historical counts
  // surface via the toggle button in the page header, not here.
  const total = summary?.runCounts.total ?? 0;
  const blocked = summary?.runCounts.blocked ?? 0;
  const stranded = summary?.runCounts.stranded ?? 0;
  return (
    <header className="space-y-2">
      <div className="flex items-baseline gap-x-6 gap-y-2 flex-wrap">
        <CountTile label="Active" value={total} tone="strong" />
        {COUNT_LABELS.map(([key, label]) => (
          <CountTile key={key} label={label} value={summary?.runCounts[key] ?? 0} tone="muted" />
        ))}
        {blocked > 0 && <CountTile label="Blocked" value={blocked} tone="muted" />}
        {stranded > 0 && <CountTile label="Stranded" value={stranded} tone="muted" />}
      </div>
    </header>
  );
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'strong' | 'muted';
}) {
  // tnum + tracked-uppercase label per the column-head register elsewhere on
  // the page; value sits below in body weight. No box around either.
  const valueTone = tone === 'strong' ? 'text-fg' : 'text-fg-muted';
  return (
    <div className="flex flex-col">
      <span className="text-label uppercase tracking-wider text-fg-faint">{label}</span>
      <span className={`text-title tnum ${valueTone}`}>{value}</span>
    </div>
  );
}

export const RUNS_HISTORICAL_SECTION_ID = HISTORICAL_SECTION_ID;
