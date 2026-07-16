// The Pane Rule (DESIGN.md §7): chrome inside the glass is limited to the
// ledger line, the connection state, and the zoom controls. Top-left is the
// single maroon mark; top-right is quiet zoom controls. Everything else the
// operator learns by looking at the water.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AquariumConnState, AquariumDataState } from './useAquariumData';
import type {
  FishEntity,
  FlowObservation,
  PelletEntity,
  ReefFocus,
  RigFormation,
  StrandedWorkItem,
} from '../contracts';
import { FLOW_STILL_MIN_OBSERVATION_MS, PELLET_STATE_WORD } from '../contracts';
import { isAttentionFish, isBackloggedRig, isWaitingP0 } from './ledgerEligibility';

export interface AquariumOverlayProps {
  needsAttention: number;
  flow: FlowObservation;
  connState: AquariumConnState;
  dataState: AquariumDataState;
  coverageKnown: boolean;
  formations: readonly RigFormation[];
  fish: readonly FishEntity[];
  pellets: readonly PelletEntity[];
  strandedWork: readonly StrandedWorkItem[];
  unavailableRigKeys: readonly string[];
  focus: ReefFocus | null;
  onFocusChange: (focus: ReefFocus | null) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const ZOOM_BUTTON_CLASS =
  'text-label uppercase tracking-wider text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark';
const METRIC_BUTTON_CLASS =
  'pointer-events-auto rounded-sm underline decoration-dotted underline-offset-2 hover:text-fg focus-mark';
const ROW_BUTTON_CLASS =
  'min-w-0 flex-1 rounded-sm text-left text-body text-fg-muted hover:text-fg focus-mark';
const ACTION_LINK_CLASS =
  'shrink-0 rounded-sm text-label uppercase tracking-wider text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg focus-mark';

type LedgerPanel = 'backlog' | 'p0' | 'attention' | 'stranded' | 'coverage';

interface TankLightSpec {
  word: string;
  glyph: string;
  toneClass: string;
}

// Word + glyph + tone per connection state — Greyscale Test safe (the glyph
// alone still distinguishes every state). 'fixture' is a fourth, dev-only
// state: the operator is looking at synthetic data, not a stalled connection.
const TANK_LIGHT: Record<AquariumConnState, TankLightSpec> = {
  connecting: { word: 'connecting', glyph: '◌', toneClass: 'text-fg-muted' },
  open: { word: 'clear', glyph: '●', toneClass: 'text-ok' },
  degraded: { word: 'degraded', glyph: '◐', toneClass: 'text-warn' },
  closed: { word: 'drained', glyph: '○', toneClass: 'text-fg-muted' },
  fixture: { word: 'fixture', glyph: '◇', toneClass: 'text-fg-muted' },
};

export function AquariumOverlay({
  needsAttention,
  flow,
  connState,
  dataState,
  coverageKnown,
  formations,
  fish,
  pellets,
  strandedWork,
  unavailableRigKeys,
  focus,
  onFocusChange,
  onZoomIn,
  onZoomOut,
  onReset,
}: AquariumOverlayProps) {
  const [openPanel, setOpenPanel] = useState<LedgerPanel | null>(null);
  const unavailable = useMemo(() => new Set(unavailableRigKeys), [unavailableRigKeys]);
  const backloggedRigs = useMemo(
    () => formations.filter((formation) => isBackloggedRig(formation, unavailable)),
    [formations, unavailable],
  );
  const p0Waiting = useMemo(
    () =>
      pellets
        .filter((pellet) => isWaitingP0(pellet, unavailable))
        .sort((a, b) => a.rigKey.localeCompare(b.rigKey) || a.beadId.localeCompare(b.beadId)),
    [pellets, unavailable],
  );
  const attentionFish = useMemo(
    () => fish.filter(isAttentionFish).sort((a, b) => a.name.localeCompare(b.name)),
    [fish],
  );
  const rigCoveragePartial =
    !coverageKnown || unavailableRigKeys.length > 0 || flow.observedRigCount < flow.totalRigCount;

  const togglePanel = (panel: LedgerPanel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
    onFocusChange(null);
  };
  const panelAvailable = ledgerPanelAvailable(
    openPanel,
    backloggedRigs.length,
    p0Waiting.length,
    attentionFish.length,
    strandedWork.length,
    dataState,
    rigCoveragePartial,
  );
  const visiblePanel = panelAvailable ? openPanel : null;
  useEffect(() => {
    if (openPanel === null || panelAvailable) return;
    setOpenPanel(null);
    onFocusChange(null);
  }, [onFocusChange, openPanel, panelAvailable]);

  return (
    <>
      <div
        data-aquarium-ledger
        className="pointer-events-none absolute left-4 right-4 top-4 z-10 sm:right-auto sm:max-w-[min(78vw,64rem)]"
      >
        <div data-aquarium-ledger-facts className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <TideLine
            flow={flow}
            dataState={dataState}
            openPanel={visiblePanel}
            onTogglePanel={togglePanel}
          />
          {needsAttention > 0 && (
            <AttentionMark
              needsAttention={needsAttention}
              expanded={visiblePanel === 'attention'}
              onToggle={() => togglePanel('attention')}
            />
          )}
          {strandedWork.length > 0 && (
            <StrandedMark
              count={strandedWork.length}
              expanded={visiblePanel === 'stranded'}
              onToggle={() => togglePanel('stranded')}
            />
          )}
          <span aria-hidden="true" className="text-fg-muted">
            ·
          </span>
          <TankLight connState={connState} />
          {dataState === 'partial' && rigCoveragePartial && (
            <CoverageNote
              flow={flow}
              coverageKnown={coverageKnown}
              expanded={visiblePanel === 'coverage'}
              onToggle={() => togglePanel('coverage')}
            />
          )}
          {dataState === 'partial' && !rigCoveragePartial && <InventoryPartialNote />}
        </div>
        {visiblePanel !== null && (
          <LedgerDetails
            panel={visiblePanel}
            flow={flow}
            coverageKnown={coverageKnown}
            unavailableRigKeys={unavailableRigKeys}
            backloggedRigs={backloggedRigs}
            p0Waiting={p0Waiting}
            attentionFish={attentionFish}
            strandedWork={strandedWork}
            focus={focus}
            onFocusChange={onFocusChange}
            onClose={() => {
              setOpenPanel(null);
              onFocusChange(null);
            }}
          />
        )}
      </div>
      <div
        data-aquarium-zoom
        className="absolute bottom-4 right-4 z-10 flex items-center gap-4 border border-rule bg-surface/70 px-3 py-2 sm:bottom-auto sm:top-4 sm:border-0 sm:bg-transparent sm:p-0"
      >
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          className={ZOOM_BUTTON_CLASS}
        >
          −
        </button>
        <button type="button" onClick={onZoomIn} aria-label="Zoom in" className={ZOOM_BUTTON_CLASS}>
          +
        </button>
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset camera"
          className={ZOOM_BUTTON_CLASS}
        >
          Reset
        </button>
      </div>
    </>
  );
}

// The single maroon mark in the whole /reef viewport (DESIGN.md's One Mark
// Rule, adapted). text-accent appears nowhere else on this route.
function TideLine({
  flow,
  dataState,
  openPanel,
  onTogglePanel,
}: {
  flow: FlowObservation;
  dataState: AquariumDataState;
  openPanel: LedgerPanel | null;
  onTogglePanel: (panel: LedgerPanel) => void;
}) {
  if (dataState === 'loading' || dataState === 'unavailable') {
    const copy = dataState === 'loading' ? 'loading reef inventory' : 'reef inventory unavailable';
    return (
      <span className="tnum text-label font-semibold text-fg-muted sm:text-title">{copy}</span>
    );
  }

  const partial = flow.observedRigCount < flow.totalRigCount;
  const backlogLabel = `${flow.backloggedRigCount} ${partial ? 'observed ' : ''}backlogged ${plural(flow.backloggedRigCount, 'rig')}`;
  const p0Label = `${flow.p0Waiting} P0 waiting`;
  const young = flow.observedForMs < FLOW_STILL_MIN_OBSERVATION_MS;
  const minutes = Math.max(1, Math.floor(flow.observedForMs / 60_000));
  const still =
    flow.stillRigKeys.length > 0
      ? ` · ${flow.stillRigKeys.map(displayRigKey).join(', ')} still`
      : '';

  return (
    <span
      data-testid="aquarium-tide-line"
      className="tnum text-label font-semibold text-fg-muted sm:text-title"
    >
      {young ? (
        <>
          observing flow ·{' '}
          <MetricFact
            label={backlogLabel}
            interactive={flow.backloggedRigCount > 0}
            expanded={openPanel === 'backlog'}
            onClick={() => onTogglePanel('backlog')}
          />{' '}
          ·{' '}
          <MetricFact
            label={p0Label}
            interactive={flow.p0Waiting > 0}
            expanded={openPanel === 'p0'}
            onClick={() => onTogglePanel('p0')}
          />
        </>
      ) : (
        <>
          work moved in {flow.movingRigCount} of{' '}
          <MetricFact
            label={backlogLabel}
            interactive={flow.backloggedRigCount > 0}
            expanded={openPanel === 'backlog'}
            onClick={() => onTogglePanel('backlog')}
          />{' '}
          over {minutes}m{still} ·{' '}
          <MetricFact
            label={p0Label}
            interactive={flow.p0Waiting > 0}
            expanded={openPanel === 'p0'}
            onClick={() => onTogglePanel('p0')}
          />
        </>
      )}
    </span>
  );
}

function MetricFact({
  label,
  interactive,
  expanded,
  onClick,
}: {
  label: string;
  interactive: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  if (!interactive) return <span>{label}</span>;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className={METRIC_BUTTON_CLASS}
    >
      {label}
    </button>
  );
}

function CoverageNote({
  flow,
  coverageKnown,
  expanded,
  onToggle,
}: {
  flow: FlowObservation;
  coverageKnown: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      role="note"
      aria-label="Bead coverage"
      className="tnum text-label uppercase tracking-wider text-warn"
    >
      <button
        type="button"
        aria-label="Explain partial bead coverage"
        aria-expanded={expanded}
        onClick={onToggle}
        className={`${METRIC_BUTTON_CLASS} uppercase`}
      >
        {coverageKnown
          ? `◒ partial · ${flow.observedRigCount}/${flow.totalRigCount} rigs`
          : '◒ partial inventory'}
      </button>
    </span>
  );
}

function InventoryPartialNote() {
  return (
    <span
      role="note"
      aria-label="Partial inventory"
      className="tnum text-label uppercase tracking-wider text-warn"
    >
      ◒ partial inventory
    </span>
  );
}

function AttentionMark({
  needsAttention,
  expanded,
  onToggle,
}: {
  needsAttention: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={`pointer-events-auto rounded-sm tnum text-title font-semibold text-accent underline decoration-dotted underline-offset-2 focus-mark`}
    >
      {needsAttention} need attention
    </button>
  );
}

function StrandedMark({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="pointer-events-auto rounded-sm text-label uppercase tracking-wider text-warn underline decoration-dotted underline-offset-2 transition-colors duration-150 ease-out-quart hover:text-fg focus-mark"
    >
      ◆ {count} stranded
    </button>
  );
}

function TankLight({ connState }: { connState: AquariumConnState }) {
  const spec = TANK_LIGHT[connState];
  return (
    <span role="status" className={`text-label uppercase tracking-wider tnum ${spec.toneClass}`}>
      <span aria-hidden="true">{spec.glyph}</span> {spec.word}
    </span>
  );
}

interface LedgerDetailsProps {
  panel: LedgerPanel;
  flow: FlowObservation;
  coverageKnown: boolean;
  unavailableRigKeys: readonly string[];
  backloggedRigs: readonly RigFormation[];
  p0Waiting: readonly PelletEntity[];
  attentionFish: readonly FishEntity[];
  strandedWork: readonly StrandedWorkItem[];
  focus: ReefFocus | null;
  onFocusChange: (focus: ReefFocus | null) => void;
  onClose: () => void;
}

function LedgerDetails(props: LedgerDetailsProps) {
  const title = panelTitle(props.panel);
  return (
    <section
      role="region"
      aria-label={`${title} details`}
      className="pointer-events-auto mt-2 max-h-[min(42vh,22rem)] w-full max-w-xl overflow-y-auto border border-rule bg-surface/90 px-3 py-2 text-body text-fg"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-label font-semibold uppercase tracking-wider">{title}</h2>
        <button
          type="button"
          aria-label={`Close ${title} details`}
          onClick={props.onClose}
          className={ACTION_LINK_CLASS}
        >
          close
        </button>
      </div>
      {props.panel === 'backlog' && <BacklogDetails {...props} />}
      {props.panel === 'p0' && <P0Details {...props} />}
      {props.panel === 'attention' && <AttentionDetails {...props} />}
      {props.panel === 'stranded' && <StrandedDetails {...props} />}
      {props.panel === 'coverage' && <PartialDetails {...props} />}
    </section>
  );
}

function BacklogDetails({ backloggedRigs, flow, focus, onFocusChange }: LedgerDetailsProps) {
  const recentlyMoving = new Set(flow.recentlyMovingRigKeys);
  return (
    <>
      <p className="mt-1 text-label text-fg-muted">
        A morsel held at a fish&apos;s mouth is that agent&apos;s current bead. A bubble trail means
        work moved in the last 15 minutes.
      </p>
      <ul className="mt-2 space-y-1">
        {backloggedRigs.map((formation) => {
          const selected = focus?.kind === 'rig' && focus.rigKey === formation.key;
          return (
            <li key={formation.key}>
              <button
                type="button"
                aria-label={`Highlight rig ${formation.key}`}
                aria-pressed={selected}
                onClick={() =>
                  onFocusChange(selected ? null : { kind: 'rig', rigKey: formation.key })
                }
                className={`${ROW_BUTTON_CLASS} flex w-full items-baseline justify-between gap-4`}
              >
                <span className={selected ? 'font-semibold text-fg' : undefined}>
                  {displayRigKey(formation.key)}
                </span>
                <span className="tnum shrink-0 text-label uppercase tracking-wider">
                  {formation.openBeadTotal} open
                  {recentlyMoving.has(formation.key) ? ' · moved recently' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-label text-fg-muted">
        Dashed marks show the selected formation and its currently rendered beads. Zooming in
        reveals the thinned backlog.
      </p>
    </>
  );
}

function P0Details({ p0Waiting, focus, onFocusChange }: LedgerDetailsProps) {
  return (
    <>
      <p className="mt-1 text-label text-fg-muted">
        Select a bead to draw a dashed focus mark around its morsel.
      </p>
      <ul className="mt-2 space-y-2">
        {p0Waiting.map((pellet) => {
          const selected = focus?.kind === 'bead' && focus.beadId === pellet.beadId;
          return (
            <li key={pellet.beadId} className="flex items-baseline gap-3">
              <button
                type="button"
                aria-label={`Highlight bead ${pellet.beadId}`}
                aria-pressed={selected}
                onClick={() =>
                  onFocusChange(selected ? null : { kind: 'bead', beadId: pellet.beadId })
                }
                className={ROW_BUTTON_CLASS}
              >
                <span className={`block ${selected ? 'font-semibold text-fg' : ''}`}>
                  {pellet.title.length > 0 ? pellet.title : pellet.label}
                </span>
                <span className="block text-label uppercase tracking-wider">
                  {displayRigKey(pellet.rigKey)} · {PELLET_STATE_WORD[pellet.state]} ·{' '}
                  {pellet.beadId}
                </span>
              </button>
              <Link to={pellet.linkTo} className={ACTION_LINK_CLASS}>
                open
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AttentionDetails({ attentionFish, focus, onFocusChange }: LedgerDetailsProps) {
  return (
    <>
      <p className="mt-1 text-label text-fg-muted">
        Select an agent to mark its fish on the surface shelf.
      </p>
      <ul className="mt-2 space-y-2">
        {attentionFish.map((entity) => {
          const selected = focus?.kind === 'fish' && focus.fishId === entity.id;
          return (
            <li key={entity.id} className="flex items-baseline gap-3">
              <button
                type="button"
                aria-label={`Highlight agent ${entity.name}`}
                aria-pressed={selected}
                onClick={() => onFocusChange(selected ? null : { kind: 'fish', fishId: entity.id })}
                className={ROW_BUTTON_CLASS}
              >
                <span className={`block ${selected ? 'font-semibold text-fg' : ''}`}>
                  {entity.name}
                </span>
                <span className="block text-label uppercase tracking-wider">
                  {displayRigKey(entity.homeKey)} · {entity.poseWord}
                </span>
              </button>
              <Link to={entity.linkTo} className={ACTION_LINK_CLASS}>
                open
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function StrandedDetails({ strandedWork }: LedgerDetailsProps) {
  const ordered = [...strandedWork].sort(
    (a, b) => a.rigKey.localeCompare(b.rigKey) || a.title.localeCompare(b.title),
  );
  return (
    <>
      <p className="mt-1 text-label text-fg-muted">
        Orphaned work whose assigned agent session ended mid-flight.
      </p>
      <ul className="mt-2 space-y-2">
        {ordered.map((work) => (
          <li key={work.beadId} className="flex min-w-0 items-baseline gap-3">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-body text-fg-muted">{work.title}</span>
              <span className="block text-label uppercase tracking-wider text-fg-muted">
                {displayRigKey(work.rigKey)} · {work.beadId}
              </span>
            </div>
            <Link to={work.linkTo} aria-label={`Open ${work.title}`} className={ACTION_LINK_CLASS}>
              open
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function PartialDetails({ flow, coverageKnown, unavailableRigKeys }: LedgerDetailsProps) {
  if (!coverageKnown) {
    return (
      <p className="mt-1 text-fg-muted">
        Current rig coverage is unknown because the rig list or rig bead reads are incomplete or
        stale. Counts retain only available or last-known data.
      </p>
    );
  }
  return (
    <>
      <p className="mt-1 text-fg-muted">
        {flow.observedRigCount} of {flow.totalRigCount} rig bead reads completed. Tide-report counts
        exclude unavailable rigs.
      </p>
      {unavailableRigKeys.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-label uppercase tracking-wider text-fg-muted">
          {unavailableRigKeys.map((rigKey) => (
            <li key={rigKey}>{displayRigKey(rigKey)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function panelTitle(panel: LedgerPanel): string {
  switch (panel) {
    case 'backlog':
      return 'Backlogged rig';
    case 'p0':
      return 'P0 waiting';
    case 'attention':
      return 'Needs attention';
    case 'stranded':
      return 'Stranded work';
    case 'coverage':
      return 'Partial coverage';
  }
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function displayRigKey(key: string): string {
  return key.replaceAll('-', ' ').toUpperCase();
}

function ledgerPanelAvailable(
  panel: LedgerPanel | null,
  backlogCount: number,
  p0Count: number,
  attentionCount: number,
  strandedCount: number,
  dataState: AquariumDataState,
  coverageDrillable: boolean,
): boolean {
  if (panel === null || dataState === 'loading' || dataState === 'unavailable') return false;
  switch (panel) {
    case 'backlog':
      return backlogCount > 0;
    case 'p0':
      return p0Count > 0;
    case 'attention':
      return attentionCount > 0;
    case 'stranded':
      return strandedCount > 0;
    case 'coverage':
      return dataState === 'partial' && coverageDrillable;
  }
}
