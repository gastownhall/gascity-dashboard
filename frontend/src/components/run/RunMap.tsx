import { useState } from 'react';
import type { RunLane, RunSummary, SourceState } from 'gas-city-dashboard-shared';
import type { BadgeSeverity } from '../../attention/compose';
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

interface RunMapProps {
  source: SourceState<RunSummary>;
  now: number;
  showHistory: boolean;
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
// How many completed runs show before the operator opts into the rest.
// The wire carries every historical lane (gascity-dashboard-l9q9); this
// preview keeps the section ambient by default per DESIGN.md.
const HISTORICAL_PREVIEW = 5;

export function RunMap({ source, now, showHistory, attentionSeverity }: RunMapProps) {
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

  return (
    <section>
      <CountsHeader summary={summary} />
      <ActiveSection
        summary={summary}
        now={now}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      <BlockedSection
        summary={summary}
        now={now}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
      {showHistory && (
        <HistoricalSection
          summary={summary}
          now={now}
          {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
        />
      )}
    </section>
  );
}

function ActiveSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
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
    // Distinguish "nothing at all" from "nothing active but N completed".
    const trailer = summary.totalHistorical > 0 ? ` (${summary.totalHistorical} completed.)` : '';
    return (
      <p className="mt-8 text-body text-fg-muted italic">{`No active formula runs.${trailer}`}</p>
    );
  }
  // gascity-dashboard-7hek: organize active lanes by rig (the run-root store).
  // A flat list of same-named molecule runs is indistinguishable; grouping
  // under the rig — a section head, no card, per the Flat Page Rule — gives
  // the operator the store context they navigate by. Within a group, lanes
  // keep their pre-sorted (recency/priority) order.
  const groups = groupLanesByRig(summary.lanes);
  return (
    <>
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
      {summary.totalActive > summary.lanes.length && (
        <p className="mt-3 text-label uppercase tracking-wider text-fg-faint tnum">
          {summary.totalActive - summary.lanes.length} more not shown
        </p>
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
  if (summary.blockedLanes.length === 0) return null;
  return (
    <section aria-label="Blocked runs" className="mt-12">
      <h2 className="text-label uppercase tracking-wider text-fg-faint">Blocked</h2>
      <LaneList
        lanes={summary.blockedLanes}
        now={now}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
      />
    </section>
  );
}

function HistoricalSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => BadgeSeverity | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const lanes = summary.historicalLanes;
  const shown = expanded ? lanes : lanes.slice(0, HISTORICAL_PREVIEW);

  return (
    <section id={HISTORICAL_SECTION_ID} aria-label="Historical runs" className="mt-12">
      <h2 className="text-label uppercase tracking-wider text-fg-faint">Historical</h2>
      {lanes.length === 0 ? (
        <p className="mt-3 text-body text-fg-muted italic">
          No completed runs in the current window.
        </p>
      ) : (
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
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls={HISTORICAL_LIST_ID}
              className="mt-3 text-label uppercase tracking-wider text-fg-faint tnum hover:text-fg focus-mark"
            >
              {expanded ? 'Show fewer' : `Show ${lanes.length - HISTORICAL_PREVIEW} more`}
            </button>
          )}
        </>
      )}
    </section>
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
  return (
    <header className="space-y-2">
      <div className="flex items-baseline gap-x-6 gap-y-2 flex-wrap">
        <CountTile label="Active" value={total} tone="strong" />
        {COUNT_LABELS.map(([key, label]) => (
          <CountTile key={key} label={label} value={summary?.runCounts[key] ?? 0} tone="muted" />
        ))}
        {blocked > 0 && <CountTile label="Blocked" value={blocked} tone="muted" />}
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
