import type { RunLane, RunSummary, SourceState } from "gas-city-dashboard-shared";
import type { AttentionSeverity } from "../../attention/compose";
import { LaneCard } from "./LaneCard";

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
  attentionSeverity?: (lane: RunLane) => AttentionSeverity | null;
}

const COUNT_LABELS: Array<[keyof RunSummary["runCounts"], string]> = [
  ["prReview", "PR"],
  ["designReview", "Design"],
  ["bugfix", "Bugfix"],
  ["other", "Other"],
];

const HISTORICAL_SECTION_ID = 'runs-historical-section';

export function RunMap({
  source,
  now,
  showHistory,
  attentionSeverity,
}: RunMapProps) {
  if (source.status === "error") {
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
  attentionSeverity?: (lane: RunLane) => AttentionSeverity | null;
}) {
  if (summary.lanes.length === 0) {
    // Distinguish "nothing at all" from "nothing active but N completed".
    const trailer =
      summary.totalHistorical > 0
        ? ` (${summary.totalHistorical} completed.)`
        : '';
    return (
      <p className="mt-8 text-body text-fg-muted italic">
        {`No active formula runs.${trailer}`}
      </p>
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
          <h3 className="text-label uppercase tracking-wider text-fg-faint">
            {rigLabel(rig)}
          </h3>
          <ol className="mt-3 divide-y divide-rule">
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

/** Group lanes by their run-root rig, preserving first-seen (pre-sorted)
 *  order so the most-recently-active rig surfaces first. */
function groupLanesByRig(
  lanes: readonly RunLane[],
): Array<{ rig: string; lanes: RunLane[] }> {
  const order: string[] = [];
  const byRig = new Map<string, RunLane[]>();
  for (const lane of lanes) {
    const rig =
      lane.scope.status === 'available' ? lane.scope.rootStoreRef : 'unknown';
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
  if (rig === 'unknown') return 'unknown rig';
  return rig.replace(/^rig:/, '');
}

function HistoricalSection({
  summary,
  now,
  attentionSeverity,
}: {
  summary: RunSummary;
  now: number;
  attentionSeverity?: (lane: RunLane) => AttentionSeverity | null;
}) {
  return (
    <section
      id={HISTORICAL_SECTION_ID}
      aria-label="Historical runs"
      className="mt-12"
    >
      <h2 className="text-label uppercase tracking-wider text-fg-faint">
        Historical
      </h2>
      {summary.historicalLanes.length === 0 ? (
        <p className="mt-3 text-body text-fg-muted italic">
          No completed runs in the current window.
        </p>
      ) : (
        <>
          <ol className="mt-3 divide-y divide-rule">
            {summary.historicalLanes.map((lane) => (
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
          {summary.totalHistorical > summary.historicalLanes.length && (
            <p className="mt-3 text-label uppercase tracking-wider text-fg-faint tnum">
              {summary.totalHistorical - summary.historicalLanes.length} more not shown
            </p>
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
          <CountTile
            key={key}
            label={label}
            value={summary?.runCounts[key] ?? 0}
            tone="muted"
          />
        ))}
        {blocked > 0 && (
          <CountTile label="Blocked" value={blocked} tone="accent" />
        )}
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
  tone: "strong" | "muted" | "accent";
}) {
  // tnum + tracked-uppercase label per the column-head register elsewhere on
  // the page; value sits below in body weight. No box around either.
  const valueTone =
    tone === "strong"
      ? "text-fg"
      : tone === "accent"
        ? "text-accent"
        : "text-fg-muted";
  return (
    <div className="flex flex-col">
      <span className="text-label uppercase tracking-wider text-fg-faint">
        {label}
      </span>
      <span className={`text-title tnum ${valueTone}`}>{value}</span>
    </div>
  );
}

export const RUNS_HISTORICAL_SECTION_ID = HISTORICAL_SECTION_ID;
