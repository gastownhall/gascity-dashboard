import { useCallback, useEffect, useMemo, useState } from 'react';
import { GC_EVENT_PREFIX, type GcBead } from 'gas-city-dashboard-shared';
import { api, formatApiError } from '../api/client';
import { BeadBoardSection } from '../components/beads/BeadBoardSection';
import { BeadDetailModal } from '../components/BeadDetailModal';
import { Button } from '../components/Button';
import { FilterChips } from '../components/FilterChips';
import { ListSearchBar } from '../components/ListSearchBar';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { buildBeadGraph } from '../lib/beadGraph';
import { useCachedData } from '../hooks/useCachedData';
import { useGcEventRefresh } from '../hooks/useGcEvents';
import { useListFilters, type FilterChip } from '../hooks/useListFilters';
import { beadProject } from '../hooks/projectOf';

const EMPTY_IDS: ReadonlySet<string> = new Set();

// Sentinel for the rig dropdown's "all rigs" option. Empty string can't
// collide with a derived rig key (beadProject always returns a non-empty
// prefix), mirroring the Agents view's RIG_FILTER_ALL.
const RIG_FILTER_ALL = '';

const BEAD_CHIPS: ReadonlyArray<FilterChip<GcBead>> = [
  { id: 'open', label: 'open', match: (b) => b.status === 'open' },
  { id: 'in_progress', label: 'in progress', match: (b) => b.status === 'in_progress' },
  { id: 'blocked', label: 'blocked', match: (b) => b.status === 'blocked' },
  { id: 'closed', label: 'closed', match: (b) => b.status === 'closed' },
];

const BEAD_SEARCH_FIELDS = (b: GcBead): ReadonlyArray<string | undefined> => [
  b.id,
  b.title,
  b.assignee,
  ...(b.labels ?? []),
];

export function BeadsPage() {
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [rigFilter, setRigFilter] = useState<string>(RIG_FILTER_ALL);
  // #33: read the real-work-filtered feed (no showAll). The
  // default endpoint keeps every status (it filters by type/label, not
  // status), so the kanban's in-progress / blocked / done columns stay
  // populated, while bookkeeping beads (slack/nudge/mail/session/convoy) are
  // excluded. This keeps the ready column/count mirroring the supervisor's
  // "Ready to Work" instead of inflating it with synthetic beads.
  const { data, loading, error, refresh } = useCachedData(
    'beads:all',
    () => api.listBeads(),
  );
  const rows = useMemo(() => data?.items ?? [], [data]);
  const totalShown = data?.total ?? 0;
  const upstreamTotal = data?.upstream_total;
  const upstreamFetched = data?.upstream_fetched;
  const fetchLimit = data?.fetch_limit;

  const [closing, setClosing] = useState<GcBead | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [actionInFlight, setActionInFlight] = useState<{ id: string; action: string } | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sessions back the board's bead -> live-run resolution.
  const sessions = useCachedData('sessions', () => api.listSessions());
  const sessionItems = useMemo(
    () => sessions.data?.items ?? [],
    [sessions.data],
  );

  // Rig options for the dropdown: every rig present in the fetched beads,
  // keyed by the same beadProject derivation the board groups on, sorted
  // alphabetically. Keeping the key identical to the group key means the
  // selection maps 1:1 onto a rendered section.
  const rigOptions = useMemo(
    () => Array.from(new Set(rows.map(beadProject))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  // If the selected rig leaves the feed (e.g. its last bead closed and was
  // dropped on a refresh), the controlled <select> would keep filtering
  // against a rig with no rows and strand the board empty with no visible
  // cause. Reset to "all rigs" when the selection is no longer present.
  useEffect(() => {
    if (rigFilter !== RIG_FILTER_ALL && !rigOptions.includes(rigFilter)) {
      setRigFilter(RIG_FILTER_ALL);
    }
  }, [rigOptions, rigFilter]);

  const filteredRows = useMemo(() => {
    let rs = rows;
    if (rigFilter !== RIG_FILTER_ALL) {
      rs = rs.filter((r) => beadProject(r) === rigFilter);
    }
    if (labelFilter !== null) {
      rs = rs.filter((r) => Array.isArray(r.labels) && r.labels.includes(labelFilter));
    }
    return rs;
  }, [rows, rigFilter, labelFilter]);

  const filters = useListFilters<GcBead>({
    viewKey: 'beads',
    rows: filteredRows,
    projectOf: beadProject,
    searchOf: BEAD_SEARCH_FIELDS,
    chips: BEAD_CHIPS,
  });

  useGcEventRefresh([GC_EVENT_PREFIX.bead], () => void refresh());

  // The board operates on the search/chip/label-filtered set, flattened
  // across project groups. The dependency graph (columns + needs/blocks
  // edges) is rebuilt from that set; edges pointing outside it render
  // unresolved rather than fabricated.
  const matched = useMemo(
    () => filters.groups.flatMap((g) => g.rows),
    [filters.groups],
  );
  const graph = useMemo(() => buildBeadGraph(matched), [matched]);
  // Bead ids per rig group, so each rig section renders its own slice of the
  // single shared graph (cross-rig edges stay resolved).
  const groupIds = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const g of filters.groups) {
      map.set(g.projectKey, new Set(g.rows.map((r) => r.id)));
    }
    return map;
  }, [filters.groups]);
  const selectedBead = useMemo(
    () => matched.find((b) => b.id === selectedId) ?? null,
    [matched, selectedId],
  );
  // Resolved graph node for the open bead, so the detail pop-out can render
  // its needs/blocks tree. Null when the bead is outside the current window
  // (e.g. a re-centred related bead): the modal still shows the body, just
  // without dependencies.
  const selectedNode = useMemo(
    () => (selectedId !== null ? graph.nodes.get(selectedId) ?? null : null),
    [graph, selectedId],
  );

  const runAction = useCallback(
    async (
      bead: GcBead,
      action: 'claim' | 'close' | 'nudge',
      reason?: string,
    ): Promise<void> => {
      setActionInFlight({ id: bead.id, action });
      setActionResult(null);
      try {
        if (action === 'claim') await api.claimBead(bead.id);
        else if (action === 'close') await api.closeBead(bead.id, reason);
        else await api.nudgeBead(bead.id);
        setActionResult(`${action} ${bead.id}: ok`);
        await refresh();
      } catch (err) {
        setActionResult(`${action} ${bead.id}: ${formatApiError(err, 'action failed')}`);
      } finally {
        setActionInFlight(null);
      }
    },
    [refresh],
  );

  const synopsis = useMemo(
    () => buildSynopsis(filteredRows, totalShown, labelFilter),
    [filteredRows, totalShown, labelFilter],
  );

  const isTruncated =
    typeof upstreamTotal === 'number' &&
    typeof upstreamFetched === 'number' &&
    upstreamFetched < upstreamTotal;

  return (
    <section>
      <PageHeader
        title="Beads"
        synopsis={synopsis}
        meta={
          <>
            {error && (
              <span className="normal-case text-body text-accent" role="alert">
                {error}
              </span>
            )}
            <span className="text-label uppercase tracking-wider text-fg-faint">
              All statuses
            </span>
            <Button size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      <div className="space-y-2 mb-6 text-body text-fg-muted max-w-prose">
        {isTruncated && (
          <p className="text-warn">
            <StatusBadge
              tone="warn"
              label={`Fetch window covered ${upstreamFetched} of ${upstreamTotal} store beads. Raise the limit (currently ${fetchLimit ?? '?'}) if engineering work sits past the window.`}
            />
          </p>
        )}
        {labelFilter !== null && (
          <p>
            Filtering by label <span className="text-accent">{labelFilter}</span>.{' '}
            <button
              type="button"
              onClick={() => setLabelFilter(null)}
              className="text-fg-muted hover:text-fg focus-mark underline decoration-dotted underline-offset-2 rounded-sm"
            >
              Clear
            </button>
          </p>
        )}
        {actionResult && <p className="italic">{actionResult}</p>}
      </div>

      <div className="mb-6 space-y-3">
        <ListSearchBar
          value={filters.search}
          onChange={filters.setSearch}
          placeholder="Search beads by id, title, label, assignee"
          matchCount={filters.totalMatches}
          totalCount={filteredRows.length}
          ariaLabel="Search beads"
        />
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <FilterChips
            chips={BEAD_CHIPS}
            activeIds={filters.activeChipIds}
            onToggle={filters.toggleChip}
            legend="Status"
          />
          {rigOptions.length > 1 && (
            <label className="flex items-baseline gap-2 text-label">
              <span className="uppercase tracking-wider text-fg-muted">Rig</span>
              <select
                value={rigFilter}
                onChange={(e) => setRigFilter(e.target.value)}
                aria-label="Filter by rig"
                className="text-label uppercase tracking-wider text-fg-muted bg-transparent border-0 focus-mark cursor-pointer hover:text-fg transition-colors duration-150 ease-out-quart"
              >
                <option value={RIG_FILTER_ALL}>all rigs</option>
                {rigOptions.map((rig) => (
                  <option key={rig} value={rig}>
                    {rig}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {matched.length === 0 ? (
        <p className="text-body text-fg-muted italic">
          {filters.search.length > 0 || filters.activeChipIds.size > 0
            ? 'No beads match the current search or filter.'
            : labelFilter !== null
              ? `No beads match label "${labelFilter}".`
              : 'Nothing on the queue right now.'}
        </p>
      ) : (
        <div className="space-y-12">
          {filters.groups.map((g) => (
            <BeadBoardSection
              key={g.projectKey}
              label={g.project}
              count={g.totalInProject}
              graph={graph}
              ids={groupIds.get(g.projectKey) ?? EMPTY_IDS}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}

      <BeadDetailModal
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        beadId={selectedId}
        initialBead={selectedBead}
        depNode={selectedNode}
        sessions={sessionItems}
        onOpenBead={setSelectedId}
      />

      <Modal
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={closing ? `Close ${closing.id}` : 'Close bead'}
        caption={closing?.title}
        widthClass="max-w-lg"
        footer={
          <>
            <Button tone="quiet" size="sm" onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button
              tone="accent"
              size="sm"
              disabled={actionInFlight !== null}
              onClick={() => {
                if (!closing) return;
                const c = closing;
                setClosing(null);
                void runAction(c, 'close', closeReason.trim() || undefined);
              }}
            >
              {actionInFlight?.action === 'close' ? 'Closing' : 'Close bead'}
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="text-label uppercase tracking-wider text-fg-muted">
            Reason (optional)
          </span>
          <textarea
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
            placeholder="What was resolved, and how."
            rows={5}
            className="mt-2 w-full bg-surface-tint border border-rule rounded-sm px-3 py-2 text-body text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 resize-y"
          />
        </label>
      </Modal>
    </section>
  );
}

function buildSynopsis(filtered: ReadonlyArray<GcBead>, totalShown: number, labelFilter: string | null): string {
  if (labelFilter !== null) {
    return `${filtered.length} matching "${labelFilter}".`;
  }
  const open = filtered.filter((b) => b.status === 'open').length;
  const inProgress = filtered.filter((b) => b.status === 'in_progress').length;
  const blocked = filtered.filter((b) => b.status === 'blocked').length;
  const parts: string[] = [];
  if (open > 0) parts.push(`${open} open`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (parts.length === 0) return 'Nothing on the queue.';
  let s = parts.join(', ') + '.';
  if (totalShown > filtered.length) s += ` Showing ${filtered.length} of ${totalShown}.`;
  return s;
}
