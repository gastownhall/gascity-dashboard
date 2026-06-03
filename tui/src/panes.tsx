import React from 'react';
import { Box, Text } from 'ink';
import type { RunLane } from 'gas-city-dashboard-shared';
import type { GcBead, GcMailItem } from './api.ts';
import {
  activityPhrase,
  agentLane,
  basename,
  CITY_BOARD_PHASE_LABEL,
  CITY_BOARD_PHASES,
  ctxPct,
  displayRig,
  kindGlyph,
  kindLabel,
  laneNeedsOperator,
  laneRig,
  mailSnippet,
  peekCommands,
  relativeTime,
  shortModel,
  type AgentView,
  type ContextPressureEntry,
  type IdleRollup,
  type RigPhaseCounts,
  type SystemHealth,
} from './derive.ts';

function pct(n: number | null | undefined, scale01 = false): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(scale01 ? n * 100 : n)}%`;
}

// ── one agent row in the list ───────────────────────────────────────────────

interface AgentRowProps {
  readonly view: AgentView;
  readonly selected: boolean;
  readonly dim: boolean;
  readonly now: number;
}

export function AgentRow({ view, selected, dim, now }: AgentRowProps): React.JSX.Element {
  const s = view.session;
  const pct = ctxPct(s);
  const ctx = pct !== undefined ? `${pct}%` : '';
  // Active agents show live activity; dormant agents show WHY they're idle
  // (the supervisor's transition reason, e.g. "city-stop"/"drained") rather
  // than a bare "asleep", so "I thought we suspended that" is answerable.
  const activity =
    view.category === 'active'
      ? (s.activity ?? '')
      : s.attached
        ? 'attached'
        : (s.reason ?? s.state);
  return (
    <Box>
      <Box width={2}>
        {selected ? <Text color="cyan">▸</Text> : <Text> </Text>}
      </Box>
      {/* Kind sigil + word are the greyscale-readable carriers of agent type
          (DESIGN.md Greyscale Test): a glyph and a short word, no hue. The
          orchestration glyph is bold — the one layer worth catching at a
          glance — as the restrained weight-only accelerator. */}
      <Box width={2}>
        <Text bold={view.kind === 'orch'} dimColor={view.kind !== 'orch'}>
          {kindGlyph(view.kind)}
        </Text>
      </Box>
      <Box width={30} marginRight={1}>
        <Text wrap="truncate-end" bold={selected} inverse={selected} dimColor={dim && !selected}>
          {view.agent}
        </Text>
      </Box>
      <Box width={4} marginRight={1}>
        <Text dimColor>{kindLabel(view.kind)}</Text>
      </Box>
      <Box width={4} marginRight={1} justifyContent="flex-end">
        <Text dimColor>{ctx}</Text>
      </Box>
      <Box width={9} marginRight={1}>
        <Text wrap="truncate-end" dimColor>
          {activity}
        </Text>
      </Box>
      <Box width={9} marginRight={1}>
        <Text wrap="truncate-end" dimColor>
          {shortModel(s.model) || s.provider}
        </Text>
      </Box>
      <Box width={5} justifyContent="flex-end">
        <Text dimColor>{relativeTime(s.last_active, now)}</Text>
      </Box>
    </Box>
  );
}

// ── one session row (sessions live-feed view) ───────────────────────────────

interface SessionRowProps {
  readonly view: AgentView;
  readonly selected: boolean;
  readonly now: number;
}

/** A live-feed row: agent, rig, and a mechanical phrase for what it's doing
 *  right now (the activity hint / reason), given more room than the terse
 *  Agents row so the phrase reads in full. */
export function SessionRow({ view, selected, now }: SessionRowProps): React.JSX.Element {
  const s = view.session;
  const pct = ctxPct(s);
  const ctx = pct !== undefined ? `${pct}%` : '';
  return (
    <Box>
      <Box width={2}>{selected ? <Text color="cyan">▸</Text> : <Text> </Text>}</Box>
      <Box width={20} marginRight={1}>
        <Text wrap="truncate-end" bold={selected} inverse={selected}>
          {view.agent}
        </Text>
      </Box>
      <Box width={12} marginRight={1}>
        <Text wrap="truncate-end" dimColor>
          {view.rig}
        </Text>
      </Box>
      <Box flexGrow={1} marginRight={1}>
        <Text wrap="truncate-end">{activityPhrase(s)}</Text>
      </Box>
      <Box width={4} marginRight={1} justifyContent="flex-end">
        <Text dimColor>{ctx}</Text>
      </Box>
      <Box width={5} justifyContent="flex-end">
        <Text dimColor>{relativeTime(s.last_active, now)}</Text>
      </Box>
    </Box>
  );
}

// ── one bead row (beads view) ───────────────────────────────────────────────

interface BeadRowProps {
  readonly bead: GcBead;
  readonly selected: boolean;
  readonly dim: boolean;
}

export function BeadRow({ bead, selected, dim }: BeadRowProps): React.JSX.Element {
  const prio = typeof bead.priority === 'number' ? `P${bead.priority}` : '';
  return (
    <Box>
      <Box width={2}>{selected ? <Text color="cyan">▸</Text> : <Text> </Text>}</Box>
      <Box width={3} marginRight={1}>
        <Text dimColor>{prio}</Text>
      </Box>
      <Box flexGrow={1} marginRight={1}>
        <Text wrap="truncate-end" bold={selected} inverse={selected} dimColor={dim && !selected}>
          {bead.title}
        </Text>
      </Box>
      <Box width={8} marginRight={1}>
        <Text wrap="truncate-end" dimColor>
          {bead.issue_type}
        </Text>
      </Box>
    </Box>
  );
}

// ── one run-lane row (formula runs view) ─────────────────────────────────────

interface RunRowProps {
  readonly lane: RunLane;
  readonly selected: boolean;
}

export function RunRow({ lane, selected }: RunRowProps): React.JSX.Element {
  const needsOp = laneNeedsOperator(lane);
  return (
    <Box>
      <Box width={2}>
        {needsOp ? <Text color="red">●</Text> : selected ? <Text color="cyan">▸</Text> : <Text> </Text>}
      </Box>
      <Box flexGrow={1} marginRight={1}>
        <Text wrap="truncate-end" bold={selected} inverse={selected}>
          {lane.title}
        </Text>
      </Box>
      <Box width={14} marginRight={1}>
        <Text wrap="truncate-end" dimColor>
          {lane.phaseLabel}
        </Text>
      </Box>
      <Box width={12}>
        <Text wrap="truncate-end" dimColor>
          {needsOp ? 'needs operator' : ''}
        </Text>
      </Box>
    </Box>
  );
}

// ── detail / peek pane for the selected agent ───────────────────────────────

export type DetailTab = 'overview' | 'config';

interface DetailPaneProps {
  readonly view: AgentView;
  readonly beads: readonly GcBead[];
  readonly lanes: readonly RunLane[];
  readonly now: number;
  readonly tab: DetailTab;
}

export function DetailPane({ view, beads, lanes, now, tab }: DetailPaneProps): React.JSX.Element {
  const s = view.session;
  const pct = ctxPct(s);
  const ctx = pct !== undefined ? `${pct}%` : '—';
  return (
    <Box flexDirection="column">
      <Text bold>
        {view.rig} · {view.agent}
      </Text>
      <Text dimColor>
        {s.state}
        {s.reason ? ` (${s.reason})` : ''} · {s.provider}
        {s.model ? ` · ${shortModel(s.model)}` : ''} · ctx {ctx} · last {relativeTime(s.last_active, now)}
        {s.attached ? ' · attached' : ''}
      </Text>
      {tab === 'config' ? (
        <ConfigSection view={view} />
      ) : (
        <OverviewSection view={view} beads={beads} lanes={lanes} />
      )}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ change agent · c {tab === 'config' ? 'overview' : 'config'} · enter peek · x close
          peek · p close · q quit
        </Text>
      </Box>
    </Box>
  );
}

interface OverviewSectionProps {
  readonly view: AgentView;
  readonly beads: readonly GcBead[];
  readonly lanes: readonly RunLane[];
}

function OverviewSection({ view, beads, lanes }: OverviewSectionProps): React.JSX.Element {
  const cmds = peekCommands(view.session);
  return (
    <>
      <Text dimColor>
        id {view.session.id} · pool {view.session.pool ?? '—'} · kind {view.kind}
      </Text>

      <Box marginTop={1}>
        <Text bold>peek</Text>
      </Box>
      <Text>  {cmds.gcPeek}</Text>
      <Text>  {cmds.tmuxAttach}</Text>
      <Text dimColor>  {cmds.tmuxCapture}</Text>

      <Box marginTop={1}>
        <Text bold>formulas </Text>
        <Text dimColor>(active run lanes on this rig)</Text>
      </Box>
      {lanes.length === 0 ? (
        <Text dimColor>  none</Text>
      ) : (
        lanes.slice(0, 6).map((l) => (
          <Box key={l.id}>
            <Text>  {laneNeedsOperator(l) ? <Text color="red">● </Text> : '  '}</Text>
            <Text>{l.title}</Text>
            <Text dimColor> — {l.phaseLabel}</Text>
            {laneNeedsOperator(l) ? <Text color="red"> — needs operator</Text> : null}
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text bold>beads </Text>
        <Text dimColor>(this rig, best-effort match)</Text>
      </Box>
      {beads.length === 0 ? (
        <Text dimColor>  none</Text>
      ) : (
        beads.slice(0, 8).map((b) => (
          <Box key={b.id}>
            <Text dimColor>  [{b.status}] </Text>
            <Text wrap="truncate-end">{b.title}</Text>
          </Box>
        ))
      )}
    </>
  );
}

interface ConfigRow {
  readonly label: string;
  readonly value: string;
}

/** Agent configuration as surfaced by the backend /api/*. The supervisor's
 *  session API exposes config metadata but NOT the launch prompt/instructions
 *  (only a config-side template path it does not serialise), so that line is
 *  shown honestly as unavailable rather than faked. */
function ConfigSection({ view }: { readonly view: AgentView }): React.JSX.Element {
  const s = view.session;
  const rows: readonly ConfigRow[] = [
    { label: 'kind', value: view.kind },
    { label: 'template', value: s.template || '—' },
    { label: 'pool', value: s.pool ?? '—' },
    { label: 'rig', value: view.rig },
    { label: 'session', value: s.session_name },
    { label: 'alias', value: s.alias ?? '—' },
    { label: 'display', value: s.display_name ?? '—' },
    { label: 'provider', value: s.provider },
    { label: 'model', value: s.model ?? '—' },
    { label: 'ctx window', value: s.context_window ? `${s.context_window}` : '—' },
    { label: 'agent_kind', value: s.agent_kind ?? '—' },
    { label: 'created', value: s.created_at },
    { label: 'id', value: s.id },
  ];
  return (
    <>
      <Box marginTop={1}>
        <Text bold>config</Text>
      </Box>
      {rows.map((r) => (
        <Box key={r.label}>
          <Box width={11}>
            <Text dimColor>{r.label}</Text>
          </Box>
          <Text wrap="truncate-end">{r.value}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Box width={11}>
          <Text dimColor>prompt</Text>
        </Box>
        <Text dimColor>not exposed by supervisor API</Text>
      </Box>
    </>
  );
}

// ── system health / observability pane ──────────────────────────────────────

interface HealthPaneProps {
  readonly health: SystemHealth;
  readonly idle: readonly IdleRollup[];
  readonly pressure: readonly ContextPressureEntry[];
  readonly now: number;
}

export function HealthPane({ health, idle, pressure }: HealthPaneProps): React.JSX.Element {
  const needsOp = health.lanes.filter(laneNeedsOperator);
  return (
    <Box flexDirection="column">
      <Text bold>system</Text>
      <Text dimColor>
        {'  '}load {health.load1?.toFixed(2) ?? '—'} / {health.vcpu ?? '—'} vcpu (
        {health.loadPerVcpu?.toFixed(2) ?? '—'} per-vcpu) · mem {pct(health.memUtil, true)}
      </Text>
      <Text dimColor>
        {'  '}agents {health.activeAgents ?? '—'} active · sessions {health.activeSessions ?? '—'} · runs{' '}
        {health.activeRuns ?? '—'} active · max {health.maxAgents ?? '—'}
      </Text>

      <Box marginTop={1}>
        <Text bold>runs needing operator </Text>
        <Text dimColor>({needsOp.length})</Text>
      </Box>
      {needsOp.length === 0 ? (
        <Text dimColor>  none</Text>
      ) : (
        needsOp.slice(0, 8).map((l) => (
          <Box key={l.id}>
            <Text color="red">  ● </Text>
            <Text>{l.title}</Text>
            <Text dimColor>
              {' '}({laneRig(l) ?? '—'}) — {l.phaseLabel}
            </Text>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text bold>context pressure </Text>
        <Text dimColor>(≥75%)</Text>
      </Box>
      {pressure.length === 0 ? (
        <Text dimColor>  none</Text>
      ) : (
        pressure.slice(0, 8).map((e) => (
          <Box key={e.session.id}>
            <Text color="red">  {e.pct}% </Text>
            <Text wrap="truncate-end">{e.session.title}</Text>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text bold>idle / reallocation </Text>
        <Text dimColor>(agents never active, by rig)</Text>
      </Box>
      {idle.length === 0 ? (
        <Text dimColor>  none</Text>
      ) : (
        idle.slice(0, 10).map((r) => (
          <Box key={r.rig}>
            <Text dimColor>{'  '}</Text>
            <Text>{r.rig}</Text>
            <Text dimColor>
              {'  '}
              {r.neverActive} never / {r.total}
            </Text>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text bold>costs</Text>
      </Box>
      <Text dimColor>
        {'  '}not measured — supervisor exposes no per-run cost yet
      </Text>
      <Text dimColor>  (see specs/architecture/cost-token-feasibility.md)</Text>

      <Box marginTop={1}>
        <Text dimColor>h close · q quit</Text>
      </Box>
    </Box>
  );
}

// ── city board pane (rig × in-flight phase count matrix) ─────────────────────

interface CityBoardPaneProps {
  readonly board: readonly RigPhaseCounts[];
}

const BOARD_RIG_W = 22;
const BOARD_COL_W = 7;

/** One right-aligned count cell. Zero reads as a calm hairline dot so the eye
 *  lands on the populated columns; the needs-operator cell is the board's single
 *  red mark (DESIGN.md One Mark / Greyscale: the count, not a hue, is the data). */
function BoardCell({ n, alert = false }: { readonly n: number; readonly alert?: boolean }): React.JSX.Element {
  return (
    <Box width={BOARD_COL_W} justifyContent="flex-end">
      {n === 0 ? <Text dimColor>·</Text> : alert ? <Text color="red">{n}</Text> : <Text>{n}</Text>}
    </Box>
  );
}

export function CityBoardPane({ board }: CityBoardPaneProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>city board</Text>
      <Text dimColor>(in-flight run lanes by rig, phase columns; complete history not shown)</Text>

      <Box marginTop={1}>
        <Box width={BOARD_RIG_W}>
          <Text dimColor>rig</Text>
        </Box>
        {CITY_BOARD_PHASES.map((p) => (
          <Box key={p} width={BOARD_COL_W} justifyContent="flex-end">
            <Text dimColor>{CITY_BOARD_PHASE_LABEL[p]}</Text>
          </Box>
        ))}
        <Box width={BOARD_COL_W} justifyContent="flex-end">
          <Text dimColor>needs</Text>
        </Box>
      </Box>

      {board.length === 0 ? (
        <Text dimColor>no active runs</Text>
      ) : (
        board.map((r) => (
          <Box key={r.rig}>
            <Box width={BOARD_RIG_W}>
              {/* Weight (not hue) leads the eye to an attention rig; the red mark
                  is reserved for the needs cell. */}
              <Text wrap="truncate-end" bold={r.needsOperator > 0}>
                {r.rig}
              </Text>
            </Box>
            {CITY_BOARD_PHASES.map((p) => (
              <BoardCell key={p} n={r.counts[p]} />
            ))}
            <BoardCell n={r.needsOperator} alert={r.needsOperator > 0} />
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text dimColor>m close · q quit</Text>
      </Box>
    </Box>
  );
}

// ── operator ledger pane (things waiting on the user) ────────────────────────

interface LedgerPaneProps {
  /** Operator-relevant mail (orchestration-sender), already filtered + ordered. */
  readonly mail: readonly GcMailItem[];
  /** Count of unread worker-report mail folded away (mayor-handled). */
  readonly mailFolded: number;
  /** Run lanes flagged needs-operator. */
  readonly runs: readonly RunLane[];
}

/** How many ledger rows each section shows before collapsing to a count. */
const LEDGER_LIMIT = 8;

/** Surfaces what a section's row cap hid, so a long backlog never reads as
 *  "all clear" (no silent truncation). */
function MoreLine({ total, shown }: { readonly total: number; readonly shown: number }): React.JSX.Element | null {
  if (total <= shown) return null;
  return <Text dimColor>  + {total - shown} more</Text>;
}

export function LedgerPane({ mail, mailFolded, runs }: LedgerPaneProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>waiting on you</Text>

      <Box marginTop={1}>
        <Text bold>mail for you </Text>
        <Text dimColor>
          ({mail.length}
          {mailFolded > 0 ? ` · ${mailFolded} worker reports folded, mayor-handled` : ''})
        </Text>
      </Box>
      {mail.length === 0 ? (
        <Text dimColor>  none</Text>
      ) : (
        mail.slice(0, LEDGER_LIMIT).map((m) => (
          <Box key={m.id} flexDirection="column">
            <Box>
              <Text dimColor>  ✉ </Text>
              <Box width={20} marginRight={1}>
                <Text wrap="truncate-end">{basename(m.from) || m.from}</Text>
              </Box>
              <Text wrap="truncate-end">{m.subject}</Text>
              {typeof m.priority === 'number' ? <Text dimColor> · P{m.priority}</Text> : null}
            </Box>
            <Box>
              <Text dimColor wrap="truncate-end">
                {'    '}
                {mailSnippet(m.body, 100)}
              </Text>
            </Box>
          </Box>
        ))
      )}
      <MoreLine total={mail.length} shown={LEDGER_LIMIT} />

      <Box marginTop={1}>
        <Text bold>runs needing operator </Text>
        <Text dimColor>({runs.length})</Text>
      </Box>
      {runs.length === 0 ? (
        <Text dimColor>  none</Text>
      ) : (
        runs.slice(0, LEDGER_LIMIT).map((l) => (
          <Box key={l.id}>
            <Text color="red">  ● </Text>
            <Text wrap="truncate-end">{l.title}</Text>
            <Text dimColor>
              {' '}({laneRig(l) ?? '—'}) — {l.phaseLabel}
            </Text>
          </Box>
        ))
      )}
      <MoreLine total={runs.length} shown={LEDGER_LIMIT} />

      <Box marginTop={1}>
        <Text dimColor>l close · q quit</Text>
      </Box>
    </Box>
  );
}

// ── overview rows (rendered by the generic grouped list) ─────────────────────

interface ActiveAgentRowProps {
  readonly view: AgentView;
  readonly selected: boolean;
  readonly city: string;
  readonly lanes: readonly RunLane[];
  readonly now: number;
}

/** One ACTIVE row in the overview: kind glyph, agent, city/rig, what it's working
 *  on (the assigned run lane, else the activity hint), recency. */
export function ActiveAgentRow({ view, selected, city, lanes, now }: ActiveAgentRowProps): React.JSX.Element {
  const lane = agentLane(view, lanes);
  const work = lane ? `on ${lane.title}` : activityPhrase(view.session);
  return (
    <Box>
      <Box width={2}>{selected ? <Text color="cyan">▸</Text> : <Text> </Text>}</Box>
      <Box width={2}>
        <Text bold={view.kind === 'orch'} dimColor={view.kind !== 'orch'}>
          {kindGlyph(view.kind)}
        </Text>
      </Box>
      <Box width={16} marginRight={1}>
        <Text wrap="truncate-end" bold={selected} inverse={selected}>
          {view.agent}
        </Text>
      </Box>
      <Box width={12} marginRight={1}>
        <Text dimColor wrap="truncate-end">
          {displayRig(view.rig, city)}
        </Text>
      </Box>
      <Box flexGrow={1} marginRight={1}>
        <Text dimColor wrap="truncate-end">
          {work}
        </Text>
      </Box>
      <Box width={5} justifyContent="flex-end">
        <Text dimColor>{relativeTime(view.session.last_active, now)}</Text>
      </Box>
    </Box>
  );
}

interface MailRowProps {
  readonly mail: GcMailItem;
  readonly selected: boolean;
}

/** One WAITING mail row: a quiet envelope, the sender, the subject. `enter`
 *  peeks the full message (read-only `gc mail peek`). */
export function MailRow({ mail, selected }: MailRowProps): React.JSX.Element {
  return (
    <Box>
      <Box width={2}>{selected ? <Text color="cyan">▸</Text> : <Text dimColor>✉</Text>}</Box>
      <Box width={16} marginRight={1}>
        <Text wrap="truncate-end" bold={selected} inverse={selected}>
          {basename(mail.from) || mail.from}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="truncate-end" dimColor>
          {mail.subject}
        </Text>
      </Box>
    </Box>
  );
}
