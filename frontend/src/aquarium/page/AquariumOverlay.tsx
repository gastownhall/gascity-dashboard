// The Pane Rule (DESIGN.md §7): chrome inside the glass is limited to the
// ledger line, the connection state, and the zoom controls. Top-left is the
// single maroon mark; top-right is quiet zoom controls. Everything else the
// operator learns by looking at the water.

import type { AquariumConnState, AquariumDataState } from './useAquariumData';
import type { FlowObservation } from '../contracts';
import { formatTideReport } from './tideReport';

export interface AquariumOverlayProps {
  needsAttention: number;
  flow: FlowObservation;
  connState: AquariumConnState;
  dataState: AquariumDataState;
  coverageKnown: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const ZOOM_BUTTON_CLASS =
  'text-label uppercase tracking-wider text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark';

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
  onZoomIn,
  onZoomOut,
  onReset,
}: AquariumOverlayProps) {
  return (
    <>
      <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:right-auto sm:max-w-[min(70vw,64rem)]">
        <TideLine flow={flow} dataState={dataState} />
        {needsAttention > 0 && <AttentionMark needsAttention={needsAttention} />}
        <span aria-hidden="true" className="text-fg-muted">
          ·
        </span>
        <TankLight connState={connState} />
        {dataState === 'partial' && <CoverageNote flow={flow} coverageKnown={coverageKnown} />}
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
function TideLine({ flow, dataState }: { flow: FlowObservation; dataState: AquariumDataState }) {
  const copy =
    dataState === 'loading'
      ? 'loading reef inventory'
      : dataState === 'unavailable'
        ? 'reef inventory unavailable'
        : formatTideReport(flow);
  return <span className="tnum text-label font-semibold text-fg-muted sm:text-title">{copy}</span>;
}

function CoverageNote({ flow, coverageKnown }: { flow: FlowObservation; coverageKnown: boolean }) {
  return (
    <span
      role="note"
      aria-label="Bead coverage"
      className="tnum text-label uppercase tracking-wider text-warn"
    >
      {coverageKnown
        ? `◒ partial · ${flow.observedRigCount}/${flow.totalRigCount} rigs`
        : '◒ partial inventory'}
    </span>
  );
}

function AttentionMark({ needsAttention }: { needsAttention: number }) {
  return (
    <span className="tnum text-title font-semibold text-accent">
      {needsAttention} need attention
    </span>
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
