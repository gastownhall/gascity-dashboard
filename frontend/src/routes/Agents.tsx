import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GC_EVENT_PREFIX,
  effectiveContextPct,
} from 'gas-city-dashboard-shared';
import { Button } from '../components/Button';
import { useAttentionModel } from '../attention/context';
import {
  attentionRowProps,
  resourceAttentionSeverity,
} from '../attention/routeHighlight';
import { FilterChips } from '../components/FilterChips';
import { ListSearchBar } from '../components/ListSearchBar';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { PartialDataNotice } from '../components/PartialDataNotice';
import { LiveSessionPeek, isAgentStreamable } from '../components/LiveSessionPeek';
import { SortToggle } from '../components/SortToggle';
import { SseIndicator } from '../components/SseIndicator';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import { Table, type TableColumn } from '../components/Table';
import { useNow } from '../contexts/NowContext';
import { useCachedData } from '../hooks/useCachedData';
import { useGcEventRefresh } from '../hooks/useGcEvents';
import { useListFilters, type FilterChip, type SortMode } from '../hooks/useListFilters';
import { formatRelative } from '../hooks/time';
import {
  attachCommand,
  listAgentPendingInteractions,
  respondToAgentPendingInteraction,
  type AgentPendingInteraction,
} from '../supervisor/agentPending';
import { listSupervisorSessions } from '../supervisor/sessionReads';
import {
  listSupervisorAgents,
  type SupervisorAgent,
} from '../supervisor/agentReads';
import {
  agentProject,
  isAgentOutsideRig,
  isPerRigDispatcherAgent,
} from '../hooks/projectOf';
import { agentSlug } from '../hooks/sessionSlug';

// gascity-dashboard-ay6: the Agents view consumes the supervisor's
// first-class /v0/city/{name}/agents roster. The previous implementation
// derived agents from the dashboard sessions mirror, which undercounted
// any agent that wasn't currently running a session
// (orphan / configured-but-asleep agents simply didn't appear).
//
// The cityStatus snapshot collector continues to aggregate over sessions
// for now — sessionsByProvider migration is sd4's territory.

// Flat table: agents are not grouped by rig (the Rig column + sort carry that).
// useListFilters still drives search/chips/sort, so we collapse every row into
// one bucket and render the result as a single flat, sortable table.
const FLAT_GROUP = () => '';

// Sentinel for the rig dropdown's "all rigs" option. Empty string can't
// collide with a real rig key because agentProject() never returns one.
const RIG_FILTER_ALL = '';

// Display label + stable key for a row's rig, reusing agentProject so the Rig
// column, dropdown, and sort all agree (folds case/separator drift and lifts
// cross-rig agents into the Orchestration bucket).
function agentRigLabel(a: SupervisorAgent): string {
  return agentProject(a).label;
}

function agentRigKey(a: SupervisorAgent): string {
  return agentProject(a).key;
}

// Activity ordering uses the agent's bound session's last_activity. Agents
// with no session (orphans) return undefined so the list-filter sink sends
// them to the bottom under activity-sort rather than ranking them at the
// epoch.
function agentActivity(a: SupervisorAgent): number | undefined {
  const raw = a.session?.last_activity;
  if (!raw) return undefined;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : undefined;
}

const SORT_OPTIONS: ReadonlyArray<{ id: SortMode; label: string }> = [
  { id: 'activity', label: 'activity' },
  { id: 'alpha', label: 'alphabetical' },
];

// Agent state chips collapse the gc supervisor's many states into buckets
// the operator actually filters by. Every state an agent can carry must
// match at least one chip — otherwise agents in that state vanish silently
// when any chip is active (parallels gascity-dashboard-9yb's invariant for
// sessions). Exported so tests can assert full state coverage.
// Non-suspended chips all gate on `!a.suspended` so the chip filter
// matches `stateBucket`'s priority order — `stateBucket` returns
// 'suspended' before checking state, so a suspended-asleep agent is
// counted in the suspended bucket only. Without the guard, the idle
// chip would also surface suspended-asleep agents and the operator's
// "what's idle?" filter would be over-broad. Same reasoning applies
// to running/detached/stopped (a suspended agent that also reads as
// running/detached/stopped via raw state should still only count as
// suspended).
export const AGENT_CHIPS: ReadonlyArray<FilterChip<SupervisorAgent>> = [
  {
    id: 'running',
    label: 'running',
    match: (a) =>
      !a.suspended &&
      (a.state === 'active' || a.state === 'running' || a.running === true),
  },
  {
    id: 'idle',
    label: 'idle',
    match: (a) =>
      !a.suspended &&
      (a.state === 'asleep' || a.state === 'idle' || a.state === 'creating'),
  },
  {
    id: 'detached',
    label: 'detached',
    match: (a) => !a.suspended && a.state === 'detached',
  },
  {
    id: 'stopped',
    label: 'stopped',
    match: (a) =>
      !a.suspended &&
      (a.state === 'failed' ||
        a.state === 'closed' ||
        a.state === 'errored' ||
        a.state === 'stuck'),
  },
  {
    id: 'suspended',
    label: 'suspended',
    // The agent roster surfaces suspended agents that the session list
    // never did — a distinct chip lets the operator slice by them
    // without conflating with stopped/idle.
    match: (a) => a.suspended === true,
  },
];

const AGENT_SEARCH_FIELDS = (a: SupervisorAgent): ReadonlyArray<string | undefined> => [
  a.name,
  a.display_name,
  a.pool,
  a.rig,
  a.provider,
  a.model,
];

export function AgentsPage() {
  const attention = useAttentionModel();
  const { data, loading, error, refresh } = useCachedData(
    'agents',
    listSupervisorAgents,
  );
  // The supervisor's AgentResponse.session (SessionInfo) carries only
  // `name`/`attached`/`last_activity` — NOT the session id. Peek needs
  // the session id (gc-XXX format) per SESSION_ID_RE on the backend.
  // Fetch the sessions list in parallel so we can map agent.session.name
  // -> session.id at peek time.
  const sessionsCache = useCachedData('sessions', listSupervisorSessions);
  const rows = useMemo<SupervisorAgent[]>(() => data?.items ?? [], [data]);
  const sessionIds = useMemo(
    () => (sessionsCache.data?.items ?? []).map((session) => session.id).sort(),
    [sessionsCache.data],
  );
  const agentNames = useMemo(
    () => rows.map((agent) => agent.name).sort(),
    [rows],
  );
  const pendingCache = useCachedData(
    `agent-pending:${agentNames.join(',')}:${sessionIds.join(',')}`,
    () => listAgentPendingInteractions(rows, sessionsCache.data?.items ?? []),
  );
  const sessionsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessionsCache.data?.items ?? []) {
      if (s.session_name) map.set(s.session_name, s.id);
    }
    return map;
  }, [sessionsCache.data]);
  const pendingByAgent = useMemo(() => {
    const map = new Map<string, AgentPendingInteraction>();
    for (const pending of pendingCache.data ?? []) {
      map.set(pending.agentName, pending);
    }
    return map;
  }, [pendingCache.data]);
  const now = useNow();

  // Peek key is the agent alias (`name`); modal resolves the live session
  // by mapping agent.session.name -> session.id via the sessions cache.
  const [peekAlias, setPeekAlias] = useState<string | null>(null);
  const [responseMessage, setResponseMessage] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [responding, setResponding] = useState<{
    sessionId: string;
    action: string;
  } | null>(null);
  const peekAgent = useMemo(
    () => (peekAlias === null ? null : rows.find((a) => a.name === peekAlias) ?? null),
    [rows, peekAlias],
  );
  const peekSessionId = useMemo(() => {
    const sessionName = peekAgent?.session?.name;
    if (!sessionName) return null;
    return sessionsById.get(sessionName) ?? null;
  }, [peekAgent, sessionsById]);

  const sseState = useGcEventRefresh([GC_EVENT_PREFIX.session, 'agent.'], () => void refresh());

  const synopsis = useMemo(() => buildAgentSynopsis(rows), [rows]);
  const handlePendingResponse = useCallback(async (
    pending: AgentPendingInteraction,
    action: 'approve' | 'deny',
  ) => {
    setResponding({ sessionId: pending.sessionId, action });
    setResponseMessage(null);
    setResponseError(null);
    try {
      await respondToAgentPendingInteraction(pending.sessionId, {
        action,
        request_id: pending.pending.request_id,
      });
      setResponseMessage(`responded to ${pending.agentName}`);
      await pendingCache.refresh();
    } catch (err) {
      setResponseError(err instanceof Error ? err.message : 'response failed');
    } finally {
      setResponding(null);
    }
  }, [pendingCache]);

  const filters = useListFilters<SupervisorAgent>({
    viewKey: 'agents',
    rows,
    projectOf: FLAT_GROUP,
    searchOf: AGENT_SEARCH_FIELDS,
    chips: AGENT_CHIPS,
    defaultCollapsed: false,
    activityOf: agentActivity,
    defaultSortMode: 'activity',
  });

  // Rig dropdown (flat table): every rig present in the roster, by stable key
  // with its display label, sorted alphabetically by label.
  const [rigFilter, setRigFilter] = useState<string>(RIG_FILTER_ALL);
  const rigOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const a of rows) byKey.set(agentRigKey(a), agentRigLabel(a));
    return Array.from(byKey, ([key, label]) => ({ key, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [rows]);
  // If the selected rig leaves the roster (its agents all stopped and were
  // pruned on an SSE/manual refresh), reset to "all rigs" so the controlled
  // <select> doesn't strand the table empty with no visible cause.
  useEffect(() => {
    if (rigFilter !== RIG_FILTER_ALL && !rigOptions.some((o) => o.key === rigFilter)) {
      setRigFilter(RIG_FILTER_ALL);
    }
  }, [rigOptions, rigFilter]);

  // Flatten useListFilters' (now single) group into one sorted, search/chip
  // filtered list, then apply the rig dropdown.
  const visibleRows = useMemo(() => {
    const flat = filters.groups.flatMap((g) => g.rows);
    if (rigFilter === RIG_FILTER_ALL) return flat;
    return flat.filter((a) => agentRigKey(a) === rigFilter);
  }, [filters.groups, rigFilter]);

  const rowProps = useMemo(
    () => (agent: SupervisorAgent) =>
      attentionRowProps(resourceAttentionSeverity(attention, 'agents', agent.name)),
    [attention],
  );
  const rosterUnavailable = error !== null && rows.length === 0;
  const emptyMessage = rosterUnavailable
    ? 'Agent roster unavailable.'
    : filters.search.length > 0 || filters.activeChipIds.size > 0
      ? 'No agents match the current search or filter.'
      : 'No agents configured.';

  const columns = useMemo<ReadonlyArray<TableColumn<SupervisorAgent>>>(() => [
    {
      key: 'name',
      label: 'Agent',
      sortable: true,
      // Sort by alias (the identity), not the display_name. Two agents
      // with the same provider label ("Claude (Account 5)") would
      // otherwise collide; alias is unique.
      sortValue: (r) => r.name,
      render: (r) => {
        // Per-rig dispatchers (alias '<rig>/control-dispatcher') live
        // inside their rig group but perform an orchestration role.
        // Italicize the alias so the operator can spot them at a glance
        // without lifting them out of their rig (cross-rig
        // orchestration is handled separately by the Orchestration
        // pinned group).
        const dispatcher = isPerRigDispatcherAgent(r);
        // Primary label is the alias (`name`) — that's the identity the
        // operator dispatches with (`gc sling <alias> ...`) and the only
        // field guaranteed unique. display_name is the provider's
        // human-readable label (e.g. "Claude (Account 5)") and is
        // useful as secondary context but not as a primary identifier.
        const secondary = r.display_name && r.display_name !== r.name
          ? r.display_name
          : (r.provider ?? r.model ?? '');
        // ay6.2: orphan agents (no bound session) still render a link
        // to /agents/<slug>, but AgentDetail will resolve nothing and
        // show "no session matches" — a confusing dead-end if the
        // operator clicks expecting a drilldown. A distinct title
        // tooltip and a muted color pre-empt the surprise without
        // disabling the link (the configured-but-not-running detail
        // page is sd4's scope). Dispatchers keep their italic cue.
        const orphan = !r.session;
        const linkTitle = orphan
          ? `${r.name} — configured but not running; detail will show no live session`
          : `Open drilldown for ${r.name}`;
        const linkColor = orphan ? 'text-fg-muted' : 'text-fg';
        return (
          <div className="min-w-0">
            <Link
              to={`/agents/${encodeURIComponent(agentSlug(r))}`}
              className={`block ${linkColor} truncate hover:text-accent focus-mark ${
                dispatcher ? 'font-normal italic' : 'font-medium'
              }`}
              title={linkTitle}
            >
              {r.name}
            </Link>
            {secondary && (
              <div className="text-label uppercase tracking-wider text-fg-faint mt-1 truncate">
                {secondary}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'rig',
      label: 'Rig',
      sortable: true,
      // Sort by the display label so the column's visual order matches the
      // sort order (the key is lowercased/normalized and would diverge).
      sortValue: (r) => agentRigLabel(r),
      // Agents outside a rig (Orchestration roles + the residual no-rig bucket)
      // are not in a real rig, so the column shows a neutral dot rather than a
      // pseudo-rig label. The dot carries a title/aria-label so the state stays
      // readable in greyscale and to assistive tech (DESIGN.md: states have words).
      render: (r) =>
        isAgentOutsideRig(r) ? (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-fg-faint align-middle"
            title="Not associated with a rig"
            aria-label="Not associated with a rig"
          />
        ) : (
          <span className="text-fg-muted">{agentRigLabel(r)}</span>
        ),
      className: 'w-40',
    },
    {
      key: 'state',
      label: 'State',
      sortable: true,
      sortValue: (r) => r.state,
      render: (r) => (
        <StatusBadge
          tone={stateTone(r.state)}
          label={r.state}
          {...(r.session?.attached ? { trailing: 'att' } : {})}
          {...(r.unavailable_reason ? { title: `unavailable: ${r.unavailable_reason}` } : {})}
        />
      ),
      className: 'w-32',
    },
    {
      key: 'activity',
      label: 'Activity',
      sortable: true,
      sortValue: (r) => r.activity ?? '',
      render: (r) => {
        const pending = pendingByAgent.get(r.name);
        if (pending !== undefined) {
          return (
            <div className="min-w-0">
              <StatusBadge tone="stuck" label="needs you" />
              <p className="mt-1 truncate text-fg-muted" title={pending.pending.prompt}>
                {pending.pending.prompt ?? pending.pending.kind}
              </p>
            </div>
          );
        }
        return (
          <span className="text-fg-muted">
            {r.activity ?? (r.running ? 'running' : '·')}
          </span>
        );
      },
      className: 'w-28',
    },
    {
      key: 'context',
      label: 'Context',
      sortable: true,
      // Sort by the value we DISPLAY, not the raw gc value — otherwise
      // mayor (raw 89%, effective 18%) would sort above a true-90%
      // agent that looks calmer.
      sortValue: (r) => effectiveContextPct(r) ?? -1,
      align: 'right',
      render: (r) => {
        const pct = effectiveContextPct(r);
        if (typeof pct !== 'number') {
          return <span className="text-fg-faint">·</span>;
        }
        // Tooltip exposes the raw gc value when scaling kicked in so
        // the operator can audit the dashboard against gc directly.
        const title =
          typeof r.context_pct === 'number' && r.context_pct !== pct
            ? `gc reports ${r.context_pct}% against ${r.context_window ?? '?'}-token window; scaled to model's true window`
            : undefined;
        return (
          <span
            title={title}
            className={`tnum ${
              pct >= 95
                ? 'text-accent font-medium'
                : pct >= 80
                  ? 'text-warn font-medium'
                  : 'text-fg-muted'
            }`}
          >
            {pct}%
          </span>
        );
      },
      className: 'w-24',
    },
    {
      key: 'last_active',
      label: 'Last active',
      sortable: true,
      sortValue: (r) => r.session?.last_activity ?? '',
      render: (r) => {
        const ts = r.session?.last_activity;
        if (!ts) return <span className="text-fg-faint tnum">·</span>;
        return (
          <span className="tnum text-fg-muted">
            {formatRelative(ts, now)}
          </span>
        );
      },
      className: 'w-32',
    },
    {
      key: 'actions',
      label: '',
      render: (r) => {
        // Orphan agents (no bound session) have nothing to peek into.
        // Hide the button so the operator doesn't get a 404 from the
        // transcript fetch. Use visibility:hidden equivalent (render the
        // empty cell) rather than collapsing the column width.
        if (!r.session) return null;
        const pending = pendingByAgent.get(r.name);
        return (
          <div className="flex justify-end gap-2">
            {pending !== undefined && (
              <>
                <Button
                  size="sm"
                  tone="quiet"
                  disabled={responding?.sessionId === pending.sessionId}
                  onClick={() => void handlePendingResponse(pending, 'approve')}
                >
                  {responding?.sessionId === pending.sessionId && responding.action === 'approve'
                    ? 'Approving'
                    : 'Approve'}
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  disabled={responding?.sessionId === pending.sessionId}
                  onClick={() => void handlePendingResponse(pending, 'deny')}
                >
                  {responding?.sessionId === pending.sessionId && responding.action === 'deny'
                    ? 'Denying'
                    : 'Deny'}
                </Button>
                <CopyAttachButton command={attachCommand(r.name)} />
              </>
            )}
            <Button size="sm" tone="quiet" onClick={() => setPeekAlias(r.name)}>
              Peek
            </Button>
          </div>
        );
      },
      align: 'right',
      className: 'w-80',
    },
  ], [handlePendingResponse, now, pendingByAgent, responding]);

  return (
    <section>
      <PageHeader
        title="Agents"
        synopsis={rosterUnavailable ? 'Agent roster unavailable.' : synopsis}
        meta={
          <>
            <SseIndicator state={sseState} />
            {error && (
              <span className="normal-case text-body text-accent" role="alert">
                {error}
              </span>
            )}
            <PartialDataNotice
              show={data?.partial === true}
              label="roster partial"
              title={data?.partial_errors?.join('\n') ?? 'one or more agent backends unavailable'}
            />
            <Button size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      <div className="mb-6 space-y-3">
        <ListSearchBar
          value={filters.search}
          onChange={filters.setSearch}
          placeholder="Search agents by alias, rig, pool, provider"
          matchCount={filters.totalMatches}
          totalCount={rows.length}
          ariaLabel="Search agents"
        />
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <FilterChips
            chips={AGENT_CHIPS}
            activeIds={filters.activeChipIds}
            onToggle={filters.toggleChip}
            legend="State"
          />
          <label className="flex items-baseline gap-2 text-label">
            <span className="uppercase tracking-wider text-fg-muted">Rig</span>
            <select
              value={rigFilter}
              onChange={(e) => setRigFilter(e.target.value)}
              aria-label="Filter by rig"
              className="text-label uppercase tracking-wider text-fg-muted bg-transparent border-0 focus-mark cursor-pointer hover:text-fg transition-colors duration-150 ease-out-quart"
            >
              <option value={RIG_FILTER_ALL}>all rigs</option>
              {rigOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <SortToggle<SortMode>
            value={filters.sortMode}
            options={SORT_OPTIONS}
            onChange={filters.setSortMode}
            legend="Sort"
          />
        </div>
      </div>
      {responseMessage && (
        <div className="mb-4 text-body text-fg-muted" role="status">
          {responseMessage}
        </div>
      )}
      {responseError && (
        <div className="mb-4 text-body text-accent" role="alert">
          {responseError}
        </div>
      )}

      <Table
        rows={visibleRows}
        columns={columns}
        rowKey={(r) => r.name}
        rowProps={rowProps}
        empty={emptyMessage}
        initialSort={{ key: 'last_active', dir: 'desc' }}
      />

      <Modal
        open={peekAlias !== null}
        onClose={() => setPeekAlias(null)}
        title={peekAgent?.name ?? peekAlias ?? 'Transcript'}
        caption={
          // SessionInfo on the supervisor side carries only name/attached/
          // last_activity — no session id — so we resolve agent.session.name
          // -> session.id through the sessions cache. If sessions hasn't
          // loaded yet (or the agent's session is missing from it), surface
          // that explicitly instead of letting peek hit the route with an
          // invalid id and degrade to "invalid session id".
          peekAgent && peekAgent.session && !peekSessionId
            ? sessionsCache.loading
              ? 'Resolving session…'
              : `No live session matches "${peekAgent.session.name}".`
            : isAgentStreamable(peekAgent)
              ? "Live transcript from the supervisor's session stream."
              : "Snapshot from the supervisor's transcript API."
        }
        widthClass="max-w-5xl"
      >
        <LiveSessionPeek
          sessionId={peekSessionId}
          stream={isAgentStreamable(peekAgent)}
          showBadge
          showCaption
        />
      </Modal>
    </section>
  );
}

function CopyAttachButton({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const label = state === 'copied'
    ? 'Copied'
    : state === 'failed'
      ? 'Copy failed'
      : 'Copy attach';

  return (
    <Button
      size="sm"
      tone="quiet"
      title={command}
      onClick={() => {
        void copyAttachCommand(command, setState);
      }}
    >
      {label}
    </Button>
  );
}

async function copyAttachCommand(
  command: string,
  setState: (state: 'idle' | 'copied' | 'failed') => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(command);
    setState('copied');
  } catch {
    setState('failed');
  }
}

// Single source of truth for state → tone mapping. Aligned with how the
// gc supervisor emits agent (and session) states. Unknown states default
// to neutral so we don't lie about them. 'detached' is explicit (not a
// silent default) so reviewers see the intent.
export function stateTone(state: string): StatusTone {
  switch (state) {
    case 'active':
    case 'running':
      return 'ok';
    case 'rate-limited':
    case 'rate_limited':
    case 'waiting':
      return 'warn';
    case 'failed':
    case 'closed':
    case 'errored':
    case 'stuck':
      return 'stuck';
    case 'detached':
    case 'asleep':
    case 'idle':
    case 'creating':
    default:
      return 'neutral';
  }
}

// Buckets a raw state into the synopsis category. Distinct from
// stateTone because 'detached' and 'idle' share a tone (neutral) but the
// header text breaks them out.
export type SynopsisBucket =
  | 'active'
  | 'idle'
  | 'detached'
  | 'rate-limited'
  | 'stuck'
  | 'suspended';

function stateBucket(agent: SupervisorAgent): SynopsisBucket {
  if (agent.suspended) return 'suspended';
  switch (agent.state) {
    case 'active':
    case 'running':
      return 'active';
    case 'detached':
      return 'detached';
    case 'rate-limited':
    case 'rate_limited':
    case 'waiting':
      return 'rate-limited';
    case 'failed':
    case 'closed':
    case 'errored':
    case 'stuck':
      return 'stuck';
    default:
      return 'idle';
  }
}

export function buildAgentSynopsis(rows: ReadonlyArray<SupervisorAgent>): string {
  if (rows.length === 0) return 'No agents configured.';
  const counts = new Map<SynopsisBucket, number>();
  for (const r of rows) {
    const b = stateBucket(r);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const parts: string[] = [];
  const active = counts.get('active') ?? 0;
  const idle = counts.get('idle') ?? 0;
  const detached = counts.get('detached') ?? 0;
  const rateLimited = counts.get('rate-limited') ?? 0;
  const stuck = counts.get('stuck') ?? 0;
  const suspended = counts.get('suspended') ?? 0;
  if (active > 0) parts.push(`${active} active`);
  if (idle > 0) parts.push(`${idle} idle`);
  if (detached > 0) parts.push(`${detached} detached`);
  if (rateLimited > 0) parts.push(`${rateLimited} rate-limited`);
  if (stuck > 0) parts.push(`${stuck} stuck`);
  if (suspended > 0) parts.push(`${suspended} suspended`);
  return parts.join(', ') + '.';
}
