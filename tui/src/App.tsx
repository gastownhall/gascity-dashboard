import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCity } from './useCity.ts';
import { useMouseWheel } from './useMouseWheel.ts';
import {
  ActiveAgentRow,
  AgentRow,
  BeadRow,
  CityBoardPane,
  DetailPane,
  HealthPane,
  LedgerPane,
  MailRow,
  RunRow,
  SessionRow,
  type DetailTab,
} from './panes.tsx';
import {
  buildCommand,
  closePeek,
  openPeek,
  paneExists,
  replacePeek,
  type PeekKind,
} from './peek.ts';
import {
  beadsForRig,
  categorize,
  cityBoard,
  contextPressure,
  groupBeads,
  groupByRig,
  groupRuns,
  lanesForRig,
  laneNeedsOperator,
  foldedMailCount,
  matchesStatusFilter,
  neverActiveByRig,
  nextStatusFilter,
  operatorMail,
  orchFirstActive,
  overviewModel,
  runningSessions,
  systemHealth,
  toAgentView,
  type AgentView,
  type Category,
  type StatusFilter,
} from './derive.ts';
import type { GcBead, GcMailItem, GcSession, RunLane } from './api.ts';

interface AppProps {
  readonly baseUrl: string;
  readonly city: string;
  /** Mayor-companion mode: open on the truncated overview instead of the full
   *  agent list (set by the launcher's --split/--target via --compact). */
  readonly compact?: boolean;
  /** Whether to grab the mouse for wheel scrolling. False (`--no-mouse`) leaves
   *  the mouse to tmux so a pinned panel is drag-resizable; keyboard nav still
   *  works. */
  readonly mouse?: boolean;
}

type ViewMode =
  | 'list'
  | 'beads'
  | 'runs'
  | 'detail'
  | 'health'
  | 'sessions'
  | 'ledger'
  | 'board'
  | 'overview';

type Entry =
  | { readonly kind: 'agent'; readonly id: string; readonly agent: AgentView }
  | { readonly kind: 'bead'; readonly id: string; readonly bead: GcBead }
  | { readonly kind: 'run'; readonly id: string; readonly lane: RunLane }
  | { readonly kind: 'mail'; readonly id: string; readonly mail: GcMailItem };

interface GroupInfo {
  readonly label: string;
  readonly sub: string;
  readonly alert: boolean;
}

type Row =
  | { readonly kind: 'heading'; readonly group: GroupInfo }
  | {
      readonly kind: 'entry';
      readonly entry: Entry;
      readonly index: number;
      readonly dim: boolean;
      readonly group: GroupInfo;
    };

interface Nav {
  readonly entries: readonly Entry[];
  readonly renderRows: readonly Row[];
}

const EMPTY_NAV: Nav = { entries: [], renderRows: [] };

function buildNav(
  view: ViewMode,
  sessions: readonly GcSession[],
  beads: readonly GcBead[],
  lanes: readonly RunLane[],
  mail: readonly GcMailItem[],
  filter: StatusFilter,
): Nav {
  const entries: Entry[] = [];
  const renderRows: Row[] = [];
  const push = (entry: Entry, dim: boolean, group: GroupInfo): void => {
    renderRows.push({ kind: 'entry', entry, index: entries.length, dim, group });
    entries.push(entry);
  };

  if (view === 'beads') {
    for (const g of groupBeads(beads)) {
      const group: GroupInfo = { label: g.status, sub: `${g.beads.length}`, alert: false };
      renderRows.push({ kind: 'heading', group });
      const dim = g.status === 'closed' || g.status === 'deferred';
      for (const b of g.beads) push({ kind: 'bead', id: b.id, bead: b }, dim, group);
    }
    return { entries, renderRows };
  }

  if (view === 'runs') {
    for (const g of groupRuns(lanes)) {
      const needs = g.lanes.filter(laneNeedsOperator).length;
      const group: GroupInfo = {
        label: g.rig,
        sub: needs > 0 ? `${g.lanes.length} · ${needs} need operator` : `${g.lanes.length}`,
        alert: needs > 0,
      };
      renderRows.push({ kind: 'heading', group });
      for (const l of g.lanes) push({ kind: 'run', id: l.id, lane: l }, false, group);
    }
    return { entries, renderRows };
  }

  if (view === 'sessions') {
    // Flat "live now" feed: active sessions, most-recently-active first. Reuses
    // the agent entry kind so enter-peek and p-detail work unchanged.
    const live = runningSessions(sessions);
    const group: GroupInfo = { label: 'live now', sub: `${live.length}`, alert: false };
    renderRows.push({ kind: 'heading', group });
    for (const s of live) push({ kind: 'agent', id: s.id, agent: toAgentView(s) }, false, group);
    return { entries, renderRows };
  }

  if (view === 'overview') {
    // One scrollable, peekable list with attention-first sections: the LEDGER
    // (what's waiting on the operator — needs-operator runs and mayor-escalated
    // mail, worker chatter folded away) leads, then ACTIVE agents, then
    // in-progress BEADS, then a RUNS summary. Every item peeks via the shared
    // drill (run/mail/agent/bead). The single red mark is the ledger heading.
    const needsOp = lanes.filter(laneNeedsOperator);
    const escalations = operatorMail(mail, sessions);
    const folded = foldedMailCount(mail, escalations);
    const actives = orchFirstActive(sessions);
    const wip = beads.filter((b) => b.status === 'in_progress');
    const open = beads.filter((b) => b.status === 'open').length;

    const ledgerTotal = needsOp.length + escalations.length;
    const ledgerGroup: GroupInfo = {
      // The ledger's signature honesty: never silently drop the worker firehose
      // the mayor digested — report how much was folded.
      label: 'LEDGER',
      sub: folded > 0 ? `${ledgerTotal} · ${folded} folded` : `${ledgerTotal}`,
      alert: ledgerTotal > 0,
    };
    renderRows.push({ kind: 'heading', group: ledgerGroup });
    for (const l of needsOp) push({ kind: 'run', id: l.id, lane: l }, false, ledgerGroup);
    for (const m of escalations) push({ kind: 'mail', id: m.id, mail: m }, false, ledgerGroup);

    const actGroup: GroupInfo = {
      label: 'ACTIVE',
      sub: `${actives.length} of ${sessions.length}`,
      alert: false,
    };
    renderRows.push({ kind: 'heading', group: actGroup });
    for (const v of actives) push({ kind: 'agent', id: v.session.id, agent: v }, false, actGroup);

    const beadGroup: GroupInfo = {
      label: 'BEADS',
      sub: `${open} open · ${wip.length} in progress`,
      alert: false,
    };
    renderRows.push({ kind: 'heading', group: beadGroup });
    for (const b of wip) push({ kind: 'bead', id: b.id, bead: b }, false, beadGroup);

    renderRows.push({
      kind: 'heading',
      group: {
        label: 'RUNS',
        sub: `${lanes.length} active · ${needsOp.length} needs operator`,
        alert: false,
      },
    });
    return { entries, renderRows };
  }

  // list (and detail, which navigates the same agent list underneath).
  // Failed agents always pass the filter so a problem is never hidden.
  const filtered = sessions.filter((s) => matchesStatusFilter(categorize(s), filter));
  for (const g of groupByRig(filtered)) {
    const group: GroupInfo = {
      label: g.rig,
      sub: `${g.failed > 0 ? `${g.failed} failed · ` : ''}${g.active} active · ${g.idle} idle`,
      alert: g.failed > 0,
    };
    renderRows.push({ kind: 'heading', group });
    for (const v of g.agents) {
      push({ kind: 'agent', id: v.session.id, agent: v }, v.category === 'idle', group);
    }
  }
  return { entries, renderRows };
}

function entryLabel(e: Entry): string {
  if (e.kind === 'agent') return e.agent.agent;
  if (e.kind === 'bead') return e.bead.id;
  if (e.kind === 'mail') return e.mail.subject;
  return e.lane.title;
}

function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows ?? 24);
  useEffect(() => {
    const onResize = (): void => setRows(stdout.rows ?? 24);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return rows;
}

export function App({ baseUrl, city, compact = false, mouse = true }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { sessions, snapshot, beads, mail, error, conn } = useCity(baseUrl, city);
  const rows = useTerminalRows();

  const [view, setView] = useState<ViewMode>(compact ? 'overview' : 'list');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active+idle');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // A single reused peek pane: its tmux id, and "<kind>:<id>" it's showing.
  const [peekPaneId, setPeekPaneId] = useState<string | null>(null);
  const [peekTarget, setPeekTarget] = useState<string | null>(null);
  const now = Date.now();

  const health = useMemo(() => systemHealth(snapshot), [snapshot]);
  const board = useMemo(() => cityBoard(health.lanes), [health.lanes]);
  const overview = useMemo(
    () => overviewModel(sessions, beads, mail, health.lanes),
    [sessions, beads, mail, health.lanes],
  );
  // detail navigates the same agent list as 'list' underneath.
  const navView: ViewMode = view === 'detail' ? 'list' : view;
  const { entries, renderRows } = useMemo(
    () =>
      navView === 'health' || navView === 'ledger' || navView === 'board'
        ? EMPTY_NAV
        : buildNav(navView, sessions, beads, health.lanes, mail, statusFilter),
    [navView, sessions, beads, health.lanes, mail, statusFilter],
  );

  const cursorIndex = Math.max(0, entries.findIndex((e) => e.id === cursorId));
  const selected: Entry | undefined = entries[cursorIndex];
  const selectedAgent: AgentView | undefined =
    selected && selected.kind === 'agent' ? selected.agent : undefined;

  // Keep the cursor on a real entry as lists churn / views switch.
  useEffect(() => {
    if (entries.length === 0) return;
    if (cursorId === null || !entries.some((e) => e.id === cursorId)) {
      setCursorId(entries[0]?.id ?? null);
    }
  }, [entries, cursorId]);

  // Refs so the wheel callback stays stable (re-subscribing re-emits the
  // mouse-enable escape sequence every render).
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const cursorIndexRef = useRef(cursorIndex);
  cursorIndexRef.current = cursorIndex;

  const moveCursor = useCallback((delta: number) => {
    const list = entriesRef.current;
    if (list.length === 0) return;
    const next = Math.min(Math.max(cursorIndexRef.current + delta, 0), list.length - 1);
    setCursorId(list[next]?.id ?? null);
  }, []);

  useMouseWheel(useCallback((dir: -1 | 1) => moveCursor(dir * 3), [moveCursor]), mouse);

  const closeActivePeek = (): void => {
    if (peekPaneId !== null && paneExists(peekPaneId)) closePeek(peekPaneId);
    setPeekPaneId(null);
    setPeekTarget(null);
  };

  const quit = (): void => {
    if (peekPaneId !== null && paneExists(peekPaneId)) closePeek(peekPaneId);
    exit();
  };

  const drill = (entry: Entry): void => {
    const kind: PeekKind = entry.kind;
    const built = buildCommand({
      kind,
      id: entry.id,
      cityRoot: snapshot?.config.cityRoot ?? null,
      city,
      baseUrl,
    });
    if (typeof built !== 'string') {
      setStatus(`peek: ${built.error}`);
      return;
    }
    const target = `${kind}:${entry.id}`;
    const live = peekPaneId !== null && paneExists(peekPaneId);
    if (live && peekTarget === target) {
      closeActivePeek();
      setStatus('peek closed');
      return;
    }
    const r = live ? replacePeek(peekPaneId, built) : openPeek(built);
    if (r.ok) {
      if (!live) setPeekPaneId(r.paneId ?? null);
      setPeekTarget(target);
      setStatus(`peeking ${entryLabel(entry)} →`);
    } else {
      setStatus(`peek: ${r.error}`);
    }
  };

  // Exact one-line-per-row accounting prevents screen overflow. chrome =
  // header + sticky line + footer (+ error line).
  const chrome = error ? 4 : 3;
  const viewport = Math.max(3, rows - chrome);
  const maxTop = Math.max(0, renderRows.length - viewport);

  const cursorRowIndex = renderRows.findIndex(
    (r) => r.kind === 'entry' && r.index === cursorIndex,
  );
  useEffect(() => {
    if (cursorRowIndex < 0) return;
    setScrollTop((top) => {
      if (cursorRowIndex < top) return cursorRowIndex;
      if (cursorRowIndex >= top + viewport) return cursorRowIndex - viewport + 1;
      return Math.min(top, maxTop);
    });
  }, [cursorRowIndex, viewport, maxTop]);

  const effectiveTop = Math.min(scrollTop, maxTop);
  const visible = renderRows.slice(effectiveTop, effectiveTop + viewport);
  const above = effectiveTop;
  const below = Math.max(0, renderRows.length - (effectiveTop + viewport));
  const firstVisible = visible[0];
  const stickyGroup: GroupInfo | null =
    firstVisible && firstVisible.kind === 'entry' ? firstVisible.group : null;

  const toggle = (target: ViewMode): void => {
    setView((v) => (v === target ? 'list' : target));
    setScrollTop(0);
  };

  useInput(
    (input, key) => {
      if (input === 'q') return quit();
      if (key.escape) return view === 'list' ? quit() : (setView('list'), setScrollTop(0));
      if (input === 'o') return toggle('overview');
      if (input === 'h') return toggle('health');
      if (input === 'm') return toggle('board');
      if (input === 'b') return toggle('beads');
      if (input === 'f') return toggle('runs');
      if (input === 's') return toggle('sessions');
      if (input === 'l') return toggle('ledger');
      if (input === 'p') {
        // Detail for the selected agent — from the agent list, or from the
        // overview when an agent row (not a run/mail/bead) is selected.
        const onAgent = navView === 'list' || (navView === 'overview' && selected?.kind === 'agent');
        if (onAgent) setView((v) => (v === 'detail' ? 'list' : 'detail'));
        return;
      }
      if (input === 'a') {
        // Status filter only governs the agent list/detail; ignore elsewhere.
        if (navView === 'list') {
          setStatusFilter(nextStatusFilter);
          setScrollTop(0);
        }
        return;
      }
      if (input === 'c') {
        if (view === 'detail') setDetailTab((t) => (t === 'config' ? 'overview' : 'config'));
        return;
      }
      if (input === 'x') {
        closeActivePeek();
        setStatus('peek closed');
        return;
      }
      if (key.return) {
        if (selected) drill(selected);
        return;
      }
      if (key.downArrow || input === 'j') moveCursor(1);
      else if (key.upArrow || input === 'k') moveCursor(-1);
      else if (key.pageDown) moveCursor(viewport);
      else if (key.pageUp) moveCursor(-viewport);
      else if (input === 'g') moveCursor(-entries.length);
      else if (input === 'G') moveCursor(entries.length);
    },
    { isActive: Boolean(process.stdin.isTTY) },
  );

  const counts: Record<Category, number> = { failed: 0, active: 0, idle: 0 };
  for (const s of sessions) counts[categorize(s)] += 1;
  const openBeads = beads.filter((b) => b.status === 'open').length;
  const needsOpRuns = health.lanes.filter(laneNeedsOperator).length;
  const ledgerMail = operatorMail(mail, sessions);
  const mailFolded = foldedMailCount(mail, ledgerMail);

  const summary =
    view === 'overview' ? (
      // No red here: the LEDGER heading inside the list carries the one mark.
      <Text dimColor>
        overview
        {overview.waitingTotal > 0 ? ` · ${overview.waitingTotal} on the ledger` : ' · ledger clear'}
      </Text>
    ) : view === 'board' ? (
      // No red here: the board's own `needs` column carries the one mark, so a
      // second red region in the same viewport would break the One Mark Rule.
      <Text dimColor>
        board · {board.length} {board.length === 1 ? 'rig' : 'rigs'} active
        {needsOpRuns > 0 ? ` · ${needsOpRuns} need operator` : ''}
      </Text>
    ) : view === 'beads' ? (
      <Text dimColor>
        beads · {openBeads} open · {beads.length} total
      </Text>
    ) : view === 'runs' ? (
      <Text dimColor>
        runs · {health.lanes.length} active
        {needsOpRuns > 0 ? <Text color="red"> · {needsOpRuns} need operator</Text> : null}
      </Text>
    ) : view === 'sessions' ? (
      <Text dimColor>sessions · {counts.active} live</Text>
    ) : view === 'ledger' ? (
      <Text dimColor>
        ledger · {ledgerMail.length} for you
        {needsOpRuns > 0 ? <Text color="red"> · {needsOpRuns} need operator</Text> : null}
      </Text>
    ) : (
      <Text>
        {counts.failed > 0 ? (
          <Text>
            <Text color="red">{counts.failed} failed</Text>
            <Text dimColor> · </Text>
          </Text>
        ) : null}
        <Text>{counts.active} active</Text>
        <Text dimColor> · {counts.idle} idle · {sessions.length} agents</Text>
        {statusFilter !== 'active+idle' ? (
          <Text dimColor> · showing {statusFilter}</Text>
        ) : null}
      </Text>
    );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          <Text bold>{city}</Text>
          <Text dimColor>  </Text>
          {summary}
        </Text>
        <Text dimColor>{conn === 'open' ? 'live' : conn === 'closed' ? 'reconnecting…' : conn}</Text>
      </Box>

      {error ? (
        <Box>
          <Text color="red">! {error}</Text>
        </Box>
      ) : null}

      {view === 'board' ? (
        <Box marginTop={1}>
          <CityBoardPane board={board} />
        </Box>
      ) : view === 'health' ? (
        <Box marginTop={1}>
          <HealthPane
            health={health}
            idle={neverActiveByRig(sessions)}
            pressure={contextPressure(sessions)}
            now={now}
          />
        </Box>
      ) : view === 'ledger' ? (
        <Box marginTop={1}>
          <LedgerPane
            mail={ledgerMail}
            mailFolded={mailFolded}
            runs={health.lanes.filter(laneNeedsOperator)}
          />
        </Box>
      ) : view === 'detail' && selectedAgent ? (
        <Box marginTop={1}>
          <DetailPane
            view={selectedAgent}
            beads={beadsForRig(beads, selectedAgent.rig)}
            lanes={lanesForRig(health.lanes, selectedAgent.rig)}
            now={now}
            tab={detailTab}
          />
        </Box>
      ) : (
        <>
          {stickyGroup ? (
            <Box>
              <Text dimColor>{stickyGroup.label}</Text>
              <Text dimColor>
                {'  '}
                {stickyGroup.sub} ↑
              </Text>
            </Box>
          ) : (
            <Box>
              <Text> </Text>
            </Box>
          )}
          <Box flexDirection="column">
            {renderRows.length === 0 ? (
              <Text dimColor>{emptyLabel(view)}</Text>
            ) : (
              visible.map((row, i) =>
                row.kind === 'heading' ? (
                  <Box key={`h:${row.group.label}:${effectiveTop + i}`}>
                    {row.group.alert ? (
                      <Text bold color="red">{row.group.label}</Text>
                    ) : (
                      <Text bold>{row.group.label}</Text>
                    )}
                    <Text dimColor>
                      {'  '}
                      {row.group.sub}
                    </Text>
                  </Box>
                ) : (
                  <EntryRow
                    key={`${row.entry.kind}:${row.entry.id}`}
                    entry={row.entry}
                    selected={row.index === cursorIndex}
                    dim={row.dim}
                    now={now}
                    sessionRow={navView === 'sessions'}
                    overview={navView === 'overview' ? { city, lanes: health.lanes } : null}
                  />
                ),
              )
            )}
          </Box>
          <Box justifyContent="space-between">
            {status ? (
              <Text dimColor>{status}</Text>
            ) : (
              <Text dimColor>
                {above > 0 ? `↑ ${above} ` : '   '}
                {below > 0 ? `↓ ${below}` : ''}
              </Text>
            )}
            <Text dimColor>
              ↑↓ · enter peek · {view === 'overview' ? 'o full' : 'o overview'} · a filter ·
              s/b/f/l/h/m · p detail · x close · q quit
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}

function emptyLabel(view: ViewMode): string {
  if (view === 'board') return 'no active runs';
  if (view === 'beads') return 'no beads';
  if (view === 'runs') return 'no active runs';
  if (view === 'sessions') return 'no live sessions';
  return 'no sessions';
}

interface EntryRowProps {
  readonly entry: Entry;
  readonly selected: boolean;
  readonly dim: boolean;
  readonly now: number;
  /** Render an agent entry as the activity-forward Sessions row instead of the
   *  grouped Agents row. */
  readonly sessionRow: boolean;
  /** Overview context: render the calm overview rows (agent = city + on-lane,
   *  mail = sender/subject). Null outside the overview. */
  readonly overview: { readonly city: string; readonly lanes: readonly RunLane[] } | null;
}

function EntryRow({ entry, selected, dim, now, sessionRow, overview }: EntryRowProps): React.JSX.Element {
  if (entry.kind === 'agent') {
    if (overview) {
      return (
        <ActiveAgentRow
          view={entry.agent}
          selected={selected}
          city={overview.city}
          lanes={overview.lanes}
          now={now}
        />
      );
    }
    return sessionRow ? (
      <SessionRow view={entry.agent} selected={selected} now={now} />
    ) : (
      <AgentRow view={entry.agent} selected={selected} dim={dim} now={now} />
    );
  }
  if (entry.kind === 'mail') {
    return <MailRow mail={entry.mail} selected={selected} />;
  }
  if (entry.kind === 'bead') {
    return <BeadRow bead={entry.bead} selected={selected} dim={dim} />;
  }
  return <RunRow lane={entry.lane} selected={selected} />;
}
