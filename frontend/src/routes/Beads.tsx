import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GC_EVENT_PREFIX } from 'gas-city-dashboard-shared';
import { formatApiError } from '../api/client';
import { useAttentionModel } from '../attention/context';
import { resourceAttentionSeverity } from '../attention/routeHighlight';
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
import { listSupervisorAgents } from '../supervisor/agentReads';
import {
  listSupervisorBeads,
  type SupervisorBead,
} from '../supervisor/beadReads';
import {
  claimSupervisorBead,
  closeSupervisorBead,
  createAndSlingSupervisorBead,
  nudgeSupervisorAgent,
} from '../supervisor/beadWrites';
import { listSupervisorSessions } from '../supervisor/sessionReads';

const EMPTY_IDS: ReadonlySet<string> = new Set();
const RIG_FILTER_ALL = '';

type BeadAction = 'claim' | 'close' | 'nudge';

interface ActionMessage {
  tone: 'ok' | 'error';
  text: string;
}

const isNonEmptyString = (value: string | undefined | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const BEAD_CHIPS: ReadonlyArray<FilterChip<SupervisorBead>> = [
  { id: 'open', label: 'open', match: (b) => b.status === 'open' },
  { id: 'in_progress', label: 'in progress', match: (b) => b.status === 'in_progress' },
  { id: 'blocked', label: 'blocked', match: (b) => b.status === 'blocked' },
  { id: 'closed', label: 'closed', match: (b) => b.status === 'closed' },
];

const BEAD_SEARCH_FIELDS = (b: SupervisorBead): ReadonlyArray<string | undefined> => [
  b.id,
  b.title,
  b.assignee,
  ...(b.labels ?? []),
];

export function BeadsPage() {
  const attention = useAttentionModel();
  const [searchParams] = useSearchParams();
  const selectedBeadParam = normalizeSelectedBeadParam(searchParams.get('bead'));
  const [rigFilter, setRigFilter] = useState<string>(RIG_FILTER_ALL);
  const [selectedId, setSelectedId] = useState<string | null>(selectedBeadParam);
  const [closing, setClosing] = useState<SupervisorBead | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [actionInFlight, setActionInFlight] = useState<{
    id: string;
    action: BeadAction;
  } | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [creating, setCreating] = useState(false);
  const [createInFlight, setCreateInFlight] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newRig, setNewRig] = useState('');
  const [newAgent, setNewAgent] = useState('');

  const { data, loading, error, refresh } = useCachedData(
    `beads:board:${rigFilter}`,
    () => listSupervisorBeads({
      includeClosed: true,
      ...(rigFilter === RIG_FILTER_ALL ? {} : { rigFilter }),
    }),
  );
  const rows = useMemo(() => data?.items ?? [], [data]);
  const totalShown = data?.total ?? 0;
  const upstreamTotal = data?.upstream_total;
  const upstreamFetched = data?.upstream_fetched;
  const fetchLimit = data?.fetch_limit;

  const sessions = useCachedData('sessions', listSupervisorSessions);
  const sessionItems = useMemo(
    () => sessions.data?.items ?? [],
    [sessions.data],
  );
  const agents = useCachedData('agents', listSupervisorAgents);
  const agentItems = useMemo(
    () => agents.data?.items ?? [],
    [agents.data],
  );

  const dispatchRigOptions = useMemo(
    () => Array.from(
      new Set(agentItems.map((agent) => agent.rig).filter(isNonEmptyString)),
    ).sort((a, b) => a.localeCompare(b)),
    [agentItems],
  );
  const filteredDispatchAgents = useMemo(
    () => (
      newRig.length === 0
        ? agentItems
        : agentItems.filter((agent) => agent.rig === newRig)
    ),
    [agentItems, newRig],
  );

  useEffect(() => {
    if (!creating) return;
    if (filteredDispatchAgents.length === 0) {
      if (newAgent.length > 0) setNewAgent('');
      return;
    }
    if (!filteredDispatchAgents.some((agent) => agent.name === newAgent)) {
      setNewAgent(filteredDispatchAgents[0]?.name ?? '');
    }
  }, [creating, filteredDispatchAgents, newAgent]);

  useEffect(() => {
    if (rigFilter !== RIG_FILTER_ALL && !dispatchRigOptions.includes(rigFilter)) {
      setRigFilter(RIG_FILTER_ALL);
    }
  }, [dispatchRigOptions, rigFilter]);

  const filteredRows = rows;

  const filters = useListFilters<SupervisorBead>({
    viewKey: 'beads',
    rows: filteredRows,
    projectOf: beadProject,
    searchOf: BEAD_SEARCH_FIELDS,
    chips: BEAD_CHIPS,
  });

  useGcEventRefresh([GC_EVENT_PREFIX.bead], () => void refresh());

  useEffect(() => {
    if (selectedBeadParam !== null) setSelectedId(selectedBeadParam);
  }, [selectedBeadParam]);

  const runAction = useCallback(async (
    bead: SupervisorBead,
    action: BeadAction,
    reason?: string,
  ) => {
    setActionInFlight({ id: bead.id, action });
    setActionMessage(null);
    try {
      if (action === 'claim') {
        await claimSupervisorBead(bead.id);
        setActionMessage({ tone: 'ok', text: `Claimed ${bead.id}.` });
      } else if (action === 'close') {
        await closeSupervisorBead(bead.id, reason);
        setClosing(null);
        setCloseReason('');
        setActionMessage({ tone: 'ok', text: `Closed ${bead.id}.` });
      } else {
        const assignee = bead.assignee?.trim() ?? '';
        if (assignee.length === 0) {
          throw new Error('Assigned agent is required before nudging.');
        }
        await nudgeSupervisorAgent(assignee);
        setActionMessage({ tone: 'ok', text: `Nudged ${assignee}.` });
      }
      await refresh();
    } catch (err) {
      setActionMessage({ tone: 'error', text: formatApiError(err, `${action} failed`) });
    } finally {
      setActionInFlight(null);
    }
  }, [refresh]);

  const openCreateBead = useCallback(() => {
    const defaultRig = dispatchRigOptions[0] ?? '';
    const defaultAgent = agentItems.find((agent) =>
      defaultRig.length === 0 || agent.rig === defaultRig
    );
    setNewTitle('');
    setNewBody('');
    setNewRig(defaultRig);
    setNewAgent(defaultAgent?.name ?? '');
    setCreateError(null);
    setActionMessage(null);
    setCreating(true);
  }, [agentItems, dispatchRigOptions]);

  const handleDispatchRigChange = useCallback((rig: string) => {
    setNewRig(rig);
    const currentAgentStillVisible = agentItems.some((agent) =>
      agent.name === newAgent && (rig.length === 0 || agent.rig === rig)
    );
    if (!currentAgentStillVisible) {
      const defaultAgent = agentItems.find((agent) =>
        rig.length === 0 || agent.rig === rig
      );
      setNewAgent(defaultAgent?.name ?? '');
    }
  }, [agentItems, newAgent]);

  const createAndSling = useCallback(async () => {
    setCreateInFlight(true);
    setCreateError(null);
    try {
      const result = await createAndSlingSupervisorBead({
        title: newTitle,
        description: newBody,
        rig: newRig,
        target: newAgent,
      });
      setActionMessage({
        tone: 'ok',
        text: `Created ${result.bead.id} and slung to ${newAgent}.`,
      });
      setCreating(false);
      await refresh();
    } catch (err) {
      setCreateError(formatApiError(err, 'create and sling failed'));
    } finally {
      setCreateInFlight(false);
    }
  }, [newAgent, newBody, newRig, newTitle, refresh]);

  const matched = useMemo(
    () => filters.groups.flatMap((group) => group.rows),
    [filters.groups],
  );
  const graph = useMemo(() => buildBeadGraph(matched), [matched]);
  const groupIds = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const group of filters.groups) {
      map.set(group.projectKey, new Set(group.rows.map((row) => row.id)));
    }
    return map;
  }, [filters.groups]);
  const selectedBead = useMemo(
    () => matched.find((bead) => bead.id === selectedId) ?? null,
    [matched, selectedId],
  );
  const selectedNode = useMemo(
    () => (selectedId === null ? null : graph.nodes.get(selectedId) ?? null),
    [graph, selectedId],
  );
  const beadAttentionSeverity = useMemo(
    () => (beadId: string) => resourceAttentionSeverity(attention, 'beads', beadId),
    [attention],
  );

  const renderBeadActions = useCallback((bead: SupervisorBead) => {
    const assignee = bead.assignee?.trim() ?? '';
    const busy = actionInFlight !== null;
    const actionLabel = actionInFlight?.id === bead.id
      ? actionInFlight.action.replace('_', ' ')
      : null;

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actionLabel && (
          <span className="text-label uppercase tracking-wider text-fg-faint">
            {actionLabel}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          tone="quiet"
          disabled={busy || bead.status === 'in_progress' || bead.status === 'closed'}
          onClick={() => void runAction(bead, 'claim')}
        >
          Claim
        </Button>
        <Button
          type="button"
          size="sm"
          tone="quiet"
          disabled={busy || bead.status === 'closed'}
          onClick={() => {
            setCloseReason('');
            setActionMessage(null);
            setClosing(bead);
          }}
        >
          Close
        </Button>
        <Button
          type="button"
          size="sm"
          tone="quiet"
          disabled={busy || assignee.length === 0}
          onClick={() => void runAction(bead, 'nudge')}
        >
          Nudge
        </Button>
      </div>
    );
  }, [actionInFlight, runAction]);

  const synopsis = useMemo(
    () => buildSynopsis(filteredRows, totalShown, rigFilter),
    [filteredRows, totalShown, rigFilter],
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
            {sessions.error && (
              <span className="normal-case text-body text-accent" role="alert">
                {sessions.error}
              </span>
            )}
            {agents.error && (
              <span className="normal-case text-body text-accent" role="alert">
                {agents.error}
              </span>
            )}
            <span className="text-label uppercase tracking-wider text-fg-faint">
              All statuses
            </span>
            <Button
              type="button"
              size="sm"
              onClick={openCreateBead}
              disabled={agents.loading || agentItems.length === 0}
            >
              New bead
            </Button>
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
              label={`Fetch window covered ${upstreamFetched} of ${upstreamTotal} store beads. Raise the per-type limit (currently ${fetchLimit ?? '?'}) if engineering work sits past the window.`}
            />
          </p>
        )}
        {rigFilter !== RIG_FILTER_ALL && (
          <p>
            Filtering by rig <span className="text-accent">{rigFilter}</span>.{' '}
            <button
              type="button"
              onClick={() => setRigFilter(RIG_FILTER_ALL)}
              className="text-fg-muted hover:text-fg focus-mark underline decoration-dotted underline-offset-2 rounded-sm"
            >
              Clear
            </button>
          </p>
        )}
        {actionMessage && (
          <p
            className={actionMessage.tone === 'error' ? 'text-accent' : 'text-fg-muted'}
            role={actionMessage.tone === 'error' ? 'alert' : 'status'}
          >
            {actionMessage.text}
          </p>
        )}
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
          {dispatchRigOptions.length > 1 && (
            <label className="flex items-baseline gap-2 text-label">
              <span className="uppercase tracking-wider text-fg-muted">Rig</span>
              <select
                value={rigFilter}
                onChange={(event) => setRigFilter(event.target.value)}
                aria-label="Rig filter"
                className="text-label uppercase tracking-wider text-fg-muted bg-transparent border-0 focus-mark cursor-pointer hover:text-fg transition-colors duration-150 ease-out-quart"
              >
                <option value={RIG_FILTER_ALL}>all rigs</option>
                {dispatchRigOptions.map((rig) => (
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
            : 'Nothing on the queue right now.'}
        </p>
      ) : (
        <div className="space-y-12">
          {filters.groups.map((group) => (
            <BeadBoardSection
              key={group.projectKey}
              label={group.project}
              count={group.totalInProject}
              graph={graph}
              ids={groupIds.get(group.projectKey) ?? EMPTY_IDS}
              selectedId={selectedId}
              attentionSeverity={beadAttentionSeverity}
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
        renderActions={renderBeadActions}
      />

      <Modal
        open={closing !== null}
        onClose={() => {
          if (actionInFlight === null) {
            setClosing(null);
            setCloseReason('');
          }
        }}
        title={closing ? `Close ${closing.id}` : 'Close bead'}
        caption={closing?.title}
        widthClass="max-w-xl"
        footer={
          <>
            <Button
              type="button"
              size="sm"
              tone="quiet"
              disabled={actionInFlight !== null}
              onClick={() => {
                setClosing(null);
                setCloseReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              tone="accent"
              disabled={closing === null || actionInFlight !== null}
              onClick={() => {
                if (closing) void runAction(closing, 'close', closeReason);
              }}
            >
              Close bead
            </Button>
          </>
        }
      >
        <label className="block space-y-2 text-body">
          <span className="text-label uppercase tracking-wider text-fg-muted">
            Reason
          </span>
          <textarea
            value={closeReason}
            onChange={(event) => setCloseReason(event.target.value)}
            rows={4}
            placeholder="Optional close reason"
            className="w-full rounded-sm border border-rule bg-transparent px-3 py-2 text-body text-fg focus-mark"
          />
        </label>
      </Modal>

      <Modal
        open={creating}
        onClose={() => {
          if (!createInFlight) setCreating(false);
        }}
        title="New bead"
        caption="Create and sling"
        widthClass="max-w-2xl"
        footer={
          <>
            <Button
              type="button"
              size="sm"
              tone="quiet"
              disabled={createInFlight}
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-bead-form"
              size="sm"
              disabled={
                createInFlight ||
                newTitle.trim().length === 0 ||
                newAgent.trim().length === 0
              }
            >
              {createInFlight ? 'Creating' : 'Create and sling'}
            </Button>
          </>
        }
      >
        <form
          id="new-bead-form"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void createAndSling();
          }}
        >
          {createError && (
            <p className="text-accent" role="alert">
              {createError}
            </p>
          )}
          <label className="block space-y-2 text-body">
            <span className="text-label uppercase tracking-wider text-fg-muted">
              Title
            </span>
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              required
              className="w-full rounded-sm border border-rule bg-transparent px-3 py-2 text-body text-fg focus-mark"
            />
          </label>
          <label className="block space-y-2 text-body">
            <span className="text-label uppercase tracking-wider text-fg-muted">
              Body
            </span>
            <textarea
              value={newBody}
              onChange={(event) => setNewBody(event.target.value)}
              rows={5}
              className="w-full rounded-sm border border-rule bg-transparent px-3 py-2 text-body text-fg focus-mark"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-body">
              <span className="text-label uppercase tracking-wider text-fg-muted">
                Rig
              </span>
              <select
                value={newRig}
                onChange={(event) => handleDispatchRigChange(event.target.value)}
                className="w-full rounded-sm border border-rule bg-transparent px-3 py-2 text-body text-fg focus-mark"
              >
                {dispatchRigOptions.length === 0 && (
                  <option value="">all rigs</option>
                )}
                {dispatchRigOptions.map((rig) => (
                  <option key={rig} value={rig}>
                    {rig}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-2 text-body">
              <span className="text-label uppercase tracking-wider text-fg-muted">
                Agent
              </span>
              <select
                value={newAgent}
                onChange={(event) => setNewAgent(event.target.value)}
                required
                className="w-full rounded-sm border border-rule bg-transparent px-3 py-2 text-body text-fg focus-mark"
              >
                {filteredDispatchAgents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.display_name ?? agent.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </form>
      </Modal>
    </section>
  );
}

function normalizeSelectedBeadParam(value: string | null): string | null {
  const clean = value?.trim();
  return clean && clean.length > 0 ? clean : null;
}

function buildSynopsis(
  filtered: ReadonlyArray<SupervisorBead>,
  totalShown: number,
  rigFilter: string,
): string {
  if (rigFilter !== RIG_FILTER_ALL && filtered.length === 0) return `No beads on ${rigFilter}.`;
  const open = filtered.filter((bead) => bead.status === 'open').length;
  const inProgress = filtered.filter((bead) => bead.status === 'in_progress').length;
  const blocked = filtered.filter((bead) => bead.status === 'blocked').length;
  const parts: string[] = [];
  if (open > 0) parts.push(`${open} open`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (parts.length === 0) return 'Nothing on the queue.';
  let summary = `${parts.join(', ')}.`;
  if (rigFilter !== RIG_FILTER_ALL) summary = `${rigFilter}: ${summary}`;
  if (totalShown > filtered.length) summary += ` Showing ${filtered.length} of ${totalShown}.`;
  return summary;
}
